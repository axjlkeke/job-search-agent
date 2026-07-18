from __future__ import annotations

import hashlib
import ipaddress
import re
import socket
import subprocess
from collections import deque
from dataclasses import dataclass, field
from io import BytesIO
from typing import Any, Callable, Mapping
from urllib.parse import parse_qsl, urlencode, urljoin, urlsplit, urlunsplit

import httpx
from bs4 import BeautifulSoup
from pypdf import PdfReader

from .config import Settings
from .database import KnowledgeDatabase
from .dify import DifyDocumentError, sync_document_to_dify
from .document_quality import (
    DOCUMENT_ROLE_CONTENT_STUB,
    document_quality_metadata,
    is_retrieval_eligible,
)
from .fact_review import analyze_cross_document_change, analyze_version_change


class SyncError(RuntimeError):
    pass


@dataclass(slots=True)
class ExtractedDocument:
    url: str
    title: str
    content: str
    mime_type: str
    published_at: str | None
    links: list[str]
    metadata: dict[str, Any]
    ocr_artifacts: list["OcrArtifact"] = field(default_factory=list)


@dataclass(frozen=True, slots=True)
class OcrArtifact:
    image_url: str
    image_hash: str
    raw_text: str
    normalized_text: str
    engine: str
    engine_config: dict[str, Any]
    quality: dict[str, Any]


OcrArtifactResolver = Callable[[str, str], OcrArtifact | None]


TRACKING_QUERY_KEYS = {
    "from",
    "spm",
    "utm_campaign",
    "utm_content",
    "utm_medium",
    "utm_source",
    "utm_term",
}
FAKE_IP_NETWORKS = (ipaddress.ip_network("198.18.0.0/15"),)
OCR_MAX_TEXT_CHARS = 100_000
OCR_MIN_QUALITY_SCORE = 70
DISCOVERY_INDEX_FILENAME = re.compile(
    r"^index(?:_[0-9]+)*(?:\.s?html?)?$",
    re.IGNORECASE,
)
UNSUPPORTED_FOLLOW_LINK_SUFFIXES = (
    ".7z",
    ".avi",
    ".bmp",
    ".doc",
    ".docm",
    ".docx",
    ".dps",
    ".et",
    ".flv",
    ".gif",
    ".gz",
    ".jpeg",
    ".jpg",
    ".m4a",
    ".mkv",
    ".mov",
    ".mp3",
    ".mp4",
    ".png",
    ".ppt",
    ".pptm",
    ".pptx",
    ".rar",
    ".tar",
    ".tif",
    ".tiff",
    ".wav",
    ".webm",
    ".webp",
    ".wps",
    ".xls",
    ".xlsm",
    ".xlsx",
    ".zip",
)


def canonicalize_url(url: str) -> str:
    parts = urlsplit(url)
    query = urlencode(
        sorted(
            (key, value)
            for key, value in parse_qsl(parts.query, keep_blank_values=True)
            if key.lower() not in TRACKING_QUERY_KEYS
        ),
        doseq=True,
    )
    scheme = parts.scheme.lower()
    hostname = (parts.hostname or "").lower()
    port = parts.port
    netloc = hostname
    if port and not ((scheme == "http" and port == 80) or (scheme == "https" and port == 443)):
        netloc = f"{hostname}:{port}"
    path = parts.path or "/"
    return urlunsplit((scheme, netloc, path, query, ""))


def _is_discovery_queue_url(url: str) -> bool:
    filename = urlsplit(str(url or "")).path.rstrip("/").rsplit("/", 1)[-1]
    return bool(DISCOVERY_INDEX_FILENAME.fullmatch(filename))


def _is_supported_follow_link(url: str) -> bool:
    path = urlsplit(str(url or "")).path.casefold()
    return not path.endswith(UNSUPPORTED_FOLLOW_LINK_SUFFIXES)


