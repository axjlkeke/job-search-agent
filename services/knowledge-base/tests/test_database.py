from __future__ import annotations

import sqlite3

import pytest

from app.database import KnowledgeDatabase
from app.retrieval import retrieve_from_dify, retrieve_locally
from app.schemas import SearchRequest

from conftest import make_settings


def test_versions_are_hash_deduplicated_and_searchable(tmp_path):
    database = KnowledgeDatabase(tmp_path / "kb.db")
    database.initialize()
    source = database.register_source(
        name="国家电网招聘",
        url="https://example.com/jobs",
        tags=["国家电网", "校园招聘"],
    )
    first = database.upsert_document(
        source=source,
        canonical_url="https://example.com/jobs/1",
        title="国家电网计算机类校园招聘公告",
        content="国家电网本次面向计算机科学与技术等相关专业开展校园招聘，报名人员应以官方公告条件为准。",
        content_hash="hash-v1",
        mime_type="text/html",
        published_at="2026-07-01",
        metadata={"status": "recruiting", "validUntil": "2026-08-31"},
    )
    unchanged = database.upsert_document(
        source=source,
        canonical_url="https://example.com/jobs/1",
        title="国家电网计算机类校园招聘公告",
        content="国家电网本次面向计算机科学与技术等相关专业开展校园招聘，报名人员应以官方公告条件为准。",
        content_hash="hash-v1",
        mime_type="text/html",
        published_at="2026-07-01",
        metadata={"status": "recruiting", "validUntil": "2026-08-31"},
    )
    changed = database.upsert_document(
        source=source,
        canonical_url="https://example.com/jobs/1",
        title="国家电网计算机类校园招聘公告（更新）",
        content="国家电网计算机类岗位招聘条件已经更新，报名截止时间和专业范围请核对最新官方公告。",
        content_hash="hash-v2",
        mime_type="text/html",
        published_at="2026-07-02",
        metadata={"status": "recruiting", "validUntil": "2026-09-15"},
    )

    assert first["changed"] is True
    assert unchanged["changed"] is False
    assert unchanged["version_no"] == 1
    assert changed["changed"] is True
    assert changed["version_no"] == 2
    assert database.stats()["documents"] == 1
    assert database.stats()["versions"] == 2

    results = retrieve_locally(
        database,
        SearchRequest(
            query="计算机专业想进国家电网",
            topK=6,
            target={"companies": ["国家电网"]},
            filters={"validAt": "2026-08-01", "status": "active"},
        ),
    )
    assert len(results) == 1
    assert results[0]["id"] == first["document_id"]
    assert "国家电网" in results[0]["snippet"]


def test_document_roles_separate_saved_pages_from_retrievable_evidence(tmp_path):
    database = KnowledgeDatabase(tmp_path / "kb.db")
    database.initialize()
    source = database.register_source(
        name="央企公开资料",
        url="https://official.example.test/",
    )
    discovery = database.upsert_document(
        source=source,
        canonical_url="https://official.example.test/index_20742332_5.html",
        title="index_20742332_5.html",
        content="招聘公告列表包含企业招聘入口、历史年份和栏目翻页链接。" * 8,
        content_hash="discovery-v1",
        mime_type="text/html",
        published_at=None,
    )
    stub = database.upsert_document(
        source=source,
        canonical_url="https://official.example.test/china-great-wall",
        title="中国长城2026全球博士人才招聘",
        content="中国长城2026全球博士人才招聘中国长城2026全球博士人才招聘",
        content_hash="stub-v1",
        mime_type="text/html",
        published_at=None,
    )
    directory = database.upsert_document(
        source=source,
        canonical_url="https://official.example.test/central-enterprises/index.html",
        title="央企名录－国务院国有资产监督管理委员会",
        content=(
            "国务院国资委公布中央企业名录，包括中国核工业集团有限公司、"
            "国家电网有限公司和中国石油天然气集团有限公司等企业。"
        ),
        content_hash="directory-v1",
        mime_type="text/html",
        published_at=None,
    )

    stats = database.stats()
    assert stats["documents"] == 3
    assert stats["retrievableDocuments"] == 1
    assert stats["discoveryDocuments"] == 1
    assert stats["contentStubs"] == 1
    assert database.fts_candidates('"index_20742332_5"', 6) == []
    assert database.like_candidates(["中国长城2026全球博士人才招聘"], 6) == []
    results = retrieve_locally(
        database,
        SearchRequest(query="央企名录有哪些企业", topK=6),
    )
    assert [item["id"] for item in results] == [directory["document_id"]]
    assert discovery["document_id"] not in {item["id"] for item in results}
    assert stub["document_id"] not in {item["id"] for item in results}


def test_document_becoming_stub_is_removed_from_local_index(tmp_path):
    database = KnowledgeDatabase(tmp_path / "kb.db")
    database.initialize()
    source = database.register_source(
        name="官方招聘公告",
        url="https://official.example.test/jobs",
    )
    document = database.upsert_document(
        source=source,
        canonical_url="https://official.example.test/jobs/1",
        title="中国长城2026全球博士人才招聘",
        content=(
            "中国长城面向全球招聘博士人才，公告列明专业方向、学历条件、"
            "研究经历、工作地点、报名方式与资格审查要求。"
        ),
        content_hash="full-v1",
        mime_type="text/html",
        published_at=None,
    )
    assert database.like_candidates(["全球招聘博士人才"], 6)

    database.upsert_document(
        source=source,
        canonical_url="https://official.example.test/jobs/1",
        title="中国长城2026全球博士人才招聘",
        content="中国长城2026全球博士人才招聘中国长城2026全球博士人才招聘",
        content_hash="stub-v2",
        mime_type="text/html",
        published_at=None,
    )

    assert database.like_candidates(["中国长城2026全球博士人才招聘"], 6) == []
    assert database.stats()["contentStubs"] == 1
    with database.connect() as connection:
        indexed = connection.execute(
            "SELECT count(*) FROM document_fts WHERE document_id = ?",
            (document["document_id"],),
        ).fetchone()[0]
    assert indexed == 0


