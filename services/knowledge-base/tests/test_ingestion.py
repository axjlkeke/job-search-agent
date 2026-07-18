from __future__ import annotations

import socket
from dataclasses import replace
from types import SimpleNamespace

import pytest

from app.database import KnowledgeDatabase
from app.dify import DifyDocumentError, DifyDocumentSyncReceipt
from app.ingestion import (
    ExtractedDocument,
    OcrArtifact,
    SyncError,
    _enrich_document_with_ocr,
    _html_document,
    _normalize_ocr_content,
    _ocr_image_url,
    _ocr_quality,
    source_allows_url,
    sync_enabled_sources,
    sync_source,
    validate_public_url,
)
from app.retrieval import retrieve_locally
from app.schemas import SearchRequest

from conftest import make_settings


def test_html_image_article_keeps_scoped_image_for_ocr():
    document = _html_document(
        "https://official.example.test/recruit/notice.html",
        b"""
        <html><head><title>Official notice</title></head><body>
          <nav>unrelated navigation text that must not become the article</nav>
          <div class=\"zsy_content\"><p>image notice</p><img src=\"part/poster.jpeg\"></div>
        </body></html>
        """,
        "text/html; charset=utf-8",
    )

    assert document.content == "image notice"
    assert document.metadata["imageUrls"] == [
        "https://official.example.test/recruit/part/poster.jpeg"
    ]


def test_short_image_article_is_enriched_by_configured_ocr(monkeypatch, tmp_path):
    settings = make_settings(tmp_path, ocr=True)
    database = KnowledgeDatabase(settings.database_path)
    database.initialize()
    source = database.register_source(
        name="图片招聘公告",
        url="https://official.example.test/recruit/",
        allowed_hosts=["official.example.test"],
        include_paths=["/recruit/"],
    )
    document = ExtractedDocument(
        url="https://official.example.test/recruit/notice.html",
        title="图片招聘公告",
        content="招聘海报",
        mime_type="text/html",
        published_at="2026-07-17",
        links=[],
        metadata={
            "imageUrls": [
                "https://official.example.test/recruit/part/poster.jpeg"
            ]
        },
    )
    monkeypatch.setattr(
        "app.ingestion._ocr_image_url",
        lambda *args, **kwargs: OcrArtifact(
            image_url="https://official.example.test/recruit/part/poster.jpeg",
            image_hash="image-hash",
            raw_text="OCR 原始输出\n招聘岗位",
            normalized_text=(
                "OCR 识别出的招聘岗位、工作地点、投递时间、招聘网址和投递限制等完整公开内容。" * 3
            ),
            engine="test-ocr",
            engine_config={"mode": "accurate"},
            quality={"score": 96, "needsReview": False},
        ),
    )

    enriched, errors = _enrich_document_with_ocr(
        object(),
        document=document,
        settings=settings,
        source=source,
        allowed_hosts={"official.example.test"},
    )

    assert errors == []
    assert "[图片文字识别]" in enriched.content
    assert "工作地点" in enriched.content
    assert enriched.metadata["ocrStatus"] == "completed"
    assert enriched.metadata["ocrImageCount"] == 1
    assert enriched.metadata["ocrQualityScore"] == 96
    assert enriched.metadata["ocrNeedsReview"] is False
    assert enriched.ocr_artifacts[0].raw_text.startswith("OCR 原始输出")


def test_unchanged_ocr_image_reuses_current_audit_without_new_version(
    monkeypatch, tmp_path
):
    settings = replace(
        make_settings(tmp_path, ocr=True),
        vision_ocr_path="/test/tokensoff-vision-ocr",
    )
    database = KnowledgeDatabase(settings.database_path)
    database.initialize()
    source = database.register_source(
        name="图片招聘公告",
        url="https://official.example.test/recruit/notice.html",
        allowed_hosts=["official.example.test"],
        include_paths=["/recruit/"],
    )
    monkeypatch.setattr(
        "app.ingestion.fetch_document",
        lambda *args, **kwargs: ExtractedDocument(
            url=source["url"],
            title="图片招聘公告",
            content="招聘海报",
            mime_type="text/html",
            published_at="2026-07-17",
            links=[],
            metadata={
                "imageUrls": [
                    "https://official.example.test/recruit/poster.jpeg"
                ]
            },
        ),
    )
    monkeypatch.setattr(
        "app.ingestion._read_response",
        lambda *args, **kwargs: (
            "https://official.example.test/recruit/poster.jpeg",
            "image/jpeg",
            b"stable-image-pixels",
        ),
    )
    ocr_calls: list[int] = []

    def changing_ocr(*args, **kwargs):
        ocr_calls.append(1)
        text = (
            "官方招聘公告明确招聘岗位、专业要求、学历条件、工作地点、"
            f"报名时间和投递入口。识别批次{len(ocr_calls)}。"
        ) * 5
        return SimpleNamespace(
            returncode=0,
            stdout=text.encode(),
            stderr=b"",
        )

    monkeypatch.setattr("app.ingestion.subprocess.run", changing_ocr)

    first = sync_source(database, settings, source["id"])
    second = sync_source(database, settings, source["id"])
    snapshot = database.get_document_snapshot(
        source_id=source["id"],
        canonical_url=source["url"],
    )

    assert first["documentsChanged"] == 1
    assert second["documentsChanged"] == 0
    assert len(ocr_calls) == 1
    assert snapshot is not None
    assert "识别批次1" in snapshot["content"]
    assert database.stats()["versions"] == 1
    assert database.stats()["ocrArtifacts"] == 1


