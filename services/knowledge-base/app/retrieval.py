from __future__ import annotations

import math
import re
from datetime import date
from typing import Any, Iterable, Mapping

import httpx

from .config import Settings
from .database import KnowledgeDatabase
from .entity_matching import matches_retrieval_target
from .schemas import SearchRequest


class DifyRetrievalError(RuntimeError):
    pass


DIFY_QUERY_LIMIT = 250
DIFY_CONTEXT_SECTION_LIMIT = 56
DIFY_MERGED_SNIPPET_LIMIT = 1_200
DIFY_SEGMENTS_PER_DOCUMENT = 3
RETRIEVAL_RESULT_SNIPPET_LIMIT = 2_500
MULTI_FACET_WINDOW_LIMIT = 4

_QUERY_FACETS = (
    (
        re.compile(r"招聘对象|面向|毕业生|哪一届|年级|届别|应届"),
        ("招聘对象", "面向对象", "高校毕业生", "应届毕业生", "毕业生"),
    ),
    (
        re.compile(r"学历|学位|本科|硕士|博士|专科|大专"),
        ("学历要求", "最低学历", "本科", "硕士", "博士", "专科", "大专"),
    ),
    (
        re.compile(r"专业|学科|技术方向|研发方向"),
        (
            "需求学科",
            "招聘专业",
            "需求专业",
            "急需紧缺专业",
            "专业要求",
            "技术方向",
            "引才方向",
        ),
    ),
    (
        re.compile(r"工作城市|工作地点|城市|地点|地区"),
        ("工作地点", "工作城市", "招聘地区", "城市", "地点"),
    ),
    (
        re.compile(r"报名|申请|投递|简历"),
        (
            "简历投递",
            "投递简历",
            "投递方式",
            "报名方式",
            "投递入口",
            "报名入口",
            "招聘官网",
            "www.",
        ),
    ),
    (
        re.compile(r"薪酬|福利|待遇|补贴|户口|公寓"),
        ("薪酬福利", "福利保障", "六险两金", "人才补贴", "人才公寓"),
    ),
    (
        re.compile(r"招聘流程|招聘程序|流程|程序|笔试|面试"),
        ("招聘流程", "招聘程序", "笔试", "面试", "资格审查"),
    ),
    (
        re.compile(r"招聘单位|单位分布|下属单位|所属单位|成员企业"),
        ("招聘单位", "单位分布", "所属单位", "成员企业"),
    ),
    (
        re.compile(r"交通|食宿|后勤"),
        ("往返交通", "全程食宿", "统一安排", "后勤保障"),
    ),
    (
        re.compile(r"截止|截至|还可以报名|还能报名"),
        ("报名截止时间", "投递截止时间", "截止时间", "截止日期"),
    ),
    (
        re.compile(r"几个岗位|报考|投递次数|几个意向|投几个"),
        ("只能报考一个岗位", "1次投递", "一次投递", "1个意向", "投递次数"),
    ),
)