def test_local_retrieval_keeps_only_the_selected_company(tmp_path):
    database = KnowledgeDatabase(tmp_path / "kb.db")
    database.initialize()
    source = database.register_source(
        name="航空工业招聘",
        url="https://official.example.test/avic",
    )
    huiyang = database.upsert_document(
        source=source,
        canonical_url="https://official.example.test/avic/huiyang",
        title="航空工业惠阳2026年设计岗位招募",
        content="航空工业惠阳招聘设计岗位，工作地点为河北保定。",
        content_hash="huiyang-v1",
        mime_type="text/html",
        published_at="2026-07-01",
    )
    database.upsert_document(
        source=source,
        canonical_url="https://official.example.test/avic/general-aircraft",
        title="航空工业通飞2026届及2027届校园招聘",
        content="航空工业通飞招聘设计岗位，面向应届毕业生。",
        content_hash="general-aircraft-v1",
        mime_type="text/html",
        published_at="2026-07-01",
    )

    results = retrieve_locally(
        database,
        SearchRequest(
            query="航空工业设计岗位",
            topK=6,
            target={"companies": ["航空工业惠阳"]},
        ),
    )

    assert [item["id"] for item in results] == [huiyang["document_id"]]


def test_fact_change_candidate_is_hidden_until_approved(tmp_path):
    database = KnowledgeDatabase(tmp_path / "kb.db")
    database.initialize()
    source = database.register_source(
        name="官方招聘公告",
        url="https://official.example.test/jobs",
    )
    current = database.upsert_document(
        source=source,
        canonical_url="https://official.example.test/jobs/1",
        title="某央企校园招聘公告",
        content="报名截止时间为2026年8月31日，本科及以上学历可以申请。",
        content_hash="fact-v1",
        mime_type="text/html",
        published_at="2026-07-01",
    )
    database.save_dify_mapping(
        local_document_id=current["document_id"],
        remote_document_id="remote-fact-1",
        last_content_hash="fact-v1",
        status="queued",
    )
    staged = database.stage_document_version(
        source=source,
        canonical_url="https://official.example.test/jobs/1",
        title="某央企校园招聘公告（更新）",
        content="报名截止时间调整为2026年9月15日，本科及以上学历可以申请。",
        content_hash="fact-v2",
        mime_type="text/html",
        published_at="2026-07-02",
        metadata={"sourceGrade": "A"},
        analysis={
            "requiresReview": True,
            "reasons": [{"code": "deadline_changed"}],
        },
    )

    assert staged["held_for_review"] is True
    assert database.has_incomplete_dify_documents() is False
    assert database.list_fact_reviews()[0]["candidateContentHash"] == "fact-v2"
    hidden = retrieve_locally(
        database,
        SearchRequest(query="报名截止时间", topK=6),
    )
    assert hidden == []

    resolved = database.resolve_fact_review(
        document_id=current["document_id"],
        decision="approve",
    )
    assert resolved == {
        "status": "resolved",
        "decision": "approve",
        "documentId": current["document_id"],
        "contentHash": "fact-v2",
        "requiresDifySync": True,
    }
    assert database.list_fact_reviews() == []
    assert database.has_incomplete_dify_documents() is True
    visible = retrieve_locally(
        database,
        SearchRequest(query="2026年9月15日", topK=6),
    )
    assert len(visible) == 1
    assert "9月15日" in visible[0]["snippet"]


def test_pending_fact_review_is_removed_from_dify_results(monkeypatch, tmp_path):
    settings = make_settings(tmp_path, dify=True)
    database = KnowledgeDatabase(settings.database_path)
    database.initialize()
    source = database.register_source(
        name="官方招聘公告",
        url="https://official.example.test/jobs",
    )
    current = database.upsert_document(
        source=source,
        canonical_url="https://official.example.test/jobs/1",
        title="某央企校园招聘公告",
        content="报名截止时间为2026年8月31日。",
        content_hash="fact-v1",
        mime_type="text/html",
        published_at="2026-07-01",
    )
    database.save_dify_mapping(
        local_document_id=current["document_id"],
        remote_document_id="remote-fact-1",
        last_content_hash="fact-v1",
        status="queued",
    )
    database.stage_document_version(
        source=source,
        canonical_url="https://official.example.test/jobs/1",
        title="某央企校园招聘公告（更新）",
        content="报名截止时间调整为2026年9月15日。",
        content_hash="fact-v2",
        mime_type="text/html",
        published_at="2026-07-02",
        metadata={},
        analysis={
            "requiresReview": True,
            "reasons": [{"code": "deadline_changed"}],
        },
    )

    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {
                "records": [
                    {
                        "score": 0.95,
                        "segment": {
                            "id": "segment-1",
                            "content": "报名截止时间为2026年8月31日。",
                            "document": {
                                "id": "remote-fact-1",
                                "name": "某央企校园招聘公告",
                            },
                        },
                    }
                ]
            }

    monkeypatch.setattr(
        "app.retrieval.httpx.post",
        lambda *args, **kwargs: FakeResponse(),
    )
    results = retrieve_from_dify(
        database,
        settings,
        SearchRequest(query="报名截止时间", topK=6),
    )

    assert results == []


