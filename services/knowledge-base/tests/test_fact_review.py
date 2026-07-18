from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.fact_review import (
    analyze_cross_document_change,
    analyze_version_change,
    extract_critical_facts,
)


def test_extracts_high_confidence_recruitment_facts():
    facts = extract_critical_facts(
        title="某央企 2027 届校园招聘公告",
        content=(
            "报名时间：2026年7月1日至2026年8月31日。"
            "招聘对象为2027-2028届应届毕业生，学历要求为本科及以上。"
            "每人最多可投递2个岗位。"
        ),
    )

    assert facts == {
        "deadlines": ["2026-08-31"],
        "minimumDegree": "本科",
        "graduationYears": ["2027", "2028"],
        "applicationLimits": [2],
        "lifecycle": [],
    }


def test_changed_deadline_requires_review():
    analysis = analyze_version_change(
        previous_title="某央企校园招聘公告",
        previous_content=(
            "这是某央企校园招聘公告。报名截止时间为2026年8月31日。"
            "学历要求为本科及以上，具体岗位以官方页面为准。"
        ),
        previous_metadata={},
        candidate_title="某央企校园招聘公告",
        candidate_content=(
            "这是某央企校园招聘公告。报名截止时间为2026年9月15日。"
            "学历要求为本科及以上，具体岗位以官方页面为准。"
        ),
        candidate_metadata={},
    )

    assert analysis["requiresReview"] is True
    assert analysis["reasons"][0] == {
        "code": "deadline_changed",
        "facet": "deadlines",
        "previous": ["2026-08-31"],
        "candidate": ["2026-09-15"],
    }


def test_short_stub_to_complete_ocr_is_technical_enrichment():
    analysis = analyze_version_change(
        previous_title="招聘海报",
        previous_content="某央企招聘海报，具体内容见图片。",
        previous_metadata={},
        candidate_title="某央企 2027 届校园招聘公告",
        candidate_content=(
            "某央企面向2027届应届毕业生开展校园招聘。"
            "学历要求为本科及以上。报名截止时间为2026年8月31日。"
            "本次招聘包含研发、生产、运营和职能等岗位，申请人应通过"
            "官方招聘网站提交真实材料，并以岗位详情中的专业、学历、"
            "工作地点和资格审查要求为准。"
        )
        * 4,
        candidate_metadata={
            "ocrStatus": "completed",
            "ocrQualityScore": 95,
            "ocrNeedsReview": False,
        },
    )

    assert analysis["technicalEnrichment"] is True
    assert analysis["requiresReview"] is False


def test_large_content_regression_and_low_ocr_quality_are_held():
    analysis = analyze_version_change(
        previous_title="完整招聘公告",
        previous_content=(
            "完整招聘公告包含岗位、专业、学历、届别、工作地点、"
            "报名时间、投递限制和资格审查要求。"
        )
        * 30,
        previous_metadata={"ocrQualityScore": 95},
        candidate_title="招聘公告",
        candidate_content="招聘海报，内容见图片。",
        candidate_metadata={
            "ocrNeedsReview": True,
            "ocrQualityScore": 42,
        },
    )

    assert analysis["requiresReview"] is True
    assert {reason["code"] for reason in analysis["reasons"]} == {
        "ocr_quality_pending",
        "content_regression",
    }


def test_withdrawal_or_hard_threshold_change_requires_review():
    analysis = analyze_version_change(
        previous_title="某央企 2027 届校园招聘公告",
        previous_content=(
            "招聘对象为2027届应届毕业生。学历要求为本科及以上。"
            "每人最多可投递2个岗位。"
        ),
        previous_metadata={},
        candidate_title="关于撤回某央企 2027 届校园招聘公告的通知",
        candidate_content=(
            "现撤回本次招聘公告。招聘对象调整为2026届应届毕业生，"
            "学历要求为硕士及以上，每人最多可投递1个岗位。"
        ),
        candidate_metadata={},
    )

    codes = {reason["code"] for reason in analysis["reasons"]}
    assert {
        "lifecycle_changed",
        "minimum_degree_changed",
        "graduation_year_changed",
        "application_limit_changed",
    }.issubset(codes)


def test_new_url_correction_links_to_the_original_announcement():
    analysis = analyze_cross_document_change(
        candidate_title="关于中国电信天翼云2027届超级优才招聘延期的公告",
        candidate_content=(
            "中国电信天翼云2027届超级优才招聘报名截止时间"
            "由2026年8月31日延长至2026年9月15日。"
        ),
        candidate_links=[],
        existing_documents=[
            {
                "document_id": "original-1",
                "title": "中国电信天翼云2027届超级优才招聘正式启动！",
                "url": "https://official.example.test/jobs/original",
                "source_id": "source-1",
                "candidate_source_id": "source-1",
            },
            {
                "document_id": "unrelated-1",
                "title": "中广核2027届校园招聘正式启动",
                "url": "https://official.example.test/jobs/unrelated",
                "source_id": "source-1",
                "candidate_source_id": "source-1",
            },
        ],
    )

    assert analysis["requiresReview"] is True
    assert analysis["relationType"] == "delayed"
    assert analysis["changeScope"] == "unknown"
    assert analysis["resolutionMode"] == "reconcile"
    assert analysis["unresolved"] is False
    assert analysis["suggestedTargets"][0] == {
        "documentId": "original-1",
        "title": "中国电信天翼云2027届超级优才招聘正式启动！",
        "url": "https://official.example.test/jobs/original",
        "score": 0.9,
        "blocked": True,
        "evidence": ["title_core_reference"],
    }
    assert analysis["suggestedTargets"][1]["documentId"] == "unrelated-1"
    assert analysis["suggestedTargets"][1]["blocked"] is False


