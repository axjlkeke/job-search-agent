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
        "graduationDateRequirements": [],
        "recruitmentAudiences": ["应届毕业生"],
        "assessmentDates": [],
        "applicationLimits": [2],
        "ageRequirements": [],
        "experienceRequirements": [],
        "languageRequirements": [],
        "majorRequirements": [],
        "workLocations": [],
        "recruitmentHeadcounts": [],
        "applicationChannels": [],
        "lifecycle": [],
    }


@pytest.mark.parametrize(
    ("content", "expected"),
    [
        (
            "三、应聘要求 （一）博士、硕士、本科应届毕业生；",
            "本科",
        ),
        (
            "学历要求：大专、本科、硕士研究生均可报名。",
            "专科",
        ),
        (
            "招聘条件：取得硕士研究生学历和相应学位。",
            "硕士",
        ),
        (
            "任职要求：博士研究生，专业方向与岗位一致。",
            "博士",
        ),
    ],
)
def test_mixed_and_bare_degree_wording_uses_the_lowest_eligible_level(
    content,
    expected,
):
    facts = extract_critical_facts(
        title="某央企校园招聘公告",
        content=content,
    )

    assert facts["minimumDegree"] == expected


def test_mixed_degree_requirement_becoming_more_restrictive_requires_review():
    analysis = analyze_version_change(
        previous_title="某央企校园招聘公告",
        previous_content="应聘要求：博士、硕士、本科应届毕业生。",
        previous_metadata={},
        candidate_title="某央企校园招聘公告",
        candidate_content="应聘要求：博士、硕士应届毕业生。",
        candidate_metadata={},
    )

    assert analysis["requiresReview"] is True
    assert analysis["reasons"] == [
        {
            "code": "minimum_degree_changed",
            "facet": "minimumDegree",
            "previous": "本科",
            "candidate": "硕士",
        }
    ]


def test_extracts_degree_specific_age_limits_without_losing_the_mapping():
    facts = extract_critical_facts(
        title="某央企校园招聘公告",
        content=(
            "年龄要求：博士研究生年龄不超过35岁、"
            "硕士研究生年龄不超过30岁、"
            "本科及职业学院毕业生年龄不超过26岁。"
        ),
    )

    assert facts["ageRequirements"] == [
        "博士=≤35",
        "本科及职业学院=≤26",
        "硕士=≤30",
    ]


def test_extracts_age_suffix_wording_and_preserves_exclusive_limits():
    facts = extract_critical_facts(
        title="某央企校园招聘公告",
        content=(
            "硕士年龄28岁及以下，博士年龄32岁以下。"
            "特殊岗位年龄不满35周岁。"
        ),
    )

    assert facts["ageRequirements"] == [
        "博士=≤32",
        "硕士=≤28",
        "通用=<35",
    ]


def test_age_range_keeps_the_upper_limit_but_minimum_age_alone_is_ignored():
    range_facts = extract_critical_facts(
        title="某国企社会招聘公告",
        content="年龄须在18周岁以上、35周岁以下。",
    )
    minimum_only = extract_critical_facts(
        title="某国企社会招聘公告",
        content="报名人员须年满18周岁，出生年份以身份证为准。",
    )

    assert range_facts["ageRequirements"] == ["通用=≤35"]
    assert minimum_only["ageRequirements"] == []


def test_age_limit_change_or_group_swap_requires_review():
    changed = analyze_version_change(
        previous_title="某央企校园招聘公告",
        previous_content="博士年龄35岁以下，硕士年龄30岁以下。",
        previous_metadata={},
        candidate_title="某央企校园招聘公告",
        candidate_content="博士年龄32岁以下，硕士年龄28岁以下。",
        candidate_metadata={},
    )
    swapped = analyze_version_change(
        previous_title="某央企校园招聘公告",
        previous_content="博士年龄35岁以下，硕士年龄30岁以下。",
        previous_metadata={},
        candidate_title="某央企校园招聘公告",
        candidate_content="博士年龄30岁以下，硕士年龄35岁以下。",
        candidate_metadata={},
    )

    assert changed["reasons"][0]["code"] == "age_requirement_changed"
    assert swapped["reasons"][0]["code"] == "age_requirement_changed"
    assert changed["previousFacts"]["ageRequirements"] != changed[
        "candidateFacts"
    ]["ageRequirements"]
    assert swapped["previousFacts"]["ageRequirements"] != swapped[
        "candidateFacts"
    ]["ageRequirements"]


def test_age_limit_addition_and_removal_are_reviewed():
    added = analyze_version_change(
        previous_title="某国企社会招聘公告",
        previous_content="本次招聘面向符合岗位条件的社会人员。",
        previous_metadata={},
        candidate_title="某国企社会招聘公告",
        candidate_content="本次招聘面向社会人员，年龄不超过35周岁。",
        candidate_metadata={},
    )
    removed = analyze_version_change(
        previous_title="某国企社会招聘公告",
        previous_content="本次招聘面向社会人员，年龄不超过35周岁。",
        previous_metadata={},
        candidate_title="某国企社会招聘公告",
        candidate_content="本次招聘面向符合岗位条件的社会人员。",
        candidate_metadata={},
    )

    assert added["reasons"][0]["code"] == "age_requirement_changed_added"
    assert removed["reasons"][0]["code"] == "age_requirement_changed_removed"


def test_age_limit_from_technical_enrichment_is_not_reviewed():
    analysis = analyze_version_change(
        previous_title="招聘海报",
        previous_content="某央企招聘海报，具体内容见图片。",
        previous_metadata={},
        candidate_title="某央企校园招聘公告",
        candidate_content=(
            "某央企面向高校毕业生开展校园招聘。"
            "年龄要求：博士研究生年龄不超过35岁、"
            "硕士研究生年龄不超过30岁。"
            "应聘人员应通过官方招聘网站提交材料，"
            "并以公告中的岗位条件和资格审查要求为准。"
        )
        * 5,
        candidate_metadata={
            "ocrStatus": "completed",
            "ocrQualityScore": 95,
            "ocrNeedsReview": False,
        },
    )

    assert analysis["technicalEnrichment"] is True
    assert analysis["candidateFacts"]["ageRequirements"]
    assert analysis["requiresReview"] is False


def test_extracts_degree_specific_work_experience_without_generic_duplicates():
    facts = extract_critical_facts(
        title="某国企社会招聘公告",
        content=(
            "大学本科及以上学历；"
            "博士研究生毕业后工作满1年、"
            "硕士研究生毕业后工作满2年、"
            "本科毕业后工作满3年。"
        ),
    )

    assert facts["experienceRequirements"] == [
        "博士=≥1",
        "本科=≥3",
        "硕士=≥2",
    ]