def test_vision_ocr_is_preferred_and_keeps_raw_audit_text(monkeypatch, tmp_path):
    settings = replace(
        make_settings(tmp_path, ocr=True),
        vision_ocr_path="/test/tokensoff-vision-ocr",
    )
    raw_text = """
    招聘岗位
    【超级优才专项】研发工程师
    智算网络 大数据 AI存储 操作系统 AI云电脑
    工作地点：北京、上海、广州、深圳
    校园招聘官网：https://ctyun.hotjob.cn
    每人仅有1次投递机会，共可投递1个意向
    """ * 4
    calls: list[list[str]] = []
    monkeypatch.setattr(
        "app.ingestion._read_response",
        lambda *args, **kwargs: (
            "https://official.example.test/recruit/poster.jpeg",
            "image/jpeg",
            b"test-image-pixels",
        ),
    )

    def fake_run(command, **kwargs):
        calls.append(command)
        return SimpleNamespace(returncode=0, stdout=raw_text.encode(), stderr=b"")

    monkeypatch.setattr("app.ingestion.subprocess.run", fake_run)
    artifact = _ocr_image_url(
        object(),
        url="https://official.example.test/recruit/poster.jpeg",
        settings=settings,
        allowed_hosts={"official.example.test"},
    )

    assert calls == [["/test/tokensoff-vision-ocr", "-"]]
    assert artifact.engine == "apple-vision-accurate-zh-Hans+en-US"
    assert artifact.raw_text == raw_text
    assert "每人仅有1次投递机会" in artifact.normalized_text
    assert artifact.quality["needsReview"] is False


def test_vision_failure_falls_back_to_tesseract_psm_three(monkeypatch, tmp_path):
    settings = replace(
        make_settings(tmp_path, ocr=True),
        vision_ocr_path="/test/tokensoff-vision-ocr",
    )
    calls: list[list[str]] = []
    monkeypatch.setattr(
        "app.ingestion._read_response",
        lambda *args, **kwargs: (
            "https://official.example.test/recruit/poster.jpeg",
            "image/jpeg",
            b"test-image-pixels",
        ),
    )

    def fake_run(command, **kwargs):
        calls.append(command)
        if command[0] == "/test/tokensoff-vision-ocr":
            return SimpleNamespace(returncode=1, stdout=b"", stderr=b"failed")
        text = "央企招聘公告包含岗位、学历、专业、工作地点和投递时间等官方信息。" * 12
        return SimpleNamespace(returncode=0, stdout=text.encode(), stderr=b"")

    monkeypatch.setattr("app.ingestion.subprocess.run", fake_run)
    artifact = _ocr_image_url(
        object(),
        url="https://official.example.test/recruit/poster.jpeg",
        settings=settings,
        allowed_hosts={"official.example.test"},
    )

    assert len(calls) == 2
    assert calls[1][-2:] == ["--psm", "3"]
    assert artifact.engine == "tesseract-chi_sim+eng"


def test_ocr_normalization_removes_decorations_and_flags_fragmented_text():
    cleaned = _normalize_ocr_content("»\na\nAI\n北京\n岗位要求完整正文")
    assert cleaned == "AI\n北京\n岗位要求完整正文"

    quality = _ocr_quality("a\nb\nc\n招聘\n岗位")
    assert quality["needsReview"] is True
    assert quality["score"] < 70


def test_short_image_article_without_ocr_is_marked_for_review(tmp_path):
    settings = make_settings(tmp_path)
    database = KnowledgeDatabase(settings.database_path)
    database.initialize()
    source = database.register_source(
        name="图片招聘公告",
        url="https://official.example.test/recruit/",
        allowed_hosts=["official.example.test"],
    )
    document = ExtractedDocument(
        url="https://official.example.test/recruit/notice.html",
        title="图片招聘公告",
        content="招聘海报",
        mime_type="text/html",
        published_at=None,
        links=[],
        metadata={
            "imageUrls": [
                "https://official.example.test/recruit/part/poster.jpeg"
            ]
        },
    )

    enriched, errors = _enrich_document_with_ocr(
        object(),
        document=document,
        settings=settings,
        source=source,
        allowed_hosts={"official.example.test"},
    )

    assert enriched.metadata["ocrStatus"] == "required"
    assert errors == ["页面主要正文位于图片中，OCR 尚未配置"]


def test_single_source_sync_versions_content(monkeypatch, tmp_path):
    settings = make_settings(tmp_path)
    database = KnowledgeDatabase(settings.database_path)
    database.initialize()
    source = database.register_source(
        name="官方招聘公告",
        url="https://official.example.test/notices",
        follow_links=False,
    )
    current = {"body": "这是官方发布的招聘公告正文，包含报名资格、专业要求、报名时间和官方核验提示等完整信息。"}

    def fake_fetch(*args, **kwargs):
        return ExtractedDocument(
            url="https://official.example.test/notices",
            title="官方招聘公告",
            content=current["body"],
            mime_type="text/html",
            published_at="2026-07-13",
            links=[],
            metadata={"contentType": "text/html"},
        )

    monkeypatch.setattr("app.ingestion.fetch_document", fake_fetch)
    first = sync_source(database, settings, source["id"])
    second = sync_source(database, settings, source["id"])
    current["body"] = "这是更新后的官方招聘公告正文，专业范围和报名截止时间已经变化，请申请人核对最新原文。"
    third = sync_source(database, settings, source["id"])

    assert first["documentsChanged"] == 1
    assert second["documentsChanged"] == 0
    assert third["documentsChanged"] == 1
    assert database.stats()["documents"] == 1
    assert database.stats()["versions"] == 2
    assert database.stats()["syncRuns"] == 3


