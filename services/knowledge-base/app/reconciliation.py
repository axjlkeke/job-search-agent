from __future__ import annotations

from typing import Any

from .config import Settings
from .database import KnowledgeDatabase
from .dify import (
    DifyDocumentError,
    get_dify_document_index_status,
    sync_document_to_dify,
)
from .document_quality import is_retrieval_eligible


PROCESSING_STATUSES = {"waiting", "parsing", "cleaning", "splitting", "indexing"}
ERROR_STATUSES = {"error", "paused"}
RECOVERABLE_REVIEW_KINDS = (
    "dify_sync_failure",
    "dify_indexing_failure",
    "dify_reconcile_failure",
)


def retry_failed_dify_documents(
    database: KnowledgeDatabase,
    settings: Settings,
    *,
    limit: int = 100,
) -> dict[str, Any]:
    if not settings.dify_configured:
        return {
            "status": "not-configured",
            "selected": 0,
            "queued": 0,
            "skipped": 0,
            "failed": 0,
        }
    mappings = database.list_dify_mappings(statuses=("error",), limit=limit)
    queued = 0
    skipped = 0
    failed = 0
    results: list[dict[str, Any]] = []
    for mapping in mappings:
        local_id = str(mapping["local_document_id"])
        document = database.get_dify_retry_document(local_id)
        metadata = document.get("metadata", {}) if document else {}
        fact_review = metadata.get("factReview")
        safe_to_retry = bool(
            document
            and document["source_enabled"]
            and document["status"] == "active"
            and not document["cross_blocked"]
            and not metadata.get("ocrNeedsReview")
            and not (
                isinstance(fact_review, dict)
                and fact_review.get("status") == "pending"
            )
            and is_retrieval_eligible(
                title=str(document["title"]),
                url=str(document["canonical_url"]),
                content=str(document["content"]),
                metadata=metadata,
            )
        )
        if not safe_to_retry:
            skipped += 1
            results.append(
                {"localDocumentId": local_id, "status": "blocked"}
            )
            continue
        try:
            receipt = sync_document_to_dify(
                settings,
                title=str(document["title"]),
                content=str(document["content"]),
                remote_document_id=mapping.get("remote_document_id"),
            )
        except DifyDocumentError as error:
            database.save_dify_mapping(
                local_document_id=local_id,
                remote_document_id=mapping.get("remote_document_id"),
                last_content_hash=mapping.get("last_content_hash"),
                last_batch_id=mapping.get("last_batch_id"),
                status="error",
                last_error=str(error),
            )
            database.queue_review(
                source_id=document["source_id"],
                document_id=local_id,
                kind="dify_sync_failure",
                message=str(error),
                payload={
                    "url": document["canonical_url"],
                    "operation": "retry",
                },
            )
            failed += 1
            results.append(
                {"localDocumentId": local_id, "status": "error"}
            )
            continue
        database.save_dify_mapping(
            local_document_id=local_id,
            remote_document_id=receipt.remote_document_id,
            last_content_hash=document["content_hash"],
            last_batch_id=receipt.batch_id,
            status="queued",
        )
        queued += 1
        results.append({"localDocumentId": local_id, "status": "queued"})

    if not mappings:
        overall = "noop"
    elif failed:
        overall = "completed-with-errors"
    elif skipped:
        overall = "completed-with-skips"
    else:
        overall = "success"
    return {
        "status": overall,
        "selected": len(mappings),
        "queued": queued,
        "skipped": skipped,
        "failed": failed,
        "results": results,
    }


