from __future__ import annotations

import re
from difflib import SequenceMatcher
from typing import Any, Mapping


_DATE_PATTERN = re.compile(
    r"(?P<year>20\d{2})\s*[年./-]\s*(?P<month>1[0-2]|0?[1-9])"
    r"\s*[月./-]\s*(?P<day>3[01]|[12]\d|0?[1-9])\s*日?"
)
_SENTENCE_PATTERN = re.compile(r"[^。！？；;\n]{1,220}[。！？；;]?", re.MULTILINE)
_DEADLINE_CONTEXT = re.compile(
    r"截止|报名(?:时间|日期|期限)|网申(?:时间|日期|期限)|"
    r"申请(?:时间|日期|期限)|投递(?:时间|日期|期限)"
)
_RANGE_CONTEXT = re.compile(r"至|到|—|–|~|～")
_GRADUATION_CONTEXT = re.compile(r"应届|毕业|校园招聘|校招")
_GRADUATION_YEAR = re.compile(
    r"(?P<first>20\d{2})"
    r"(?:\s*[-—–至到]\s*(?P<second>20\d{2}))?"
    r"\s*届"
)
_RECRUITMENT_CONTEXT = re.compile(r"招聘|招录|报名|网申|投递|岗位|应聘")

_DEGREE_PATTERNS = (
    ("博士", re.compile(r"博士(?:研究生)?(?:及以上)?")),
    ("硕士", re.compile(r"硕士(?:研究生)?(?:及以上)|研究生及以上")),
    ("本科", re.compile(r"本科(?:及以上)?|大学本科(?:及以上)?")),
    ("专科", re.compile(r"大专(?:及以上)?|专科(?:及以上)?")),
)
_APPLICATION_LIMIT_PATTERNS = (
    re.compile(r"每人[^。；;\n]{0,40}?(?:可|限)[^。；;\n]{0,20}?投递\s*(\d+)\s*个"),
    re.compile(r"每人[^。；;\n]{0,40}?仅有\s*(\d+)\s*次投递机会"),
    re.compile(r"每人[^。；;\n]{0,40}?最多[^。；;\n]{0,20}?投递\s*(\d+)\s*个"),
)
_LIFECYCLE_MARKERS = {
    "withdrawn": re.compile(
        r"撤回|撤销|"
        r"取消(?:本次|本批次|全部|整体)?(?:公开)?招聘|"
        r"终止(?:本次|本批次|全部|整体)?(?:公开)?招聘"
    ),
    "resumed": re.compile(
        r"恢复(?:本次|本批次)?(?:20\d{2}年)?(?:公开)?"
        r"(?:招聘|报名|网申|投递)(?:工作|报名)?|"
        r"(?:重新启动|重启)[^。；;\n]{0,20}?(?:招聘|报名|网申|投递)"
    ),
    "paused": re.compile(
        r"(?:暂停|暂缓)[^。；;\n]{0,24}?(?:招聘|报名|网申|投递)"
    ),
    "delayed": re.compile(
        r"延期|"
        r"延长[^。；;\n]{0,40}?(?:报名|网申|投递)(?:时间|日期|期限)?|"
        r"(?:报名|网申|投递)(?:时间|日期|期限)?[^。；;\n]{0,12}?延长|"
        r"截止时间调整"
    ),
    "corrected": re.compile(r"更正公告|补充公告|修订公告|招聘信息更正"),
}
_PARTIAL_CHANGE_SCOPE = re.compile(
    r"部分(?:招聘)?岗位|个别(?:招聘)?岗位|"
    r"(?:取消|核减|调减)[^。；;\n]{0,20}"
    r"(?:岗位|招聘人数|招聘计划)(?:数|人数)?|"
    r"岗位[^。；;\n]{0,18}(?:取消|核减|调减)"
)
_WHOLE_CHANGE_SCOPE = re.compile(
    r"(?:终止|取消|撤回|撤销)"
    r"(?:本次|本批次|全部|整体)[^。；;\n]{0,18}"
    r"(?:公开)?招聘(?:工作|公告|计划)|"
    r"(?:本次|本批次|全部|整体)[^。；;\n]{0,18}"
    r"(?:公开)?招聘(?:工作|公告|计划)[^。；;\n]{0,8}"
    r"(?:终止|取消|撤回|撤销)"
)
_RELATION_GENERIC_TERMS = (
    "招聘信息更正",
    "招聘公告",
    "公开招聘",
    "社会招聘",
    "校园招聘",
    "正式启动",
    "截止时间",
    "报名时间",
    "关于",
    "公告",
    "通知",
    "更正",
    "补充",
    "修订",
    "撤回",
    "撤销",
    "取消",
    "终止",
    "暂停",
    "延期",
    "延长",
    "调整",
    "招聘",
    "报名",
    "投递",
    "启动",
    "恢复",
    "暂缓",
    "重新启动",
    "重启",
)
_PUBLISHER_SUFFIX = re.compile(
    r"[－—]\s*(?:国务院国有资产监督管理委员会|中国就业网).*$"
)
_RELATION_PLAIN = re.compile(r"[^0-9a-z\u3400-\u9fff]+")
_YEAR_TOKEN = re.compile(r"20\d{2}")


