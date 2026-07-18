from __future__ import annotations

from app.entity_matching import (
    entity_variants,
    matches_retrieval_target,
    text_matches_entity,
)


def test_common_central_enterprise_abbreviations_are_controlled_variants():
    assert "中国广核" in entity_variants("中广核")
    assert "中广核" in entity_variants("中国广核集团有限公司")
    assert text_matches_entity("中国石油天然气集团招聘公告", "中石油")


def test_sibling_enterprises_with_a_shared_group_prefix_do_not_match():
    assert text_matches_entity("航空工业惠阳2026年设计岗位招募", "航空工业惠阳")
    assert not text_matches_entity(
        "航空工业通飞2026届及2027届校园招聘",
        "航空工业惠阳",
    )
    assert text_matches_entity(
        "中国航天科技集团2027校招提前批正式启动",
        "中国航天科技集团",
    )
    assert not text_matches_entity(
        "中国航天科工集团2027届校园招聘全面启动",
        "中国航天科技集团",
    )
    assert not text_matches_entity(
        "中国航天科技集团2027校招提前批正式启动",
        "中国航天科工集团",
    )
    assert not text_matches_entity(
        (
            "中国航天科工集团2027届校园招聘全面启动，集团拥有多家科技"
            "创新平台和国家级科技英才，完善技术、管理双序列培养机制。"
        ),
        "中国航天科技集团",
    )


def test_company_target_takes_priority_over_a_matching_job_title():
    assert not matches_retrieval_target(
        title="中国航发总部招聘公告",
        content="本次招聘设置信息技术岗位。",
        target={
            "companies": ["中国长城"],
            "jobTitles": ["信息技术"],
        },
    )


def test_empty_target_keeps_general_policy_search_available():
    assert matches_retrieval_target(
        title="国有企业吸纳高校毕业生就业政策",
        content="介绍公开招聘制度与就业支持措施。",
        target={},
    )