def test_critical_fact_change_is_staged_once_and_can_be_rejected(
    monkeypatch, tmp_path
):
    settings = make_settings(tmp_path)
    database = KnowledgeDatabase(settings.database_path)
    database.initialize()
    source = database.register_source(
        name="官方招聘公告",
        url="https://official.example.test/notices",
    )
    current = {
        "body": (
            "某央企面向2027届应届毕业生开展校园招聘，"
            "报名截止时间为2026年8月31日，学历要求为本科及以上。"
        )
    }

    def fake_fetch(*args, **kwargs):
        return ExtractedDocument(
            url=source["url"],
            title="某央企校园招聘公告",
            content=current["body"],
            mime_type="text/html",
            published_at="2026-07-17",
            links=[],
            metadata={},
        )

    monkeypatch.setattr("app.ingestion.fetch_document", fake_fetch)
    first = sync_source(database, settings, source["id"])
    current["body"] = (
        "某央企面向2027届应届毕业生开展校园招聘，"
        "报名截止时间为2026年9月15日，学历要求为本科及以上。"
    )
    second = sync_source(database, settings, source["id"])
    repeated = sync_source(database, settings, source["id"])
    review = database.list_fact_reviews()[0]
    snapshot = database.get_document_snapshot(
        source_id=source["id"],
        canonical_url=source["url"],
    )

    assert first["documentsChanged"] == 1
    assert second["documentsChanged"] == 1
    assert repeated["documentsChanged"] == 0
    assert database.stats()["versions"] == 2
    assert database.stats()["pendingReviews"] == 1
    assert snapshot is not None
    assert "8月31日" in snapshot["content"]

    database.resolve_fact_review(
        document_id=review["documentId"],
        decision="reject",
    )
    after_reject = sync_source(database, settings, source["id"])

    assert after_reject["documentsChanged"] == 0
    assert database.stats()["pendingReviews"] == 0
    assert database.stats()["versions"] == 2


def test_new_url_delay_notice_creates_cross_document_review(
    monkeypatch, tmp_path
):
    settings = make_settings(tmp_path)
    database = KnowledgeDatabase(settings.database_path)
    database.initialize()
    source = database.register_source(
        name="官方招聘栏目",
        url="https://official.example.test/jobs",
        follow_links=True,
        max_documents=2,
        allowed_hosts=["official.example.test"],
        include_paths=["/jobs"],
    )
    correction_url = "https://official.example.test/jobs/delayed"

    def fake_fetch(*args, **kwargs):
        url = kwargs["url"]
        if url == source["url"]:
            return ExtractedDocument(
                url=source["url"],
                title="某央企2027届校园招聘公告",
                content=(
                    "某央企面向2027届应届毕业生开展校园招聘，"
                    "报名截止时间为2026年8月31日。"
                ),
                mime_type="text/html",
                published_at="2026-07-01",
                links=[correction_url],
                metadata={},
            )
        assert url == correction_url
        return ExtractedDocument(
            url=correction_url,
            title="关于某央企2027届校园招聘延期的公告",
            content=(
                "某央企2027届校园招聘报名截止时间"
                "由2026年8月31日延长至2026年9月15日。"
            ),
            mime_type="text/html",
            published_at="2026-07-10",
            links=[source["url"]],
            metadata={},
        )

    monkeypatch.setattr("app.ingestion.fetch_document", fake_fetch)
    first = sync_source(database, settings, source["id"])
    repeated = sync_source(database, settings, source["id"])
    reviews = database.list_cross_document_reviews()

    assert first["status"] == "success"
    assert first["documentsSeen"] == 2
    assert first["documentsChanged"] == 2
    assert repeated["documentsChanged"] == 0
    assert database.stats()["pendingCrossDocumentReviews"] == 1
    assert database.stats()["pendingReviews"] == 1
    assert database.stats()["versions"] == 2
    assert len(reviews) == 1
    assert reviews[0]["relationType"] == "delayed"
    assert reviews[0]["analysis"]["changeScope"] == "unknown"
    assert reviews[0]["analysis"]["resolutionMode"] == "reconcile"
    assert reviews[0]["candidateStatus"] == "review_pending"
    assert reviews[0]["targets"][0]["blocked"] is True
    assert retrieve_locally(
        database,
        SearchRequest(query="某央企2027届校园招聘", topK=6),
    ) == []