def _compact(value: str) -> str:
    return " ".join(str(value or "").split())


def _normalize_date(match: re.Match[str]) -> str:
    return (
        f"{int(match.group('year')):04d}-"
        f"{int(match.group('month')):02d}-"
        f"{int(match.group('day')):02d}"
    )


def _deadline_dates(content: str) -> list[str]:
    values: set[str] = set()
    for sentence_match in _SENTENCE_PATTERN.finditer(content):
        sentence = sentence_match.group(0)
        if not _DEADLINE_CONTEXT.search(sentence):
            continue
        dates = [_normalize_date(match) for match in _DATE_PATTERN.finditer(sentence)]
        if not dates:
            continue
        if "截止" in sentence or _RANGE_CONTEXT.search(sentence):
            values.add(dates[-1])
    return sorted(values)


def _minimum_degree(content: str) -> str | None:
    candidates: list[tuple[int, str]] = []
    for sentence_match in _SENTENCE_PATTERN.finditer(content):
        sentence = sentence_match.group(0)
        if not re.search(r"学历|学位|应聘资格|招聘条件|任职要求|报名条件", sentence):
            continue
        for rank, (degree, pattern) in enumerate(_DEGREE_PATTERNS):
            if pattern.search(sentence):
                candidates.append((rank, degree))
    if not candidates:
        return None
    return min(candidates, key=lambda item: item[0])[1]


def _graduation_years(content: str) -> list[str]:
    values: set[str] = set()
    for sentence_match in _SENTENCE_PATTERN.finditer(content):
        sentence = sentence_match.group(0)
        if not _GRADUATION_CONTEXT.search(sentence):
            continue
        for match in _GRADUATION_YEAR.finditer(sentence):
            values.add(match.group("first"))
            if match.group("second"):
                values.add(match.group("second"))
    return sorted(values)


def _application_limits(content: str) -> list[int]:
    values: set[int] = set()
    for pattern in _APPLICATION_LIMIT_PATTERNS:
        values.update(int(match.group(1)) for match in pattern.finditer(content))
    return sorted(values)


def _lifecycle_markers(title: str, content: str) -> list[str]:
    title_text = _compact(title)
    lead = _compact(content)[:500]
    values: list[str] = []
    for status, pattern in _LIFECYCLE_MARKERS.items():
        title_match = pattern.search(title_text)
        lead_match = pattern.search(lead)
        if title_match or (lead_match and _RECRUITMENT_CONTEXT.search(lead)):
            values.append(status)
    return values


def _relation_plain(value: str) -> str:
    without_publisher = _PUBLISHER_SUFFIX.sub("", _compact(value).casefold())
    return _RELATION_PLAIN.sub("", without_publisher)


def _relation_core(value: str) -> str:
    text = _relation_plain(value)
    for term in _RELATION_GENERIC_TERMS:
        text = text.replace(term, "")
    return text


def _relation_type(lifecycle: list[str]) -> str | None:
    for value in ("withdrawn", "resumed", "paused", "delayed", "corrected"):
        if value in lifecycle:
            return value
    return None


def _change_scope(*, title: str, content: str) -> str:
    context = _compact(f"{title} {content[:1_500]}")
    # “部分岗位”是更强的安全信号：即使同段出现“本次招聘”，
    # 也不能据此把整份原公告直接作废。
    if _PARTIAL_CHANGE_SCOPE.search(context):
        return "partial"
    if _WHOLE_CHANGE_SCOPE.search(context):
        return "whole"
    return "unknown"