def test_rejected_fact_change_keeps_current_version_and_hash(tmp_path):
    database = KnowledgeDatabase(tmp_path / "kb.db")
    database.initialize()
    source = database.register_source(
        name="官方招聘公告",
        url="https://official.example.test/jobs",
    )
    current = database.upsert_document(
        source=source,
        canonical_url="https://official.example.test/jobs/1",
        title="完整招聘公告",
        content="完整招聘公告正文，报名截止时间为2026年8月31日。",
        content_hash="current-hash",
        mime_type="text/html",
        published_at="2026-07-01",
    )
    database.stage_document_version(
        source=source,
        canonical_url="https://official.example.test/jobs/1",
        title="不完整 OCR",
        content="招聘海报",
        content_hash="bad-ocr-hash",
        mime_type="text/html",
        published_at="2026-07-01",
        metadata={"ocrNeedsReview": True},
        analysis={
            "requiresReview": True,
            "reasons": [{"code": "content_regression"}],
        },
    )

    resolved = database.resolve_fact_review(
        document_id=current["document_id"],
        decision="reject",
    )
    snapshot = database.get_document_snapshot(
        source_id=source["id"],
        canonical_url="https://official.example.test/jobs/1",
    )

    assert resolved["contentHash"] == "current-hash"
    assert snapshot is not None
    assert snapshot["content_hash"] == "current-hash"
    assert snapshot["metadata"]["rejectedContentHashes"] == ["bad-ocr-hash"]
    assert "factReview" not in snapshot["metadata"]


def test_delayed_notice_requires_reconciliation_before_original_reactivation(
    monkeypatch, tmp_path
):
    settings = make_settings(tmp_path, dify=True)
    database = KnowledgeDatabase(settings.database_path)
    database.initialize()
    source = database.register_source(
        name="官方招聘公告",
        url="https://official.example.test/jobs",
    )
    original = database.upsert_document(
        source=source,
        canonical_url="https://official.example.test/jobs/original",
        title="某央企2027届校园招聘公告",
        content="原公告报名截止时间为2026年8月31日。",
        content_hash="original-v1",
        mime_type="text/html",
        published_at="2026-07-01",
    )
    database.save_dify_mapping(
        local_document_id=original["document_id"],
        remote_document_id="remote-original",
        last_content_hash="original-v1",
        status="synced",
    )
    candidate = database.create_cross_document_review(
        source=source,
        canonical_url="https://official.example.test/jobs/delayed",
        title="关于某央企2027届校园招聘延期的公告",
        content="报名截止时间延长至2026年9月15日。",
        content_hash="correction-v1",
        mime_type="text/html",
        published_at="2026-07-10",
        metadata={},
        analysis={
            "requiresReview": True,
            "relationType": "delayed",
            "changeScope": "unknown",
            "resolutionMode": "reconcile",
            "suggestedTargets": [
                {
                    "documentId": original["document_id"],
                    "score": 0.9,
                    "blocked": True,
                    "evidence": ["title_core_reference"],
                }
            ],
        },
    )
    database.queue_review(
        source_id=source["id"],
        document_id=candidate["document_id"],
        kind="cross_document_change",
        message="跨公告关系待审核",
        payload={"crossReviewId": candidate["cross_review_id"]},
    )

    assert database.stats()["pendingCrossDocumentReviews"] == 1
    assert database.has_incomplete_dify_documents() is False
    stale_query_results = retrieve_locally(
        database,
        SearchRequest(query="2026年8月31日", topK=6),
    )
    assert all(
        item["id"] != original["document_id"] for item in stale_query_results
    )
    remote = database.get_local_documents_by_remote_ids(["remote-original"])
    assert remote["remote-original"]["blocked"] is True

    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {
                "records": [
                    {
                        "score": 0.95,
                        "segment": {
                            "id": "segment-original",
                            "content": "原公告报名截止时间为2026年8月31日。",
                            "document": {
                                "id": "remote-original",
                                "name": "某央企2027届校园招聘公告",
                            },
                        },
                    }
                ]
            }

    monkeypatch.setattr(
        "app.retrieval.httpx.post",
        lambda *args, **kwargs: FakeResponse(),
    )
    assert retrieve_from_dify(
        database,
        settings,
        SearchRequest(query="报名截止时间", topK=6),
    ) == []

    resolved = database.resolve_cross_document_review(
        review_id=candidate["cross_review_id"],
        decision="approve",
    )

    assert resolved["targetDocumentId"] == original["document_id"]
    assert resolved["resolutionMode"] == "reconcile"
    assert resolved["requiresReconciliation"] is True
    assert database.stats()["pendingCrossDocumentReviews"] == 0
    assert database.stats()["pendingCrossDocumentReconciliations"] == 1
    assert database.stats()["pendingReviews"] == 1
    visible = retrieve_locally(
        database,
        SearchRequest(query="2026年9月15日", topK=6),
    )
    assert len(visible) == 1
    assert visible[0]["id"] == candidate["document_id"]
    original_snapshot = database.get_document_snapshot(
        source_id=source["id"],
        canonical_url="https://official.example.test/jobs/original",
    )
    assert original_snapshot is not None
    assert original_snapshot["status"] == "review_pending"
    assert original_snapshot["metadata"]["crossDocumentReconciliation"][
        "originalContentHash"
    ] == "original-v1"

    database.upsert_document(
        source=source,
        canonical_url="https://official.example.test/jobs/original",
        title="某央企2027届校园招聘公告",
        content="原公告报名截止时间为2026年8月31日。",
        content_hash="original-v1",
        mime_type="text/html",
        published_at="2026-07-01",
    )
    original_after_resync = database.get_document_snapshot(
        source_id=source["id"],
        canonical_url="https://official.example.test/jobs/original",
    )
    assert original_after_resync is not None
    assert original_after_resync["status"] == "review_pending"
    stale_query_results = retrieve_locally(
        database,
        SearchRequest(query="2026年8月31日", topK=6),
    )
    assert all(
        item["id"] != original["document_id"] for item in stale_query_results
    )

    with pytest.raises(ValueError, match="内容尚未更新"):
        database.resolve_cross_document_reconciliation(
            review_id=candidate["cross_review_id"],
            replacement_document_id=original["document_id"],
        )

    database.upsert_document(
        source=source,
        canonical_url="https://official.example.test/jobs/original",
        title="某央企2027届校园招聘公告（已合并延期安排）",
        content=(
            "某央企2027届校园招聘继续有效，"
            "报名截止时间已延长至2026年9月15日。"
        ),
        content_hash="original-v2",
        mime_type="text/html",
        published_at="2026-07-11",
    )
    reconciliations = database.list_cross_document_reconciliations()
    assert len(reconciliations) == 1
    assert reconciliations[0]["reviewId"] == candidate["cross_review_id"]
    assert reconciliations[0]["targetStatus"] == "review_pending"
    assert reconciliations[0]["originalContentHash"] == "original-v1"

    reconciled = database.resolve_cross_document_reconciliation(
        review_id=candidate["cross_review_id"],
        replacement_document_id=original["document_id"],
    )
    assert reconciled["resolution"] == "reactivated_updated_target"
    assert database.stats()["pendingCrossDocumentReconciliations"] == 0
    assert database.stats()["pendingReviews"] == 0
    current_original = database.get_document_snapshot(
        source_id=source["id"],
        canonical_url="https://official.example.test/jobs/original",
    )
    assert current_original is not None
    assert current_original["status"] == "active"
    assert "crossDocumentReconciliation" not in current_original["metadata"]
    remote_after_reconciliation = database.get_local_documents_by_remote_ids(
        ["remote-original"]
    )
    assert remote_after_reconciliation["remote-original"]["blocked"] is True
    database.save_dify_mapping(
        local_document_id=original["document_id"],
        remote_document_id="remote-original",
        last_content_hash="original-v2",
        status="synced",
    )
    remote_after_resync = database.get_local_documents_by_remote_ids(
        ["remote-original"]
    )
    assert remote_after_resync["remote-original"]["blocked"] is False
    current_results = retrieve_locally(
        database,
        SearchRequest(query="2026年9月15日", topK=6),
    )
    assert {item["id"] for item in current_results} == {
        original["document_id"],
        candidate["document_id"],
    }