def test_abbreviated_and_chinese_work_years_normalize_to_the_same_mapping():
    numeric = extract_critical_facts(
        title="某国企社会招聘公告",
        content="博士毕业后工作满1年、硕士满2年、本科满3年。",
    )
    chinese = extract_critical_facts(
        title="某国企社会招聘公告",
        content="博士毕业后工作满一年、硕士满两年、本科满三年。",
    )

    assert numeric["experienceRequirements"] == chinese[
        "experienceRequirements"
    ]
    assert numeric["experienceRequirements"] == [
        "博士=≥1",
        "本科=≥3",
        "硕士=≥2",
    ]


@pytest.mark.parametrize(
    "content",
    [
        "具有3年以上相关工作经验。",
        "相关工作经验不少于三年。",
        "从事相关工作满3年。",
        "3年以上相关工作经历。",
    ],
)
def test_extracts_common_generic_work_experience_wording(content):
    facts = extract_critical_facts(
        title="某国企社会招聘公告",
        content=content,
    )

    assert facts["experienceRequirements"] == ["通用=≥3"]


def test_work_experience_change_or_degree_swap_requires_review():
    changed = analyze_version_change(
        previous_title="某国企社会招聘公告",
        previous_content="博士工作满1年、硕士满2年、本科满3年。",
        previous_metadata={},
        candidate_title="某国企社会招聘公告",
        candidate_content="博士工作满2年、硕士满3年、本科满5年。",
        candidate_metadata={},
    )
    swapped = analyze_version_change(
        previous_title="某国企社会招聘公告",
        previous_content="博士工作满1年、硕士满2年、本科满3年。",
        previous_metadata={},
        candidate_title="某国企社会招聘公告",
        candidate_content="博士工作满3年、硕士满2年、本科满1年。",
        candidate_metadata={},
    )

    assert changed["reasons"][0]["code"] == "experience_requirement_changed"
    assert swapped["reasons"][0]["code"] == "experience_requirement_changed"


def test_work_experience_addition_and_removal_are_reviewed():
    added = analyze_version_change(
        previous_title="某国企社会招聘公告",
        previous_content="本次招聘面向符合岗位要求的社会人员。",
        previous_metadata={},
        candidate_title="某国企社会招聘公告",
        candidate_content="本次招聘要求具有3年以上相关工作经验。",
        candidate_metadata={},
    )
    removed = analyze_version_change(
        previous_title="某国企社会招聘公告",
        previous_content="本次招聘要求具有3年以上相关工作经验。",
        previous_metadata={},
        candidate_title="某国企社会招聘公告",
        candidate_content="本次招聘面向符合岗位要求的社会人员。",
        candidate_metadata={},
    )

    assert added["reasons"][0]["code"] == "experience_requirement_changed_added"
    assert (
        removed["reasons"][0]["code"]
        == "experience_requirement_changed_removed"
    )


def test_work_experience_ignores_years_unrelated_to_eligibility():
    facts = extract_critical_facts(
        title="某国企招聘公告",
        content=(
            "申请人应于2026年毕业。项目建设周期为3年，"
            "工作地点为北京，录用后提供系统培训。"
        ),
    )

    assert facts["experienceRequirements"] == []


def test_work_experience_from_technical_enrichment_is_not_reviewed():
    analysis = analyze_version_change(
        previous_title="招聘海报",
        previous_content="某国企招聘海报，具体内容见图片。",
        previous_metadata={},
        candidate_title="某国企社会招聘公告",
        candidate_content=(
            "本次招聘面向符合岗位条件的社会人员。"
            "任职要求：具有3年以上相关工作经验。"
            "应聘人员应通过官方招聘网站提交材料，"
            "并以公告中的岗位条件和资格审查要求为准。"
        )
        * 7,
        candidate_metadata={
            "ocrStatus": "completed",
            "ocrQualityScore": 95,
            "ocrNeedsReview": False,
        },
    )

    assert analysis["technicalEnrichment"] is True
    assert analysis["candidateFacts"]["experienceRequirements"]
    assert analysis["requiresReview"] is False


def test_extracts_degree_specific_cet_levels_and_scores():
    facts = extract_critical_facts(
        title="某央企校园招聘公告",
        content=(
            "外语水平要求：国内应届本科毕业生大学英语四级"
            "不少于425分，研究生大学英语六级不少于425分。"
        ),
    )

    assert facts["languageRequirements"] == [
        "本科=CET4≥425",
        "研究生=CET6≥425",
    ]


def test_extracts_generic_cet_level_without_inventing_a_score():
    facts = extract_critical_facts(
        title="某央企校园招聘公告",
        content="应聘基本条件：国家英语六级及以上水平。",
    )

    assert facts["languageRequirements"] == ["通用=CET6"]


def test_cet_abbreviations_normalize_to_the_same_requirements():
    abbreviated = extract_critical_facts(
        title="某央企校园招聘公告",
        content="本科生须通过CET-4，研究生须通过CET6。",
    )
    written = extract_critical_facts(
        title="某央企校园招聘公告",
        content="本科生须通过大学英语四级，研究生须通过大学英语六级。",
    )

    assert abbreviated["languageRequirements"] == written[
        "languageRequirements"
    ]
    assert abbreviated["languageRequirements"] == [
        "本科=CET4",
        "研究生=CET6",
    ]


def test_cet_score_change_or_degree_swap_requires_review():
    changed = analyze_version_change(
        previous_title="某央企校园招聘公告",
        previous_content=(
            "本科生大学英语四级不少于425分，"
            "研究生大学英语六级不少于425分。"
        ),
        previous_metadata={},
        candidate_title="某央企校园招聘公告",
        candidate_content=(
            "本科生大学英语四级不少于450分，"
            "研究生大学英语六级不少于450分。"
        ),
        candidate_metadata={},
    )
    swapped = analyze_version_change(
        previous_title="某央企校园招聘公告",
        previous_content="本科生须通过英语四级，研究生须通过英语六级。",
        previous_metadata={},
        candidate_title="某央企校园招聘公告",
        candidate_content="本科生须通过英语六级，研究生须通过英语四级。",
        candidate_metadata={},
    )

    assert changed["reasons"][0]["code"] == "language_requirement_changed"
    assert swapped["reasons"][0]["code"] == "language_requirement_changed"