def test_follow_links_prioritizes_details_before_next_discovery_page(
    monkeypatch, tmp_path
):
    settings = make_settings(tmp_path)
    database = KnowledgeDatabase(settings.database_path)
    database.initialize()
    source = database.register_source(
        name="官方招聘栏目",
        url="https://official.example.test/jobs/",
        follow_links=True,
        max_documents=4,
        allowed_hosts=["official.example.test"],
        include_paths=["/jobs/"],
    )
    current_detail = "https://official.example.test/jobs/current.html"
    first_page = "https://official.example.test/jobs/index_2026_1.html"
    second_page = "https://official.example.test/jobs/index_2026_2.html"
    older_detail = "https://official.example.test/jobs/older.html"
    fetched: list[str] = []

    documents = {
        source["url"]: ExtractedDocument(
            url=source["url"],
            title="招聘信息",
            content="官方招聘栏目用于发现当前公开招聘公告。" * 10,
            mime_type="text/html",
            published_at=None,
            links=[current_detail, first_page, second_page],
            metadata={},
        ),
        current_detail: ExtractedDocument(
            url=current_detail,
            title="当前公开招聘公告",
            content="当前公告包含招聘单位、岗位要求和报名方式等可核验信息。" * 10,
            mime_type="text/html",
            published_at="2026-07-17",
            links=[],
            metadata={},
        ),
        first_page: ExtractedDocument(
            url=first_page,
            title="index_2026_1.html",
            content="历史招聘栏目第一页用于发现更早的官方招聘公告。" * 10,
            mime_type="text/html",
            published_at=None,
            links=[older_detail, second_page],
            metadata={},
        ),
        second_page: ExtractedDocument(
            url=second_page,
            title="index_2026_2.html",
            content="历史招聘栏目第二页用于发现更多官方招聘公告。" * 10,
            mime_type="text/html",
            published_at=None,
            links=[],
            metadata={},
        ),
        older_detail: ExtractedDocument(
            url=older_detail,
            title="较早公开招聘公告",
            content="较早公告包含招聘单位、岗位条件和历史报名安排等可核验信息。" * 10,
            mime_type="text/html",
            published_at="2025-07-17",
            links=[],
            metadata={},
        ),
    }

    def fake_fetch(*args, **kwargs):
        url = kwargs["url"]
        fetched.append(url)
        return documents[url]

    monkeypatch.setattr("app.ingestion.fetch_document", fake_fetch)
    result = sync_source(database, settings, source["id"])

    assert result["status"] == "success"
    assert result["documentsSeen"] == 4
    assert fetched == [
        source["url"],
        current_detail,
        first_page,
        older_detail,
    ]
    assert second_page not in fetched


def test_follow_links_skip_known_unsupported_binary_attachments(
    monkeypatch, tmp_path
):
    settings = make_settings(tmp_path)
    database = KnowledgeDatabase(settings.database_path)
    database.initialize()
    source = database.register_source(
        name="官方招聘栏目",
        url="https://official.example.test/jobs/",
        follow_links=True,
        max_documents=3,
        allowed_hosts=["official.example.test"],
        include_paths=["/jobs/"],
    )
    detail_url = "https://official.example.test/jobs/current.html"
    pdf_url = "https://official.example.test/jobs/requirements.pdf"
    docx_url = "https://official.example.test/jobs/positions.docx"
    xlsx_url = "https://official.example.test/jobs/positions.xlsx"
    fetched: list[str] = []
    for url in (docx_url, xlsx_url):
        database.queue_review(
            source_id=source["id"],
            kind="sync_failure",
            message=f"暂不支持的附件：{url}",
            payload={"url": url},
        )
    assert database.stats()["pendingReviews"] == 2

    documents = {
        source["url"]: ExtractedDocument(
            url=source["url"],
            title="招聘信息",
            content="官方招聘栏目用于发现当前公开招聘公告。" * 10,
            mime_type="text/html",
            published_at=None,
            links=[docx_url, detail_url, xlsx_url, pdf_url],
            metadata={},
        ),
        detail_url: ExtractedDocument(
            url=detail_url,
            title="当前公开招聘公告",
            content="当前公告包含招聘单位、岗位要求和报名方式等可核验信息。" * 10,
            mime_type="text/html",
            published_at="2026-07-17",
            links=[],
            metadata={},
        ),
        pdf_url: ExtractedDocument(
            url=pdf_url,
            title="招聘条件附件",
            content="官方 PDF 附件包含岗位条件、学历要求和专业范围等可核验信息。" * 10,
            mime_type="application/pdf",
            published_at=None,
            links=[],
            metadata={},
        ),
    }

    def fake_fetch(*args, **kwargs):
        url = kwargs["url"]
        fetched.append(url)
        return documents[url]

    monkeypatch.setattr("app.ingestion.fetch_document", fake_fetch)
    result = sync_source(database, settings, source["id"])

    assert result["status"] == "success"
    assert result["documentsSeen"] == 3
    assert fetched == [source["url"], detail_url, pdf_url]
    assert docx_url not in fetched
    assert xlsx_url not in fetched
    assert database.stats()["pendingReviews"] == 0