def test_whole_recruitment_termination_supersedes_original_without_reconciliation(
    tmp_path,
):
    database = KnowledgeDatabase(tmp_path / "kb.db")
    database.initialize()
    source = database.register_source(
        name="江汽集团招聘公告",
        url="https://www.jac.com.cn/rczp/",
    )
    original = database.upsert_document(
        source=source,
        canonical_url="https://www.jac.com.cn/news/20251224/6060.html",
        title="安徽江淮汽车集团股份有限公司公开招聘工作人员公告",
        content="公开招聘党委组织部副部长岗位1人。",
        content_hash="jac-original-v1",
        mime_type="text/html",
        published_at="2025-12-24",
    )
    candidate = database.create_cross_document_review(
        source=source,
        canonical_url="https://www.jac.com.cn/news/20260223/9277.html",
        title="关于终止公开招聘工作人员的公告",
        content="经综合评审，决定终止本次公开招聘工作。",
        content_hash="jac-termination-v1",
        mime_type="text/html",
        published_at="2026-02-23",
        metadata={},
        analysis={
            "requiresReview": True,
            "relationType": "withdrawn",
            "changeScope": "whole",
            "resolutionMode": "supersede",
            "suggestedTargets": [
                {
                    "documentId": original["document_id"],
                    "score": 1.0,
                    "blocked": True,
                    "evidence": ["manual_verified_relation"],
                }
            ],
        },
    )

    resolved = database.resolve_cross_document_review(
        review_id=candidate["cross_review_id"],
        decision="approve",
    )

    assert resolved["resolutionMode"] == "supersede"
    assert resolved["requiresReconciliation"] is False
    assert database.stats()["pendingCrossDocumentReconciliations"] == 0
    original_snapshot = database.get_document_snapshot(
        source_id=source["id"],
        canonical_url="https://www.jac.com.cn/news/20251224/6060.html",
    )
    assert original_snapshot is not None
    assert original_snapshot["status"] == "superseded"
    assert original_snapshot["metadata"]["supersededByDocumentId"] == candidate[
        "document_id"
    ]

    database.upsert_document(
        source=source,
        canonical_url="https://www.jac.com.cn/news/20251224/6060.html",
        title="安徽江淮汽车集团股份有限公司公开招聘工作人员公告",
        content="公开招聘党委组织部副部长岗位1人，历史公告正文刷新。",
        content_hash="jac-original-v2",
        mime_type="text/html",
        published_at="2025-12-24",
    )
    after_resync = database.get_document_snapshot(
        source_id=source["id"],
        canonical_url="https://www.jac.com.cn/news/20251224/6060.html",
    )
    assert after_resync is not None
    assert after_resync["status"] == "superseded"


