from __future__ import annotations

import re
from typing import Any, Mapping


DOCUMENT_ROLE_EVIDENCE = "evidence"
DOCUMENT_ROLE_DISCOVERY_INDEX = "discovery_index"
DOCUMENT_ROLE_CONTENT_STUB = "content_stub"
DOCUMENT_ROLES = {
    DOCUMENT_ROLE_EVIDENCE,
    DOCUMENT_ROLE_DISCOVERY_INDEX,
    DOCUMENT_ROLE_CONTENT_STUB,
}

_INDEX_FILE_TITLE = re.compile(
    r"^index(?:_[0-9]+)+(?:\.s?html?)?$",
    re.IGNORECASE,
)
_GENERIC_DISCOVERY_TITLES = {
    "人事招聘",
    "招聘信息",
    "招聘公告列表",
    "招聘信息列表",
}
_PUBLISHER_SUFFIX = re.compile(
    r"[－—-]\s*(?:国务院国有资产监督管理委员会|中国就业网).*$"
)
_SIGNAL_TEXT = re.compile(r"[^0-9a-z\u3400-\u9fff]+")


def _compact(value: str) -> str:
    return " ".join(str(value or "").split())


def _signal(value: str) -> str:
    return _SIGNAL_TEXT.sub("", _compact(value).casefold())


def _title_without_publisher(title: str) -> str:
    return _PUBLISHER_SUFFIX.sub("", _compact(title)).strip()


def _looks_like_discovery_index(*, title: str, url: str) -> bool:
    clean_title = _title_without_publisher(title)
    if _INDEX_FILE_TITLE.fullmatch(clean_title):
        return True
    filename = str(url or "").split("?", 1)[0].rstrip("/").rsplit("/", 1)[-1]
    return (
        clean_title in _GENERIC_DISCOVERY_TITLES
        and filename.casefold().startswith("index")
    )


def _looks_like_content_stub(
    *,
    title: str,
    content: str,
    metadata: Mapping[str, Any],
) -> bool:
    compact_content = _compact(content)
    if (
        str(metadata.get("ocrStatus") or "").casefold()
        in {"required", "failed"}
        and len(compact_content) < 200
    ):
        return True

    title_signal = _signal(_title_without_publisher(title))
    content_signal = _signal(compact_content)
    if not content_signal:
        return True
    if not title_signal or len(content_signal) >= 180:
        return False

    remainder = content_signal
    repetitions = 0
    while remainder.startswith(title_signal):
        remainder = remainder[len(title_signal) :]
        repetitions += 1
    return repetitions >= 1 and not remainder


def classify_document_role(
    *,
    title: str,
    url: str,
    content: str,
    metadata: Mapping[str, Any] | None = None,
) -> tuple[str, list[str]]:
    metadata = dict(metadata or {})
    explicit_role = str(metadata.get("documentRole") or "")
    if metadata.get("retrievalEligible") is False:
        if explicit_role in {
            DOCUMENT_ROLE_DISCOVERY_INDEX,
            DOCUMENT_ROLE_CONTENT_STUB,
        }:
            return explicit_role, list(
                metadata.get("retrievalQualityReasons") or []
            )
        return DOCUMENT_ROLE_CONTENT_STUB, ["explicitly_not_retrievable"]
    if _looks_like_discovery_index(title=title, url=url):
        return DOCUMENT_ROLE_DISCOVERY_INDEX, ["listing_page"]
    if _looks_like_content_stub(
        title=title,
        content=content,
        metadata=metadata,
    ):
        return DOCUMENT_ROLE_CONTENT_STUB, ["missing_substantive_body"]
    return DOCUMENT_ROLE_EVIDENCE, []


def document_quality_metadata(
    *,
    title: str,
    url: str,
    content: str,
    metadata: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    role, reasons = classify_document_role(
        title=title,
        url=url,
        content=content,
        metadata=metadata,
    )
    return {
        "documentRole": role,
        "retrievalEligible": role == DOCUMENT_ROLE_EVIDENCE,
        "retrievalQualityReasons": reasons,
    }


def is_retrieval_eligible(
    *,
    title: str,
    url: str,
    content: str,
    metadata: Mapping[str, Any] | None = None,
) -> bool:
    role, _ = classify_document_role(
        title=title,
        url=url,
        content=content,
        metadata=metadata,
    )
    return role == DOCUMENT_ROLE_EVIDENCE
