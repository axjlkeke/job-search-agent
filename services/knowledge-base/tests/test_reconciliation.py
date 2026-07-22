from __future__ import annotations

from app.database import KnowledgeDatabase
from app.dify import (
    DifyDocumentError,
    DifyDocumentIndexStatus,
    DifyDocumentSyncReceipt,
)
from app.reconciliation import (
    reconcile_dify_documents,
    retry_failed_dify_documents,
)

from conftest import make_settings


def _queued_mapping(tmp_path):
    database = KnowledgeDatabase(tmp_path / "kb.db")
    database.initialize()
    source = database.register_source(
        name="官方来源",
        url="https://official.example/jobs",
    )
    document = database.upsert_document(
        source=source,
        canonical_url="https://official.example/jobs/1",
        title="官方招聘公告",
        content="用于验证 Dify 异步索引对账的真实正文版本。",
        content_hash="content-v1",
        mime_type="text/html",
        published_at="2026-07-17",
    )
    database.save_dify_mapping(
        local_document_id=document["document_id"],
        remote_document_id="remote-1",
        last_content_hash="content-v1",
        last_batch_id="batch-1",
        status="queued",
    )
    return database, source, document


def test_completed_dify_batch_marks_mapping_synced_and_resolves_old_review(
    monkeypatch, tmp_path
):
    database, source, document = _queued_mapping(tmp_path)
    database.queue_review(
        source_id=source["id"],
        document_id=document["document_id"],
        kind="dify_sync_failure",
        message="早期的暂时失败",
    )
    monkeypatch.setattr(
        "app.reconciliation.get_dify_document_index_status",
        lambda *args, **kwargs: DifyDocumentIndexStatus(
            remote_document_id="remote-1",
            indexing_status="completed",
        ),
    )

    result = reconcile_dify_documents(database, make_settings(tmp_path, dify=True))

    assert result["status"] == "success"
    assert result["synced"] == 1
    assert database.get_dify_mapping(document["document_id"])["status"] == "synced"
    assert database.stats()["pendingReviews"] == 0
    assert database.stats()["difyDocuments"] == 1


def test_processing_dify_batch_stays_queued(monkeypatch, tmp_path):
    database, _, document = _queued_mapping(tmp_path)
    monkeypatch.setattr(
        "app.reconciliation.get_dify_document_index_status",
        lambda *args, **kwargs: DifyDocumentIndexStatus(
            remote_document_id="remote-1",
            indexing_status="indexing",
        ),
    )

    result = reconcile_dify_documents(database, make_settings(tmp_path, dify=True))

    assert result["pending"] == 1
    assert database.get_dify_mapping(document["document_id"])["status"] == "queued"


def test_failed_status_or_status_request_never_becomes_synced(monkeypatch, tmp_path):
    database, _, document = _queued_mapping(tmp_path)
    monkeypatch.setattr(
        "app.reconciliation.get_dify_document_index_status",
        lambda *args, **kwargs: DifyDocumentIndexStatus(
            remote_document_id="remote-1",
            indexing_status="error",
            error="embedding failed",
        ),
    )
    result = reconcile_dify_documents(database, make_settings(tmp_path, dify=True))
    assert result["status"] == "completed-with-errors"
    assert database.get_dify_mapping(document["document_id"])["status"] == "error"

    database.save_dify_mapping(
        local_document_id=document["document_id"],
        remote_document_id="remote-1",
        last_content_hash="content-v1",
        last_batch_id="batch-2",
        status="queued",
    )
    monkeypatch.setattr(
        "app.reconciliation.get_dify_document_index_status",
        lambda *args, **kwargs: (_ for _ in ()).throw(
            DifyDocumentError("temporary unavailable")
        ),
    )
    result = reconcile_dify_documents(database, make_settings(tmp_path, dify=True))
    assert result["status"] == "completed-with-errors"
    assert database.get_dify_mapping(document["document_id"])["status"] == "queued"


def test_retry_failed_dify_document_creates_new_tracked_batch(
    monkeypatch, tmp_path
):
    database, source, document = _queued_mapping(tmp_path)
    database.save_dify_mapping(
        local_document_id=document["document_id"],
        remote_document_id="remote-1",
        last_content_hash="content-v1",
        last_batch_id="failed-batch",
        status="error",
        last_error="timed out",
    )
    database.queue_review(
        source_id=source["id"],
        document_id=document["document_id"],
        kind="dify_indexing_failure",
        message="timed out",
    )
    calls: list[dict[str, str]] = []

    def fake_sync(*args, **kwargs):
        calls.append(kwargs)
        return DifyDocumentSyncReceipt(
            remote_document_id="remote-1",
            batch_id="retry-batch",
        )

    monkeypatch.setattr(
        "app.reconciliation.sync_document_to_dify",
        fake_sync,
    )
    result = retry_failed_dify_documents(
        database,
        make_settings(tmp_path, dify=True),
    )
    mapping = database.get_dify_mapping(document["document_id"])

    assert result["status"] == "success"
    assert result["queued"] == 1
    assert calls[0]["remote_document_id"] == "remote-1"
    assert mapping["status"] == "queued"
    assert mapping["last_batch_id"] == "retry-batch"
    assert database.stats()["pendingReviews"] == 1


def test_retry_failed_dify_document_respects_retrieval_block(
    monkeypatch, tmp_path
):
    database = KnowledgeDatabase(tmp_path / "kb.db")
    database.initialize()
    source = database.register_source(
        name="官方来源",
        url="https://official.example/jobs",
    )
    document = database.upsert_document(
        source=source,
        canonical_url="https://official.example/jobs/index.html",
        title="招聘信息",
        content="仅用于发现招聘详情页的栏目列表。",
        content_hash="index-v1",
        mime_type="text/html",
        published_at=None,
        metadata={
            "documentRole": "discovery_index",
            "retrievalEligible": False,
        },
    )
    database.save_dify_mapping(
        local_document_id=document["document_id"],
        remote_document_id="remote-index",
        last_content_hash="index-v1",
        last_batch_id="failed-batch",
        status="error",
        last_error="timed out",
    )
    monkeypatch.setattr(
        "app.reconciliation.sync_document_to_dify",
        lambda *args, **kwargs: (_ for _ in ()).throw(
            AssertionError("blocked document must not be retried")
        ),
    )

    result = retry_failed_dify_documents(
        database,
        make_settings(tmp_path, dify=True),
    )

    assert result["status"] == "completed-with-skips"
    assert result["queued"] == 0
    assert result["skipped"] == 1
    assert (
        database.get_dify_mapping(document["document_id"])["status"]
        == "error"
    )