def test_complete_resume_notice_closes_the_prior_pause_chain(tmp_path):
    database = KnowledgeDatabase(tmp_path / "kb.db")
    database.initialize()
    source = database.register_source(
        name="最高人民法院第五巡回法庭",
        url="https://www.court.gov.cn/xunhui5/",
    )
    original = database.upsert_document(
        source=source,
        canonical_url=(
            "https://www.court.gov.cn/xunhui5/xiangqing/217321.html"
        ),
        title="最高人民法院第五巡回法庭2020年招聘公告",
        content="面向社会公开招聘聘用制人员9名，报名截止2月9日。",
        content_hash="court-original-v1",
        mime_type="text/html",
        published_at="2020-01-15",
    )
    pause = database.create_cross_document_review(
        source=source,
        canonical_url=(
            "https://www.court.gov.cn/xunhui5/xiangqing/219291.html"
        ),
        title="关于暂缓2020年年初招聘工作的公告",
        content=(
            "暂缓2020年年初招聘各项工作，恢复时间另行通知。"
        ),
        content_hash="court-pause-v1",
        mime_type="text/html",
        published_at="2020-02-10",
        metadata={},
        analysis={
            "requiresReview": True,
            "relationType": "paused",
            "changeScope": "unknown",
            "resumeCompleteness": None,
            "resolutionMode": "reconcile",
            "suggestedTargets": [
                {
                    "documentId": original["document_id"],
                    "score": 0.9,
                    "blocked": True,
                    "evidence": ["title_core_reference"],
                }
            ],
        },
    )
    paused = database.resolve_cross_document_review(
        review_id=pause["cross_review_id"],
        decision="approve",
    )
    assert paused["requiresReconciliation"] is True
    assert database.stats()["pendingCrossDocumentReconciliations"] == 1

    resume = database.create_cross_document_review(
        source=source,
        canonical_url=(
            "https://www.court.gov.cn/xunhui5/xiangqing/234371.html"
        ),
        title="关于恢复2020年招聘的公告",
        content=(
            "决定恢复2020年招聘工作，面向社会公开招聘聘用制人员"
            "13名。一、招聘条件，本科及以上学历。二、报名，报名"
            "人员提交报名材料，报名时间为6月8日至6月22日。"
            "三、资格审查和考试，考试分为初试和面试。四、体检"
            "和考察。已报名考生需要重新提交报名材料。"
        ),
        content_hash="court-resume-v1",
        mime_type="text/html",
        published_at="2020-06-08",
        metadata={},
        analysis={
            "requiresReview": True,
            "relationType": "resumed",
            "changeScope": "unknown",
            "resumeCompleteness": "complete",
            "resolutionMode": "supersede",
            "suggestedTargets": [
                {
                    "documentId": pause["document_id"],
                    "score": 0.84,
                    "blocked": True,
                    "evidence": ["title_similarity"],
                }
            ],
        },
    )
    resolved = database.resolve_cross_document_review(
        review_id=resume["cross_review_id"],
        decision="approve",
    )

    assert resolved["resolutionMode"] == "supersede"
    assert resolved["resumeCompleteness"] == "complete"
    assert resolved["requiresReconciliation"] is False
    assert resolved["closedPauseReconciliationReviewIds"] == [
        pause["cross_review_id"]
    ]
    assert database.stats()["pendingCrossDocumentReconciliations"] == 0
    assert database.stats()["pendingReviews"] == 0
    assert database.list_cross_document_reconciliations() == []

    original_snapshot = database.get_document_snapshot(
        source_id=source["id"],
        canonical_url=(
            "https://www.court.gov.cn/xunhui5/xiangqing/217321.html"
        ),
    )
    pause_snapshot = database.get_document_snapshot(
        source_id=source["id"],
        canonical_url=(
            "https://www.court.gov.cn/xunhui5/xiangqing/219291.html"
        ),
    )
    resume_snapshot = database.get_document_snapshot(
        source_id=source["id"],
        canonical_url=(
            "https://www.court.gov.cn/xunhui5/xiangqing/234371.html"
        ),
    )
    assert original_snapshot is not None
    assert pause_snapshot is not None
    assert resume_snapshot is not None
    assert original_snapshot["status"] == "superseded"
    assert pause_snapshot["status"] == "superseded"
    assert resume_snapshot["status"] == "active"
    assert original_snapshot["metadata"]["supersededByDocumentId"] == (
        resume["document_id"]
    )
    assert pause_snapshot["metadata"]["supersededByDocumentId"] == (
        resume["document_id"]
    )
    assert "crossDocumentReconciliation" not in original_snapshot["metadata"]
    assert resume_snapshot["metadata"]["supersedesDocumentIds"] == sorted(
        [original["document_id"], pause["document_id"]]
    )
    assert resume_snapshot["metadata"][
        "closedPauseReconciliationReviewIds"
    ] == [pause["cross_review_id"]]

    current_results = retrieve_locally(
        database,
        SearchRequest(query="13名", topK=6),
    )
    stale_results = retrieve_locally(
        database,
        SearchRequest(query="9名", topK=6),
    )
    assert [item["id"] for item in current_results] == [
        resume["document_id"]
    ]
    assert stale_results == []


