from __future__ import annotations

import re
import unicodedata
from typing import Any, Mapping


_ENTITY_NOISE = re.compile(r"[^a-z0-9\u3400-\u9fff]+")
_COMPANY_SUFFIX = re.compile(
    r"(?:集团股份有限公司|股份有限公司|有限责任公司|"
    r"集团有限公司|集团公司|有限公司|总公司|集团|公司)$"
)
_MIN_FUZZY_ENTITY_CHARS = 8


def _normalized_entity_text(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", str(value or "")).casefold()
    return _ENTITY_NOISE.sub("", normalized)


def _strip_company_suffix(value: str) -> str:
    return _COMPANY_SUFFIX.sub("", value)


def entity_variants(value: str) -> list[str]:
    normalized = _normalized_entity_text(value)
    core = _strip_company_suffix(normalized)
    variants = [normalized, core]
    if core.startswith("中国") and len(core) > 3:
        variants.append(f"中{core[2:]}")
    elif core.startswith("中") and not core.startswith("中国") and len(core) > 2:
        variants.append(f"中国{core[1:]}")

    unique: list[str] = []
    seen: set[str] = set()
    for variant in variants:
        if len(variant) < 3 or variant in seen:
            continue
        seen.add(variant)
        unique.append(variant)
    return unique


def _entity_bigrams(value: str) -> set[str]:
    return {value[index : index + 2] for index in range(len(value) - 1)}


def _has_fuzzy_entity_window(text: str, variant: str) -> bool:
    if len(text) < len(variant):
        return False
    grams = _entity_bigrams(variant)
    for start in range(len(text) - len(variant) + 1):
        window = text[start : start + len(variant)]
        hits = len(grams & _entity_bigrams(window))
        if hits >= 3 and hits / len(grams) >= 0.8:
            return True
    return False


def text_matches_entity(text: str, entity: str) -> bool:
    normalized_text = _normalized_entity_text(text)
    for variant in entity_variants(entity):
        if variant in normalized_text:
            return True
        # Short enterprise cores are too collision-prone for fuzzy matching:
        # 中国航天科技 and 中国航天科工 share 4/5 bigrams despite being
        # different central enterprises. Exact and controlled abbreviation
        # variants still work; typo tolerance is reserved for longer names.
        if len(variant) < _MIN_FUZZY_ENTITY_CHARS:
            continue
        # Compare one contiguous entity-sized window at a time. Counting
        # bigrams across the whole article can assemble a false match from
        # unrelated words such as 航天科工 + 科技英才 + 集团.
        if _has_fuzzy_entity_window(normalized_text, variant):
            return True
    return False


def _clean_strings(value: Any, *, limit: int = 8) -> list[str]:
    if isinstance(value, str):
        candidates = [value]
    elif isinstance(value, (list, tuple, set)):
        candidates = [item for item in value if isinstance(item, str)]
    else:
        candidates = []

    cleaned: list[str] = []
    seen: set[str] = set()
    for candidate in candidates:
        text = " ".join(candidate.split())[:120]
        normalized = text.casefold()
        if not text or normalized in seen:
            continue
        seen.add(normalized)
        cleaned.append(text)
        if len(cleaned) >= limit:
            break
    return cleaned


def matches_retrieval_target(
    *,
    title: str,
    content: str,
    target: Mapping[str, Any] | None,
) -> bool:
    target = dict(target or {})
    companies = _clean_strings(target.get("companies"))
    companies.extend(
        item
        for item in _clean_strings(target.get("company"))
        if item.casefold() not in {value.casefold() for value in companies}
    )
    if companies:
        searchable = f"{title}\n{content}"
        return any(
            text_matches_entity(searchable, company) for company in companies
        )

    job_titles = _clean_strings(target.get("jobTitles"))
    job_titles.extend(
        item
        for item in _clean_strings(target.get("jobTitle"))
        if item.casefold() not in {value.casefold() for value in job_titles}
    )
    if not job_titles:
        return True
    searchable = f"{title}\n{content}"
    return any(
        text_matches_entity(searchable, job_title) for job_title in job_titles
    )