def test_language_requirement_addition_and_removal_are_reviewed():
    added = analyze_version_change(
        previous_title="某央企校园招聘公告",
        previous_content="本次招聘面向符合岗位要求的高校毕业生。",
        previous_metadata={},
        candidate_title="某央企校园招聘公告",
        candidate_content="本次招聘要求通过大学英语四级考试。",
        candidate_metadata={},
    )
    removed = analyze_version_change(
        previous_title="某央企校园招聘公告",
        previous_content="本次招聘要求通过大学英语四级考试。",
        previous_metadata={},
        candidate_title="某央企校园招聘公告",
        candidate_content="本次招聘面向符合岗位要求的高校毕业生。",
        candidate_metadata={},
    )

    assert added["reasons"][0]["code"] == "language_requirement_changed_added"
    assert (
        removed["reasons"][0]["code"]
        == "language_requirement_changed_removed"
    )


def test_language_training_and_unrelated_scores_are_not_requirements():
    facts = extract_critical_facts(
        title="某央企招聘公告",
        content=(
            "公司为员工提供英语四级培训和学习资料，"
            "培训课程共计40学时，结业后可自愿报名考试。"
        ),
    )

    assert facts["languageRequirements"] == []


def test_language_requirement_from_technical_enrichment_is_not_reviewed():
    analysis = analyze_version_change(
        previous_title="招聘海报",
        previous_content="某央企招聘海报，具体内容见图片。",
        previous_metadata={},
        candidate_title="某央企校园招聘公告",
        candidate_content=(
            "本次招聘面向符合岗位条件的高校毕业生。"
            "外语要求：本科生大学英语四级不少于425分。"
            "应聘人员应通过官方招聘网站提交材料，"
            "并以公告中的岗位条件和资格审查要求为准。"
        )
        * 7,
        candidate_metadata={
            "ocrStatus": "completed",
            "ocrQualityScore": 95,
            "ocrNeedsReview": False,
        },
    )

    assert analysis["technicalEnrichment"] is True
    assert analysis["candidateFacts"]["languageRequirements"]
    assert analysis["requiresReview"] is False


def test_extracts_and_normalizes_labeled_and_grouped_major_requirements():
    facts = extract_critical_facts(
        title="某央企校园招聘公告",
        content=(
            "需求学科：软件工程 / 计算机科学与技术，人工智能。"
            "机械类：车辆工程、机械工程等相关专业；"
            "材料类：材料成型（焊接）、复合材料等相关专业；"
            "岗位类别：技术类、管理类。"
        ),
    )

    assert facts["majorRequirements"] == [
        "专业=人工智能、计算机科学与技术、软件工程",
        "机械类=机械工程等相关专业、车辆工程",
        "材料类=复合材料等相关专业、材料成型(焊接)",
    ]


def test_major_requirement_change_requires_review():
    analysis = analyze_version_change(
        previous_title="某央企校园招聘公告",
        previous_content="需求专业：计算机科学与技术、软件工程。",
        previous_metadata={},
        candidate_title="某央企校园招聘公告",
        candidate_content="需求专业：电气工程、自动化。",
        candidate_metadata={},
    )

    assert analysis["requiresReview"] is True
    assert analysis["reasons"] == [
        {
            "code": "major_requirement_changed",
            "facet": "majorRequirements",
            "previous": ["专业=计算机科学与技术、软件工程"],
            "candidate": ["专业=电气工程、自动化"],
        }
    ]


def test_major_requirement_reordering_and_separator_changes_are_not_reviewed():
    analysis = analyze_version_change(
        previous_title="某央企校园招聘公告",
        previous_content="需求专业：计算机科学与技术、软件工程、人工智能。",
        previous_metadata={},
        candidate_title="某央企校园招聘公告",
        candidate_content="招聘专业: 人工智能 / 计算机科学与技术，软件工程。",
        candidate_metadata={},
    )

    assert analysis["previousFacts"]["majorRequirements"] == analysis[
        "candidateFacts"
    ]["majorRequirements"]
    assert analysis["requiresReview"] is False


def test_major_requirement_addition_and_removal_are_reviewed():
    added = analyze_version_change(
        previous_title="某央企校园招聘公告",
        previous_content="本次招聘面向高校毕业生，具体岗位详见公告。",
        previous_metadata={},
        candidate_title="某央企校园招聘公告",
        candidate_content="本次招聘面向高校毕业生。专业要求：计算机类、电子信息类。",
        candidate_metadata={},
    )
    removed = analyze_version_change(
        previous_title="某央企校园招聘公告",
        previous_content="本次招聘面向高校毕业生。专业要求：计算机类、电子信息类。",
        previous_metadata={},
        candidate_title="某央企校园招聘公告",
        candidate_content="本次招聘面向高校毕业生，具体岗位详见公告。",
        candidate_metadata={},
    )

    assert added["reasons"][0]["code"] == "major_requirement_changed_added"
    assert removed["reasons"][0]["code"] == "major_requirement_changed_removed"


def test_major_requirement_from_technical_enrichment_is_not_reviewed():
    analysis = analyze_version_change(
        previous_title="招聘海报",
        previous_content="某央企招聘海报，具体内容见图片。",
        previous_metadata={},
        candidate_title="某央企校园招聘公告",
        candidate_content=(
            "某央企面向2027届高校毕业生开展校园招聘。"
            "需求专业：计算机科学与技术、软件工程、人工智能。"
            "应聘人员应通过官方招聘网站提交真实材料，"
            "并以岗位详情中的学历、工作地点和资格审查要求为准。"
        )
        * 5,
        candidate_metadata={
            "ocrStatus": "completed",
            "ocrQualityScore": 95,
            "ocrNeedsReview": False,
        },
    )

    assert analysis["technicalEnrichment"] is True
    assert analysis["candidateFacts"]["majorRequirements"]
    assert analysis["requiresReview"] is False


def test_extracts_labeled_work_location_lists():
    facts = extract_critical_facts(
        title="中国航天科技集团校园招聘公告",
        content="工作地点：北京、西安、成都、保定。",
    )

    assert facts["workLocations"] == [
        "工作地点=保定、北京、成都、西安",
    ]


def test_work_location_normalizes_labels_suffixes_order_and_separators():
    first = extract_critical_facts(
        title="某央企招聘公告",
        content="工作地点：北京、河北省保定市、上海。",
    )
    second = extract_critical_facts(
        title="某央企招聘公告",
        content="岗位所在地为上海/河北保定/北京市。",
    )
    conjunction = extract_critical_facts(
        title="某央企招聘公告",
        content="工作城市包括北京和上海。",
    )

    assert first["workLocations"] == second["workLocations"]
    assert first["workLocations"] == [
        "工作地点=上海、北京、河北保定",
    ]
    assert conjunction["workLocations"] == [
        "工作地点=上海、北京",
    ]