def test_status_only_resume_cannot_bypass_reconciliation(tmp_path):
    database = KnowledgeDatabase(tmp_path / "kb.db")
    database.initialize()
    source = database.register_source(
        name="官方招聘",
        url="https://official.example.test/jobs",
    )
    paused_notice = database.upsert_document(
        source=source,
        canonical_url="https://official.example.test/jobs/paused",
        title="关于暂缓本次公开招聘工作的公告",
        content="本次招聘暂停，恢复时间另行通知。",
        content_hash="paused-v1",
        mime_type="text/html",
        published_at="2026-07-01",
    )
    resume = database.create_cross_document_review(
        source=source,
        canonical_url="https://official.example.test/jobs/resume",
        title="关于恢复报名的通知",
        content="经研究，现恢复报名，其他事项另行通知。",
        content_hash="resume-status-only-v1",
        mime_type="text/html",
        published_at="2026-07-10",
        metadata={},
        analysis={
            "requiresReview": True,
            "relationType": "resumed",
            "changeScope": "unknown",
            "resumeCompleteness": "status_only",
            "resolutionMode": "supersede",
            "suggestedTargets": [
                {
                    "documentId": paused_notice["document_id"],
                    "score": 1.0,
                    "blocked": True,
                    "evidence": ["explicit_link"],
                }
            ],
        },
    )

    resolved = database.resolve_cross_document_review(
        review_id=resume["cross_review_id"],
        decision="approve",
    )

    assert resolved["resolutionMode"] == "reconcile"
    assert resolved["requiresReconciliation"] is True
    paused_snapshot = database.get_document_snapshot(
        source_id=source["id"],
        canonical_url="https://official.example.test/jobs/paused",
    )
    assert paused_snapshot is not None
    assert paused_snapshot["status"] == "review_pending"


def test_cross_source_reconciliation_can_select_verified_official_replacement(
    tmp_path,
):
    database = KnowledgeDatabase(tmp_path / "kb.db")
    database.initialize()
    original_source = database.register_source(
        name="人社部招聘公告",
        url="https://www.mohrss.gov.cn/recruit/",
        source_grade="A",
        authority="official",
    )
    change_source = database.register_source(
        name="国家统计局招聘公告",
        url="https://www.stats.gov.cn/recruit/",
        source_grade="A",
        authority="official",
    )
    original = database.upsert_document(
        source=original_source,
        canonical_url="https://www.mohrss.gov.cn/recruit/original.html",
        title="国家统计局2026年公开招聘公告",
        content="原公告包含全部岗位和资格条件。",
        content_hash="original-v1",
        mime_type="text/html",
        published_at="2026-04-02",
    )
    change = database.create_cross_document_review(
        source=change_source,
        canonical_url="https://www.stats.gov.cn/recruit/supplement.html",
        title="国家统计局2026年公开招聘补充公告",
        content="部分岗位资格条件调整，原公告其他内容不变。",
        content_hash="supplement-v1",
        mime_type="text/html",
        published_at="2026-04-16",
        metadata={},
        analysis={
            "requiresReview": True,
            "relationType": "corrected",
            "changeScope": "partial",
            "resolutionMode": "reconcile",
            "suggestedTargets": [
                {
                    "documentId": original["document_id"],
                    "score": 1.0,
                    "blocked": True,
                    "evidence": [
                        "explicit_link",
                        "cross_registered_source",
                    ],
                }
            ],
        },
    )

    approved = database.resolve_cross_document_review(
        review_id=change["cross_review_id"],
        decision="approve",
        target_document_id=original["document_id"],
    )
    assert approved["requiresReconciliation"] is True

    replacement = database.upsert_document(
        source=change_source,
        canonical_url="https://www.stats.gov.cn/recruit/current.html",
        title="国家统计局2026年公开招聘现行完整公告",
        content="本公告已合并全部岗位和调整后的资格条件。",
        content_hash="current-v1",
        mime_type="text/html",
        published_at="2026-04-17",
    )
    reconciled = database.resolve_cross_document_reconciliation(
        review_id=change["cross_review_id"],
        replacement_document_id=replacement["document_id"],
    )

    assert reconciled["resolution"] == "superseded_by_replacement"
    original_snapshot = database.get_document_snapshot(
        source_id=original_source["id"],
        canonical_url="https://www.mohrss.gov.cn/recruit/original.html",
    )
    replacement_snapshot = database.get_document_snapshot(
        source_id=change_source["id"],
        canonical_url="https://www.stats.gov.cn/recruit/current.html",
    )
    assert original_snapshot is not None
    assert replacement_snapshot is not None
    assert original_snapshot["status"] == "superseded"
    assert original_snapshot["metadata"]["supersededByDocumentId"] == (
        replacement["document_id"]
    )
    assert replacement_snapshot["status"] == "active"
    assert replacement_snapshot["metadata"]["reconcilesDocumentId"] == (
        original["document_id"]
    )


def test_cross_document_rejection_keeps_both_documents_active(tmp_path):
    database = KnowledgeDatabase(tmp_path / "kb.db")
    database.initialize()
    source = database.register_source(
        name="官方招聘公告",
        url="https://official.example.test/jobs",
    )
    original = database.upsert_document(
        source=source,
        canonical_url="https://official.example.test/jobs/original",
        title="某央企招聘公告",
        content="原公告包含岗位和报名要求。",
        content_hash="original-v1",
        mime_type="text/html",
        published_at="2026-07-01",
    )
    candidate = database.create_cross_document_review(
        source=source,
        canonical_url="https://official.example.test/jobs/independent",
        title="关于调整招聘安排的公告",
        content="这是另一批独立招聘安排，不替代原公告。",
        content_hash="independent-v1",
        mime_type="text/html",
        published_at="2026-07-10",
        metadata={},
        analysis={
            "requiresReview": True,
            "relationType": "corrected",
            "suggestedTargets": [
                {
                    "documentId": original["document_id"],
                    "score": 0.75,
                    "blocked": True,
                    "evidence": ["title_similarity"],
                }
            ],
        },
    )

    database.resolve_cross_document_review(
        review_id=candidate["cross_review_id"],
        decision="reject",
    )

    original_snapshot = database.get_document_snapshot(
        source_id=source["id"],
        canonical_url="https://official.example.test/jobs/original",
    )
    candidate_snapshot = database.get_document_snapshot(
        source_id=source["id"],
        canonical_url="https://official.example.test/jobs/independent",
    )
    assert original_snapshot is not None
    assert candidate_snapshot is not None
    assert original_snapshot["status"] == "active"
    assert candidate_snapshot["status"] == "active"
    assert candidate_snapshot["metadata"]["crossDocumentReviewDecision"] == "reject"