_COMPLETE_RESUME_SIGNALS = (
    re.compile(
        r"招聘[^。；;\n]{0,50}?(?:\d+|[一二三四五六七八九十]+)\s*名|"
        r"招聘岗位|招聘人数"
    ),
    re.compile(r"(?:招聘|报考|应聘|任职)条件"),
    re.compile(r"报名(?:人员|材料|时间|方式|网址|邮箱)"),
    re.compile(
        r"资格审查[^。；;\n]{0,80}?(?:考试|面试)|"
        r"考试(?:分为|时间|方式)|"
        r"体检[^。；;\n]{0,40}?考察"
    ),
)


def _resume_completeness(
    *,
    relation_type: str,
    content: str,
) -> str | None:
    if relation_type != "resumed":
        return None
    compact = _compact(content)
    signal_count = sum(
        1 for pattern in _COMPLETE_RESUME_SIGNALS if pattern.search(compact)
    )
    if len(compact) >= 280 and signal_count >= 3:
        return "complete"
    return "status_only"


def _resolution_mode(
    *,
    relation_type: str,
    change_scope: str,
    resume_completeness: str | None,
) -> str:
    if relation_type == "withdrawn" and change_scope == "whole":
        return "supersede"
    if relation_type == "resumed" and resume_completeness == "complete":
        return "supersede"
    return "reconcile"


def analyze_cross_document_change(
    *,
    candidate_title: str,
    candidate_content: str,
    candidate_links: list[str] | None,
    existing_documents: list[Mapping[str, Any]],
) -> dict[str, Any]:
    """Identify a new-URL correction and rank possible older announcements."""
    candidate_facts = extract_critical_facts(
        title=candidate_title,
        content=candidate_content,
    )
    lifecycle = list(candidate_facts["lifecycle"])
    relation_type = _relation_type(lifecycle)
    if relation_type is None:
        return {
            "requiresReview": False,
            "relationType": None,
            "lifecycle": [],
            "changeScope": None,
            "resumeCompleteness": None,
            "resolutionMode": None,
            "suggestedTargets": [],
        }

    change_scope = _change_scope(
        title=candidate_title,
        content=candidate_content,
    )
    resume_completeness = _resume_completeness(
        relation_type=relation_type,
        content=candidate_content,
    )
    resolution_mode = _resolution_mode(
        relation_type=relation_type,
        change_scope=change_scope,
        resume_completeness=resume_completeness,
    )
    links = {str(value).strip() for value in candidate_links or [] if str(value).strip()}
    candidate_title_plain = _relation_plain(candidate_title)
    candidate_context_plain = _relation_plain(
        f"{candidate_title} {candidate_content[:1_500]}"
    )
    candidate_title_core = _relation_core(candidate_title)
    candidate_context_core = _relation_core(
        f"{candidate_title} {candidate_content[:1_500]}"
    )
    candidate_years = set(_YEAR_TOKEN.findall(candidate_context_plain))
    suggestions: list[dict[str, Any]] = []

    for existing in existing_documents:
        document_id = str(existing.get("document_id") or existing.get("id") or "")
        title = str(existing.get("title") or "")
        url = str(existing.get("url") or existing.get("canonical_url") or "")
        if not document_id or not title or not url:
            continue
        title_plain = _relation_plain(title)
        title_core = _relation_core(title)
        if len(title_core) < 6:
            continue

        evidence: list[str] = []
        explicit_link = url in links
        explicit_title = (
            len(title_plain) >= 10 and title_plain in candidate_context_plain
        )
        core_reference = (
            len(title_core) >= 7 and title_core in candidate_context_core
        )
        title_similarity = SequenceMatcher(
            None,
            title_core,
            candidate_title_core,
        ).ratio()
        existing_years = set(_YEAR_TOKEN.findall(title_plain))
        shared_year = bool(candidate_years & existing_years)

        if explicit_link:
            score = 1.0
            evidence.append("explicit_link")
            if existing.get("cross_registered_source"):
                evidence.append("cross_registered_source")
        elif explicit_title:
            score = 0.96
            evidence.append("explicit_title")
        elif core_reference:
            score = 0.9
            evidence.append("title_core_reference")
        else:
            score = round(title_similarity * 0.78, 4)
            if title_similarity >= 0.55:
                evidence.append("title_similarity")
            if shared_year:
                score += 0.1
                evidence.append("shared_recruitment_year")
            if existing.get("source_id") == existing.get("candidate_source_id"):
                score += 0.04
                evidence.append("same_registered_source")
            score = min(score, 0.89)

        if score < 0.45:
            continue
        suggestions.append(
            {
                "documentId": document_id,
                "title": title,
                "url": url,
                "score": round(score, 4),
                "blocked": score >= 0.72,
                "evidence": evidence,
            }
        )

    suggestions.sort(
        key=lambda item: (-float(item["score"]), str(item["documentId"]))
    )
    return {
        "requiresReview": True,
        "relationType": relation_type,
        "lifecycle": lifecycle,
        "changeScope": change_scope,
        "resumeCompleteness": resume_completeness,
        "resolutionMode": resolution_mode,
        "candidateFacts": candidate_facts,
        "suggestedTargets": suggestions[:5],
        "unresolved": not any(item["blocked"] for item in suggestions),
    }