def test_explicit_link_can_identify_a_vaguely_titled_withdrawal():
    analysis = analyze_cross_document_change(
        candidate_title="关于撤回本次招聘公告的通知",
        candidate_content="因计划调整，现撤回此前发布的招聘公告。",
        candidate_links=["https://official.example.test/jobs/original"],
        existing_documents=[
            {
                "document_id": "original-1",
                "title": "某央企2027届校园招聘",
                "url": "https://official.example.test/jobs/original",
                "source_id": "source-1",
                "candidate_source_id": "source-1",
            }
        ],
    )

    assert analysis["relationType"] == "withdrawn"
    assert analysis["changeScope"] == "whole"
    assert analysis["resolutionMode"] == "supersede"
    assert analysis["suggestedTargets"][0]["score"] == 1.0
    assert analysis["suggestedTargets"][0]["evidence"] == ["explicit_link"]


def test_lifecycle_notice_without_match_stays_unresolved_for_manual_linking():
    analysis = analyze_cross_document_change(
        candidate_title="关于延长报名时间的通知",
        candidate_content="本次公开招聘报名时间延长，具体安排以本通知为准。",
        candidate_links=[],
        existing_documents=[
            {
                "document_id": "unrelated-1",
                "title": "另一家企业2026年社会招聘公告",
                "url": "https://official.example.test/jobs/unrelated",
                "source_id": "source-1",
                "candidate_source_id": "source-1",
            }
        ],
    )

    assert analysis["requiresReview"] is True
    assert analysis["relationType"] == "delayed"
    assert analysis["resolutionMode"] == "reconcile"
    assert analysis["unresolved"] is True
    assert analysis["suggestedTargets"] == []


def test_status_only_resume_notice_still_requires_reconciliation():
    analysis = analyze_cross_document_change(
        candidate_title="关于恢复报名的通知",
        candidate_content=(
            "经研究，现恢复本次公开招聘报名，后续安排另行通知。"
        ),
        candidate_links=["https://official.example.test/jobs/paused"],
        existing_documents=[
            {
                "document_id": "paused-1",
                "title": "关于暂缓某央企本次公开招聘工作的公告",
                "url": "https://official.example.test/jobs/paused",
                "source_id": "source-1",
                "candidate_source_id": "source-1",
            }
        ],
    )

    assert analysis["relationType"] == "resumed"
    assert analysis["resumeCompleteness"] == "status_only"
    assert analysis["resolutionMode"] == "reconcile"
    assert analysis["suggestedTargets"][0]["blocked"] is True


@pytest.mark.parametrize(
    "case",
    json.loads(
        (
            Path(__file__).parents[1]
            / "examples"
            / "cross-document-change-cases.json"
        ).read_text(encoding="utf-8")
    )["cases"],
    ids=lambda case: case["id"],
)
def test_real_official_change_samples_keep_the_declared_relation(case):
    candidate = case["candidate"]
    existing = case["existing"]
    expected = case["expected"]
    analysis = analyze_cross_document_change(
        candidate_title=candidate["title"],
        candidate_content=candidate["content"],
        candidate_links=candidate["links"],
        existing_documents=[
            {
                "document_id": existing["documentId"],
                "source_id": existing["sourceId"],
                "candidate_source_id": candidate["sourceId"],
                "cross_registered_source": expected[
                    "crossRegisteredSource"
                ],
                "title": existing["title"],
                "url": existing["url"],
            }
        ],
    )

    assert analysis["requiresReview"] is True
    assert analysis["relationType"] == expected["relationType"]
    assert analysis["changeScope"] == expected["changeScope"]
    assert analysis["resumeCompleteness"] == expected.get(
        "resumeCompleteness"
    )
    assert analysis["resolutionMode"] == expected["resolutionMode"]
    assert analysis["unresolved"] is expected["unresolved"]
    if expected["targetExpected"]:
        target = analysis["suggestedTargets"][0]
        assert target["documentId"] == existing["documentId"]
        if "targetScore" in expected:
            assert target["score"] == expected["targetScore"]
        assert target["blocked"] is expected["targetBlocked"]
        assert target["evidence"] == expected["evidence"]
    else:
        assert analysis["suggestedTargets"] == []