def test_work_location_change_requires_review():
    analysis = analyze_version_change(
        previous_title="某央企招聘公告",
        previous_content="工作地点：北京、上海。",
        previous_metadata={},
        candidate_title="某央企招聘公告",
        candidate_content="工作地点：北京、广州。",
        candidate_metadata={},
    )

    assert analysis["requiresReview"] is True
    assert analysis["reasons"] == [
        {
            "code": "work_location_changed",
            "facet": "workLocations",
            "previous": ["工作地点=上海、北京"],
            "candidate": ["工作地点=北京、广州"],
        }
    ]


def test_work_location_addition_and_removal_are_reviewed():
    added = analyze_version_change(
        previous_title="某央企招聘公告",
        previous_content="具体岗位安排以官方页面发布内容为准。",
        previous_metadata={},
        candidate_title="某央企招聘公告",
        candidate_content="工作地点：北京、上海，具体岗位以官方页面为准。",
        candidate_metadata={},
    )
    removed = analyze_version_change(
        previous_title="某央企招聘公告",
        previous_content="工作地点：北京、上海，具体岗位以官方页面为准。",
        previous_metadata={},
        candidate_title="某央企招聘公告",
        candidate_content="具体岗位安排和其他事项以官方页面发布内容为准。",
        candidate_metadata={},
    )

    assert added["reasons"][0]["code"] == "work_location_changed_added"
    assert removed["reasons"][0]["code"] == "work_location_changed_removed"


def test_work_location_ignores_company_intro_and_unknown_placeholder():
    facts = extract_critical_facts(
        title="某央企招聘公告",
        content=(
            "公司总部位于北京，并在上海设有分公司。"
            "岗位工作地点和资格审查要求以岗位详情为准。"
        ),
    )

    assert facts["workLocations"] == []


def test_work_location_from_technical_enrichment_is_not_reviewed():
    analysis = analyze_version_change(
        previous_title="招聘海报",
        previous_content="某央企招聘海报，具体内容见图片。",
        previous_metadata={},
        candidate_title="某央企校园招聘公告",
        candidate_content=(
            "本次招聘面向2027届高校毕业生。"
            "工作地点：北京、西安、成都、保定。"
            "应聘人员须通过官方招聘网站提交材料，"
            "并以公告中的岗位条件和资格审查要求为准。"
        )
        * 7,
        candidate_metadata={
            "ocrStatus": "completed",
            "ocrQualityScore": 95,
            "ocrNeedsReview": False,
        },
    )

    assert analysis["technicalEnrichment"] is True
    assert analysis["candidateFacts"]["workLocations"]
    assert analysis["requiresReview"] is False


@pytest.mark.parametrize(
    ("content", "expected"),
    [
        ("本次计划公开招聘工作人员二十名。", ["招聘人数=20"]),
        ("招聘人数：20人。", ["招聘人数=20"]),
        ("公开招聘20名工作人员。", ["招聘人数=20"]),
        ("招录名额为一百零二人。", ["招聘人数=102"]),
        ("本次招聘计划共2人。", ["招聘人数=2"]),
    ],
)
def test_extracts_explicit_recruitment_headcounts(content, expected):
    facts = extract_critical_facts(
        title="某央企公开招聘公告",
        content=content,
    )

    assert facts["recruitmentHeadcounts"] == expected


def test_recruitment_headcounts_normalize_order_and_number_styles():
    first = extract_critical_facts(
        title="某央企公开招聘公告",
        content="岗位甲招聘人数：2人；岗位乙招聘人数：一人。",
    )
    second = extract_critical_facts(
        title="某央企公开招聘公告",
        content="岗位乙招录名额1名；岗位甲招聘计划人数二人。",
    )

    assert first["recruitmentHeadcounts"] == second["recruitmentHeadcounts"]
    assert first["recruitmentHeadcounts"] == [
        "招聘人数=1",
        "招聘人数=2",
    ]


def test_recruitment_headcount_change_requires_review():
    analysis = analyze_version_change(
        previous_title="某央企公开招聘公告",
        previous_content="本次计划公开招聘工作人员20名。",
        previous_metadata={},
        candidate_title="某央企公开招聘公告",
        candidate_content="本次计划公开招聘工作人员12名。",
        candidate_metadata={},
    )

    assert analysis["requiresReview"] is True
    assert analysis["reasons"] == [
        {
            "code": "recruitment_headcount_changed",
            "facet": "recruitmentHeadcounts",
            "previous": ["招聘人数=20"],
            "candidate": ["招聘人数=12"],
        }
    ]


def test_recruitment_headcount_addition_and_removal_are_reviewed():
    added = analyze_version_change(
        previous_title="某央企公开招聘公告",
        previous_content="本次公开招聘岗位安排以公告附件为准。",
        previous_metadata={},
        candidate_title="某央企公开招聘公告",
        candidate_content="本次公开招聘工作人员20名，岗位安排以附件为准。",
        candidate_metadata={},
    )
    removed = analyze_version_change(
        previous_title="某央企公开招聘公告",
        previous_content="本次公开招聘工作人员20名，岗位安排以附件为准。",
        previous_metadata={},
        candidate_title="某央企公开招聘公告",
        candidate_content="本次公开招聘岗位及其他安排继续以公告附件为准。",
        candidate_metadata={},
    )

    assert added["reasons"][0]["code"] == "recruitment_headcount_changed_added"
    assert removed["reasons"][0]["code"] == "recruitment_headcount_changed_removed"


def test_recruitment_headcount_ignores_other_people_counts_and_ratios():
    facts = extract_critical_facts(
        title="某央企公开招聘资格复审公告",
        content=(
            "本次招聘共有8个岗位开考比例未达到3:1，"
            "报名人数100人，通过资格复审人数20人。"
            "决定核减1个招聘计划，取消7个岗位，"
            "核减后招聘1人。项目预计投入20人月，"
            "实际招聘人数根据岗位需要另行确定。"
        ),
    )

    assert facts["recruitmentHeadcounts"] == []


def test_labeled_position_headcount_does_not_absorb_reviewed_people_count():
    facts = extract_critical_facts(
        title="某央企公开招聘面试公告",
        content=(
            "1039岗位招聘计划人数1人，"
            "报名人数5人，通过资格复审人数0人。"
        ),
    )

    assert facts["recruitmentHeadcounts"] == ["招聘人数=1"]