def reconcile_dify_documents(
    database: KnowledgeDatabase,
    settings: Settings,
    *,
    limit: int = 200,
) -> dict[str, Any]:
    if not settings.dify_configured:
        return {
            "status": "not-configured",
            "selected": 0,
            "synced": 0,
            "pending": 0,
            "failed": 0,
        }
    mappings = database.list_dify_mappings(statuses=("queued",), limit=limit)
    synced = 0
    pending = 0
    failed = 0
    results: list[dict[str, Any]] = []
    for mapping in mappings:
        local_id = str(mapping["local_document_id"])
        remote_id = mapping.get("remote_document_id")
        batch_id = mapping.get("last_batch_id")
        if not isinstance(remote_id, str) or not remote_id or not isinstance(batch_id, str) or not batch_id:
            message = "Dify 映射缺少可跟踪的文档或批次 ID"
            database.save_dify_mapping(
                local_document_id=local_id,
                remote_document_id=remote_id if isinstance(remote_id, str) else None,
                last_content_hash=mapping.get("last_content_hash"),
                last_batch_id=batch_id if isinstance(batch_id, str) else None,
                status="error",
                last_error=message,
            )
            database.queue_review(
                source_id=mapping.get("source_id"),
                document_id=local_id,
                kind="dify_indexing_failure",
                message=message,
                payload={"url": mapping.get("canonical_url")},
            )
            failed += 1
            results.append({"localDocumentId": local_id, "status": "error"})
            continue
        try:
            status = get_dify_document_index_status(
                settings,
                batch_id=batch_id,
                remote_document_id=remote_id,
            )
        except DifyDocumentError as error:
            database.queue_review(
                source_id=mapping.get("source_id"),
                document_id=local_id,
                kind="dify_reconcile_failure",
                message=str(error),
                payload={
                    "url": mapping.get("canonical_url"),
                    "remoteDocumentId": remote_id,
                    "batchId": batch_id,
                },
            )
            failed += 1
            results.append({"localDocumentId": local_id, "status": "check-failed"})
            continue

        if status.indexing_status == "completed":
            if mapping.get("last_content_hash") != mapping.get("current_content_hash"):
                message = "Dify 已完成的批次对应旧正文版本，需要重新同步"
                database.save_dify_mapping(
                    local_document_id=local_id,
                    remote_document_id=remote_id,
                    last_content_hash=mapping.get("last_content_hash"),
                    last_batch_id=batch_id,
                    status="error",
                    last_error=message,
                )
                database.queue_review(
                    source_id=mapping.get("source_id"),
                    document_id=local_id,
                    kind="dify_indexing_failure",
                    message=message,
                    payload={
                        "url": mapping.get("canonical_url"),
                        "remoteDocumentId": remote_id,
                    },
                )
                failed += 1
                results.append({"localDocumentId": local_id, "status": "stale"})
                continue
            database.save_dify_mapping(
                local_document_id=local_id,
                remote_document_id=remote_id,
                last_content_hash=mapping.get("last_content_hash"),
                last_batch_id=batch_id,
                status="synced",
            )
            database.resolve_reviews(
                document_id=local_id,
                kinds=RECOVERABLE_REVIEW_KINDS,
            )
            synced += 1
            results.append({"localDocumentId": local_id, "status": "synced"})
        elif status.indexing_status in PROCESSING_STATUSES:
            pending += 1
            results.append(
                {"localDocumentId": local_id, "status": status.indexing_status}
            )
        elif status.indexing_status in ERROR_STATUSES:
            message = status.error or f"Dify 索引状态为 {status.indexing_status}"
            database.save_dify_mapping(
                local_document_id=local_id,
                remote_document_id=remote_id,
                last_content_hash=mapping.get("last_content_hash"),
                last_batch_id=batch_id,
                status="error",
                last_error=message,
            )
            database.queue_review(
                source_id=mapping.get("source_id"),
                document_id=local_id,
                kind="dify_indexing_failure",
                message=message,
                payload={
                    "url": mapping.get("canonical_url"),
                    "remoteDocumentId": remote_id,
                    "indexingStatus": status.indexing_status,
                },
            )
            failed += 1
            results.append({"localDocumentId": local_id, "status": "error"})

    if not mappings:
        overall = "noop"
    elif failed:
        overall = "completed-with-errors"
    else:
        overall = "success"
    return {
        "status": overall,
        "selected": len(mappings),
        "synced": synced,
        "pending": pending,
        "failed": failed,
        "results": results,
    }