def test_cross_domain_official_supplement_blocks_linked_original(
    monkeypatch, tmp_path
):
    settings = make_settings(tmp_path)
    database = KnowledgeDatabase(settings.database_path)
    database.initialize()
    original_url = (
        "https://www.mohrss.gov.cn/SYrlzyhshbzb/fwyd/"
        "SYkaoshizhaopin/zyhgjjgsydwgkzp/zpgg/202604/"
        "t20260402_571893.html"
    )
    original_source = database.register_source(
        name="人社部公开招聘公告",
        url=original_url,
        source_grade="A",
        authority="official",
        allowed_hosts=["www.mohrss.gov.cn"],
    )
    original = database.upsert_document(
        source=original_source,
        canonical_url=original_url,
        title="国家统计局在京直属企事业单位2026年公开招聘应届毕业生公告",
        content=(
            "国家统计局在京直属企事业单位2026年公开招聘应届毕业生。"
            "岗位专业和报名时间以原公告为准。"
        ),
        content_hash="stats-original-v1",
        mime_type="text/html",
        published_at="2026-04-02",
    )
    correction_url = (
        "https://www.stats.gov.cn/xw/tjxw/tzgg/202604/"
        "t20260416_1963335.html"
    )
    correction_source = database.register_source(
        name="国家统计局招聘公告",
        url=correction_url,
        source_grade="A",
        authority="official",
        allowed_hosts=["www.stats.gov.cn"],
    )

    monkeypatch.setattr(
        "app.ingestion.fetch_document",
        lambda *args, **kwargs: ExtractedDocument(
            url=correction_url,
            title=(
                "国家统计局在京直属事业单位2026年度公开招聘"
                "应届高校毕业生补充公告"
            ),
            content=(
                "原公告中部分岗位资格条件作出调整。"
                "以上岗位报名时间延长至2026年4月22日17：00，"
                "原公告中其他信息不变。"
            ),
            mime_type="text/html",
            published_at="2026-04-16",
            links=[original_url],
            metadata={},
        ),
    )

    result = sync_source(database, settings, correction_source["id"])
    reviews = database.list_cross_document_reviews()

    assert result["status"] == "success"
    assert result["documentsChanged"] == 1
    assert len(reviews) == 1
    assert reviews[0]["relationType"] == "delayed"
    assert reviews[0]["analysis"]["changeScope"] == "partial"
    assert reviews[0]["analysis"]["resolutionMode"] == "reconcile"
    assert len(reviews[0]["targets"]) == 1
    assert reviews[0]["targets"][0] == {
        "documentId": original["document_id"],
        "title": (
            "国家统计局在京直属企事业单位2026年公开招聘"
            "应届毕业生公告"
        ),
        "url": original_url,
        "status": "active",
        "score": 1.0,
        "blocked": True,
        "selected": False,
        "evidence": [
            "explicit_link",
            "cross_registered_source",
        ],
    }
    assert database.stats()["difyQueued"] == 0
    assert database.has_incomplete_dify_documents() is False
    assert retrieve_locally(
        database,
        SearchRequest(query="国家统计局2026年公开招聘", topK=6),
    ) == []


def test_sync_failure_enters_review_queue(monkeypatch, tmp_path):
    settings = make_settings(tmp_path)
    database = KnowledgeDatabase(settings.database_path)
    database.initialize()
    source = database.register_source(
        name="待复核官方入口", url="https://official.example.test/"
    )

    def fail(*args, **kwargs):
        raise SyncError("页面需要 JavaScript 渲染")

    monkeypatch.setattr("app.ingestion.fetch_document", fail)
    result = sync_source(database, settings, source["id"])
    assert result["status"] == "failed"
    assert result["errorCount"] == 1
    assert database.stats()["pendingReviews"] == 1


def test_successful_resync_resolves_the_same_url_failure(monkeypatch, tmp_path):
    settings = make_settings(tmp_path)
    database = KnowledgeDatabase(settings.database_path)
    database.initialize()
    source = database.register_source(
        name="可恢复官方入口", url="https://official.example.test/notices"
    )
    attempts = {"count": 0}

    def recover(*args, **kwargs):
        attempts["count"] += 1
        if attempts["count"] == 1:
            raise SyncError("页面正文过短")
        return ExtractedDocument(
            url="https://official.example.test/notices",
            title="恢复后的官方招聘公告",
            content="这是一份恢复后可以正常提取的官方招聘公告正文，包含报名资格、专业要求和报名时间。",
            mime_type="text/html",
            published_at="2026-07-17",
            links=[],
            metadata={"contentType": "text/html"},
        )

    monkeypatch.setattr("app.ingestion.fetch_document", recover)
    first = sync_source(database, settings, source["id"])
    second = sync_source(database, settings, source["id"])

    assert first["status"] == "failed"
    assert second["status"] == "success"
    assert database.stats()["pendingReviews"] == 0
    with database.connect() as connection:
        row = connection.execute(
            "SELECT status, resolved_at FROM review_queue"
        ).fetchone()
    assert row["status"] == "resolved"
    assert row["resolved_at"] is not None


def test_disabled_source_must_be_reviewed_before_sync(tmp_path):
    settings = make_settings(tmp_path)
    database = KnowledgeDatabase(settings.database_path)
    database.initialize()
    source = database.register_source(
        name="默认关闭来源",
        url="https://official.example.test/",
        enabled=False,
    )
    try:
        sync_source(database, settings, source["id"])
    except SyncError as error:
        assert "尚未启用" in str(error)
    else:
        raise AssertionError("停用来源不应开始抓取")