def test_recruitment_headcount_from_technical_enrichment_is_not_reviewed():
    analysis = analyze_version_change(
        previous_title="招聘海报",
        previous_content="某央企招聘海报，具体内容见图片。",
        previous_metadata={},
        candidate_title="某央企公开招聘公告",
        candidate_content=(
            "某央企本次计划公开招聘工作人员20名。"
            "招聘对象为2027届高校毕业生，学历要求本科及以上。"
            "应聘人员须通过官方招聘网站提交材料，"
            "具体岗位条件和资格审查安排以公告正文为准。"
        )
        * 6,
        candidate_metadata={
            "ocrStatus": "completed",
            "ocrQualityScore": 95,
            "ocrNeedsReview": False,
        },
    )

    assert analysis["technicalEnrichment"] is True
    assert analysis["candidateFacts"]["recruitmentHeadcounts"]
    assert analysis["requiresReview"] is False


def test_extracts_labeled_application_urls_and_recruitment_email():
    facts = extract_critical_facts(
        title="某央企校园招聘公告",
        content=(
            "简历投递：登录www.spacetalent.com.cn投递简历。"
            "网申入口：https://www.iguopin.com/company?id=10685386430687539。"
            "投递方式为邮箱投递，邮箱TeleAl.HR@Chinatelecom.cn。"
            "请将简历发送至huiyangzp@126.com。"
        ),
    )

    assert facts["applicationChannels"] == [
        "网址=iguopin.com/company?id=10685386430687539",
        "网址=spacetalent.com.cn",
        "邮箱=huiyangzp@126.com",
        "邮箱=teleal.hr@chinatelecom.cn",
    ]


def test_application_url_normalizes_transport_tracking_and_query_order():
    first = extract_critical_facts(
        title="某央企校园招聘公告",
        content=(
            "网申入口：https://WWW.IGUOPIN.COM/company?"
            "id=10685386430687539&utm_source=poster&campus=2026。"
        ),
    )
    second = extract_critical_facts(
        title="某央企校园招聘公告",
        content=(
            "报名网址：http://www.iguopin.com/company/?"
            "campus=2026&id=10685386430687539&from=wechat#apply。"
        ),
    )

    assert first["applicationChannels"] == second["applicationChannels"]
    assert first["applicationChannels"] == [
        "网址=iguopin.com/company?campus=2026&id=10685386430687539",
    ]


def test_application_channel_change_requires_review():
    analysis = analyze_version_change(
        previous_title="某央企校园招聘公告",
        previous_content="网申入口：https://old-job.example.com/campus。",
        previous_metadata={},
        candidate_title="某央企校园招聘公告",
        candidate_content="网申入口：https://new-job.example.com/campus。",
        candidate_metadata={},
    )

    assert analysis["requiresReview"] is True
    assert analysis["reasons"] == [
        {
            "code": "application_channel_changed",
            "facet": "applicationChannels",
            "previous": ["网址=old-job.example.com/campus"],
            "candidate": ["网址=new-job.example.com/campus"],
        }
    ]


def test_application_email_change_requires_review():
    analysis = analyze_version_change(
        previous_title="某央企招聘公告",
        previous_content="简历投递邮箱：old-jobs@example.com。",
        previous_metadata={},
        candidate_title="某央企招聘公告",
        candidate_content="简历投递邮箱：new-jobs@example.com。",
        candidate_metadata={},
    )

    assert analysis["requiresReview"] is True
    assert analysis["reasons"][0]["code"] == "application_channel_changed"
    assert analysis["reasons"][0]["previous"] == [
        "邮箱=old-jobs@example.com",
    ]
    assert analysis["reasons"][0]["candidate"] == [
        "邮箱=new-jobs@example.com",
    ]


def test_application_channel_addition_and_removal_are_reviewed():
    added = analyze_version_change(
        previous_title="某央企招聘公告",
        previous_content="本次招聘流程和岗位安排以正式公告为准。",
        previous_metadata={},
        candidate_title="某央企招聘公告",
        candidate_content=(
            "网申入口：https://job.example.com/campus，"
            "招聘流程和岗位安排以正式公告为准。"
        ),
        candidate_metadata={},
    )
    removed = analyze_version_change(
        previous_title="某央企招聘公告",
        previous_content=(
            "网申入口：https://job.example.com/campus，"
            "招聘流程和岗位安排以正式公告为准。"
        ),
        previous_metadata={},
        candidate_title="某央企招聘公告",
        candidate_content=(
            "本次招聘流程、岗位安排和其他事项继续以正式公告及"
            "后续通知为准，申请人须及时关注公告更新。"
        ),
        candidate_metadata={},
    )

    assert added["reasons"][0]["code"] == "application_channel_changed_added"
    assert removed["reasons"][0]["code"] == "application_channel_changed_removed"


def test_application_channel_ignores_navigation_support_and_pending_entry():
    facts = extract_critical_facts(
        title="某央企招聘公告",
        content=(
            "公司官网：https://www.company.example.com。"
            "公告来源：https://notice.example.com/jobs/1。"
            "客服邮箱：support@example.com。"
            "报名入口另行公布，投递方式以岗位详情为准。"
        ),
    )

    assert facts["applicationChannels"] == []


def test_login_url_followed_by_application_action_is_extracted():
    facts = extract_critical_facts(
        title="某央企社会招聘公告",
        content=(
            "系统外人员请登录zhaopin.csg.cn进行报名，"
            "系统内人员按内部流程申请。"
        ),
    )

    assert facts["applicationChannels"] == ["网址=zhaopin.csg.cn"]


def test_login_action_only_binds_the_nearby_application_url():
    facts = extract_critical_facts(
        title="某央企社会招聘公告",
        content=(
            "访问company.example.com了解企业，"
            "另请登录job.company.example.com进行报名。"
        ),
    )

    assert facts["applicationChannels"] == [
        "网址=job.company.example.com",
    ]


def test_application_channel_from_technical_enrichment_is_not_reviewed():
    analysis = analyze_version_change(
        previous_title="招聘海报",
        previous_content="某央企招聘海报，具体内容见图片。",
        previous_metadata={},
        candidate_title="某央企校园招聘公告",
        candidate_content=(
            "某央企面向2027届高校毕业生开展校园招聘。"
            "网申入口：https://job.example.com/campus。"
            "应聘人员须通过官方招聘网站提交真实材料，"
            "具体岗位条件和资格审查安排以公告正文为准。"
        )
        * 7,
        candidate_metadata={
            "ocrStatus": "completed",
            "ocrQualityScore": 95,
            "ocrNeedsReview": False,
        },
    )

    assert analysis["technicalEnrichment"] is True
    assert analysis["candidateFacts"]["applicationChannels"]
    assert analysis["requiresReview"] is False