def extract_critical_facts(*, title: str, content: str) -> dict[str, Any]:
    compact = _compact(content)
    return {
        "deadlines": _deadline_dates(compact),
        "minimumDegree": _minimum_degree(compact),
        "graduationYears": _graduation_years(compact),
        "applicationLimits": _application_limits(compact),
        "lifecycle": _lifecycle_markers(title, compact),
    }


def analyze_version_change(
    *,
    previous_title: str,
    previous_content: str,
    previous_metadata: Mapping[str, Any] | None,
    candidate_title: str,
    candidate_content: str,
    candidate_metadata: Mapping[str, Any] | None,
) -> dict[str, Any]:
    previous_metadata = dict(previous_metadata or {})
    candidate_metadata = dict(candidate_metadata or {})
    previous_text = _compact(previous_content)
    candidate_text = _compact(candidate_content)
    previous_facts = extract_critical_facts(
        title=previous_title,
        content=previous_text,
    )
    candidate_facts = extract_critical_facts(
        title=candidate_title,
        content=candidate_text,
    )
    reasons: list[dict[str, Any]] = []

    if candidate_metadata.get("ocrNeedsReview"):
        reasons.append(
            {
                "code": "ocr_quality_pending",
                "facet": "ocrQuality",
                "previous": previous_metadata.get("ocrQualityScore"),
                "candidate": candidate_metadata.get("ocrQualityScore"),
            }
        )

    previous_length = len(previous_text)
    candidate_length = len(candidate_text)
    technical_enrichment = (
        previous_length < 240
        and candidate_length >= 400
        and candidate_length >= previous_length * 1.5
    )
    if (
        previous_length >= 500
        and candidate_length < previous_length * 0.6
        and not technical_enrichment
    ):
        reasons.append(
            {
                "code": "content_regression",
                "facet": "contentLength",
                "previous": previous_length,
                "candidate": candidate_length,
            }
        )

    if candidate_facts["lifecycle"] and (
        candidate_facts["lifecycle"] != previous_facts["lifecycle"]
    ):
        reasons.append(
            {
                "code": "lifecycle_changed",
                "facet": "lifecycle",
                "previous": previous_facts["lifecycle"],
                "candidate": candidate_facts["lifecycle"],
            }
        )

    comparable_facets = (
        ("deadlines", "deadline_changed"),
        ("minimumDegree", "minimum_degree_changed"),
        ("graduationYears", "graduation_year_changed"),
        ("applicationLimits", "application_limit_changed"),
    )
    for facet, code in comparable_facets:
        previous_value = previous_facts[facet]
        candidate_value = candidate_facts[facet]
        if previous_value and candidate_value and previous_value != candidate_value:
            reasons.append(
                {
                    "code": code,
                    "facet": facet,
                    "previous": previous_value,
                    "candidate": candidate_value,
                }
            )
        elif (
            previous_value
            and not candidate_value
            and candidate_length >= previous_length * 0.7
            and not technical_enrichment
        ):
            reasons.append(
                {
                    "code": f"{code}_removed",
                    "facet": facet,
                    "previous": previous_value,
                    "candidate": candidate_value,
                }
            )

    return {
        "requiresReview": bool(reasons),
        "reasons": reasons,
        "previousFacts": previous_facts,
        "candidateFacts": candidate_facts,
        "technicalEnrichment": technical_enrichment,
        "previousLength": previous_length,
        "candidateLength": candidate_length,
    }