def test_source_scope_rejects_other_hosts_and_unrelated_paths(tmp_path):
    database = KnowledgeDatabase(tmp_path / "kb.db")
    database.initialize()
    source = database.register_source(
        name="国资委招聘",
        url="https://www.sasac.gov.cn/recruit/index.html",
        allowed_hosts=["www.sasac.gov.cn", "wap.sasac.gov.cn"],
        include_paths=["/recruit/"],
        exclude_paths=["/recruit/login/"],
    )

    assert source_allows_url(source, "https://www.sasac.gov.cn/recruit/a.html")
    assert source_allows_url(source, "https://wap.sasac.gov.cn/recruit/a.html")
    assert not source_allows_url(source, "https://www.sasac.gov.cn/news/a.html")
    assert not source_allows_url(source, "https://www.sasac.gov.cn/recruit/login/a.html")
    assert not source_allows_url(source, "https://example.com/recruit/a.html")


def test_fake_ip_dns_requires_explicit_mode_and_reviewed_host(monkeypatch):
    monkeypatch.setattr(
        socket,
        "getaddrinfo",
        lambda *args, **kwargs: [
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("198.18.0.9", 443))
        ],
    )
    url = "https://www.sasac.gov.cn/recruit/index.html"
    with pytest.raises(SyncError, match="拒绝访问"):
        validate_public_url(url, allowed_hosts={"www.sasac.gov.cn"})

    validate_public_url(
        url,
        allowed_hosts={"www.sasac.gov.cn"},
        allow_fake_ip_dns=True,
    )

    with pytest.raises(SyncError, match="允许列表"):
        validate_public_url(
            url,
            allowed_hosts={"example.com"},
            allow_fake_ip_dns=True,
        )


def test_batch_sync_only_processes_enabled_sources_with_a_hard_limit(
    monkeypatch, tmp_path
):
    settings = make_settings(tmp_path)
    database = KnowledgeDatabase(settings.database_path)
    database.initialize()
    enabled_one = database.register_source(
        name="来源一", url="https://one.example.test/"
    )
    database.register_source(
        name="停用来源", url="https://disabled.example.test/", enabled=False
    )
    database.register_source(name="来源二", url="https://two.example.test/")
    calls = []

    def fake_sync(database, settings, source_ref):
        calls.append(source_ref)
        return {
            "sourceId": source_ref,
            "status": "success",
            "documentsSeen": 1,
            "documentsChanged": 1,
            "errorCount": 0,
        }

    monkeypatch.setattr("app.ingestion.sync_source", fake_sync)
    report = sync_enabled_sources(database, settings, limit_sources=1)

    assert calls == [enabled_one["id"]]
    assert report["mode"] == "enabled-sources-only"
    assert report["available"] == 2
    assert report["selected"] == 1
    assert report["succeeded"] == 1


def test_changed_documents_create_then_update_same_dify_document(monkeypatch, tmp_path):
    settings = make_settings(tmp_path, dify=True)
    database = KnowledgeDatabase(settings.database_path)
    database.initialize()
    source = database.register_source(
        name="官方招聘入口", url="https://official.example.test/jobs"
    )
    current = {"body": "首次发布的官方招聘正文，包含岗位条件、专业要求、报名时间与资格审查等信息。"}
    calls = []

    def fake_fetch(*args, **kwargs):
        return ExtractedDocument(
            url=source["url"],
            title="官方招聘公告",
            content=current["body"],
            mime_type="text/html",
            published_at="2026-07-13",
            links=[],
            metadata={},
        )

    def fake_dify(settings, *, title, content, remote_document_id):
        calls.append(remote_document_id)
        return DifyDocumentSyncReceipt(
            remote_document_id=remote_document_id or "remote-document-1",
            batch_id=f"batch-{len(calls)}",
        )

    monkeypatch.setattr("app.ingestion.fetch_document", fake_fetch)
    monkeypatch.setattr("app.ingestion.sync_document_to_dify", fake_dify)
    first = sync_source(database, settings, source["id"])
    first_mapping = database.get_dify_mapping(
        database.like_candidates(["首次发布的官方招聘正文"], 1)[0]["id"]
    )
    database.save_dify_mapping(
        local_document_id=first_mapping["local_document_id"],
        remote_document_id=first_mapping["remote_document_id"],
        last_content_hash=first_mapping["last_content_hash"],
        last_batch_id=first_mapping["last_batch_id"],
        status="synced",
    )
    unchanged = sync_source(database, settings, source["id"])
    current["body"] = "更新后的官方招聘正文，报名时间和专业条件发生变化，请学生核对本次最新公告。"
    updated = sync_source(database, settings, source["id"])

    assert first["status"] == "success"
    assert unchanged["documentsChanged"] == 0
    assert updated["status"] == "success"
    assert calls == [None, "remote-document-1"]
    assert database.stats()["difyDocuments"] == 0
    mapping = database.get_dify_mapping(
        database.like_candidates(["更新后的官方招聘正文"], 1)[0]["id"]
    )
    assert mapping["remote_document_id"] == "remote-document-1"
    assert mapping["status"] == "queued"
    assert mapping["last_batch_id"] == "batch-2"