def test_extracts_domestic_overseas_graduation_and_certification_windows():
    facts = extract_critical_facts(
        title="中国能建投资公司2026年校园招聘公告",
        content=(
            "国（境）内高校毕业生须在2026年7月31日前取得证书；"
            "国（境）外高校毕业证时间为2025年7月1日至"
            "2026年6月30日，并在2026年7月31日前取得学历认证。"
        ),
    )

    assert facts["graduationDateRequirements"] == [
        "境内:毕业≤2026-07-31",
        "境外:毕业=2025-07-01..2026-06-30",
        "境外:认证≤2026-07-31",
    ]


def test_graduation_window_normalizes_date_styles():
    written = extract_critical_facts(
        title="某央企校园招聘公告",
        content="毕业时间须在2025年7月1日至2026年6月30日期间。",
    )
    punctuated = extract_critical_facts(
        title="某央企校园招聘公告",
        content="毕业日期为2025/07/01—2026-06-30。",
    )

    assert written["graduationDateRequirements"] == [
        "通用:毕业=2025-07-01..2026-06-30"
    ]
    assert written["graduationDateRequirements"] == punctuated[
        "graduationDateRequirements"
    ]


def test_graduation_or_certification_window_change_requires_review():
    analysis = analyze_version_change(
        previous_title="某央企校园招聘公告",
        previous_content=(
            "境外高校毕业时间为2025年7月1日至2026年6月30日，"
            "并在2026年7月31日前取得学历认证。"
        ),
        previous_metadata={},
        candidate_title="某央企校园招聘公告",
        candidate_content=(
            "境外高校毕业时间为2025年7月1日至2026年8月31日，"
            "并在2026年9月30日前取得学历认证。"
        ),
        candidate_metadata={},
    )

    assert analysis["requiresReview"] is True
    assert analysis["reasons"] == [
        {
            "code": "graduation_date_requirement_changed",
            "facet": "graduationDateRequirements",
            "previous": [
                "境外:毕业=2025-07-01..2026-06-30",
                "境外:认证≤2026-07-31",
            ],
            "candidate": [
                "境外:毕业=2025-07-01..2026-08-31",
                "境外:认证≤2026-09-30",
            ],
        }
    ]


def test_graduation_date_requirement_addition_and_removal_are_reviewed():
    added = analyze_version_change(
        previous_title="某央企校园招聘公告",
        previous_content="本次招聘面向符合岗位要求的高校毕业生。",
        previous_metadata={},
        candidate_title="某央企校园招聘公告",
        candidate_content="高校毕业生须在2026年7月31日前取得毕业证书。",
        candidate_metadata={},
    )
    removed = analyze_version_change(
        previous_title="某央企校园招聘公告",
        previous_content="高校毕业生须在2026年7月31日前取得毕业证书。",
        previous_metadata={},
        candidate_title="某央企校园招聘公告",
        candidate_content="本次招聘面向符合岗位要求的高校毕业生。",
        candidate_metadata={},
    )

    assert (
        added["reasons"][0]["code"]
        == "graduation_date_requirement_changed_added"
    )
    assert (
        removed["reasons"][0]["code"]
        == "graduation_date_requirement_changed_removed"
    )


def test_graduation_date_requirement_ignores_unrelated_deadlines_and_no_date():
    facts = extract_critical_facts(
        title="某央企校园招聘公告",
        content=(
            "报名截止时间为2026年8月31日。"
            "应聘人员须如期取得毕业证和学位证。"
        ),
    )

    assert facts["graduationDateRequirements"] == []


def test_graduation_date_from_technical_enrichment_is_not_reviewed():
    analysis = analyze_version_change(
        previous_title="招聘海报",
        previous_content="某央企招聘海报，具体内容见图片。",
        previous_metadata={},
        candidate_title="某央企校园招聘公告",
        candidate_content=(
            "本次招聘面向符合岗位要求的高校毕业生。"
            "境外高校毕业时间为2025年7月1日至2026年6月30日，"
            "并在2026年7月31日前取得学历认证。"
            "应聘人员须通过官方招聘网站提交材料。"
        )
        * 5,
        candidate_metadata={
            "ocrStatus": "completed",
            "ocrQualityScore": 95,
            "ocrNeedsReview": False,
        },
    )

    assert analysis["technicalEnrichment"] is True
    assert analysis["candidateFacts"]["graduationDateRequirements"]
    assert analysis["requiresReview"] is False


def test_extracts_graduate_recruitment_audiences_from_real_wording():
    facts = extract_critical_facts(
        title="中国石油2026年春季高校毕业生招聘公告",
        content=(
            "本次招聘主要面向2026届高校毕业生；"
            "符合条件的留学回国人员和未落实工作单位的"
            "2025届毕业生也可报名。"
        ),
    )

    assert facts["recruitmentAudiences"] == [
        "未就业毕业生",
        "留学回国人员",
        "高校毕业生",
    ]


def test_extracts_system_internal_and_external_recruitment_scope():
    facts = extract_critical_facts(
        title="南网共享公司社会招聘公告",
        content="招聘范围面向系统内外人员。",
    )

    assert facts["recruitmentAudiences"] == [
        "系统内人员",
        "系统外人员",
    ]


def test_recruitment_audience_change_requires_review():
    analysis = analyze_version_change(
        previous_title="某企业招聘公告",
        previous_content="招聘对象为应届高校毕业生。",
        previous_metadata={},
        candidate_title="某企业招聘公告",
        candidate_content="招聘对象调整为社会人员。",
        candidate_metadata={},
    )

    assert analysis["requiresReview"] is True
    assert analysis["reasons"] == [
        {
            "code": "recruitment_audience_changed",
            "facet": "recruitmentAudiences",
            "previous": ["应届毕业生"],
            "candidate": ["社会人员"],
        }
    ]


def test_recruitment_audience_addition_and_removal_are_reviewed():
    added = analyze_version_change(
        previous_title="某企业招聘公告",
        previous_content="具体岗位和报名安排以公告为准。",
        previous_metadata={},
        candidate_title="某企业招聘公告",
        candidate_content="招聘对象为在职人员，具体岗位以公告为准。",
        candidate_metadata={},
    )
    removed = analyze_version_change(
        previous_title="某企业招聘公告",
        previous_content="招聘对象为在职人员，具体岗位以公告为准。",
        previous_metadata={},
        candidate_title="某企业招聘公告",
        candidate_content="具体岗位和报名安排以公告为准。",
        candidate_metadata={},
    )

    assert (
        added["reasons"][0]["code"]
        == "recruitment_audience_changed_added"
    )
    assert (
        removed["reasons"][0]["code"]
        == "recruitment_audience_changed_removed"
    )