def validate_public_url(
    url: str,
    *,
    allowed_hosts: set[str] | None = None,
    allow_fake_ip_dns: bool = False,
) -> None:
    parts = urlsplit(url)
    if parts.scheme not in {"http", "https"} or not parts.hostname:
        raise SyncError("只允许抓取公开的 http/https 地址")
    hostname = parts.hostname.casefold()
    if allowed_hosts is not None and hostname not in allowed_hosts:
        raise SyncError("目标域名不在该来源的允许列表中")
    try:
        direct_ip = ipaddress.ip_address(parts.hostname)
    except ValueError:
        direct_ip = None
    if direct_ip is not None:
        addresses = [direct_ip]
    else:
        try:
            addresses = {
                ipaddress.ip_address(item[4][0])
                for item in socket.getaddrinfo(parts.hostname, parts.port or 443)
            }
        except (OSError, ValueError) as error:
            raise SyncError(f"域名无法解析：{parts.hostname}") from error
    def permitted(address: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
        if address.is_global:
            return True
        return (
            direct_ip is None
            and allow_fake_ip_dns
            and allowed_hosts is not None
            and hostname in allowed_hosts
            and any(address in network for network in FAKE_IP_NETWORKS)
        )

    if not addresses or any(not permitted(address) for address in addresses):
        raise SyncError("拒绝访问内网、回环或保留地址")


def source_allows_url(source: Mapping[str, Any], url: str) -> bool:
    parts = urlsplit(canonicalize_url(url))
    hostname = (parts.hostname or "").casefold()
    root_hostname = (urlsplit(str(source["url"])).hostname or "").casefold()
    allowed_hosts = {
        str(host).casefold()
        for host in source.get("allowed_hosts", [])
        if str(host).strip()
    } or {root_hostname}
    if hostname not in allowed_hosts:
        return False
    path = parts.path or "/"
    include_paths = [str(value) for value in source.get("include_paths", [])]
    exclude_paths = [str(value) for value in source.get("exclude_paths", [])]
    if include_paths and not any(path.startswith(prefix) for prefix in include_paths):
        return False
    return not any(path.startswith(prefix) for prefix in exclude_paths)


def _decode_text(body: bytes, content_type: str) -> str:
    charset_match = re.search(r"charset=([\w-]+)", content_type, flags=re.I)
    encodings = [charset_match.group(1)] if charset_match else []
    encodings.extend(["utf-8", "gb18030"])
    for encoding in encodings:
        try:
            return body.decode(encoding)
        except (LookupError, UnicodeDecodeError):
            continue
    return body.decode("utf-8", errors="replace")


def _normalize_content(value: str) -> str:
    lines = [" ".join(line.split()) for line in value.replace("\x00", "").splitlines()]
    return "\n".join(line for line in lines if line).strip()


def _normalize_ocr_content(value: str) -> str:
    lines: list[str] = []
    for raw_line in value.replace("\x00", "").splitlines():
        line = " ".join(raw_line.split()).strip()
        if not line:
            continue
        signal = re.findall(r"[A-Za-z0-9\u4e00-\u9fff]", line)
        # Remove isolated decoration marks and one-letter Latin fragments, but
        # retain short Chinese labels such as 北京 and technical labels like AI.
        if not re.search(r"[\u4e00-\u9fff]", line) and len(signal) <= 1:
            continue
        lines.append(line)
    return "\n".join(lines).strip()[:OCR_MAX_TEXT_CHARS]


def _ocr_quality(content: str) -> dict[str, Any]:
    lines = [line for line in content.splitlines() if line]
    cjk_count = len(re.findall(r"[\u4e00-\u9fff]", content))
    signal_count = len(re.findall(r"[A-Za-z0-9\u4e00-\u9fff]", content))
    short_lines = sum(
        1
        for line in lines
        if len(re.findall(r"[A-Za-z0-9\u4e00-\u9fff]", line)) <= 2
    )
    short_line_ratio = short_lines / len(lines) if lines else 1.0
    signal_ratio = signal_count / max(len(content), 1)
    replacement_chars = content.count("\ufffd")

    score = 100
    if len(content) < 200:
        score -= 35
    elif len(content) < 500:
        score -= 15
    if cjk_count < 80:
        score -= 25
    elif cjk_count < 200:
        score -= 10
    if short_line_ratio > 0.35:
        score -= 25
    elif short_line_ratio > 0.20:
        score -= 10
    if signal_ratio < 0.45:
        score -= 15
    if replacement_chars:
        score -= 20
    score = max(0, min(score, 100))
    return {
        "score": score,
        "needsReview": score < OCR_MIN_QUALITY_SCORE,
        "characterCount": len(content),
        "cjkCount": cjk_count,
        "lineCount": len(lines),
        "shortLineRatio": round(short_line_ratio, 4),
        "signalRatio": round(signal_ratio, 4),
        "replacementCharacterCount": replacement_chars,
    }


def _read_response(
    client: httpx.Client,
    url: str,
    max_bytes: int,
    *,
    allowed_hosts: set[str] | None = None,
    allow_fake_ip_dns: bool = False,
) -> tuple[str, str, bytes]:
    current_url = canonicalize_url(url)
    for _ in range(6):
        validate_public_url(
            current_url,
            allowed_hosts=allowed_hosts,
            allow_fake_ip_dns=allow_fake_ip_dns,
        )
        with client.stream("GET", current_url) as response:
            if response.status_code in {301, 302, 303, 307, 308}:
                location = response.headers.get("location")
                if not location:
                    raise SyncError(f"重定向缺少 Location：{current_url}")
                current_url = canonicalize_url(urljoin(current_url, location))
                continue
            response.raise_for_status()
            declared_size = response.headers.get("content-length")
            if declared_size and int(declared_size) > max_bytes:
                raise SyncError(f"文件超过上限 {max_bytes} 字节")
            chunks: list[bytes] = []
            size = 0
            for chunk in response.iter_bytes():
                size += len(chunk)
                if size > max_bytes:
                    raise SyncError(f"文件超过上限 {max_bytes} 字节")
                chunks.append(chunk)
            content_type = response.headers.get("content-type", "").lower()
            return canonicalize_url(str(response.url)), content_type, b"".join(chunks)
    raise SyncError("重定向次数过多")


def _html_document(url: str, body: bytes, content_type: str) -> ExtractedDocument:
    markup = _decode_text(body, content_type)
    soup = BeautifulSoup(markup, "html.parser")
    title = ""
    if soup.title:
        title = soup.title.get_text(" ", strip=True)
    heading = soup.find("h1")
    if heading and heading.get_text(" ", strip=True):
        title = heading.get_text(" ", strip=True)
    if not title:
        title = urlsplit(url).path.rsplit("/", 1)[-1] or urlsplit(url).hostname or "未命名资料"

    published_at = None
    for selector, attribute in (
        ('meta[property="article:published_time"]', "content"),
        ('meta[name="publishdate"]', "content"),
        ('meta[name="date"]', "content"),
        ("time[datetime]", "datetime"),
    ):
        node = soup.select_one(selector)
        if node and node.get(attribute):
            published_at = str(node.get(attribute)).strip()[:80] or None
            if published_at:
                break

    links: list[str] = []
    for anchor in soup.find_all("a", href=True):
        href = str(anchor.get("href", "")).strip()
        if not href or href.startswith(("mailto:", "tel:", "javascript:")):
            continue
        candidate = canonicalize_url(urljoin(url, href))
        if urlsplit(candidate).hostname == urlsplit(url).hostname:
            links.append(candidate)

    candidate_containers = []
    for selector in (
        "#article_inbox",
        ".zsy_content",
        ".TRS_Editor",
        ".article-content",
        "article",
        "main",
    ):
        candidate_containers.extend(soup.select(selector))
    container = max(
        candidate_containers,
        key=lambda node: len(node.get_text(" ", strip=True))
        + len(node.find_all("img", src=True)) * 200,
        default=soup.body or soup,
    )
    image_urls: list[str] = []
    for image in container.find_all("img", src=True):
        src = str(image.get("src", "")).strip()
        if not src or src.startswith("data:"):
            continue
        candidate = canonicalize_url(urljoin(url, src))
        if urlsplit(candidate).hostname == urlsplit(url).hostname:
            image_urls.append(candidate)

    for tag in container.find_all(
        ["script", "style", "noscript", "svg", "canvas", "template"]
    ):
        tag.decompose()
    content = _normalize_content(container.get_text("\n", strip=True))
    if len(content) < 40 and not image_urls:
        raise SyncError("页面正文过短，可能需要 JavaScript 渲染或人工复核")
    return ExtractedDocument(
        url=url,
        title=_normalize_content(title)[:500],
        content=content,
        mime_type="text/html",
        published_at=published_at,
        links=list(dict.fromkeys(links)),
        metadata={
            "contentType": content_type or "text/html",
            "imageUrls": list(dict.fromkeys(image_urls))[:20],
        },
    )


def _ocr_image_url(
    client: httpx.Client,
    *,
    url: str,
    settings: Settings,
    allowed_hosts: set[str],
    artifact_resolver: OcrArtifactResolver | None = None,
) -> OcrArtifact:
    if not settings.ocr_configured:
        raise SyncError("图片正文需要 OCR，但 OCR 尚未配置")
    final_url, content_type, body = _read_response(
        client,
        url,
        settings.max_fetch_bytes,
        allowed_hosts=allowed_hosts,
        allow_fake_ip_dns=settings.allow_fake_ip_dns,
    )
    suffix = urlsplit(final_url).path.lower()
    if not content_type.startswith("image/") and not suffix.endswith(
        (".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff")
    ):
        raise SyncError("OCR 目标不是受支持的图片")
    image_hash = hashlib.sha256(body).hexdigest()

    attempts: list[tuple[list[str], str, dict[str, Any]]] = []
    if settings.vision_ocr_path:
        attempts.append(
            (
                [settings.vision_ocr_path, "-"],
                "apple-vision-accurate-zh-Hans+en-US",
                {
                    "recognitionLevel": "accurate",
                    "languages": ["zh-Hans", "en-US"],
                    "languageCorrection": True,
                },
            )
        )
    if settings.tesseract_path and settings.tessdata_dir:
        attempts.append(
            (
                [
                    settings.tesseract_path,
                    "stdin",
                    "stdout",
                    "--tessdata-dir",
                    str(settings.tessdata_dir),
                    "-l",
                    "chi_sim+eng",
                    "--psm",
                    "3",
                ],
                "tesseract-chi_sim+eng",
                {"languages": ["chi_sim", "eng"], "pageSegmentationMode": 3},
            )
        )
    if artifact_resolver is not None:
        cached = artifact_resolver(final_url, image_hash)
        if cached is not None and any(
            cached.engine == engine and cached.engine_config == engine_config
            for _, engine, engine_config in attempts
        ):
            return cached

    last_error: Exception | None = None
    for command, engine, engine_config in attempts:
        try:
            process = subprocess.run(
                command,
                input=body,
                capture_output=True,
                timeout=settings.ocr_timeout_seconds,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired) as error:
            last_error = error
            continue
        if process.returncode != 0:
            last_error = SyncError("图片 OCR 返回失败状态")
            continue
        raw_text = process.stdout.decode("utf-8", errors="replace")[:OCR_MAX_TEXT_CHARS]
        content = _normalize_ocr_content(raw_text)
        if len(content) < 80:
            last_error = SyncError("图片 OCR 有效文字过短")
            continue
        return OcrArtifact(
            image_url=final_url,
            image_hash=image_hash,
            raw_text=raw_text,
            normalized_text=content,
            engine=engine,
            engine_config=engine_config,
            quality=_ocr_quality(content),
        )
    raise SyncError("图片 OCR 执行失败") from last_error


def _enrich_document_with_ocr(
    client: httpx.Client,
    *,
    document: ExtractedDocument,
    settings: Settings,
    source: Mapping[str, Any],
    allowed_hosts: set[str],
    artifact_resolver: OcrArtifactResolver | None = None,
) -> tuple[ExtractedDocument, list[str]]:
    image_urls = [
        str(value)
        for value in document.metadata.get("imageUrls", [])
        if isinstance(value, str) and source_allows_url(source, value)
    ][: settings.ocr_max_images]
    if len(document.content) >= settings.ocr_trigger_chars or not image_urls:
        return document, []
    if not settings.ocr_configured:
        document.metadata["ocrStatus"] = "required"
        return document, ["页面主要正文位于图片中，OCR 尚未配置"]

    recognized: list[OcrArtifact] = []
    errors: list[str] = []
    for image_url in image_urls:
        try:
            artifact = _ocr_image_url(
                client,
                url=image_url,
                settings=settings,
                allowed_hosts=allowed_hosts,
                artifact_resolver=artifact_resolver,
            )
            recognized.append(artifact)
        except SyncError as error:
            errors.append(f"{image_url}: {error}")

    if recognized:
        document.content = _normalize_content(
            f"{document.content}\n[图片文字识别]\n"
            + "\n".join(item.normalized_text for item in recognized)
        )
        document.ocr_artifacts.extend(recognized)
        quality_scores = [int(item.quality["score"]) for item in recognized]
        needs_review = any(bool(item.quality["needsReview"]) for item in recognized)
        engines = list(dict.fromkeys(item.engine for item in recognized))
        document.metadata.update(
            {
                "ocrStatus": "review_required" if needs_review else "completed",
                "ocrEngine": engines[0] if len(engines) == 1 else engines,
                "ocrImageCount": len(recognized),
                "ocrSourceUrls": [item.image_url for item in recognized],
                "ocrQualityScore": min(quality_scores),
                "ocrNeedsReview": needs_review,
            }
        )
    else:
        document.metadata["ocrStatus"] = "failed"
        if not errors:
            errors.append("图片 OCR 未生成有效正文")
    return document, errors


def _current_ocr_artifact_resolver(
    database: KnowledgeDatabase,
    snapshot: Mapping[str, Any] | None,
) -> OcrArtifactResolver | None:
    if snapshot is None or not snapshot.get("current_version_id"):
        return None
    current_version_id = str(snapshot["current_version_id"])
    artifacts = [
        artifact
        for artifact in database.list_ocr_artifacts(str(snapshot["document_id"]))
        if str(artifact["version_id"]) == current_version_id
    ]
    if not artifacts:
        return None

    def resolve(image_url: str, image_hash: str) -> OcrArtifact | None:
        normalized_url = canonicalize_url(image_url)
        candidates = [
            artifact
            for artifact in artifacts
            if str(artifact["image_hash"]) == image_hash
        ]
        exact = next(
            (
                artifact
                for artifact in candidates
                if canonicalize_url(str(artifact["image_url"])) == normalized_url
            ),
            None,
        )
        selected = exact or (candidates[0] if candidates else None)
        if selected is None:
            return None
        return OcrArtifact(
            image_url=image_url,
            image_hash=image_hash,
            raw_text=str(selected["raw_text"]),
            normalized_text=str(selected["normalized_text"]),
            engine=str(selected["engine"]),
            engine_config=dict(selected["engine_config"]),
            quality=dict(selected["quality"]),
        )

    return resolve


def _pdf_document(url: str, body: bytes, content_type: str) -> ExtractedDocument:
    try:
        reader = PdfReader(BytesIO(body))
        content = _normalize_content(
            "\n".join((page.extract_text() or "") for page in reader.pages)
        )
    except Exception as error:  # pypdf 的解析异常类型并不稳定
        raise SyncError("PDF 无法解析") from error
    if len(content) < 40:
        raise SyncError("PDF 没有可提取正文，可能需要 OCR 人工复核")
    metadata = reader.metadata or {}
    title = str(metadata.get("/Title") or "").strip()
    if not title:
        title = urlsplit(url).path.rsplit("/", 1)[-1] or "未命名 PDF"
    return ExtractedDocument(
        url=url,
        title=title[:500],
        content=content,
        mime_type="application/pdf",
        published_at=None,
        links=[],
        metadata={"contentType": content_type or "application/pdf", "pages": len(reader.pages)},
    )


def _text_document(url: str, body: bytes, content_type: str) -> ExtractedDocument:
    content = _normalize_content(_decode_text(body, content_type))
    if len(content) < 40:
        raise SyncError("文本正文过短")
    title = urlsplit(url).path.rsplit("/", 1)[-1] or urlsplit(url).hostname or "未命名文本"
    return ExtractedDocument(
        url=url,
        title=title[:500],
        content=content,
        mime_type=(content_type.split(";", 1)[0] or "text/plain"),
        published_at=None,
        links=[],
        metadata={"contentType": content_type or "text/plain"},
    )


def fetch_document(
    client: httpx.Client,
    *,
    url: str,
    declared_type: str,
    max_bytes: int,
    allowed_hosts: set[str] | None = None,
    allow_fake_ip_dns: bool = False,
) -> ExtractedDocument:
    final_url, content_type, body = _read_response(
        client,
        url,
        max_bytes,
        allowed_hosts=allowed_hosts,
        allow_fake_ip_dns=allow_fake_ip_dns,
    )
    effective_type = declared_type
    if effective_type == "auto":
        if "pdf" in content_type or final_url.lower().endswith(".pdf"):
            effective_type = "pdf"
        elif "html" in content_type or not content_type:
            effective_type = "html"
        elif content_type.startswith("text/") or "json" in content_type:
            effective_type = "text"
        else:
            raise SyncError(f"暂不支持的内容类型：{content_type or 'unknown'}")
    if effective_type == "pdf":
        return _pdf_document(final_url, body, content_type)
    if effective_type == "text":
        return _text_document(final_url, body, content_type)
    return _html_document(final_url, body, content_type)


def sync_source(
    database: KnowledgeDatabase,
    settings: Settings,
    source_ref: str,
) -> dict[str, Any]:
    source = database.get_source(source_ref)
    if source is None:
        raise SyncError(f"来源不存在：{source_ref}")
    if not source["enabled"]:
        raise SyncError("来源尚未启用；请先审核来源配置再启用")

    run_id = database.begin_sync_run(source["id"])
    initial_url = canonicalize_url(source["url"])
    priority_queue = deque([initial_url])
    discovery_queue: deque[str] = deque()
    queued = {initial_url}
    visited: set[str] = set()
    documents_seen = 0
    documents_changed = 0
    errors: list[str] = []
    max_documents = int(source.get("max_documents", 1))
    allowed_hosts = {
        str(host).casefold()
        for host in source.get("allowed_hosts", [])
        if str(host).strip()
    } or {(urlsplit(str(source["url"])).hostname or "").casefold()}

    try:
        with httpx.Client(
            timeout=settings.fetch_timeout_seconds,
            follow_redirects=False,
            trust_env=False,
            proxy=settings.proxy_url,
            headers={"User-Agent": settings.user_agent, "Accept": "text/html,application/pdf,text/plain,*/*;q=0.2"},
        ) as client:
            while (
                priority_queue or discovery_queue
            ) and documents_seen < max_documents:
                queue = priority_queue if priority_queue else discovery_queue
                url = queue.popleft()
                queued.discard(url)
                if url in visited:
                    continue
                visited.add(url)
                try:
                    document = fetch_document(
                        client,
                        url=url,
                        declared_type=source["source_type"] if not documents_seen else "auto",
                        max_bytes=settings.max_fetch_bytes,
                        allowed_hosts=allowed_hosts,
                        allow_fake_ip_dns=settings.allow_fake_ip_dns,
                    )
                    if not source_allows_url(source, document.url):
                        raise SyncError(
                            "最终页面超出来源允许的域名或路径范围"
                        )
                    snapshot = database.get_document_snapshot(
                        source_id=source["id"],
                        canonical_url=document.url,
                    )
                    document, ocr_errors = _enrich_document_with_ocr(
                        client,
                        document=document,
                        settings=settings,
                        source=source,
                        allowed_hosts=allowed_hosts,
                        artifact_resolver=_current_ocr_artifact_resolver(
                            database,
                            snapshot,
                        ),
                    )
                    document.metadata.update(
                        document_quality_metadata(
                            title=document.title,
                            url=document.url,
                            content=document.content,
                            metadata=document.metadata,
                        )
                    )
                    candidate_retrieval_eligible = bool(
                        document.metadata["retrievalEligible"]
                    )
                    for ocr_error in ocr_errors:
                        errors.append(f"{document.url}: {ocr_error}")
                        database.queue_review(
                            source_id=source["id"],
                            kind="ocr_failure",
                            message=ocr_error,
                            payload={"url": document.url, "runId": run_id},
                        )
                    documents_seen += 1
                    digest = hashlib.sha256(document.content.encode("utf-8")).hexdigest()
                    metadata = {
                        **document.metadata,
                        "sourceGrade": source["source_grade"],
                        "tags": source["tags"],
                        "outboundLinks": document.links[:100],
                    }
                    previous_retrieval_eligible = bool(
                        snapshot
                        and is_retrieval_eligible(
                            title=str(snapshot["title"]),
                            url=str(snapshot["canonical_url"]),
                            content=str(snapshot["content"]),
                            metadata=snapshot["metadata"],
                        )
                    )
                    held_for_cross_review = False
                    rejected_hashes = (
                        snapshot["metadata"].get("rejectedContentHashes", [])
                        if snapshot
                        else []
                    )
                    ignored_candidate = digest in rejected_hashes
                    held_for_review = False
                    result: dict[str, Any] | None = None
                    if snapshot is None and candidate_retrieval_eligible:
                        cross_analysis = analyze_cross_document_change(
                            candidate_title=document.title,
                            candidate_content=document.content,
                            candidate_links=document.links,
                            existing_documents=(
                                database.find_cross_document_candidates(
                                    source_id=source["id"],
                                    canonical_url=document.url,
                                    explicit_links=document.links,
                                )
                            ),
                        )
                        if cross_analysis["requiresReview"]:
                            result = database.create_cross_document_review(
                                source=source,
                                canonical_url=document.url,
                                title=document.title,
                                content=document.content,
                                content_hash=digest,
                                mime_type=document.mime_type,
                                published_at=document.published_at,
                                metadata=metadata,
                                analysis=cross_analysis,
                            )
                            held_for_cross_review = True
                            database.queue_review(
                                source_id=source["id"],
                                document_id=result["document_id"],
                                kind="cross_document_change",
                                message=(
                                    "发现新 URL 的更正、撤回、延期、暂停、恢复"
                                    "或取消公告，"
                                    "候选关系已隔离待审核"
                                ),
                                payload={
                                    "url": document.url,
                                    "runId": run_id,
                                    "crossReviewId": result["cross_review_id"],
                                    "relationType": cross_analysis[
                                        "relationType"
                                    ],
                                    "changeScope": cross_analysis[
                                        "changeScope"
                                    ],
                                    "resolutionMode": cross_analysis[
                                        "resolutionMode"
                                    ],
                                    "resumeCompleteness": cross_analysis[
                                        "resumeCompleteness"
                                    ],
                                    "suggestedTargets": cross_analysis[
                                        "suggestedTargets"
                                    ],
                                },
                            )
                    elif (
                        snapshot is not None
                        and snapshot["status"] == "review_pending"
                    ):
                        result = database.upsert_document(
                            source=source,
                            canonical_url=document.url,
                            title=document.title,
                            content=document.content,
                            content_hash=digest,
                            mime_type=document.mime_type,
                            published_at=document.published_at,
                            metadata=metadata,
                        )
                        held_for_cross_review = True

                    if result is None and ignored_candidate and snapshot is not None:
                        result = {
                            "document_id": snapshot["document_id"],
                            "version_id": snapshot["current_version_id"],
                            "version_no": None,
                            "changed": False,
                            "content_hash": snapshot["content_hash"],
                            "status": snapshot["status"],
                            "ignored_candidate": True,
                        }
                    elif result is None:
                        analysis = (
                            analyze_version_change(
                                previous_title=snapshot["title"],
                                previous_content=snapshot["content"],
                                previous_metadata=snapshot["metadata"],
                                candidate_title=document.title,
                                candidate_content=document.content,
                                candidate_metadata=metadata,
                            )
                            if (
                                snapshot
                                and snapshot["content_hash"] != digest
                                and (
                                    candidate_retrieval_eligible
                                    or previous_retrieval_eligible
                                )
                            )
                            else {"requiresReview": False}
                        )
                        held_for_review = bool(analysis["requiresReview"])
                        if held_for_review:
                            result = database.stage_document_version(
                                source=source,
                                canonical_url=document.url,
                                title=document.title,
                                content=document.content,
                                content_hash=digest,
                                mime_type=document.mime_type,
                                published_at=document.published_at,
                                metadata=metadata,
                                analysis=analysis,
                            )
                            previous_pending = snapshot["metadata"].get("factReview")
                            if result["changed"] and previous_pending:
                                database.resolve_reviews(
                                    document_id=result["document_id"],
                                    kinds=["fact_change"],
                                )
                            database.queue_review(
                                source_id=source["id"],
                                document_id=result["document_id"],
                                kind="fact_change",
                                message="招聘公告关键事实变化，候选版本已隔离待审核",
                                payload={
                                    "url": document.url,
                                    "runId": run_id,
                                    "candidateContentHash": digest,
                                    "reasons": analysis["reasons"],
                                },
                            )
                        else:
                            result = database.upsert_document(
                                source=source,
                                canonical_url=document.url,
                                title=document.title,
                                content=document.content,
                                content_hash=digest,
                                mime_type=document.mime_type,
                                published_at=document.published_at,
                                metadata=metadata,
                            )
                            database.resolve_reviews(
                                document_id=result["document_id"],
                                kinds=["fact_change"],
                            )
                    if document.ocr_artifacts and not ignored_candidate:
                        database.record_ocr_artifacts(
                            document_id=result["document_id"],
                            version_id=result["version_id"],
                            artifacts=[
                                {
                                    "image_url": item.image_url,
                                    "image_hash": item.image_hash,
                                    "raw_text": item.raw_text,
                                    "normalized_text": item.normalized_text,
                                    "engine": item.engine,
                                    "engine_config": item.engine_config,
                                    "quality": item.quality,
                                }
                                for item in document.ocr_artifacts
                            ],
                        )
                    if document.metadata.get("ocrNeedsReview"):
                        quality_message = (
                            f"{document.url}: 图片 OCR 质量评分低于自动入库门槛"
                        )
                        errors.append(quality_message)
                        database.queue_review(
                            source_id=source["id"],
                            document_id=result["document_id"],
                            kind="ocr_quality",
                            message="图片 OCR 质量评分低于自动入库门槛",
                            payload={
                                "url": document.url,
                                "runId": run_id,
                                "score": document.metadata.get("ocrQualityScore"),
                            },
                        )
                    else:
                        database.resolve_source_url_reviews(
                            source_id=source["id"],
                            urls=[url, document.url],
                            kinds=["ocr_quality"],
                        )
                    if (
                        not ignored_candidate
                        and not held_for_review
                        and document.metadata.get("documentRole")
                        == DOCUMENT_ROLE_CONTENT_STUB
                    ):
                        quality_message = (
                            f"{document.url}: 页面缺少可用于回答的实质正文"
                        )
                        errors.append(quality_message)
                        database.queue_review(
                            source_id=source["id"],
                            document_id=result["document_id"],
                            kind="content_quality",
                            message="页面缺少可用于回答的实质正文",
                            payload={
                                "url": document.url,
                                "runId": run_id,
                                "documentRole": document.metadata.get(
                                    "documentRole"
                                ),
                                "reasons": document.metadata.get(
                                    "retrievalQualityReasons", []
                                ),
                            },
                        )
                    elif not ignored_candidate and not held_for_review:
                        database.resolve_source_url_reviews(
                            source_id=source["id"],
                            urls=[url, document.url],
                            kinds=["content_quality"],
                        )
                    database.resolve_source_url_reviews(
                        source_id=source["id"],
                        urls=[url, document.url],
                        kinds=["sync_failure"],
                    )
                    if not ocr_errors:
                        database.resolve_source_url_reviews(
                            source_id=source["id"],
                            urls=[url, document.url],
                            kinds=["ocr_failure"],
                        )
                    documents_changed += int(result["changed"])
                    mapping = (
                        database.get_dify_mapping(result["document_id"])
                        if settings.dify_configured
                        else None
                    )
                    dify_needs_sync = (
                        settings.dify_configured
                        and not held_for_review
                        and not held_for_cross_review
                        and not ignored_candidate
                        and result.get("status") == "active"
                        and not document.metadata.get("ocrNeedsReview")
                        and candidate_retrieval_eligible
                        and (
                            mapping is None
                            or mapping.get("status") != "synced"
                            or mapping.get("last_content_hash")
                            != result["content_hash"]
                        )
                    )
                    if dify_needs_sync:
                        remote_id = mapping.get("remote_document_id") if mapping else None
                        try:
                            receipt = sync_document_to_dify(
                                settings,
                                title=document.title,
                                content=document.content,
                                remote_document_id=remote_id,
                            )
                            database.save_dify_mapping(
                                local_document_id=result["document_id"],
                                remote_document_id=receipt.remote_document_id,
                                last_content_hash=result["content_hash"],
                                last_batch_id=receipt.batch_id,
                                status="queued",
                            )
                        except DifyDocumentError as error:
                            message = f"{document.url}: {error}"
                            errors.append(message)
                            database.save_dify_mapping(
                                local_document_id=result["document_id"],
                                remote_document_id=remote_id,
                                last_content_hash=(
                                    mapping.get("last_content_hash") if mapping else None
                                ),
                                status="error",
                                last_error=str(error),
                            )
                            database.queue_review(
                                source_id=source["id"],
                                document_id=result["document_id"],
                                kind="dify_sync_failure",
                                message=str(error),
                                payload={
                                    "url": document.url,
                                    "runId": run_id,
                                    "contentHash": digest,
                                    "operation": "update" if remote_id else "create",
                                },
                            )
                    if source.get("follow_links"):
                        for link in document.links:
                            if not source_allows_url(source, link):
                                continue
                            if not _is_supported_follow_link(link):
                                database.resolve_source_url_reviews(
                                    source_id=source["id"],
                                    urls=[link],
                                    kinds=["sync_failure"],
                                )
                                continue
                            if (
                                link not in visited
                                and link not in queued
                                and (
                                    len(priority_queue)
                                    + len(discovery_queue)
                                    + documents_seen
                                    < max_documents * 4
                                )
                            ):
                                target_queue = (
                                    discovery_queue
                                    if _is_discovery_queue_url(link)
                                    else priority_queue
                                )
                                target_queue.append(link)
                                queued.add(link)
                except (httpx.HTTPError, SyncError, ValueError) as error:
                    message = f"{url}: {error}"
                    errors.append(message)
                    database.queue_review(
                        source_id=source["id"],
                        kind="sync_failure",
                        message=str(error),
                        payload={"url": url, "runId": run_id},
                    )
    except Exception as error:
        errors.append(str(error))
        database.queue_review(
            source_id=source["id"],
            kind="sync_run_failure",
            message=str(error),
            payload={"runId": run_id},
        )

    if errors and documents_seen == 0:
        status = "failed"
    elif errors:
        status = "partial"
    else:
        status = "success"
    database.finish_sync_run(
        run_id,
        status=status,
        documents_seen=documents_seen,
        documents_changed=documents_changed,
        error_count=len(errors),
        error_message="\n".join(errors)[:4_000] or None,
    )
    return {
        "runId": run_id,
        "sourceId": source["id"],
        "status": status,
        "documentsSeen": documents_seen,
        "documentsChanged": documents_changed,
        "errorCount": len(errors),
    }


def sync_enabled_sources(
    database: KnowledgeDatabase,
    settings: Settings,
    *,
    limit_sources: int = 20,
) -> dict[str, Any]:
    limit_sources = max(1, min(int(limit_sources), 50))
    sources = [source for source in database.list_sources() if source["enabled"]]
    selected = sources[:limit_sources]
    results: list[dict[str, Any]] = []
    for source in selected:
        try:
            result = sync_source(database, settings, source["id"])
        except SyncError as error:
            result = {
                "sourceId": source["id"],
                "status": "failed",
                "documentsSeen": 0,
                "documentsChanged": 0,
                "errorCount": 1,
                "message": str(error),
            }
        results.append({"sourceName": source["name"], **result})

    failed = sum(int(item["status"] == "failed") for item in results)
    partial = sum(int(item["status"] == "partial") for item in results)
    if not results:
        status = "noop"
    elif failed == len(results):
        status = "failed"
    elif failed or partial:
        status = "completed-with-errors"
    else:
        status = "success"
    return {
        "status": status,
        "mode": "enabled-sources-only",
        "available": len(sources),
        "selected": len(selected),
        "succeeded": sum(int(item["status"] == "success") for item in results),
        "partial": partial,
        "failed": failed,
        "documentsSeen": sum(int(item.get("documentsSeen", 0)) for item in results),
        "documentsChanged": sum(
            int(item.get("documentsChanged", 0)) for item in results
        ),
        "results": results,
    }