def test_discovery_index_is_saved_but_not_sent_to_dify(monkeypatch, tmp_path):
    settings = make_settings(tmp_path, dify=True)
    database = KnowledgeDatabase(settings.database_path)
    database.initialize()
    source = database.register_source(
        name="人事招聘栏目",
        url="https://official.example.test/index_20742332_5.html",
    )
    monkeypatch.setattr(
        "app.ingestion.fetch_document",
        lambda *args, **kwargs: ExtractedDocument(
            url=source["url"],
            title="index_20742332_5.html",
            content="人事招聘栏目历史公告列表，包含年份、公告标题和详情页入口。" * 10,
            mime_type="text/html",
            published_at=None,
            links=[],
            metadata={},
        ),
    )

    def forbidden_dify(*args, **kwargs):
        raise AssertionError("发现索引页不应发送到 Dify")

    monkeypatch.setattr("app.ingestion.sync_document_to_dify", forbidden_dify)
    result = sync_source(database, settings, source["id"])
    snapshot = database.get_document_snapshot(
        source_id=source["id"],
        canonical_url=source["url"],
    )

    assert result["status"] == "success"
    assert result["documentsChanged"] == 1
    assert snapshot is not None
    assert snapshot["metadata"]["documentRole"] == "discovery_index"
    assert snapshot["metadata"]["retrievalEligible"] is False
    assert database.get_dify_mapping(snapshot["document_id"]) is None
    assert database.stats()["pendingReviews"] == 0
    assert database.stats()["discoveryDocuments"] == 1


def test_content_stub_is_reviewed_then_recovers_when_body_arrives(
    monkeypatch, tmp_path
):
    settings = make_settings(tmp_path, dify=True)
    database = KnowledgeDatabase(settings.database_path)
    database.initialize()
    source = database.register_source(
        name="中国长城招聘公告",
        url="https://official.example.test/jobs/china-great-wall",
    )
    current = {
        "content": (
            "中国长城2026全球博士人才招聘"
            "中国长城2026全球博士人才招聘"
        )
    }
    calls: list[str | None] = []

    monkeypatch.setattr(
        "app.ingestion.fetch_document",
        lambda *args, **kwargs: ExtractedDocument(
            url=source["url"],
            title="中国长城2026全球博士人才招聘",
            content=current["content"],
            mime_type="text/html",
            published_at="2026-07-17",
            links=[],
            metadata={},
        ),
    )

    def fake_dify(settings, *, title, content, remote_document_id):
        calls.append(remote_document_id)
        return DifyDocumentSyncReceipt(
            remote_document_id="remote-china-great-wall",
            batch_id="batch-complete",
        )

    monkeypatch.setattr("app.ingestion.sync_document_to_dify", fake_dify)
    first = sync_source(database, settings, source["id"])
    first_snapshot = database.get_document_snapshot(
        source_id=source["id"],
        canonical_url=source["url"],
    )

    assert first["status"] == "partial"
    assert first_snapshot is not None
    assert first_snapshot["metadata"]["documentRole"] == "content_stub"
    assert first_snapshot["metadata"]["retrievalEligible"] is False
    assert database.get_dify_mapping(first_snapshot["document_id"]) is None
    assert database.stats()["pendingReviews"] == 1
    assert database.stats()["contentStubs"] == 1
    assert calls == []

    current["content"] = (
        "中国长城面向全球招聘博士人才。本次公告明确人工智能、计算机、"
        "通信工程等专业方向，申请人应取得博士学历，并提交研究成果、"
        "项目经历和报名材料。岗位工作地点、截止时间、资格审查与面试"
        "安排均以中国长城官方招聘页面的完整公告为准。"
    )
    second = sync_source(database, settings, source["id"])
    second_snapshot = database.get_document_snapshot(
        source_id=source["id"],
        canonical_url=source["url"],
    )

    assert second["status"] == "success"
    assert second["documentsChanged"] == 1
    assert second_snapshot is not None
    assert second_snapshot["metadata"]["documentRole"] == "evidence"
    assert second_snapshot["metadata"]["retrievalEligible"] is True
    assert database.stats()["pendingReviews"] == 0
    assert database.stats()["retrievableDocuments"] == 1
    assert database.stats()["contentStubs"] == 0
    assert calls == [None]
    mapping = database.get_dify_mapping(second_snapshot["document_id"])
    assert mapping is not None
    assert mapping["remote_document_id"] == "remote-china-great-wall"
    assert mapping["status"] == "queued"


def test_low_quality_ocr_is_audited_and_not_sent_to_dify(monkeypatch, tmp_path):
    settings = make_settings(tmp_path, dify=True)
    database = KnowledgeDatabase(settings.database_path)
    database.initialize()
    source = database.register_source(
        name="图片招聘入口", url="https://official.example.test/jobs"
    )
    document = ExtractedDocument(
        url=source["url"],
        title="低质量图片招聘公告",
        content="[图片文字识别]\n招聘\na\nb\nc",
        mime_type="text/html",
        published_at="2026-07-17",
        links=[],
        metadata={
            "ocrStatus": "review_required",
            "ocrNeedsReview": True,
            "ocrQualityScore": 35,
        },
        ocr_artifacts=[
            OcrArtifact(
                image_url="https://official.example.test/poster.jpeg",
                image_hash="image-hash",
                raw_text="招聘\na\nb\nc",
                normalized_text="招聘",
                engine="test-ocr",
                engine_config={},
                quality={"score": 35, "needsReview": True},
            )
        ],
    )
    monkeypatch.setattr("app.ingestion.fetch_document", lambda *args, **kwargs: document)
    monkeypatch.setattr(
        "app.ingestion._enrich_document_with_ocr",
        lambda *args, **kwargs: (document, []),
    )

    def forbidden_dify(*args, **kwargs):
        raise AssertionError("低质量 OCR 不应发送到 Dify")

    monkeypatch.setattr("app.ingestion.sync_document_to_dify", forbidden_dify)
    result = sync_source(database, settings, source["id"])

    assert result["status"] == "partial"
    assert result["errorCount"] == 1
    assert database.stats()["ocrArtifacts"] == 1
    assert database.stats()["pendingReviews"] == 1
    assert database.like_candidates(["低质量图片招聘公告"], 1) == []
    snapshot = database.get_document_snapshot(
        source_id=source["id"],
        canonical_url=source["url"],
    )
    assert snapshot is not None
    assert database.get_dify_mapping(snapshot["document_id"]) is None