def test_unresolved_cross_document_review_requires_an_explicit_target(tmp_path):
    database = KnowledgeDatabase(tmp_path / "kb.db")
    database.initialize()
    source = database.register_source(
        name="官方招聘公告",
        url="https://official.example.test/jobs",
    )
    original = database.upsert_document(
        source=source,
        canonical_url="https://official.example.test/jobs/original",
        title="某央企招聘公告",
        content="原公告正文。",
        content_hash="original-v1",
        mime_type="text/html",
        published_at=None,
    )
    candidate = database.create_cross_document_review(
        source=source,
        canonical_url="https://official.example.test/jobs/correction",
        title="关于延长报名时间的通知",
        content="本次招聘报名时间延长。",
        content_hash="correction-v1",
        mime_type="text/html",
        published_at=None,
        metadata={},
        analysis={
            "requiresReview": True,
            "relationType": "delayed",
            "suggestedTargets": [],
        },
    )

    with pytest.raises(ValueError, match="显式提供"):
        database.resolve_cross_document_review(
            review_id=candidate["cross_review_id"],
            decision="approve",
        )

    resolved = database.resolve_cross_document_review(
        review_id=candidate["cross_review_id"],
        decision="approve",
        target_document_id=original["document_id"],
    )
    assert resolved["targetDocumentId"] == original["document_id"]


def test_cross_source_candidates_require_exact_link_and_official_sources(
    tmp_path,
):
    database = KnowledgeDatabase(tmp_path / "kb.db")
    database.initialize()
    original_source = database.register_source(
        name="人社部招聘公告",
        url="https://www.mohrss.gov.cn/recruit/index.html",
        source_grade="A",
        authority="official",
    )
    untrusted_source = database.register_source(
        name="第三方转载",
        url="https://jobs.example.test/reposts",
        source_grade="C",
        authority="community",
    )
    candidate_source = database.register_source(
        name="国家统计局招聘公告",
        url="https://www.stats.gov.cn/recruit/index.html",
        source_grade="A",
        authority="official",
    )
    untrusted_candidate_source = database.register_source(
        name="第三方更正转载",
        url="https://mirror.example.test/supplements",
        source_grade="C",
        authority="community",
    )
    original_url = "https://www.mohrss.gov.cn/recruit/original.html"
    untrusted_url = "https://jobs.example.test/reposts/original.html"
    original = database.upsert_document(
        source=original_source,
        canonical_url=original_url,
        title="国家统计局在京直属企事业单位2026年公开招聘公告",
        content="原公告的报名时间、专业要求和岗位资格条件。",
        content_hash="official-original",
        mime_type="text/html",
        published_at="2026-04-02",
    )
    database.upsert_document(
        source=untrusted_source,
        canonical_url=untrusted_url,
        title="转载的国家统计局公开招聘公告",
        content="未经独立核验的第三方转载内容。",
        content_hash="untrusted-repost",
        mime_type="text/html",
        published_at="2026-04-02",
    )
    candidate_url = "https://www.stats.gov.cn/recruit/supplement.html"

    assert database.find_cross_document_candidates(
        source_id=candidate_source["id"],
        canonical_url=candidate_url,
    ) == []

    candidates = database.find_cross_document_candidates(
        source_id=candidate_source["id"],
        canonical_url=candidate_url,
        explicit_links=[original_url, untrusted_url],
    )

    assert [item["document_id"] for item in candidates] == [
        original["document_id"]
    ]
    assert candidates[0]["cross_registered_source"] is True
    assert candidates[0]["source_grade"] == "A"
    assert candidates[0]["source_authority"] == "official"
    assert database.find_cross_document_candidates(
        source_id=untrusted_candidate_source["id"],
        canonical_url=(
            "https://mirror.example.test/supplements/correction.html"
        ),
        explicit_links=[original_url],
    ) == []


def test_review_queue_is_counted(tmp_path):
    database = KnowledgeDatabase(tmp_path / "kb.db")
    database.initialize()
    source = database.register_source(name="官方来源", url="https://example.com/")
    database.queue_review(
        source_id=source["id"],
        kind="parse_failure",
        message="需要 OCR",
        payload={"url": "https://example.com/a.pdf"},
    )
    assert database.stats()["pendingReviews"] == 1