def test_recruitment_audience_ignores_non_recruitment_context():
    facts = extract_critical_facts(
        title="某企业可持续发展报告",
        content=(
            "公司积极履行社会责任，为在职人员提供留学培训，"
            "并持续做好退役军人公益服务。"
        ),
    )

    assert facts["recruitmentAudiences"] == []


def test_recruitment_audience_from_technical_enrichment_is_not_reviewed():
    analysis = analyze_version_change(
        previous_title="招聘海报",
        previous_content="某央企招聘海报，具体内容见图片。",
        previous_metadata={},
        candidate_title="某央企校园招聘公告",
        candidate_content=(
            "本次招聘主要面向2027届高校毕业生。"
            "符合条件的留学回国人员也可报名。"
            "应聘人员须通过官方招聘网站提交材料，"
            "并以公告中的岗位条件和资格审查要求为准。"
        )
        * 7,
        candidate_metadata={
            "ocrStatus": "completed",
            "ocrQualityScore": 95,
            "ocrNeedsReview": False,
        },
    )

    assert analysis["technicalEnrichment"] is True
    assert analysis["candidateFacts"]["recruitmentAudiences"]
    assert analysis["requiresReview"] is False


def test_extracts_tentative_written_exam_date_from_state_grid_wording():
    facts = extract_critical_facts(
        title="国家电网有限公司2026年第三批招聘高校毕业生公告",
        content=(
            "组织招聘笔试：公司第三批统一笔试时间"
            "初定为2026年5月17日。"
        ),
    )

    assert facts["assessmentDates"] == [
        "笔试:暂定=2026-05-17",
    ]


@pytest.mark.parametrize(
    ("content", "expected"),
    [
        (
            "统一初选考试时间为2025年11月23日。",
            ["初选考试:确定=2025-11-23"],
        ),
        (
            "统一笔试定于4月18日举行。",
            ["笔试:确定=--04-18"],
        ),
        (
            "线上测评时间为2026年4月10日至2026年4月12日。",
            ["测评:确定=2026-04-10..2026-04-12"],
        ),
    ],
)
def test_extracts_assessment_types_full_partial_and_range_dates(
    content,
    expected,
):
    facts = extract_critical_facts(
        title="某央企校园招聘公告",
        content=content,
    )

    assert facts["assessmentDates"] == expected


def test_assessment_date_or_certainty_change_requires_review():
    changed = analyze_version_change(
        previous_title="某央企招聘公告",
        previous_content="统一笔试时间初定为2026年5月17日。",
        previous_metadata={},
        candidate_title="某央企招聘公告",
        candidate_content="统一笔试时间定于2026年5月24日。",
        candidate_metadata={},
    )
    confirmed = analyze_version_change(
        previous_title="某央企招聘公告",
        previous_content="统一笔试时间初定为2026年5月17日。",
        previous_metadata={},
        candidate_title="某央企招聘公告",
        candidate_content="统一笔试时间定于2026年5月17日。",
        candidate_metadata={},
    )

    assert changed["reasons"][0]["code"] == "assessment_date_changed"
    assert confirmed["reasons"][0]["code"] == "assessment_date_changed"
    assert changed["previousFacts"]["assessmentDates"] != changed[
        "candidateFacts"
    ]["assessmentDates"]
    assert confirmed["previousFacts"]["assessmentDates"] != confirmed[
        "candidateFacts"
    ]["assessmentDates"]


def test_assessment_date_addition_and_removal_are_reviewed():
    added = analyze_version_change(
        previous_title="某央企招聘公告",
        previous_content="后续考试安排以官方通知为准。",
        previous_metadata={},
        candidate_title="某央企招聘公告",
        candidate_content="统一笔试时间为2026年5月17日。",
        candidate_metadata={},
    )
    removed = analyze_version_change(
        previous_title="某央企招聘公告",
        previous_content="统一笔试时间为2026年5月17日。",
        previous_metadata={},
        candidate_title="某央企招聘公告",
        candidate_content="后续考试安排以官方通知为准。",
        candidate_metadata={},
    )

    assert added["reasons"][0]["code"] == "assessment_date_changed_added"
    assert removed["reasons"][0]["code"] == "assessment_date_changed_removed"


def test_assessment_date_ignores_language_tests_and_undated_processes():
    facts = extract_critical_facts(
        title="某央企招聘公告",
        content=(
            "大学英语四级考试成绩应在2026年6月1日前取得。"
            "招聘考试分为笔试和面试，后续安排以官方通知为准。"
        ),
    )

    assert facts["assessmentDates"] == []


def test_assessment_date_from_technical_enrichment_is_not_reviewed():
    analysis = analyze_version_change(
        previous_title="招聘海报",
        previous_content="某央企招聘海报，具体内容见图片。",
        previous_metadata={},
        candidate_title="某央企校园招聘公告",
        candidate_content=(
            "本次招聘面向2027届高校毕业生。"
            "统一笔试时间初定为2026年5月17日。"
            "应聘人员须通过官方招聘网站提交材料，"
            "并以公告中的岗位条件和后续通知为准。"
        )
        * 7,
        candidate_metadata={
            "ocrStatus": "completed",
            "ocrQualityScore": 95,
            "ocrNeedsReview": False,
        },
    )

    assert analysis["technicalEnrichment"] is True
    assert analysis["candidateFacts"]["assessmentDates"]
    assert analysis["requiresReview"] is False


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


def test_deadline_inherits_same_year_and_preserves_cutoff_time():
    shortened = extract_critical_facts(
        title="中国石油春季招聘公告",
        content="报名时间2026年4月22日至5月15日17:00。",
    )
    explicit = extract_critical_facts(
        title="中国石油春季招聘公告",
        content="报名时间2026/04/22至2026-05-15 17：00。",
    )

    assert shortened["deadlines"] == ["2026-05-15T17:00"]
    assert shortened["deadlines"] == explicit["deadlines"]


@pytest.mark.parametrize(
    ("content", "expected"),
    [
        (
            "报名截止时间为5月15日17时。",
            ["--05-15T17:00"],
        ),
        (
            "报名时间为2026年12月1日至1月15日。",
            ["--01-15"],
        ),
    ],
)
def test_deadline_keeps_unknown_year_when_it_cannot_be_inferred_safely(
    content,
    expected,
):
    facts = extract_critical_facts(
        title="某央企招聘公告",
        content=content,
    )

    assert facts["deadlines"] == expected