def test_queued_dify_mapping_is_retried_for_unchanged_content(monkeypatch, tmp_path):
    settings = make_settings(tmp_path, dify=True)
    database = KnowledgeDatabase(settings.database_path)
    database.initialize()
    source = database.register_source(
        name="官方招聘入口", url="https://official.example.test/jobs"
    )
    calls: list[str | None] = []

    monkeypatch.setattr(
        "app.ingestion.fetch_document",
        lambda *args, **kwargs: ExtractedDocument(
            url=source["url"],
            title="官方招聘公告",
            content="这是一份内容不变的官方招聘公告，用于验证 Dify 未完成状态会重试。",
            mime_type="text/html",
            published_at=None,
            links=[],
            metadata={},
        ),
    )

    def fake_dify(settings, *, title, content, remote_document_id):
        calls.append(remote_document_id)
        return DifyDocumentSyncReceipt(
            remote_document_id=remote_document_id or "remote-document-queued",
            batch_id=f"queued-batch-{len(calls)}",
        )

    monkeypatch.setattr("app.ingestion.sync_document_to_dify", fake_dify)
    first = sync_source(database, settings, source["id"])
    second = sync_source(database, settings, source["id"])

    assert first["documentsChanged"] == 1
    assert second["documentsChanged"] == 0
    assert calls == [None, "remote-document-queued"]
    document_id = database.like_candidates(["Dify 未完成状态"], 1)[0]["id"]
    mapping = database.get_dify_mapping(document_id)
    assert mapping["status"] == "queued"
    assert mapping["last_batch_id"] == "queued-batch-2"
    assert database.has_incomplete_dify_documents() is True


def test_failed_dify_sync_retries_unchanged_document(monkeypatch, tmp_path):
    settings = make_settings(tmp_path, dify=True)
    database = KnowledgeDatabase(settings.database_path)
    database.initialize()
    source = database.register_source(
        name="官方招聘入口", url="https://official.example.test/jobs"
    )
    attempts = 0

    monkeypatch.setattr(
        "app.ingestion.fetch_document",
        lambda *args, **kwargs: ExtractedDocument(
            url=source["url"],
            title="官方招聘公告",
            content="这份官方招聘正文保持不变，首次 Dify 失败后必须在下次同步重试。",
            mime_type="text/html",
            published_at=None,
            links=[],
            metadata={},
        ),
    )

    def flaky_dify(settings, *, title, content, remote_document_id):
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise DifyDocumentError("Dify 暂时不可用")
        return DifyDocumentSyncReceipt(
            remote_document_id="remote-document-recovered",
            batch_id="recovery-batch",
        )

    monkeypatch.setattr("app.ingestion.sync_document_to_dify", flaky_dify)
    first = sync_source(database, settings, source["id"])
    second = sync_source(database, settings, source["id"])

    assert first["status"] == "partial"
    assert second["status"] == "success"
    assert second["documentsChanged"] == 0
    assert attempts == 2
    document_id = database.like_candidates(["下次同步重试"], 1)[0]["id"]
    mapping = database.get_dify_mapping(document_id)
    assert mapping["status"] == "queued"
    assert mapping["remote_document_id"] == "remote-document-recovered"
    assert mapping["last_batch_id"] == "recovery-batch"


def test_dify_failure_keeps_local_document_and_marks_partial(monkeypatch, tmp_path):
    settings = make_settings(tmp_path, dify=True)
    database = KnowledgeDatabase(settings.database_path)
    database.initialize()
    source = database.register_source(
        name="官方招聘入口", url="https://official.example.test/jobs"
    )

    monkeypatch.setattr(
        "app.ingestion.fetch_document",
        lambda *args, **kwargs: ExtractedDocument(
            url=source["url"],
            title="官方招聘公告",
            content="这是一份真实抓取的官方招聘公告，远端索引故障不应删除本地正文和历史版本。",
            mime_type="text/html",
            published_at=None,
            links=[],
            metadata={},
        ),
    )

    def fail_dify(*args, **kwargs):
        raise DifyDocumentError("Dify 文档创建失败")

    monkeypatch.setattr("app.ingestion.sync_document_to_dify", fail_dify)
    result = sync_source(database, settings, source["id"])
    assert result["status"] == "partial"
    assert result["documentsChanged"] == 1
    assert result["errorCount"] == 1
    stats = database.stats()
    assert stats["documents"] == 1
    assert stats["versions"] == 1
    assert stats["difyDocuments"] == 0
    assert stats["pendingReviews"] == 1