def test_ocr_artifact_preserves_raw_text_outside_search_metadata(tmp_path):
    database = KnowledgeDatabase(tmp_path / "kb.db")
    database.initialize()
    source = database.register_source(
        name="图片招聘公告",
        url="https://official.example.test/recruit/",
    )
    document = database.upsert_document(
        source=source,
        canonical_url="https://official.example.test/recruit/notice",
        title="图片招聘公告",
        content="[图片文字识别]\n招聘岗位、工作地点和投递要求。",
        content_hash="vision-clean-v1",
        mime_type="text/html",
        published_at="2026-07-17",
        metadata={"ocrStatus": "completed", "ocrQualityScore": 95},
    )
    inserted = database.record_ocr_artifacts(
        document_id=document["document_id"],
        version_id=document["version_id"],
        artifacts=[
            {
                "image_url": "https://official.example.test/recruit/poster.jpeg",
                "image_hash": "image-sha256",
                "raw_text": "原始 Vision 识别\n含换行和装饰符号 »",
                "normalized_text": "原始 Vision 识别\n含换行和装饰符号",
                "engine": "apple-vision-accurate-zh-Hans+en-US",
                "engine_config": {"recognitionLevel": "accurate"},
                "quality": {"score": 95, "needsReview": False},
            }
        ],
    )

    artifacts = database.list_ocr_artifacts(document["document_id"])
    assert inserted == 1
    assert database.stats()["ocrArtifacts"] == 1
    assert artifacts[0]["raw_text"].endswith("装饰符号 »")
    assert artifacts[0]["quality"] == {"score": 95, "needsReview": False}
    with database.connect() as connection:
        document_metadata = connection.execute(
            "SELECT metadata_json FROM documents WHERE id = ?",
            (document["document_id"],),
        ).fetchone()[0]
    assert "原始 Vision 识别" not in document_metadata


def test_review_queue_deduplicates_pending_issue_across_sync_runs(tmp_path):
    database = KnowledgeDatabase(tmp_path / "kb.db")
    database.initialize()
    source = database.register_source(name="官方来源", url="https://example.com/")
    first = database.queue_review(
        source_id=source["id"],
        kind="sync_failure",
        message="页面正文过短",
        payload={"url": "https://example.com/a", "runId": "run-1"},
    )
    repeated = database.queue_review(
        source_id=source["id"],
        kind="sync_failure",
        message="页面正文过短",
        payload={"url": "https://example.com/a", "runId": "run-2"},
    )
    other_page = database.queue_review(
        source_id=source["id"],
        kind="sync_failure",
        message="页面正文过短",
        payload={"url": "https://example.com/b", "runId": "run-2"},
    )

    assert repeated == first
    assert other_page != first
    assert database.stats()["pendingReviews"] == 2


def test_coverage_report_separates_registered_enabled_and_document_coverage(tmp_path):
    database = KnowledgeDatabase(tmp_path / "kb.db")
    database.initialize()
    source = database.register_source(
        name="官方招聘来源",
        url="https://official.example.test/jobs",
        tags=["央企", "招聘公告"],
        enabled=True,
    )
    database.register_source(
        name="待审核来源",
        url="https://pending.example.test/jobs",
        tags=["央企"],
        enabled=False,
    )
    database.upsert_document(
        source=source,
        canonical_url="https://official.example.test/jobs/1",
        title="官方招聘公告",
        content="一份有明确来源、发布时间和岗位要求的官方招聘公告正文。",
        content_hash="coverage-v1",
        mime_type="text/html",
        published_at="2026-07-17",
    )
    database.queue_review(
        source_id=source["id"],
        kind="parse_failure",
        message="附件需要复核",
    )

    report = database.coverage_report(stale_after_days=14)
    assert report["summary"] == {
        "registeredSources": 2,
        "enabledSources": 1,
        "sourcesWithDocuments": 1,
        "neverSyncedSources": 2,
        "staleEnabledSources": 1,
        "documents": 1,
        "documentsWithPublishedAt": 1,
        "pendingReviews": 1,
        "retrievableDocuments": 1,
        "discoveryDocuments": 0,
        "contentStubs": 0,
    }
    central = next(item for item in report["byTag"] if item["tag"] == "央企")
    assert central == {
        "tag": "央企",
        "registeredSources": 2,
        "enabledSources": 1,
        "documents": 1,
    }


def test_initialize_adds_batch_column_to_existing_dify_mapping_table(tmp_path):
    path = tmp_path / "kb.db"
    with sqlite3.connect(path) as connection:
        connection.execute(
            """
            CREATE TABLE dify_documents (
                local_document_id TEXT PRIMARY KEY,
                remote_document_id TEXT,
                last_content_hash TEXT,
                status TEXT NOT NULL DEFAULT 'pending',
                last_error TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )

    database = KnowledgeDatabase(path)
    database.initialize()

    with database.connect() as connection:
        columns = {
            row[1] for row in connection.execute("PRAGMA table_info(dify_documents)")
        }
    assert "last_batch_id" in columns


def test_initialize_adds_review_dedupe_column_to_existing_table(tmp_path):
    path = tmp_path / "kb.db"
    database = KnowledgeDatabase(path)
    database.initialize()
    with database.connect() as connection:
        connection.execute("DROP INDEX idx_review_pending_dedupe")
        connection.execute("ALTER TABLE review_queue RENAME TO old_review_queue")
        connection.execute(
            """
            CREATE TABLE review_queue (
                id TEXT PRIMARY KEY,
                source_id TEXT,
                document_id TEXT,
                kind TEXT NOT NULL,
                message TEXT NOT NULL,
                payload_json TEXT NOT NULL DEFAULT '{}',
                status TEXT NOT NULL DEFAULT 'pending',
                created_at TEXT NOT NULL,
                resolved_at TEXT
            )
            """
        )
        connection.execute("DROP TABLE old_review_queue")
        connection.commit()

    database.initialize()

    with database.connect() as connection:
        columns = {
            row[1] for row in connection.execute("PRAGMA table_info(review_queue)")
        }
        indexes = {
            row[1] for row in connection.execute("PRAGMA index_list(review_queue)")
        }
    assert "dedupe_key" in columns
    assert "idx_review_pending_dedupe" in indexes