def test_deadline_clause_does_not_absorb_a_later_exam_date():
    facts = extract_critical_facts(
        title="某央企招聘公告",
        content=(
            "报名时间为2026年4月22日至5月15日，"
            "统一笔试时间为2026年5月17日。"
        ),
    )

    assert facts["deadlines"] == ["2026-05-15"]
    assert facts["assessmentDates"] == ["笔试:确定=2026-05-17"]


def test_deadline_time_change_requires_review():
    analysis = analyze_version_change(
        previous_title="某央企招聘公告",
        previous_content="报名截止时间为2026年5月15日17:00。",
        previous_metadata={},
        candidate_title="某央企招聘公告",
        candidate_content="报名截止时间为2026年5月15日18:00。",
        candidate_metadata={},
    )

    assert analysis["requiresReview"] is True
    assert analysis["reasons"] == [
        {
            "code": "deadline_changed",
            "facet": "deadlines",
            "previous": ["2026-05-15T17:00"],
            "candidate": ["2026-05-15T18:00"],
        }
    ]


def test_deadline_addition_and_removal_are_reviewed():
    added = analyze_version_change(
        previous_title="某央企招聘公告",
        previous_content="具体报名安排以官方页面为准。",
        previous_metadata={},
        candidate_title="某央企招聘公告",
        candidate_content="报名截止时间为2026年5月15日17:00。",
        candidate_metadata={},
    )
    removed = analyze_version_change(
        previous_title="某央企招聘公告",
        previous_content="报名截止时间为2026年5月15日17:00。",
        previous_metadata={},
        candidate_title="某央企招聘公告",
        candidate_content=(
            "本次招聘具体报名安排和其他事项以官方页面发布内容为准。"
        ),
        candidate_metadata={},
    )

    assert added["reasons"][0]["code"] == "deadline_changed_added"
    assert removed["reasons"][0]["code"] == "deadline_changed_removed"


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


def test_decided_partial_cancellation_is_reviewed_but_policy_clause_is_not():
    existing = [
        {
            "document_id": "daye-original-2026",
            "title": "大冶市国有企事业单位2026年人才引进公告",
            "url": "https://official.example.test/daye/original",
            "source_id": "daye-recruitment",
            "candidate_source_id": "daye-recruitment",
        }
    ]
    decided = analyze_cross_document_change(
        candidate_title="大冶市国有企事业单位2026年人才引进部分岗位计划调整公告",
        candidate_content=(
            "根据《大冶市国有企事业单位2026年人才引进公告》规定，"
            "结合报名资格审查情况，经研究决定，调整部分岗位计划。"
            "本次招聘共有8个岗位开考比例未达到3:1，"
            "决定对1个岗位核减1个招聘计划，取消7个岗位。"
        ),
        candidate_links=[],
        existing_documents=existing,
    )
    policy_only = analyze_cross_document_change(
        candidate_title="大冶市国有企事业单位2026年人才引进公告",
        candidate_content=(
            "报名结束后，对报名人数达不到规定开考比例的岗位，"
            "由招聘单位研究提出取消、核减招聘计划的意见，"
            "经主管部门同意后另行公布岗位计划调整情况。"
        ),
        candidate_links=[],
        existing_documents=existing,
    )
    retained = analyze_cross_document_change(
        candidate_title="大冶市国有企事业单位2026年人才引进资格复审公告",
        candidate_content=(
            "经研究，决定暂不取消该岗位，保留招聘计划1个，"
            "后续安排以面试公告为准。"
        ),
        candidate_links=[],
        existing_documents=existing,
    )

    assert decided["relationType"] == "withdrawn"
    assert decided["changeScope"] == "partial"
    assert decided["resolutionMode"] == "reconcile"
    assert decided["suggestedTargets"][0]["blocked"] is True
    assert policy_only["requiresReview"] is False
    assert retained["requiresReview"] is False


def test_field_style_cancellation_beats_deadline_extension_but_not_future_policy():
    original_url = "https://official.example.test/huaian/original"
    existing = [
        {
            "document_id": "huaian-original-2026",
            "title": "淮安市市属国有企业2026年第一批公开招聘公告",
            "url": original_url,
            "source_id": "huaian-sasac-recruitment",
            "candidate_source_id": "huaian-sasac-recruitment",
        }
    ]
    applied = analyze_cross_document_change(
        candidate_title=(
            "关于淮安市市属国有企业2026年第一批公开招聘"
            "延长报名时间及调整招聘相关条件的补充公告"
        ),
        candidate_content=(
            "经研究，决定延长招聘报名时间、调整招聘相关条件。"
            "报名时间延长至2026年4月19日16:00止。"
            "招聘岗位：取消“投资总监”岗位（招聘计划1人），"
            "该招聘计划人数增加至“投资经理”岗位。"
        ),
        candidate_links=[original_url],
        existing_documents=existing,
    )
    policy_only = analyze_cross_document_change(
        candidate_title="淮安市市属国有企业2026年第一批公开招聘公告",
        candidate_content=(
            "若未达到开考比例，该岗位在本次招聘中不再按原计划开考，"
            "具体取消或调整岗位将在补充公告中另行发布。"
        ),
        candidate_links=[],
        existing_documents=existing,
    )

    assert applied["lifecycle"] == ["withdrawn", "delayed", "corrected"]
    assert applied["relationType"] == "withdrawn"
    assert applied["changeScope"] == "partial"
    assert applied["resolutionMode"] == "reconcile"
    assert applied["suggestedTargets"][0]["evidence"] == ["explicit_link"]
    assert policy_only["requiresReview"] is False


def test_position_cancellation_in_title_is_applied_but_negation_is_not():
    original_url = "https://official.example.test/jobs/original"
    existing = [
        {
            "document_id": "original-1",
            "title": "某市2026年市属国有企业公开招聘员工公告",
            "url": original_url,
            "source_id": "municipal-soe-recruitment",
            "candidate_source_id": "municipal-soe-recruitment",
        }
    ]
    applied = analyze_cross_document_change(
        candidate_title=(
            "关于公布某市2026年市属国有企业公开招聘员工"
            "被取消岗位和减少招聘人数岗位的公告"
        ),
        candidate_content="具体岗位调整结果见公告附件。",
        candidate_links=[original_url],
        existing_documents=existing,
    )
    retained = analyze_cross_document_change(
        candidate_title="关于暂不取消岗位招聘的公告",
        candidate_content="经研究，该岗位继续按原计划组织招聘。",
        candidate_links=[original_url],
        existing_documents=existing,
    )

    assert applied["relationType"] == "withdrawn"
    assert applied["changeScope"] == "partial"
    assert applied["suggestedTargets"][0]["blocked"] is True
    assert retained["requiresReview"] is False


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
