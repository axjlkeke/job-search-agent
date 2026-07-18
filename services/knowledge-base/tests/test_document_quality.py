from __future__ import annotations

from app.document_quality import (
    DOCUMENT_ROLE_CONTENT_STUB,
    DOCUMENT_ROLE_DISCOVERY_INDEX,
    DOCUMENT_ROLE_EVIDENCE,
    classify_document_role,
    document_quality_metadata,
    is_retrieval_eligible,
)


def test_index_filename_is_discovery_only():
    role, reasons = classify_document_role(
        title="index_20742332_5.html",
        url="http://www.mohrss.gov.cn/SYrlzyhshbzb/zwgk/gggs/zygg/index_20742332_5.html",
        content="人事招聘栏目历史公告列表，包含多个年份和公告链接。" * 8,
    )

    assert role == DOCUMENT_ROLE_DISCOVERY_INDEX
    assert reasons == ["listing_page"]
    assert (
        is_retrieval_eligible(
            title="index_20742332_5.html",
            url="http://www.mohrss.gov.cn/SYrlzyhshbzb/zwgk/gggs/zygg/index_20742332_5.html",
            content="人事招聘栏目历史公告列表，包含多个年份和公告链接。" * 8,
        )
        is False
    )


def test_title_only_repeated_page_is_content_stub():
    title = "中国长城2026全球博士人才招聘－国务院国有资产监督管理委员会"
    role, reasons = classify_document_role(
        title=title,
        url="https://www.sasac.gov.cn/n2588035/n2588325/n2588350/c34721345/content.html",
        content="中国长城2026全球博士人才招聘中国长城2026全球博士人才招聘",
    )

    assert role == DOCUMENT_ROLE_CONTENT_STUB
    assert reasons == ["missing_substantive_body"]


def test_central_enterprise_directory_remains_retrievable_evidence():
    title = "央企名录－国务院国有资产监督管理委员会"
    content = (
        "国务院国资委公布中央企业名录，包括中国核工业集团有限公司、"
        "中国航天科技集团有限公司、国家电网有限公司等企业。"
    )
    quality = document_quality_metadata(
        title=title,
        url="https://www.sasac.gov.cn/n2588035/n2641579/n2641645/index.html",
        content=content,
    )

    assert quality == {
        "documentRole": DOCUMENT_ROLE_EVIDENCE,
        "retrievalEligible": True,
        "retrievalQualityReasons": [],
    }


def test_short_failed_ocr_page_is_content_stub():
    role, reasons = classify_document_role(
        title="某央企招聘海报",
        url="https://official.example.test/jobs/poster",
        content="招聘海报",
        metadata={"ocrStatus": "failed"},
    )

    assert role == DOCUMENT_ROLE_CONTENT_STUB
    assert reasons == ["missing_substantive_body"]