def _record(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _first_text(*values: Any) -> str | None:
    for value in values:
        if isinstance(value, str) and value.strip():
            return " ".join(value.split())
    return None


def _merge_dify_snippets(candidates: Iterable[Mapping[str, Any]]) -> str:
    snippets: list[str] = []
    seen: set[str] = set()
    for candidate in candidates:
        value = candidate.get("snippet")
        if not isinstance(value, str):
            continue
        text = " ".join(value.split())
        normalized = text.casefold()
        if not text or normalized in seen:
            continue
        seen.add(normalized)
        snippets.append(text)
        if len(snippets) >= DIFY_SEGMENTS_PER_DOCUMENT:
            break
    if not snippets:
        return ""
    separator = " … "
    per_segment = max(
        1,
        (DIFY_MERGED_SNIPPET_LIMIT - len(separator) * (len(snippets) - 1))
        // len(snippets),
    )
    return separator.join(text[:per_segment] for text in snippets)[
        :DIFY_MERGED_SNIPPET_LIMIT
    ]


def _extract_strings(value: Any) -> list[str]:
    if isinstance(value, str):
        return [value.strip()] if value.strip() else []
    if isinstance(value, list):
        result: list[str] = []
        for item in value:
            result.extend(_extract_strings(item))
        return result
    if isinstance(value, dict):
        result = []
        for item in value.values():
            result.extend(_extract_strings(item))
        return result
    return []


def _context_values(
    values: Iterable[Any], *, maximum_items: int = 4, maximum_length: int = 48
) -> str:
    cleaned: list[str] = []
    seen: set[str] = set()
    for value in values:
        raw_values = _extract_strings(value)
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            raw_values.append(str(value))
        for raw in raw_values:
            text = " ".join(raw.split())
            normalized = text.casefold()
            if not text or normalized in seen:
                continue
            seen.add(normalized)
            cleaned.append(text)
            if len(cleaned) >= maximum_items:
                break
        if len(cleaned) >= maximum_items:
            break
    return "/".join(cleaned)[:maximum_length]


def _dify_query(request: SearchRequest) -> str:
    companies = _context_values(
        (request.target.get("companies"), request.target.get("company"))
    )
    job_titles = _context_values(
        (request.target.get("jobTitles"), request.target.get("jobTitle"))
    )
    target_values = "|".join(value for value in (companies, job_titles) if value)

    profile_values = _context_values(
        (
            request.profile.get("major"),
            request.profile.get("degreeLevel"),
            request.profile.get("graduationYear"),
        )
    )

    context_sections = []
    if target_values:
        context_sections.append(
            f"目标:{target_values}"[:DIFY_CONTEXT_SECTION_LIMIT]
        )
    if profile_values:
        context_sections.append(
            f"学生:{profile_values}"[:DIFY_CONTEXT_SECTION_LIMIT]
        )
    if not context_sections:
        return request.query[:DIFY_QUERY_LIMIT]

    context = "；".join(context_sections)
    query_budget = max(1, DIFY_QUERY_LIMIT - len(context) - 1)
    return f"{request.query[:query_budget]}；{context}"


def _search_terms(request: SearchRequest) -> list[str]:
    preferred: list[str] = []
    for key in ("companies", "jobTitles", "company", "jobTitle"):
        preferred.extend(_extract_strings(request.target.get(key)))
    for key in ("major", "degreeLevel"):
        preferred.extend(_extract_strings(request.profile.get(key)))

    text = " ".join([request.query, *preferred])
    terms = [item for item in preferred if len(item) >= 2]
    for latin in re.findall(r"[A-Za-z0-9][A-Za-z0-9_.+-]{1,39}", text):
        terms.append(latin)
    for group in re.findall(r"[\u3400-\u9fff]{3,30}", text):
        if len(group) <= 8:
            terms.append(group)
        terms.extend(group[index : index + 3] for index in range(len(group) - 2))

    unique: list[str] = []
    seen: set[str] = set()
    for term in terms:
        normalized = term.casefold().strip()
        if normalized and normalized not in seen:
            seen.add(normalized)
            unique.append(term.strip())
        if len(unique) >= 28:
            break
    return unique


def _fts_query(terms: Iterable[str]) -> str:
    return " OR ".join(f'"{term.replace(chr(34), chr(34) * 2)}"' for term in terms)


def _normalized_metadata(metadata: Mapping[str, Any]) -> dict[str, Any]:
    return {
        re.sub(r"[_-]", "", str(key)).casefold(): value
        for key, value in metadata.items()
    }


def _as_date(value: Any) -> date | None:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        return date.fromisoformat(value.strip()[:10])
    except ValueError:
        return None


def _same_value(actual: Any, expected: Any) -> bool:
    if isinstance(expected, list):
        return any(_same_value(actual, item) for item in expected)
    if isinstance(actual, list):
        return any(_same_value(item, expected) for item in actual)
    if actual is None:
        return False
    actual_text = str(actual).strip().casefold()
    expected_text = str(expected).strip().casefold()
    active = {"active", "open", "ongoing", "recruiting", "在招", "招聘中"}
    if actual_text in active and expected_text in active:
        return True
    return actual_text == expected_text


def _matches_filters(metadata: Mapping[str, Any], filters: Mapping[str, Any]) -> bool:
    if not filters:
        return True
    values = _normalized_metadata(metadata)
    for raw_key, expected in filters.items():
        if expected in (None, "", []):
            continue
        key = re.sub(r"[_-]", "", str(raw_key)).casefold()
        if key in {"sourceid", "sourceids"}:
            if not _same_value(values.get("sourceid"), expected):
                return False
            continue
        if key == "validat":
            requested = _as_date(expected)
            valid_from = _as_date(values.get("validfrom"))
            valid_until = _as_date(values.get("validuntil"))
            if requested and valid_from and requested < valid_from:
                return False
            if requested and valid_until and requested > valid_until:
                return False
            continue
        if key == "validfrom":
            requested = _as_date(expected)
            actual_until = _as_date(values.get("validuntil"))
            if requested and actual_until and actual_until < requested:
                return False
            continue
        if key == "validuntil":
            requested = _as_date(expected)
            actual_from = _as_date(values.get("validfrom"))
            if requested and actual_from and actual_from > requested:
                return False
            continue
        # 缺少结构化元数据时保留资料，交由上层明确标注“有效性待核验”；
        # 已有该字段时则严格过滤。
        if key in values and not _same_value(values[key], expected):
            return False
    return True


def _snippet(content: str, terms: Iterable[str], maximum: int = 1_000) -> str:
    compact = " ".join(content.split())
    if len(compact) <= maximum:
        return compact
    lowered = compact.casefold()
    positions = [lowered.find(term.casefold()) for term in terms if term]
    positions = [position for position in positions if position >= 0]
    center = min(positions) if positions else 0
    start = max(0, center - maximum // 4)
    end = min(len(compact), start + maximum)
    prefix = "…" if start else ""
    suffix = "…" if end < len(compact) else ""
    return f"{prefix}{compact[start:end]}{suffix}"


def _missing_facet_snippet(
    content: str,
    request: SearchRequest,
    existing_snippet: str,
    maximum: int = DIFY_MERGED_SNIPPET_LIMIT,
) -> str | None:
    compact = " ".join(content.split())
    lowered = compact.casefold()
    existing = existing_snippet.casefold()
    anchors: list[int] = []
    for trigger, labels in _QUERY_FACETS:
        if not trigger.search(request.query):
            continue
        if any(label.casefold() in existing for label in labels):
            continue
        for label in labels:
            position = lowered.find(label.casefold())
            if position >= 0:
                anchors.append(position)
                break
    if not anchors:
        return None
    if len(compact) <= maximum:
        return compact

    separator = " … "
    ordered = sorted(set(anchors))
    initial_count = min(len(ordered), MULTI_FACET_WINDOW_LIMIT)
    initial_budget = max(
        1,
        (maximum - len(separator) * (initial_count - 1)) // initial_count,
    )
    collapsed: list[int] = []
    minimum_gap = max(96, initial_budget // 2)
    for anchor in ordered:
        if collapsed and anchor - collapsed[-1] < minimum_gap:
            continue
        collapsed.append(anchor)
        if len(collapsed) >= MULTI_FACET_WINDOW_LIMIT:
            break

    per_window = max(
        1,
        (maximum - len(separator) * (len(collapsed) - 1)) // len(collapsed),
    )
    windows: list[str] = []
    for anchor in collapsed:
        start = max(
            0,
            min(
                len(compact) - per_window,
                anchor - min(72, per_window // 4),
            ),
        )
        end = min(len(compact), start + per_window)
        window = compact[start:end]
        if start > 0 and window:
            window = f"…{window[1:]}"
        if end < len(compact) and window:
            window = f"{window[:-1]}…"
        windows.append(window)
    return separator.join(windows)[:maximum]


def _dify_endpoint(settings: Settings) -> str:
    assert settings.dify_api_url and settings.dify_dataset_id
    base = settings.dify_api_url.rstrip("/")
    if "{dataset_id}" in base:
        return base.replace("{dataset_id}", settings.dify_dataset_id)
    if re.search(r"/datasets/[^/]+/retrieve$", base):
        return base
    return f"{base}/datasets/{settings.dify_dataset_id}/retrieve"


def retrieve_from_dify(
    database: KnowledgeDatabase, settings: Settings, request: SearchRequest
) -> list[dict[str, Any]]:
    if not settings.dify_configured:
        raise DifyRetrievalError("Dify dataset retrieval 未配置")
    assert settings.dify_api_key
    try:
        response = httpx.post(
            _dify_endpoint(settings),
            headers={
                "Authorization": f"Bearer {settings.dify_api_key}",
                "Content-Type": "application/json",
            },
            json={
                "query": _dify_query(request),
                "retrieval_model": {
                    "search_method": "hybrid_search",
                    "reranking_enable": False,
                    "top_k": min(max(request.top_k * 3, 6), 20),
                    "score_threshold_enabled": False,
                },
            },
            timeout=settings.dify_timeout_seconds,
        )
        response.raise_for_status()
        payload = response.json()
    except (httpx.HTTPError, ValueError) as error:
        raise DifyRetrievalError("Dify dataset retrieval 请求失败") from error

    records = payload.get("records", []) if isinstance(payload, dict) else []
    if not isinstance(records, list):
        raise DifyRetrievalError("Dify 返回格式无效")
    candidates: list[dict[str, Any]] = []
    for index, raw in enumerate(records):
        item = _record(raw)
        segment = _record(item.get("segment"))
        document = _record(segment.get("document")) or _record(item.get("document"))
        metadata = {
            **_record(document.get("doc_metadata")),
            **_record(document.get("metadata")),
            **_record(segment.get("metadata")),
            **_record(item.get("metadata")),
        }
        title = _first_text(
            item.get("title"),
            segment.get("title"),
            document.get("name"),
            document.get("title"),
        )
        content = _first_text(
            item.get("snippet"), item.get("content"), segment.get("content")
        )
        remote_document_id = _first_text(document.get("id"))
        if not title or not content:
            continue
        score_value = item.get("score")
        try:
            score = float(score_value)
        except (TypeError, ValueError):
            score = None
        candidates.append(
            {
                "id": _first_text(item.get("id"), segment.get("id"), document.get("id"))
                or f"dify-{index + 1}",
                "remoteDocumentId": remote_document_id,
                "title": title[:500],
                "snippet": content[:1_000],
                "url": _first_text(
                    item.get("url"),
                    metadata.get("url"),
                    metadata.get("source_url"),
                    metadata.get("sourceUrl"),
                ),
                "publishedAt": _first_text(
                    metadata.get("publishedAt"), metadata.get("published_at")
                ),
                "score": score,
                "metadata": metadata,
            }
        )
    local_documents = database.get_local_documents_by_remote_ids(
        [
            str(candidate["remoteDocumentId"])
            for candidate in candidates
            if candidate.get("remoteDocumentId")
        ]
    )
    grouped: dict[str, list[dict[str, Any]]] = {}
    for candidate in candidates:
        dedupe_id = str(candidate.get("remoteDocumentId") or candidate["id"])
        grouped.setdefault(dedupe_id, []).append(candidate)

    results: list[dict[str, Any]] = []
    for document_candidates in grouped.values():
        candidate = document_candidates[0]
        remote_id = candidate.get("remoteDocumentId")
        local = local_documents.get(str(remote_id)) if remote_id else None
        # Dify is a rebuildable index, not the fact source. Every returned
        # segment must map back to the current local immutable document.
        if local is None or local.get("blocked"):
            continue
        metadata = {
            **local.get("metadata", {}),
            **candidate["metadata"],
        }
        if not _matches_filters(metadata, request.filters):
            continue
        title = str(local.get("title") or candidate["title"])
        local_content = str(local.get("content") or "")
        snippet = _merge_dify_snippets(document_candidates)
        supplement = _missing_facet_snippet(
            local_content,
            request,
            snippet,
        )
        if supplement:
            snippet = f"{snippet} … {supplement}".strip(" …")[
                :RETRIEVAL_RESULT_SNIPPET_LIMIT
            ]
        if not matches_retrieval_target(
            title=title,
            content=local_content or snippet,
            target=request.target,
        ):
            continue
        results.append(
            {
                "id": candidate["id"],
                "title": title,
                "snippet": snippet,
                "url": local.get("url") or candidate["url"],
                "publishedAt": (
                    local.get("published_at") or candidate["publishedAt"]
                ),
                "score": candidate["score"],
            }
        )
        if len(results) >= request.top_k:
            break
    return results


def retrieve_locally(
    database: KnowledgeDatabase, request: SearchRequest
) -> list[dict[str, Any]]:
    terms = _search_terms(request)
    candidates = database.fts_candidates(
        _fts_query(terms), min(max(request.top_k * 10, 30), 200)
    ) if terms else []
    seen = {candidate["id"] for candidate in candidates}
    if len(candidates) < request.top_k:
        for candidate in database.like_candidates(terms, min(request.top_k * 10, 100)):
            if candidate["id"] not in seen:
                seen.add(candidate["id"])
                candidates.append(candidate)

    results: list[dict[str, Any]] = []
    for candidate in candidates:
        if not _matches_filters(candidate["metadata"], request.filters):
            continue
        if not matches_retrieval_target(
            title=str(candidate["title"]),
            content=str(candidate["content"]),
            target=request.target,
        ):
            continue
        rank = abs(float(candidate.get("rank", 10.0)))
        score = 1.0 / (1.0 + math.log1p(rank))
        snippet = _snippet(candidate["content"], terms)
        supplement = _missing_facet_snippet(
            candidate["content"],
            request,
            snippet,
        )
        if supplement:
            snippet = f"{snippet} … {supplement}"[
                :RETRIEVAL_RESULT_SNIPPET_LIMIT
            ]
        results.append(
            {
                "id": candidate["id"],
                "title": candidate["title"][:500],
                "snippet": snippet,
                "url": candidate.get("url"),
                "publishedAt": candidate.get("published_at"),
                "score": round(max(0.0, min(score, 1.0)), 6),
            }
        )
        if len(results) >= request.top_k:
            break
    return results


def search(
    database: KnowledgeDatabase, settings: Settings, request: SearchRequest
) -> tuple[list[dict[str, Any]], str, bool]:
    if settings.dify_configured:
        if database.has_incomplete_dify_documents():
            return retrieve_locally(database, request), "sqlite_fts5", True
        try:
            dify_results = retrieve_from_dify(database, settings, request)
            if dify_results:
                return dify_results, "dify", False
        except DifyRetrievalError:
            pass
        return retrieve_locally(database, request), "sqlite_fts5", True
    return retrieve_locally(database, request), "sqlite_fts5", False
