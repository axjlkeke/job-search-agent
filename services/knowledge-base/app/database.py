from __future__ import annotations

import json
import hashlib
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, Iterator, Mapping, Sequence
from urllib.parse import urlsplit

from .document_quality import (
    DOCUMENT_ROLE_CONTENT_STUB,
    DOCUMENT_ROLE_DISCOVERY_INDEX,
    DOCUMENT_ROLE_EVIDENCE,
    classify_document_role,
    is_retrieval_eligible,
)


def utc_now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _load_json(value: str | None, fallback: Any) -> Any:
    if not value:
        return fallback
    try:
        return json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return fallback


def _clean_strings(values: Sequence[str]) -> list[str]:
    return sorted({str(value).strip() for value in values if str(value).strip()})


def _clean_paths(values: Sequence[str]) -> list[str]:
    return sorted(
        {
            value if value.startswith("/") else f"/{value}"
            for value in _clean_strings(values)
        }
    )


def _review_key(
    *,
    source_id: str | None,
    document_id: str | None,
    kind: str,
    message: str,
    payload: Mapping[str, Any] | None,
) -> str:
    stable_payload = {
        key: value
        for key, value in dict(payload or {}).items()
        if key not in {"runId", "attemptedAt", "timestamp"}
    }
    value = _json(
        {
            "sourceId": source_id,
            "documentId": document_id,
            "kind": kind,
            "message": message[:2_000],
            "payload": stable_payload,
        }
    )
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _queue_review_in_transaction(
    connection: sqlite3.Connection,
    *,
    source_id: str | None,
    document_id: str | None,
    kind: str,
    message: str,
    payload: Mapping[str, Any] | None,
    created_at: str,
) -> str:
    payload_data = dict(payload or {})
    dedupe_key = _review_key(
        source_id=source_id,
        document_id=document_id,
        kind=kind,
        message=message,
        payload=payload_data,
    )
    existing = connection.execute(
        """
        SELECT id FROM review_queue
        WHERE status = 'pending' AND dedupe_key = ?
        """,
        (dedupe_key,),
    ).fetchone()
    if existing is not None:
        return str(existing["id"])
    review_id = str(uuid.uuid4())
    connection.execute(
        """
        INSERT INTO review_queue (
            id, source_id, document_id, kind, message, payload_json,
            dedupe_key, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            review_id,
            source_id,
            document_id,
            kind,
            message[:2_000],
            _json(payload_data),
            dedupe_key,
            created_at,
        ),
    )
    return review_id


def _reindex_document(
    connection: sqlite3.Connection,
    *,
    document_id: str,
) -> None:
    connection.execute(
        "DELETE FROM document_fts WHERE document_id = ?",
        (document_id,),
    )
    row = connection.execute(
        """
        SELECT d.id, d.title, d.canonical_url, d.published_at, d.status,
               d.metadata_json, v.content_text,
               s.name AS source_name, s.tags_json
        FROM documents AS d
        JOIN versions AS v ON v.id = d.current_version_id
        JOIN sources AS s ON s.id = d.source_id
        WHERE d.id = ?
        """,
        (document_id,),
    ).fetchone()
    if row is None or row["status"] != "active":
        return
    if not is_retrieval_eligible(
        title=str(row["title"]),
        url=str(row["canonical_url"]),
        content=str(row["content_text"]),
        metadata=_load_json(row["metadata_json"], {}),
    ):
        return
    connection.execute(
        """
        INSERT INTO document_fts (
            document_id, title, content, source_name, url,
            published_at, tags
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            row["id"],
            row["title"],
            row["content_text"],
            row["source_name"],
            row["canonical_url"],
            row["published_at"] or "",
            " ".join(_load_json(row["tags_json"], [])),
        ),
    )


def _document_quality_counts(
    connection: sqlite3.Connection,
) -> dict[str, int]:
    counts = {
        DOCUMENT_ROLE_EVIDENCE: 0,
        DOCUMENT_ROLE_DISCOVERY_INDEX: 0,
        DOCUMENT_ROLE_CONTENT_STUB: 0,
    }
    rows = connection.execute(
        """
        SELECT d.title, d.canonical_url, d.metadata_json, v.content_text
        FROM documents AS d
        JOIN versions AS v ON v.id = d.current_version_id
        WHERE d.status = 'active'
        """
    ).fetchall()
    for row in rows:
        role, _ = classify_document_role(
            title=str(row["title"]),
            url=str(row["canonical_url"]),
            content=str(row["content_text"]),
            metadata=_load_json(row["metadata_json"], {}),
        )
        counts[role] += 1
    return {
        "retrievableDocuments": counts[DOCUMENT_ROLE_EVIDENCE],
        "discoveryDocuments": counts[DOCUMENT_ROLE_DISCOVERY_INDEX],
        "contentStubs": counts[DOCUMENT_ROLE_CONTENT_STUB],
    }


def _close_paused_reconciliation_chain(
    connection: sqlite3.Connection,
    *,
    selected_target_document_id: str,
    resume_document_id: str,
    resume_review_id: str,
    completed_at: str,
) -> dict[str, list[str]]:
    """Close an older pause hold once a complete resume notice takes over."""
    rows = connection.execute(
        """
        SELECT id, candidate_document_id, resolved_target_document_id,
               analysis_json
        FROM cross_document_reviews
        WHERE status = 'approved_reconciliation'
          AND relation_type = 'paused'
          AND (
                candidate_document_id = ?
                OR resolved_target_document_id = ?
          )
        ORDER BY created_at, id
        """,
        (
            selected_target_document_id,
            selected_target_document_id,
        ),
    ).fetchall()
    closed_review_ids: list[str] = []
    superseded_document_ids: set[str] = set()
    for row in rows:
        prior_review_id = str(row["id"])
        pause_document_id = str(row["candidate_document_id"])
        original_document_id = str(row["resolved_target_document_id"])
        for document_id in {pause_document_id, original_document_id}:
            if document_id == resume_document_id:
                continue
            document = connection.execute(
                "SELECT metadata_json FROM documents WHERE id = ?",
                (document_id,),
            ).fetchone()
            if document is None:
                continue
            metadata = _load_json(document["metadata_json"], {})
            metadata.pop("crossDocumentReconciliation", None)
            metadata["supersededByDocumentId"] = resume_document_id
            metadata["supersededAt"] = completed_at
            metadata["crossDocumentResumeReviewId"] = resume_review_id
            if document_id == pause_document_id:
                metadata["crossDocumentReconciledAt"] = completed_at
                metadata["reconciledByDocumentId"] = resume_document_id
            connection.execute(
                """
                UPDATE documents
                SET status = 'superseded', metadata_json = ?, updated_at = ?
                WHERE id = ?
                """,
                (_json(metadata), completed_at, document_id),
            )
            _reindex_document(connection, document_id=document_id)
            superseded_document_ids.add(document_id)

        analysis = _load_json(row["analysis_json"], {})
        analysis["reconciliation"] = {
            "status": "completed",
            "resolution": "superseded_by_complete_resume",
            "replacementDocumentId": resume_document_id,
            "completedAt": completed_at,
        }
        connection.execute(
            """
            UPDATE cross_document_reviews
            SET status = 'reconciled', analysis_json = ?, resolved_at = ?
            WHERE id = ?
            """,
            (_json(analysis), completed_at, prior_review_id),
        )
        connection.execute(
            """
            UPDATE review_queue
            SET status = 'resolved', resolved_at = ?
            WHERE status = 'pending'
              AND document_id = ?
              AND kind = 'cross_document_reconciliation'
            """,
            (completed_at, original_document_id),
        )
        closed_review_ids.append(prior_review_id)
    return {
        "reviewIds": closed_review_ids,
        "documentIds": sorted(superseded_document_ids),
    }


SCHEMA = """
CREATE TABLE IF NOT EXISTS sources (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    url TEXT NOT NULL UNIQUE,
    source_type TEXT NOT NULL DEFAULT 'auto',
    source_grade TEXT NOT NULL DEFAULT 'A',
    tags_json TEXT NOT NULL DEFAULT '[]',
    config_json TEXT NOT NULL DEFAULT '{}',
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_synced_at TEXT
);

CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    canonical_url TEXT NOT NULL,
    title TEXT NOT NULL,
    mime_type TEXT,
    published_at TEXT,
    content_hash TEXT NOT NULL,
    current_version_id TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (source_id, canonical_url)
);

CREATE TABLE IF NOT EXISTS versions (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    version_no INTEGER NOT NULL,
    content_hash TEXT NOT NULL,
    content_text TEXT NOT NULL,
    fetched_at TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    UNIQUE (document_id, version_no),
    UNIQUE (document_id, content_hash)
);

CREATE TABLE IF NOT EXISTS sync_runs (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    status TEXT NOT NULL DEFAULT 'running',
    documents_seen INTEGER NOT NULL DEFAULT 0,
    documents_changed INTEGER NOT NULL DEFAULT 0,
    error_count INTEGER NOT NULL DEFAULT 0,
    error_message TEXT
);

CREATE TABLE IF NOT EXISTS review_queue (
    id TEXT PRIMARY KEY,
    source_id TEXT REFERENCES sources(id) ON DELETE SET NULL,
    document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
    kind TEXT NOT NULL,
    message TEXT NOT NULL,
    payload_json TEXT NOT NULL DEFAULT '{}',
    dedupe_key TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS cross_document_reviews (
    id TEXT PRIMARY KEY,
    candidate_document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    relation_type TEXT NOT NULL,
    analysis_json TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'pending',
    resolved_target_document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS cross_document_review_targets (
    review_id TEXT NOT NULL REFERENCES cross_document_reviews(id) ON DELETE CASCADE,
    target_document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    score REAL NOT NULL DEFAULT 0,
    blocked INTEGER NOT NULL DEFAULT 0 CHECK (blocked IN (0, 1)),
    selected INTEGER NOT NULL DEFAULT 0 CHECK (selected IN (0, 1)),
    evidence_json TEXT NOT NULL DEFAULT '[]',
    PRIMARY KEY (review_id, target_document_id)
);

CREATE TABLE IF NOT EXISTS dify_documents (
    local_document_id TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
    remote_document_id TEXT,
    last_content_hash TEXT,
    last_batch_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ocr_artifacts (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    version_id TEXT NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
    image_url TEXT NOT NULL,
    image_hash TEXT NOT NULL,
    raw_text TEXT NOT NULL,
    normalized_text TEXT NOT NULL,
    raw_hash TEXT NOT NULL,
    normalized_hash TEXT NOT NULL,
    engine TEXT NOT NULL,
    engine_config_json TEXT NOT NULL DEFAULT '{}',
    quality_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    UNIQUE (version_id, image_url, raw_hash, engine)
);

CREATE INDEX IF NOT EXISTS idx_documents_source ON documents(source_id);
CREATE INDEX IF NOT EXISTS idx_versions_document ON versions(document_id, version_no DESC);
CREATE INDEX IF NOT EXISTS idx_sync_runs_source ON sync_runs(source_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_review_queue_status ON review_queue(status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cross_review_pending_candidate
    ON cross_document_reviews(candidate_document_id)
    WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_cross_review_status
    ON cross_document_reviews(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cross_review_target
    ON cross_document_review_targets(target_document_id, blocked);
CREATE INDEX IF NOT EXISTS idx_ocr_artifacts_document
    ON ocr_artifacts(document_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_dify_remote_document
    ON dify_documents(remote_document_id)
    WHERE remote_document_id IS NOT NULL;
"""


class KnowledgeDatabase:
    def __init__(self, path: Path | str):
        self.path = Path(path).expanduser().resolve()

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(self.path, timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 10000")
        try:
            yield connection
        finally:
            connection.close()

    def initialize(self) -> None:
        with self.connect() as connection:
            connection.execute("PRAGMA journal_mode = WAL")
            connection.execute("PRAGMA synchronous = NORMAL")
            connection.executescript(SCHEMA)
            try:
                connection.execute(
                    """
                    CREATE VIRTUAL TABLE IF NOT EXISTS document_fts USING fts5(
                        document_id UNINDEXED,
                        title,
                        content,
                        source_name UNINDEXED,
                        url UNINDEXED,
                        published_at UNINDEXED,
                        tags UNINDEXED,
                        tokenize='trigram'
                    )
                    """
                )
            except sqlite3.OperationalError as error:
                if "tokenizer" not in str(error).lower():
                    raise
                connection.execute(
                    """
                    CREATE VIRTUAL TABLE IF NOT EXISTS document_fts USING fts5(
                        document_id UNINDEXED,
                        title,
                        content,
                        source_name UNINDEXED,
                        url UNINDEXED,
                        published_at UNINDEXED,
                        tags UNINDEXED,
                        tokenize='unicode61 remove_diacritics 2'
                    )
                    """
                )
            dify_columns = {
                row[1]
                for row in connection.execute("PRAGMA table_info(dify_documents)")
            }
            if "last_batch_id" not in dify_columns:
                connection.execute(
                    "ALTER TABLE dify_documents ADD COLUMN last_batch_id TEXT"
                )
            review_columns = {
                row[1]
                for row in connection.execute("PRAGMA table_info(review_queue)")
            }
            if "dedupe_key" not in review_columns:
                connection.execute(
                    "ALTER TABLE review_queue ADD COLUMN dedupe_key TEXT"
                )
            seen_review_keys: set[str] = set()
            pending_reviews = connection.execute(
                """
                SELECT id, source_id, document_id, kind, message,
                       payload_json, dedupe_key
                FROM review_queue
                WHERE status = 'pending'
                ORDER BY created_at, id
                """
            ).fetchall()
            for review in pending_reviews:
                review_key = review["dedupe_key"] or _review_key(
                    source_id=review["source_id"],
                    document_id=review["document_id"],
                    kind=review["kind"],
                    message=review["message"],
                    payload=_load_json(review["payload_json"], {}),
                )
                if review_key in seen_review_keys:
                    continue
                seen_review_keys.add(review_key)
                if review["dedupe_key"] != review_key:
                    connection.execute(
                        "UPDATE review_queue SET dedupe_key = ? WHERE id = ?",
                        (review_key, review["id"]),
                    )
            connection.execute(
                """
                CREATE UNIQUE INDEX IF NOT EXISTS idx_review_pending_dedupe
                ON review_queue(dedupe_key)
                WHERE status = 'pending' AND dedupe_key IS NOT NULL
                """
            )
            connection.commit()

    def ping(self) -> bool:
        try:
            with self.connect() as connection:
                return connection.execute("SELECT 1").fetchone()[0] == 1
        except sqlite3.Error:
            return False

    def stats(self) -> dict[str, int]:
        tables = {
            "sources": "SELECT count(*) FROM sources WHERE enabled = 1",
            "documents": "SELECT count(*) FROM documents WHERE status = 'active'",
            "versions": "SELECT count(*) FROM versions",
            "syncRuns": "SELECT count(*) FROM sync_runs",
            "pendingReviews": "SELECT count(*) FROM review_queue WHERE status = 'pending'",
            "pendingCrossDocumentReviews": (
                "SELECT count(*) FROM cross_document_reviews "
                "WHERE status = 'pending'"
            ),
            "pendingCrossDocumentReconciliations": (
                "SELECT count(*) FROM cross_document_reviews "
                "WHERE status = 'approved_reconciliation'"
            ),
            "difyDocuments": "SELECT count(*) FROM dify_documents WHERE status = 'synced'",
            "difyQueued": "SELECT count(*) FROM dify_documents WHERE status = 'queued'",
            "difyErrors": "SELECT count(*) FROM dify_documents WHERE status = 'error'",
            "ocrArtifacts": "SELECT count(*) FROM ocr_artifacts",
        }
        with self.connect() as connection:
            result = {
                name: int(connection.execute(statement).fetchone()[0])
                for name, statement in tables.items()
            }
            result.update(_document_quality_counts(connection))
            return result

    def register_source(
        self,
        *,
        name: str,
        url: str,
        source_type: str = "auto",
        source_grade: str = "A",
        tags: Sequence[str] = (),
        follow_links: bool = False,
        max_documents: int = 1,
        enabled: bool = True,
        authority: str = "official",
        allowed_hosts: Sequence[str] = (),
        include_paths: Sequence[str] = (),
        exclude_paths: Sequence[str] = (),
    ) -> dict[str, Any]:
        source_id = str(uuid.uuid4())
        now = utc_now()
        config = {
            "follow_links": bool(follow_links),
            "max_documents": max(1, min(int(max_documents), 500)),
            "authority": authority.strip() or "official",
            "allowed_hosts": [host.casefold() for host in _clean_strings(allowed_hosts)],
            "include_paths": _clean_paths(include_paths),
            "exclude_paths": _clean_paths(exclude_paths),
        }
        cleaned_tags = _clean_strings(tags)
        with self.connect() as connection:
            connection.execute(
                """
                INSERT INTO sources (
                    id, name, url, source_type, source_grade, tags_json,
                    config_json, enabled, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(url) DO UPDATE SET
                    name = excluded.name,
                    source_type = excluded.source_type,
                    source_grade = excluded.source_grade,
                    tags_json = excluded.tags_json,
                    config_json = excluded.config_json,
                    enabled = excluded.enabled,
                    updated_at = excluded.updated_at
                """,
                (
                    source_id,
                    name.strip(),
                    url,
                    source_type,
                    source_grade,
                    _json(cleaned_tags),
                    _json(config),
                    int(enabled),
                    now,
                    now,
                ),
            )
            connection.commit()
            row = connection.execute(
                "SELECT * FROM sources WHERE url = ?", (url,)
            ).fetchone()
        return self._source_view(row)

    def set_source_enabled(self, source_ref: str, enabled: bool) -> dict[str, Any] | None:
        source = self.get_source(source_ref)
        if source is None:
            return None
        with self.connect() as connection:
            connection.execute(
                "UPDATE sources SET enabled = ?, updated_at = ? WHERE id = ?",
                (int(enabled), utc_now(), source["id"]),
            )
            connection.commit()
        return self.get_source(source["id"])

    def list_sources(self) -> list[dict[str, Any]]:
        with self.connect() as connection:
            rows = connection.execute(
                "SELECT * FROM sources ORDER BY created_at, name"
            ).fetchall()
        return [self._source_view(row) for row in rows]

    def get_source(self, source_ref: str) -> dict[str, Any] | None:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT * FROM sources WHERE id = ? OR name = ? OR url = ? LIMIT 1",
                (source_ref, source_ref, source_ref),
            ).fetchone()
        return self._source_view(row) if row else None

    @staticmethod
    def _source_view(row: sqlite3.Row) -> dict[str, Any]:
        config = _load_json(row["config_json"], {})
        return {
            "id": row["id"],
            "name": row["name"],
            "url": row["url"],
            "source_type": row["source_type"],
            "source_grade": row["source_grade"],
            "tags": _load_json(row["tags_json"], []),
            "enabled": bool(row["enabled"]),
            "follow_links": bool(config.get("follow_links", False)),
            "max_documents": int(config.get("max_documents", 1)),
            "authority": str(config.get("authority", "official")),
            "allowed_hosts": list(config.get("allowed_hosts", [])),
            "include_paths": list(config.get("include_paths", [])),
            "exclude_paths": list(config.get("exclude_paths", [])),
            "last_synced_at": row["last_synced_at"],
        }

    def coverage_report(self, stale_after_days: int = 14) -> dict[str, Any]:
        stale_after_days = max(1, min(int(stale_after_days), 365))
        stale_before = datetime.now(UTC) - timedelta(days=stale_after_days)
        with self.connect() as connection:
            rows = connection.execute(
                """
                SELECT
                    source.*,
                    COUNT(DISTINCT document.id) AS document_count,
                    COUNT(DISTINCT CASE
                        WHEN document.published_at IS NOT NULL
                             AND trim(document.published_at) != ''
                        THEN document.id
                    END) AS published_document_count,
                    (
                        SELECT run.status
                        FROM sync_runs AS run
                        WHERE run.source_id = source.id
                        ORDER BY run.started_at DESC
                        LIMIT 1
                    ) AS latest_sync_status,
                    (
                        SELECT COUNT(*)
                        FROM review_queue AS review
                        WHERE review.source_id = source.id
                          AND review.status = 'pending'
                    ) AS pending_review_count
                FROM sources AS source
                LEFT JOIN documents AS document
                  ON document.source_id = source.id
                 AND document.status = 'active'
                GROUP BY source.id
                ORDER BY source.created_at, source.name
                """
            ).fetchall()
            quality_counts = _document_quality_counts(connection)

        source_reports: list[dict[str, Any]] = []
        by_tag: dict[str, dict[str, int]] = {}
        for row in rows:
            last_synced_at = row["last_synced_at"]
            try:
                last_synced = datetime.fromisoformat(last_synced_at) if last_synced_at else None
                if last_synced and last_synced.tzinfo is None:
                    last_synced = last_synced.replace(tzinfo=UTC)
            except ValueError:
                last_synced = None
            enabled = bool(row["enabled"])
            is_stale = enabled and (last_synced is None or last_synced < stale_before)
            tags = _load_json(row["tags_json"], [])
            document_count = int(row["document_count"])
            report = {
                "id": row["id"],
                "name": row["name"],
                "authority": str(_load_json(row["config_json"], {}).get("authority", "official")),
                "sourceGrade": row["source_grade"],
                "enabled": enabled,
                "tags": tags,
                "documents": document_count,
                "documentsWithPublishedAt": int(row["published_document_count"]),
                "lastSyncedAt": last_synced_at,
                "latestSyncStatus": row["latest_sync_status"],
                "pendingReviews": int(row["pending_review_count"]),
                "stale": is_stale,
            }
            source_reports.append(report)
            for tag in tags:
                bucket = by_tag.setdefault(
                    str(tag),
                    {"registeredSources": 0, "enabledSources": 0, "documents": 0},
                )
                bucket["registeredSources"] += 1
                bucket["enabledSources"] += int(enabled)
                bucket["documents"] += document_count

        return {
            "generatedAt": utc_now(),
            "staleAfterDays": stale_after_days,
            "summary": {
                "registeredSources": len(source_reports),
                "enabledSources": sum(int(item["enabled"]) for item in source_reports),
                "sourcesWithDocuments": sum(int(item["documents"] > 0) for item in source_reports),
                "neverSyncedSources": sum(int(item["lastSyncedAt"] is None) for item in source_reports),
                "staleEnabledSources": sum(int(item["stale"]) for item in source_reports),
                "documents": sum(item["documents"] for item in source_reports),
                "documentsWithPublishedAt": sum(
                    item["documentsWithPublishedAt"] for item in source_reports
                ),
                "pendingReviews": sum(item["pendingReviews"] for item in source_reports),
                **quality_counts,
            },
            "byTag": [
                {"tag": tag, **counts}
                for tag, counts in sorted(by_tag.items(), key=lambda item: item[0])
            ],
            "sources": source_reports,
        }

    def begin_sync_run(self, source_id: str) -> str:
        run_id = str(uuid.uuid4())
        with self.connect() as connection:
            connection.execute(
                "INSERT INTO sync_runs (id, source_id, started_at) VALUES (?, ?, ?)",
                (run_id, source_id, utc_now()),
            )
            connection.commit()
        return run_id

    def finish_sync_run(
        self,
        run_id: str,
        *,
        status: str,
        documents_seen: int,
        documents_changed: int,
        error_count: int,
        error_message: str | None = None,
    ) -> None:
        with self.connect() as connection:
            source_row = connection.execute(
                "SELECT source_id FROM sync_runs WHERE id = ?", (run_id,)
            ).fetchone()
            connection.execute(
                """
                UPDATE sync_runs
                SET finished_at = ?, status = ?, documents_seen = ?,
                    documents_changed = ?, error_count = ?, error_message = ?
                WHERE id = ?
                """,
                (
                    utc_now(),
                    status,
                    documents_seen,
                    documents_changed,
                    error_count,
                    error_message,
                    run_id,
                ),
            )
            if source_row:
                connection.execute(
                    "UPDATE sources SET last_synced_at = ?, updated_at = ? WHERE id = ?",
                    (utc_now(), utc_now(), source_row["source_id"]),
                )
            connection.commit()

    def queue_review(
        self,
        *,
        source_id: str | None,
        kind: str,
        message: str,
        payload: Mapping[str, Any] | None = None,
        document_id: str | None = None,
    ) -> str:
        payload_data = dict(payload or {})
        dedupe_key = _review_key(
            source_id=source_id,
            document_id=document_id,
            kind=kind,
            message=message,
            payload=payload_data,
        )
        with self.connect() as connection:
            existing = connection.execute(
                """
                SELECT id FROM review_queue
                WHERE status = 'pending' AND dedupe_key = ?
                """,
                (dedupe_key,),
            ).fetchone()
            if existing is not None:
                return str(existing["id"])
            review_id = str(uuid.uuid4())
            connection.execute(
                """
                INSERT INTO review_queue (
                    id, source_id, document_id, kind, message, payload_json,
                    dedupe_key, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    review_id,
                    source_id,
                    document_id,
                    kind,
                    message[:2_000],
                    _json(payload_data),
                    dedupe_key,
                    utc_now(),
                ),
            )
            connection.commit()
        return review_id

    def get_document_snapshot(
        self,
        *,
        source_id: str,
        canonical_url: str,
    ) -> dict[str, Any] | None:
        with self.connect() as connection:
            row = connection.execute(
                """
                SELECT d.*, v.content_text AS current_content,
                       v.metadata_json AS current_version_metadata_json
                FROM documents AS d
                LEFT JOIN versions AS v ON v.id = d.current_version_id
                WHERE d.source_id = ? AND d.canonical_url = ?
                """,
                (source_id, canonical_url),
            ).fetchone()
        if row is None:
            return None
        return {
            "document_id": row["id"],
            "source_id": row["source_id"],
            "canonical_url": row["canonical_url"],
            "title": row["title"],
            "mime_type": row["mime_type"],
            "published_at": row["published_at"],
            "content_hash": row["content_hash"],
            "current_version_id": row["current_version_id"],
            "status": row["status"],
            "content": row["current_content"] or "",
            "metadata": _load_json(row["metadata_json"], {}),
            "version_metadata": _load_json(
                row["current_version_metadata_json"], {}
            ),
        }

    def find_cross_document_candidates(
        self,
        *,
        source_id: str,
        canonical_url: str,
        explicit_links: Sequence[str] = (),
        limit: int = 200,
    ) -> list[dict[str, Any]]:
        limit = max(1, min(int(limit), 500))
        candidate_host = (urlsplit(canonical_url).hostname or "").casefold()
        explicit_link_set = {
            str(value).strip()
            for value in explicit_links
            if str(value).strip()
        }
        with self.connect() as connection:
            candidate_source = connection.execute(
                """
                SELECT source_grade, config_json
                FROM sources
                WHERE id = ?
                """,
                (source_id,),
            ).fetchone()
            rows = list(
                connection.execute(
                    """
                    SELECT d.id AS document_id, d.source_id,
                           d.canonical_url AS url, d.title, d.published_at,
                           d.metadata_json, d.status, v.content_text AS content,
                           s.name AS source_name,
                           s.source_grade AS target_source_grade,
                           s.config_json AS target_source_config_json
                    FROM documents AS d
                    JOIN versions AS v ON v.id = d.current_version_id
                    JOIN sources AS s ON s.id = d.source_id
                    WHERE d.canonical_url != ?
                      AND d.status IN ('active', 'superseded')
                    ORDER BY d.updated_at DESC, d.id
                    LIMIT ?
                    """,
                    (canonical_url, limit),
                ).fetchall()
            )
            if explicit_link_set:
                placeholders = ",".join("?" for _ in explicit_link_set)
                linked_rows = connection.execute(
                    f"""
                    SELECT d.id AS document_id, d.source_id,
                           d.canonical_url AS url, d.title, d.published_at,
                           d.metadata_json, d.status, v.content_text AS content,
                           s.name AS source_name,
                           s.source_grade AS target_source_grade,
                           s.config_json AS target_source_config_json
                    FROM documents AS d
                    JOIN versions AS v ON v.id = d.current_version_id
                    JOIN sources AS s ON s.id = d.source_id
                    WHERE d.canonical_url != ?
                      AND d.status IN ('active', 'superseded')
                      AND d.canonical_url IN ({placeholders})
                    """,
                    (canonical_url, *sorted(explicit_link_set)),
                ).fetchall()
                known_ids = {str(row["document_id"]) for row in rows}
                rows.extend(
                    row
                    for row in linked_rows
                    if str(row["document_id"]) not in known_ids
                )

        candidate_source_config = _load_json(
            candidate_source["config_json"] if candidate_source else None,
            {},
        )
        candidate_is_official = bool(
            candidate_source
            and str(
                candidate_source_config.get("authority", "official")
            ).casefold()
            == "official"
            and str(candidate_source["source_grade"]).upper() in {"A", "B"}
        )
        results: list[dict[str, Any]] = []
        for row in rows:
            row_url = str(row["url"])
            row_host = (urlsplit(row_url).hostname or "").casefold()
            target_source_config = _load_json(
                row["target_source_config_json"],
                {},
            )
            target_is_official = bool(
                str(
                    target_source_config.get("authority", "official")
                ).casefold()
                == "official"
                and str(row["target_source_grade"]).upper() in {"A", "B"}
            )
            explicit_cross_source = bool(
                row_url in explicit_link_set
                and row["source_id"] != source_id
                and candidate_is_official
                and target_is_official
            )
            same_registered_source = row["source_id"] == source_id
            trusted_same_host_source = bool(
                candidate_host
                and row_host == candidate_host
                and candidate_is_official
                and target_is_official
            )
            if not (
                same_registered_source
                or trusted_same_host_source
                or explicit_cross_source
            ):
                continue
            results.append(
                {
                    "document_id": row["document_id"],
                    "source_id": row["source_id"],
                    "source_name": row["source_name"],
                    "source_grade": row["target_source_grade"],
                    "source_authority": str(
                        target_source_config.get("authority", "official")
                    ),
                    "candidate_source_id": source_id,
                    "cross_registered_source": (
                        row["source_id"] != source_id
                    ),
                    "title": row["title"],
                    "url": row_url,
                    "published_at": row["published_at"],
                    "content": row["content"],
                    "metadata": _load_json(row["metadata_json"], {}),
                    "status": row["status"],
                }
            )
        return results

    def create_cross_document_review(
        self,
        *,
        source: Mapping[str, Any],
        canonical_url: str,
        title: str,
        content: str,
        content_hash: str,
        mime_type: str | None,
        published_at: str | None,
        metadata: Mapping[str, Any] | None,
        analysis: Mapping[str, Any],
    ) -> dict[str, Any]:
        """Store a new-URL correction without exposing it before review."""
        now = utc_now()
        review_id = str(uuid.uuid4())
        relation_type = str(analysis.get("relationType") or "").strip()
        if not relation_type:
            raise ValueError("跨公告审核缺少关系类型")
        suggestions = [
            dict(item)
            for item in analysis.get("suggestedTargets", [])
            if isinstance(item, Mapping)
        ][:20]
        with self.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            existing = connection.execute(
                """
                SELECT id FROM documents
                WHERE source_id = ? AND canonical_url = ?
                """,
                (source["id"], canonical_url),
            ).fetchone()
            if existing is not None:
                connection.rollback()
                raise ValueError("跨公告审核只适用于首次出现的新 URL")

            document_id = str(uuid.uuid4())
            version_id = str(uuid.uuid4())
            metadata_data = {
                **dict(metadata or {}),
                "crossDocumentReviewId": review_id,
                "crossDocumentRelationType": relation_type,
                "crossDocumentChangeScope": str(
                    analysis.get("changeScope") or "unknown"
                ),
                "crossDocumentResolutionMode": str(
                    analysis.get("resolutionMode") or "reconcile"
                ),
            }
            if relation_type == "resumed":
                metadata_data["resumeCompleteness"] = str(
                    analysis.get("resumeCompleteness") or "status_only"
                )
            connection.execute(
                """
                INSERT INTO documents (
                    id, source_id, canonical_url, title, mime_type, published_at,
                    content_hash, current_version_id, status, metadata_json,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'review_pending', ?, ?, ?)
                """,
                (
                    document_id,
                    source["id"],
                    canonical_url,
                    title,
                    mime_type,
                    published_at,
                    content_hash,
                    version_id,
                    _json(metadata_data),
                    now,
                    now,
                ),
            )
            connection.execute(
                """
                INSERT INTO versions (
                    id, document_id, version_no, content_hash, content_text,
                    fetched_at, metadata_json
                ) VALUES (?, ?, 1, ?, ?, ?, ?)
                """,
                (
                    version_id,
                    document_id,
                    content_hash,
                    content,
                    now,
                    _json(metadata_data),
                ),
            )
            connection.execute(
                """
                INSERT INTO cross_document_reviews (
                    id, candidate_document_id, relation_type, analysis_json,
                    status, created_at
                ) VALUES (?, ?, ?, ?, 'pending', ?)
                """,
                (
                    review_id,
                    document_id,
                    relation_type,
                    _json(dict(analysis)),
                    now,
                ),
            )

            target_ids = [
                str(item.get("documentId") or "")
                for item in suggestions
                if str(item.get("documentId") or "")
            ]
            valid_target_ids: set[str] = set()
            if target_ids:
                placeholders = ",".join("?" for _ in target_ids)
                valid_target_ids = {
                    str(row["id"])
                    for row in connection.execute(
                        f"SELECT id FROM documents WHERE id IN ({placeholders})",
                        target_ids,
                    ).fetchall()
                }
            for item in suggestions:
                target_id = str(item.get("documentId") or "")
                if target_id not in valid_target_ids:
                    continue
                connection.execute(
                    """
                    INSERT INTO cross_document_review_targets (
                        review_id, target_document_id, score, blocked,
                        evidence_json
                    ) VALUES (?, ?, ?, ?, ?)
                    """,
                    (
                        review_id,
                        target_id,
                        float(item.get("score") or 0),
                        int(bool(item.get("blocked"))),
                        _json(list(item.get("evidence") or [])),
                    ),
                )
            connection.commit()
        return {
            "document_id": document_id,
            "version_id": version_id,
            "version_no": 1,
            "changed": True,
            "content_hash": content_hash,
            "status": "review_pending",
            "held_for_cross_review": True,
            "cross_review_id": review_id,
        }

    def list_cross_document_reviews(
        self,
        *,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        limit = max(1, min(int(limit), 500))
        with self.connect() as connection:
            reviews = connection.execute(
                """
                SELECT r.*, d.title AS candidate_title,
                       d.canonical_url AS candidate_url,
                       d.status AS candidate_status,
                       s.id AS source_id, s.name AS source_name,
                       resolved.title AS resolved_target_title,
                       resolved.canonical_url AS resolved_target_url
                FROM cross_document_reviews AS r
                JOIN documents AS d ON d.id = r.candidate_document_id
                JOIN sources AS s ON s.id = d.source_id
                LEFT JOIN documents AS resolved
                  ON resolved.id = r.resolved_target_document_id
                WHERE r.status = 'pending'
                ORDER BY r.created_at, r.id
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
            results: list[dict[str, Any]] = []
            for review in reviews:
                targets = connection.execute(
                    """
                    SELECT t.*, d.title, d.canonical_url, d.status
                    FROM cross_document_review_targets AS t
                    JOIN documents AS d ON d.id = t.target_document_id
                    WHERE t.review_id = ?
                    ORDER BY t.blocked DESC, t.score DESC, t.target_document_id
                    """,
                    (review["id"],),
                ).fetchall()
                results.append(
                    {
                        "reviewId": review["id"],
                        "status": review["status"],
                        "relationType": review["relation_type"],
                        "candidateDocumentId": review["candidate_document_id"],
                        "candidateTitle": review["candidate_title"],
                        "candidateUrl": review["candidate_url"],
                        "candidateStatus": review["candidate_status"],
                        "sourceId": review["source_id"],
                        "sourceName": review["source_name"],
                        "analysis": _load_json(review["analysis_json"], {}),
                        "targets": [
                            {
                                "documentId": target["target_document_id"],
                                "title": target["title"],
                                "url": target["canonical_url"],
                                "status": target["status"],
                                "score": float(target["score"]),
                                "blocked": bool(target["blocked"]),
                                "selected": bool(target["selected"]),
                                "evidence": _load_json(
                                    target["evidence_json"], []
                                ),
                            }
                            for target in targets
                        ],
                        "createdAt": review["created_at"],
                    }
                )
        return results

    def resolve_cross_document_review(
        self,
        *,
        review_id: str,
        decision: str,
        target_document_id: str | None = None,
    ) -> dict[str, Any] | None:
        if decision not in {"approve", "reject"}:
            raise ValueError("跨公告审核只接受 approve 或 reject")
        now = utc_now()
        with self.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            review = connection.execute(
                """
                SELECT r.*, d.source_id, d.canonical_url, d.title,
                       d.mime_type, d.published_at, d.content_hash,
                       d.current_version_id, d.metadata_json,
                       s.name AS source_name, s.tags_json,
                       v.content_text
                FROM cross_document_reviews AS r
                JOIN documents AS d ON d.id = r.candidate_document_id
                JOIN sources AS s ON s.id = d.source_id
                JOIN versions AS v ON v.id = d.current_version_id
                WHERE r.id = ?
                """,
                (review_id,),
            ).fetchone()
            if review is None or review["status"] != "pending":
                connection.rollback()
                return None

            analysis = _load_json(review["analysis_json"], {})
            change_scope = str(analysis.get("changeScope") or "unknown")
            resume_completeness = str(
                analysis.get("resumeCompleteness") or ""
            )
            requested_resolution_mode = str(
                analysis.get("resolutionMode") or "reconcile"
            )
            resolution_mode = (
                "supersede"
                if (
                    (
                        review["relation_type"] == "withdrawn"
                        and change_scope == "whole"
                    )
                    or (
                        review["relation_type"] == "resumed"
                        and resume_completeness == "complete"
                    )
                )
                and requested_resolution_mode == "supersede"
                else "reconcile"
            )
            selected_target: sqlite3.Row | None = None
            requested_target_id = str(target_document_id or "").strip()
            if decision == "approve":
                if not requested_target_id:
                    blocked_targets = connection.execute(
                        """
                        SELECT d.*
                        FROM cross_document_review_targets AS t
                        JOIN documents AS d ON d.id = t.target_document_id
                        WHERE t.review_id = ? AND t.blocked = 1
                        ORDER BY t.score DESC, t.target_document_id
                        """,
                        (review_id,),
                    ).fetchall()
                    if len(blocked_targets) != 1:
                        connection.rollback()
                        raise ValueError(
                            "无法唯一确定被替代公告，请显式提供 target_document_id"
                        )
                    selected_target = blocked_targets[0]
                    requested_target_id = str(selected_target["id"])
                else:
                    selected_target = connection.execute(
                        "SELECT * FROM documents WHERE id = ?",
                        (requested_target_id,),
                    ).fetchone()
                    if selected_target is None:
                        connection.rollback()
                        raise ValueError("指定的被替代公告不存在")
                    if selected_target["id"] == review["candidate_document_id"]:
                        connection.rollback()
                        raise ValueError("候选公告不能替代自身")
                    registered_relation = connection.execute(
                        """
                        SELECT 1
                        FROM cross_document_review_targets
                        WHERE review_id = ? AND target_document_id = ?
                        """,
                        (review_id, requested_target_id),
                    ).fetchone()
                    candidate_host = (
                        urlsplit(str(review["canonical_url"])).hostname or ""
                    ).casefold()
                    target_host = (
                        urlsplit(str(selected_target["canonical_url"])).hostname
                        or ""
                    ).casefold()
                    if (
                        selected_target["source_id"] != review["source_id"]
                        and candidate_host != target_host
                        and registered_relation is None
                    ):
                        connection.rollback()
                        raise ValueError(
                            "指定公告不属于已核验关系、同一来源或官方域名"
                        )
                    connection.execute(
                        """
                        INSERT OR IGNORE INTO cross_document_review_targets (
                            review_id, target_document_id, score, blocked,
                            evidence_json
                        ) VALUES (?, ?, 0, 1, ?)
                        """,
                        (
                            review_id,
                            requested_target_id,
                            _json(["manual_target"]),
                        ),
                    )

            candidate_metadata = _load_json(review["metadata_json"], {})
            candidate_metadata.pop("crossDocumentReviewId", None)
            candidate_metadata["crossDocumentReviewDecision"] = decision
            candidate_metadata["crossDocumentReviewResolvedAt"] = now
            candidate_metadata["crossDocumentChangeScope"] = change_scope
            candidate_metadata["crossDocumentResolutionMode"] = resolution_mode
            if review["relation_type"] == "resumed":
                candidate_metadata["resumeCompleteness"] = (
                    resume_completeness or "status_only"
                )
            requires_reconciliation = False
            closed_pause_chain: dict[str, list[str]] = {
                "reviewIds": [],
                "documentIds": [],
            }
            if decision == "approve" and selected_target is not None:
                target_metadata = _load_json(
                    selected_target["metadata_json"], {}
                )
                candidate_metadata["crossDocumentRelationType"] = review[
                    "relation_type"
                ]
                if resolution_mode == "supersede":
                    target_metadata["supersededByDocumentId"] = review[
                        "candidate_document_id"
                    ]
                    target_metadata["supersededAt"] = now
                    target_metadata["crossDocumentReviewId"] = review_id
                    candidate_metadata["supersedesDocumentId"] = (
                        requested_target_id
                    )
                    connection.execute(
                        """
                        UPDATE documents
                        SET status = 'superseded', metadata_json = ?,
                            updated_at = ?
                        WHERE id = ?
                        """,
                        (
                            _json(target_metadata),
                            now,
                            requested_target_id,
                        ),
                    )
                else:
                    requires_reconciliation = True
                    reconciliation = {
                        "status": "pending",
                        "reviewId": review_id,
                        "changeDocumentId": review[
                            "candidate_document_id"
                        ],
                        "relationType": review["relation_type"],
                        "changeScope": change_scope,
                        "heldAt": now,
                        "originalContentHash": selected_target["content_hash"],
                    }
                    target_metadata["crossDocumentReconciliation"] = (
                        reconciliation
                    )
                    candidate_metadata["modifiesDocumentId"] = (
                        requested_target_id
                    )
                    connection.execute(
                        """
                        UPDATE documents
                        SET status = 'review_pending', metadata_json = ?,
                            updated_at = ?
                        WHERE id = ?
                        """,
                        (
                            _json(target_metadata),
                            now,
                            requested_target_id,
                        ),
                    )
                _reindex_document(
                    connection,
                    document_id=requested_target_id,
                )
                if (
                    review["relation_type"] == "resumed"
                    and resolution_mode == "supersede"
                ):
                    closed_pause_chain = _close_paused_reconciliation_chain(
                        connection,
                        selected_target_document_id=requested_target_id,
                        resume_document_id=review["candidate_document_id"],
                        resume_review_id=review_id,
                        completed_at=now,
                    )
                    if closed_pause_chain["reviewIds"]:
                        candidate_metadata[
                            "closedPauseReconciliationReviewIds"
                        ] = closed_pause_chain["reviewIds"]
                    superseded_ids = sorted(
                        {
                            requested_target_id,
                            *closed_pause_chain["documentIds"],
                        }
                    )
                    candidate_metadata["supersedesDocumentIds"] = (
                        superseded_ids
                    )

            connection.execute(
                """
                UPDATE documents
                SET status = 'active', metadata_json = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    _json(candidate_metadata),
                    now,
                    review["candidate_document_id"],
                ),
            )
            _reindex_document(
                connection,
                document_id=review["candidate_document_id"],
            )
            connection.execute(
                """
                UPDATE cross_document_reviews
                SET status = ?, resolved_target_document_id = ?,
                    resolved_at = ?
                WHERE id = ?
                """,
                (
                    (
                        "approved_reconciliation"
                        if requires_reconciliation
                        else (
                            "approved"
                            if decision == "approve"
                            else "rejected"
                        )
                    ),
                    requested_target_id or None,
                    now,
                    review_id,
                ),
            )
            connection.execute(
                """
                UPDATE cross_document_review_targets
                SET selected = CASE WHEN target_document_id = ? THEN 1 ELSE 0 END
                WHERE review_id = ?
                """,
                (requested_target_id, review_id),
            )
            connection.execute(
                """
                UPDATE review_queue
                SET status = 'resolved', resolved_at = ?
                WHERE status = 'pending'
                  AND document_id = ?
                  AND kind = 'cross_document_change'
                """,
                (now, review["candidate_document_id"]),
            )
            if requires_reconciliation:
                _queue_review_in_transaction(
                    connection,
                    source_id=selected_target["source_id"],
                    document_id=requested_target_id,
                    kind="cross_document_reconciliation",
                    message="跨公告变更已批准，原公告完整有效范围待对账",
                    payload={
                        "crossReviewId": review_id,
                        "changeDocumentId": review[
                            "candidate_document_id"
                        ],
                        "targetDocumentId": requested_target_id,
                        "relationType": review["relation_type"],
                        "changeScope": change_scope,
                    },
                    created_at=now,
                )
            connection.commit()
        return {
            "status": "resolved",
            "decision": decision,
            "reviewId": review_id,
            "candidateDocumentId": review["candidate_document_id"],
            "targetDocumentId": requested_target_id or None,
            "changeScope": change_scope,
            "resumeCompleteness": resume_completeness or None,
            "resolutionMode": resolution_mode,
            "requiresReconciliation": requires_reconciliation,
            "closedPauseReconciliationReviewIds": closed_pause_chain[
                "reviewIds"
            ],
            "requiresDifySync": True,
        }

    def list_cross_document_reconciliations(
        self,
        *,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        limit = max(1, min(int(limit), 500))
        with self.connect() as connection:
            rows = connection.execute(
                """
                SELECT r.*, candidate.title AS candidate_title,
                       candidate.canonical_url AS candidate_url,
                       target.id AS target_document_id,
                       target.title AS target_title,
                       target.canonical_url AS target_url,
                       target.content_hash AS target_content_hash,
                       target.status AS target_status,
                       target.metadata_json AS target_metadata_json
                FROM cross_document_reviews AS r
                JOIN documents AS candidate
                  ON candidate.id = r.candidate_document_id
                JOIN documents AS target
                  ON target.id = r.resolved_target_document_id
                WHERE r.status = 'approved_reconciliation'
                ORDER BY r.resolved_at, r.id
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
        results: list[dict[str, Any]] = []
        for row in rows:
            analysis = _load_json(row["analysis_json"], {})
            target_metadata = _load_json(row["target_metadata_json"], {})
            reconciliation = dict(
                target_metadata.get("crossDocumentReconciliation") or {}
            )
            results.append(
                {
                    "reviewId": row["id"],
                    "status": row["status"],
                    "relationType": row["relation_type"],
                    "changeScope": str(
                        analysis.get("changeScope") or "unknown"
                    ),
                    "candidateDocumentId": row["candidate_document_id"],
                    "candidateTitle": row["candidate_title"],
                    "candidateUrl": row["candidate_url"],
                    "targetDocumentId": row["target_document_id"],
                    "targetTitle": row["target_title"],
                    "targetUrl": row["target_url"],
                    "targetStatus": row["target_status"],
                    "targetContentHash": row["target_content_hash"],
                    "originalContentHash": reconciliation.get(
                        "originalContentHash"
                    ),
                    "heldAt": reconciliation.get("heldAt"),
                }
            )
        return results

    def resolve_cross_document_reconciliation(
        self,
        *,
        review_id: str,
        replacement_document_id: str,
    ) -> dict[str, Any] | None:
        replacement_document_id = str(replacement_document_id).strip()
        if not replacement_document_id:
            raise ValueError("完成对账必须提供 replacement_document_id")
        now = utc_now()
        with self.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            review = connection.execute(
                """
                SELECT r.*, candidate.metadata_json AS candidate_metadata_json,
                       target.id AS target_document_id,
                       target.source_id AS target_source_id,
                       target.canonical_url AS target_url,
                       target.content_hash AS target_content_hash,
                       target.metadata_json AS target_metadata_json
                FROM cross_document_reviews AS r
                JOIN documents AS candidate
                  ON candidate.id = r.candidate_document_id
                JOIN documents AS target
                  ON target.id = r.resolved_target_document_id
                WHERE r.id = ?
                """,
                (review_id,),
            ).fetchone()
            if review is None or review["status"] != "approved_reconciliation":
                connection.rollback()
                return None

            replacement = connection.execute(
                "SELECT * FROM documents WHERE id = ?",
                (replacement_document_id,),
            ).fetchone()
            if replacement is None:
                connection.rollback()
                raise ValueError("指定的对账后有效公告不存在")
            if replacement["id"] == review["candidate_document_id"]:
                connection.rollback()
                raise ValueError("变更通知不能代替完整原公告")

            target_metadata = _load_json(
                review["target_metadata_json"], {}
            )
            reconciliation = dict(
                target_metadata.get("crossDocumentReconciliation") or {}
            )
            if reconciliation.get("reviewId") != review_id:
                connection.rollback()
                raise ValueError("原公告缺少与本次审核匹配的待对账状态")

            target_document_id = str(review["target_document_id"])
            resolution: str
            if replacement_document_id == target_document_id:
                original_hash = str(
                    reconciliation.get("originalContentHash") or ""
                )
                if (
                    original_hash
                    and str(review["target_content_hash"]) == original_hash
                ):
                    connection.rollback()
                    raise ValueError(
                        "原公告内容尚未更新，不能解除待对账状态"
                    )
                target_metadata.pop("crossDocumentReconciliation", None)
                target_metadata["crossDocumentReconciledAt"] = now
                connection.execute(
                    """
                    UPDATE documents
                    SET status = 'active', metadata_json = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (_json(target_metadata), now, target_document_id),
                )
                _reindex_document(
                    connection,
                    document_id=target_document_id,
                )
                resolution = "reactivated_updated_target"
            else:
                if replacement["status"] != "active":
                    connection.rollback()
                    raise ValueError("对账后的替代公告必须已处于 active 状态")
                target_host = (
                    urlsplit(str(review["target_url"])).hostname or ""
                ).casefold()
                replacement_host = (
                    urlsplit(str(replacement["canonical_url"])).hostname or ""
                ).casefold()
                trusted_sources = False
                if replacement["source_id"] != review["target_source_id"]:
                    source_rows = connection.execute(
                        """
                        SELECT id, source_grade, config_json
                        FROM sources
                        WHERE id IN (?, ?)
                        """,
                        (
                            review["target_source_id"],
                            replacement["source_id"],
                        ),
                    ).fetchall()
                    trusted_sources = len(source_rows) == 2 and all(
                        str(row["source_grade"]).upper() in {"A", "B"}
                        and str(
                            _load_json(row["config_json"], {}).get(
                                "authority", "official"
                            )
                        ).casefold()
                        == "official"
                        for row in source_rows
                    )
                if not (
                    replacement["source_id"] == review["target_source_id"]
                    or (
                        target_host
                        and replacement_host
                        and target_host == replacement_host
                    )
                    or trusted_sources
                ):
                    connection.rollback()
                    raise ValueError(
                        "替代公告不属于同一来源、官方域名或可信官方来源"
                    )

                target_metadata.pop("crossDocumentReconciliation", None)
                target_metadata["supersededByDocumentId"] = (
                    replacement_document_id
                )
                target_metadata["supersededAt"] = now
                replacement_metadata = _load_json(
                    replacement["metadata_json"], {}
                )
                replacement_metadata["reconcilesDocumentId"] = (
                    target_document_id
                )
                replacement_metadata["crossDocumentReconciledAt"] = now
                connection.execute(
                    """
                    UPDATE documents
                    SET status = 'superseded', metadata_json = ?,
                        updated_at = ?
                    WHERE id = ?
                    """,
                    (_json(target_metadata), now, target_document_id),
                )
                connection.execute(
                    """
                    UPDATE documents
                    SET metadata_json = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (
                        _json(replacement_metadata),
                        now,
                        replacement_document_id,
                    ),
                )
                _reindex_document(
                    connection,
                    document_id=target_document_id,
                )
                _reindex_document(
                    connection,
                    document_id=replacement_document_id,
                )
                resolution = "superseded_by_replacement"

            candidate_metadata = _load_json(
                review["candidate_metadata_json"], {}
            )
            candidate_metadata["crossDocumentReconciledAt"] = now
            candidate_metadata["reconciledByDocumentId"] = (
                replacement_document_id
            )
            connection.execute(
                """
                UPDATE documents
                SET metadata_json = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    _json(candidate_metadata),
                    now,
                    review["candidate_document_id"],
                ),
            )
            analysis = _load_json(review["analysis_json"], {})
            analysis["reconciliation"] = {
                "status": "completed",
                "resolution": resolution,
                "replacementDocumentId": replacement_document_id,
                "completedAt": now,
            }
            connection.execute(
                """
                UPDATE cross_document_reviews
                SET status = 'reconciled', analysis_json = ?, resolved_at = ?
                WHERE id = ?
                """,
                (_json(analysis), now, review_id),
            )
            connection.execute(
                """
                UPDATE review_queue
                SET status = 'resolved', resolved_at = ?
                WHERE status = 'pending'
                  AND document_id = ?
                  AND kind = 'cross_document_reconciliation'
                """,
                (now, target_document_id),
            )
            connection.commit()
        return {
            "status": "reconciled",
            "reviewId": review_id,
            "candidateDocumentId": review["candidate_document_id"],
            "targetDocumentId": target_document_id,
            "replacementDocumentId": replacement_document_id,
            "resolution": resolution,
            "requiresDifySync": True,
        }

    def stage_document_version(
        self,
        *,
        source: Mapping[str, Any],
        canonical_url: str,
        title: str,
        content: str,
        content_hash: str,
        mime_type: str | None,
        published_at: str | None,
        metadata: Mapping[str, Any] | None,
        analysis: Mapping[str, Any],
    ) -> dict[str, Any]:
        """Store a candidate version without promoting it into retrieval."""
        now = utc_now()
        with self.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            document = connection.execute(
                """
                SELECT * FROM documents
                WHERE source_id = ? AND canonical_url = ?
                """,
                (source["id"], canonical_url),
            ).fetchone()
            if document is None:
                connection.rollback()
                raise ValueError("首个文档版本不能进入变更隔离")

            document_id = str(document["id"])
            current_metadata = _load_json(document["metadata_json"], {})
            pending = current_metadata.get("factReview")
            pending_hash = (
                str(pending.get("candidateContentHash") or "")
                if isinstance(pending, dict)
                else ""
            )
            version_metadata = {
                **dict(metadata or {}),
                "_candidateDocument": {
                    "title": title,
                    "mimeType": mime_type,
                    "publishedAt": published_at,
                },
            }
            version = connection.execute(
                """
                SELECT id, version_no
                FROM versions
                WHERE document_id = ? AND content_hash = ?
                """,
                (document_id, content_hash),
            ).fetchone()
            if version is None:
                next_version = int(
                    connection.execute(
                        """
                        SELECT coalesce(max(version_no), 0) + 1
                        FROM versions
                        WHERE document_id = ?
                        """,
                        (document_id,),
                    ).fetchone()[0]
                )
                version_id = str(uuid.uuid4())
                connection.execute(
                    """
                    INSERT INTO versions (
                        id, document_id, version_no, content_hash, content_text,
                        fetched_at, metadata_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        version_id,
                        document_id,
                        next_version,
                        content_hash,
                        content,
                        now,
                        _json(version_metadata),
                    ),
                )
            else:
                version_id = str(version["id"])
                next_version = int(version["version_no"])

            current_metadata["factReview"] = {
                "status": "pending",
                "candidateVersionId": version_id,
                "candidateContentHash": content_hash,
                "candidateVersionNo": next_version,
                "stagedAt": now,
                "analysis": dict(analysis),
            }
            connection.execute(
                """
                UPDATE documents
                SET metadata_json = ?, updated_at = ?
                WHERE id = ?
                """,
                (_json(current_metadata), now, document_id),
            )
            connection.commit()
        return {
            "document_id": document_id,
            "version_id": version_id,
            "version_no": next_version,
            "changed": pending_hash != content_hash,
            "content_hash": str(document["content_hash"]),
            "candidate_content_hash": content_hash,
            "status": str(document["status"]),
            "held_for_review": True,
        }

    def list_fact_reviews(self, *, limit: int = 100) -> list[dict[str, Any]]:
        limit = max(1, min(int(limit), 500))
        with self.connect() as connection:
            rows = connection.execute(
                """
                SELECT d.id, d.canonical_url, d.title, d.content_hash,
                       d.metadata_json, s.id AS source_id, s.name AS source_name
                FROM documents AS d
                JOIN sources AS s ON s.id = d.source_id
                WHERE json_extract(
                    d.metadata_json, '$.factReview.status'
                ) = 'pending'
                ORDER BY d.updated_at, d.id
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
        results: list[dict[str, Any]] = []
        for row in rows:
            metadata = _load_json(row["metadata_json"], {})
            review = metadata.get("factReview", {})
            results.append(
                {
                    "documentId": row["id"],
                    "sourceId": row["source_id"],
                    "sourceName": row["source_name"],
                    "title": row["title"],
                    "url": row["canonical_url"],
                    "currentContentHash": row["content_hash"],
                    **dict(review),
                }
            )
        return results

    def resolve_fact_review(
        self,
        *,
        document_id: str,
        decision: str,
    ) -> dict[str, Any] | None:
        if decision not in {"approve", "reject"}:
            raise ValueError("事实变更审核只接受 approve 或 reject")
        now = utc_now()
        with self.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                """
                SELECT d.*, s.name AS source_name, s.tags_json
                FROM documents AS d
                JOIN sources AS s ON s.id = d.source_id
                WHERE d.id = ?
                """,
                (document_id,),
            ).fetchone()
            if row is None:
                connection.rollback()
                return None
            metadata = _load_json(row["metadata_json"], {})
            review = metadata.get("factReview")
            if not isinstance(review, dict) or review.get("status") != "pending":
                connection.rollback()
                return None
            candidate_version_id = str(review.get("candidateVersionId") or "")
            candidate = connection.execute(
                "SELECT * FROM versions WHERE id = ? AND document_id = ?",
                (candidate_version_id, document_id),
            ).fetchone()
            if candidate is None:
                connection.rollback()
                raise ValueError("待审核候选版本不存在")

            metadata.pop("factReview", None)
            if decision == "approve":
                candidate_metadata = _load_json(candidate["metadata_json"], {})
                candidate_document = candidate_metadata.pop(
                    "_candidateDocument", {}
                )
                if candidate_metadata.get("ocrNeedsReview"):
                    candidate_metadata["ocrNeedsReview"] = False
                    candidate_metadata["ocrStatus"] = "human_approved"
                    candidate_metadata["ocrReviewApprovedAt"] = now
                rejected_hashes = metadata.get("rejectedContentHashes")
                if rejected_hashes:
                    candidate_metadata["rejectedContentHashes"] = rejected_hashes
                title = str(candidate_document.get("title") or row["title"])
                mime_type = candidate_document.get("mimeType")
                published_at = candidate_document.get("publishedAt")
                connection.execute(
                    """
                    UPDATE documents
                    SET title = ?, mime_type = ?, published_at = ?,
                        content_hash = ?, current_version_id = ?,
                        metadata_json = ?, status = 'active', updated_at = ?
                    WHERE id = ?
                    """,
                    (
                        title,
                        mime_type,
                        published_at,
                        candidate["content_hash"],
                        candidate["id"],
                        _json(candidate_metadata),
                        now,
                        document_id,
                    ),
                )
                _reindex_document(connection, document_id=document_id)
                effective_hash = str(candidate["content_hash"])
            else:
                rejected = [
                    str(value)
                    for value in metadata.get("rejectedContentHashes", [])
                    if str(value)
                ]
                candidate_hash = str(candidate["content_hash"])
                if candidate_hash not in rejected:
                    rejected.append(candidate_hash)
                metadata["rejectedContentHashes"] = rejected[-10:]
                connection.execute(
                    """
                    UPDATE documents
                    SET metadata_json = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (_json(metadata), now, document_id),
                )
                effective_hash = str(row["content_hash"])

            connection.execute(
                """
                UPDATE review_queue
                SET status = 'resolved', resolved_at = ?
                WHERE status = 'pending'
                  AND document_id = ?
                  AND kind = 'fact_change'
                """,
                (now, document_id),
            )
            connection.commit()
        return {
            "status": "resolved",
            "decision": decision,
            "documentId": document_id,
            "contentHash": effective_hash,
            "requiresDifySync": decision == "approve",
        }

    def upsert_document(
        self,
        *,
        source: Mapping[str, Any],
        canonical_url: str,
        title: str,
        content: str,
        content_hash: str,
        mime_type: str | None,
        published_at: str | None,
        metadata: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        now = utc_now()
        with self.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            document = connection.execute(
                """
                SELECT * FROM documents
                WHERE source_id = ? AND canonical_url = ?
                """,
                (source["id"], canonical_url),
            ).fetchone()

            changed = document is None or document["content_hash"] != content_hash
            metadata_data = dict(metadata or {})
            document_status = "active"
            if document is not None:
                current_metadata = _load_json(document["metadata_json"], {})
                for key in (
                    "rejectedContentHashes",
                    "crossDocumentReviewId",
                    "crossDocumentRelationType",
                    "crossDocumentReviewDecision",
                    "crossDocumentReviewResolvedAt",
                    "crossDocumentChangeScope",
                    "crossDocumentResolutionMode",
                    "supersededByDocumentId",
                    "supersededAt",
                    "supersedesDocumentId",
                    "modifiesDocumentId",
                    "crossDocumentReconciliation",
                    "crossDocumentReconciledAt",
                    "reconciledByDocumentId",
                    "reconcilesDocumentId",
                ):
                    if key in current_metadata:
                        metadata_data[key] = current_metadata[key]
                if document["status"] in {"review_pending", "superseded"}:
                    document_status = str(document["status"])
            if document is None:
                document_id = str(uuid.uuid4())
                connection.execute(
                    """
                    INSERT INTO documents (
                        id, source_id, canonical_url, title, mime_type, published_at,
                        content_hash, status, metadata_json, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
                    """,
                    (
                        document_id,
                        source["id"],
                        canonical_url,
                        title,
                        mime_type,
                        published_at,
                        content_hash,
                        _json(metadata_data),
                        now,
                        now,
                    ),
                )
            else:
                document_id = document["id"]
                connection.execute(
                    """
                    UPDATE documents
                    SET title = ?, mime_type = ?, published_at = ?, content_hash = ?,
                        status = ?, metadata_json = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (
                        title,
                        mime_type,
                        published_at,
                        content_hash,
                        document_status,
                        _json(metadata_data),
                        now,
                        document_id,
                    ),
                )

            version = connection.execute(
                "SELECT id, version_no FROM versions WHERE document_id = ? AND content_hash = ?",
                (document_id, content_hash),
            ).fetchone()
            if version is None:
                next_version = int(
                    connection.execute(
                        "SELECT coalesce(max(version_no), 0) + 1 FROM versions WHERE document_id = ?",
                        (document_id,),
                    ).fetchone()[0]
                )
                version_id = str(uuid.uuid4())
                connection.execute(
                    """
                    INSERT INTO versions (
                        id, document_id, version_no, content_hash, content_text,
                        fetched_at, metadata_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        version_id,
                        document_id,
                        next_version,
                        content_hash,
                        content,
                        now,
                        _json(metadata_data),
                    ),
                )
            else:
                version_id = version["id"]
                next_version = int(version["version_no"])

            connection.execute(
                "UPDATE documents SET current_version_id = ? WHERE id = ?",
                (version_id, document_id),
            )
            _reindex_document(connection, document_id=document_id)
            connection.commit()
        return {
            "document_id": document_id,
            "version_id": version_id,
            "version_no": next_version,
            "changed": changed,
            "content_hash": content_hash,
            "status": document_status,
        }

    def record_ocr_artifacts(
        self,
        *,
        document_id: str,
        version_id: str,
        artifacts: Sequence[Mapping[str, Any]],
    ) -> int:
        inserted = 0
        now = utc_now()
        with self.connect() as connection:
            for artifact in artifacts:
                raw_text = str(artifact.get("raw_text") or "")
                normalized_text = str(artifact.get("normalized_text") or "")
                image_url = str(artifact.get("image_url") or "")
                image_hash = str(artifact.get("image_hash") or "")
                engine = str(artifact.get("engine") or "")
                if not all(
                    (raw_text, normalized_text, image_url, image_hash, engine)
                ):
                    raise ValueError("OCR 审计记录缺少必要字段")
                cursor = connection.execute(
                    """
                    INSERT OR IGNORE INTO ocr_artifacts (
                        id, document_id, version_id, image_url, image_hash,
                        raw_text, normalized_text, raw_hash, normalized_hash,
                        engine, engine_config_json, quality_json, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        str(uuid.uuid4()),
                        document_id,
                        version_id,
                        image_url,
                        image_hash,
                        raw_text,
                        normalized_text,
                        hashlib.sha256(raw_text.encode("utf-8")).hexdigest(),
                        hashlib.sha256(normalized_text.encode("utf-8")).hexdigest(),
                        engine,
                        _json(dict(artifact.get("engine_config") or {})),
                        _json(dict(artifact.get("quality") or {})),
                        now,
                    ),
                )
                inserted += max(cursor.rowcount, 0)
            connection.commit()
        return inserted

    def list_ocr_artifacts(self, document_id: str) -> list[dict[str, Any]]:
        with self.connect() as connection:
            rows = connection.execute(
                """
                SELECT * FROM ocr_artifacts
                WHERE document_id = ?
                ORDER BY created_at, id
                """,
                (document_id,),
            ).fetchall()
        return [
            {
                "id": row["id"],
                "document_id": row["document_id"],
                "version_id": row["version_id"],
                "image_url": row["image_url"],
                "image_hash": row["image_hash"],
                "raw_text": row["raw_text"],
                "normalized_text": row["normalized_text"],
                "engine": row["engine"],
                "engine_config": _load_json(row["engine_config_json"], {}),
                "quality": _load_json(row["quality_json"], {}),
                "created_at": row["created_at"],
            }
            for row in rows
        ]

    def get_dify_mapping(self, local_document_id: str) -> dict[str, Any] | None:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT * FROM dify_documents WHERE local_document_id = ?",
                (local_document_id,),
            ).fetchone()
        if row is None:
            return None
        return {
            "local_document_id": row["local_document_id"],
            "remote_document_id": row["remote_document_id"],
            "last_content_hash": row["last_content_hash"],
            "last_batch_id": row["last_batch_id"],
            "status": row["status"],
            "last_error": row["last_error"],
        }

    def list_dify_mappings(
        self,
        *,
        statuses: Sequence[str] = ("queued",),
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        cleaned_statuses = _clean_strings(statuses)
        if not cleaned_statuses:
            return []
        limit = max(1, min(int(limit), 500))
        placeholders = ",".join("?" for _ in cleaned_statuses)
        with self.connect() as connection:
            rows = connection.execute(
                f"""
                SELECT m.*, d.source_id, d.canonical_url, d.title,
                       d.content_hash AS current_content_hash
                FROM dify_documents AS m
                JOIN documents AS d ON d.id = m.local_document_id
                WHERE m.status IN ({placeholders})
                ORDER BY m.updated_at, m.local_document_id
                LIMIT ?
                """,
                (*cleaned_statuses, limit),
            ).fetchall()
        return [dict(row) for row in rows]

    def get_dify_retry_document(
        self,
        local_document_id: str,
    ) -> dict[str, Any] | None:
        with self.connect() as connection:
            row = connection.execute(
                """
                SELECT d.id, d.source_id, d.canonical_url, d.title,
                       d.content_hash, d.status, d.metadata_json,
                       v.content_text, s.enabled AS source_enabled,
                       CASE WHEN EXISTS (
                           SELECT 1
                           FROM cross_document_reviews AS review
                           JOIN cross_document_review_targets AS target
                             ON target.review_id = review.id
                           WHERE review.status = 'pending'
                             AND target.blocked = 1
                             AND target.target_document_id = d.id
                       ) THEN 1 ELSE 0 END AS cross_blocked
                FROM documents AS d
                JOIN versions AS v ON v.id = d.current_version_id
                JOIN sources AS s ON s.id = d.source_id
                WHERE d.id = ?
                """,
                (local_document_id,),
            ).fetchone()
        if row is None:
            return None
        return {
            "document_id": row["id"],
            "source_id": row["source_id"],
            "canonical_url": row["canonical_url"],
            "title": row["title"],
            "content_hash": row["content_hash"],
            "status": row["status"],
            "metadata": _load_json(row["metadata_json"], {}),
            "content": row["content_text"],
            "source_enabled": bool(row["source_enabled"]),
            "cross_blocked": bool(row["cross_blocked"]),
        }

    def get_local_documents_by_remote_ids(
        self, remote_document_ids: Sequence[str]
    ) -> dict[str, dict[str, Any]]:
        cleaned_ids = _clean_strings(remote_document_ids)[:100]
        if not cleaned_ids:
            return {}
        placeholders = ",".join("?" for _ in cleaned_ids)
        with self.connect() as connection:
            rows = connection.execute(
                f"""
                SELECT m.remote_document_id, d.id AS local_document_id,
                       d.title, d.canonical_url, d.published_at,
                       d.metadata_json, d.content_hash, v.content_text,
                       m.status AS mapping_status,
                       m.last_content_hash AS mapping_content_hash,
                       CASE WHEN (
                           d.status != 'active'
                           OR m.status != 'synced'
                           OR m.last_content_hash IS NULL
                           OR m.last_content_hash != d.content_hash
                           OR
                           json_extract(
                               d.metadata_json, '$.factReview.status'
                           ) = 'pending'
                           OR coalesce(
                               json_extract(
                                   d.metadata_json, '$.ocrNeedsReview'
                               ),
                               0
                           ) = 1
                           OR EXISTS (
                               SELECT 1
                               FROM cross_document_reviews AS review
                               JOIN cross_document_review_targets AS target
                                 ON target.review_id = review.id
                               WHERE review.status = 'pending'
                                 AND target.blocked = 1
                                 AND target.target_document_id = d.id
                           )
                       ) THEN 1 ELSE 0 END AS blocked
                FROM dify_documents AS m
                JOIN documents AS d ON d.id = m.local_document_id
                JOIN versions AS v ON v.id = d.current_version_id
                WHERE m.remote_document_id IN ({placeholders})
                """,
                cleaned_ids,
            ).fetchall()
        return {
            str(row["remote_document_id"]): {
                "local_document_id": row["local_document_id"],
                "title": row["title"],
                "url": row["canonical_url"],
                "published_at": row["published_at"],
                "content": row["content_text"],
                "metadata": _load_json(row["metadata_json"], {}),
                "blocked": bool(row["blocked"])
                or not is_retrieval_eligible(
                    title=str(row["title"]),
                    url=str(row["canonical_url"]),
                    content=str(row["content_text"]),
                    metadata=_load_json(row["metadata_json"], {}),
                ),
            }
            for row in rows
        }

    def resolve_reviews(
        self,
        *,
        document_id: str,
        kinds: Sequence[str],
    ) -> int:
        cleaned_kinds = _clean_strings(kinds)
        if not cleaned_kinds:
            return 0
        placeholders = ",".join("?" for _ in cleaned_kinds)
        with self.connect() as connection:
            cursor = connection.execute(
                f"""
                UPDATE review_queue
                SET status = 'resolved', resolved_at = ?
                WHERE status = 'pending'
                  AND document_id = ?
                  AND kind IN ({placeholders})
                """,
                (utc_now(), document_id, *cleaned_kinds),
            )
            connection.commit()
        return int(cursor.rowcount)

    def resolve_source_url_reviews(
        self,
        *,
        source_id: str,
        urls: Sequence[str],
        kinds: Sequence[str],
    ) -> int:
        cleaned_urls = _clean_strings(urls)
        cleaned_kinds = _clean_strings(kinds)
        if not cleaned_urls or not cleaned_kinds:
            return 0
        kind_placeholders = ",".join("?" for _ in cleaned_kinds)
        url_placeholders = ",".join("?" for _ in cleaned_urls)
        with self.connect() as connection:
            cursor = connection.execute(
                f"""
                UPDATE review_queue
                SET status = 'resolved', resolved_at = ?
                WHERE status = 'pending'
                  AND source_id = ?
                  AND kind IN ({kind_placeholders})
                  AND json_extract(payload_json, '$.url') IN ({url_placeholders})
                """,
                (utc_now(), source_id, *cleaned_kinds, *cleaned_urls),
            )
            connection.commit()
        return int(cursor.rowcount)

    def save_dify_mapping(
        self,
        *,
        local_document_id: str,
        remote_document_id: str | None,
        last_content_hash: str | None,
        last_batch_id: str | None = None,
        status: str,
        last_error: str | None = None,
    ) -> None:
        now = utc_now()
        with self.connect() as connection:
            connection.execute(
                """
                INSERT INTO dify_documents (
                    local_document_id, remote_document_id, last_content_hash,
                    last_batch_id, status, last_error, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(local_document_id) DO UPDATE SET
                    remote_document_id = coalesce(
                        excluded.remote_document_id,
                        dify_documents.remote_document_id
                    ),
                    last_content_hash = excluded.last_content_hash,
                    last_batch_id = coalesce(
                        excluded.last_batch_id,
                        dify_documents.last_batch_id
                    ),
                    status = excluded.status,
                    last_error = excluded.last_error,
                    updated_at = excluded.updated_at
                """,
                (
                    local_document_id,
                    remote_document_id,
                    last_content_hash,
                    last_batch_id,
                    status,
                    last_error[:2_000] if last_error else None,
                    now,
                    now,
                ),
            )
            connection.commit()

    def has_incomplete_dify_documents(self) -> bool:
        """Return true when Dify cannot represent every active local document."""
        with self.connect() as connection:
            rows = connection.execute(
                """
                SELECT d.id, d.title, d.canonical_url, d.content_hash,
                       d.metadata_json, v.content_text,
                       m.local_document_id AS mapping_document_id,
                       m.status AS mapping_status,
                       m.last_content_hash AS mapping_content_hash,
                       CASE WHEN EXISTS (
                           SELECT 1
                           FROM cross_document_reviews AS review
                           JOIN cross_document_review_targets AS target
                             ON target.review_id = review.id
                           WHERE review.status = 'pending'
                             AND target.blocked = 1
                             AND target.target_document_id = d.id
                       ) THEN 1 ELSE 0 END AS cross_blocked
                FROM documents AS d
                JOIN versions AS v ON v.id = d.current_version_id
                JOIN sources AS s ON s.id = d.source_id
                LEFT JOIN dify_documents AS m ON m.local_document_id = d.id
                WHERE d.status = 'active' AND s.enabled = 1
                """
            ).fetchall()
        for row in rows:
            metadata = _load_json(row["metadata_json"], {})
            fact_review = metadata.get("factReview")
            if not is_retrieval_eligible(
                title=str(row["title"]),
                url=str(row["canonical_url"]),
                content=str(row["content_text"]),
                metadata=metadata,
            ):
                continue
            if (
                (
                    isinstance(fact_review, Mapping)
                    and fact_review.get("status") == "pending"
                )
                or bool(metadata.get("ocrNeedsReview"))
                or bool(row["cross_blocked"])
            ):
                continue
            if (
                row["mapping_document_id"] is None
                or row["mapping_status"] != "synced"
                or row["mapping_content_hash"] is None
                or row["mapping_content_hash"] != row["content_hash"]
            ):
                return True
        return False

    def fts_candidates(self, fts_query: str, limit: int) -> list[dict[str, Any]]:
        statement = """
            SELECT
                f.document_id,
                f.title,
                f.content,
                f.url,
                nullif(f.published_at, '') AS published_at,
                bm25(document_fts, 0.0, 5.0, 1.0) AS rank,
                d.metadata_json,
                d.status,
                s.id AS source_id,
                s.name AS source_name,
                s.source_grade,
                s.tags_json
            FROM document_fts AS f
            JOIN documents AS d ON d.id = f.document_id
            JOIN sources AS s ON s.id = d.source_id
            WHERE document_fts MATCH ?
              AND d.status = 'active'
              AND s.enabled = 1
              AND coalesce(
                  json_extract(d.metadata_json, '$.factReview.status'),
                  ''
              ) != 'pending'
              AND coalesce(
                  json_extract(d.metadata_json, '$.ocrNeedsReview'),
                  0
              ) != 1
              AND NOT EXISTS (
                  SELECT 1
                  FROM cross_document_reviews AS review
                  JOIN cross_document_review_targets AS target
                    ON target.review_id = review.id
                  WHERE review.status = 'pending'
                    AND target.blocked = 1
                    AND target.target_document_id = d.id
              )
            ORDER BY rank
            LIMIT ?
        """
        with self.connect() as connection:
            try:
                rows = connection.execute(statement, (fts_query, limit)).fetchall()
            except sqlite3.OperationalError:
                return []
        candidates = [self._candidate(row) for row in rows]
        return [
            candidate
            for candidate in candidates
            if is_retrieval_eligible(
                title=str(candidate["title"]),
                url=str(candidate["url"]),
                content=str(candidate["content"]),
                metadata=candidate["metadata"],
            )
        ]

    def like_candidates(self, terms: Sequence[str], limit: int) -> list[dict[str, Any]]:
        cleaned = [term for term in terms if term][:8]
        if not cleaned:
            return []
        predicates = " OR ".join("(d.title LIKE ? OR v.content_text LIKE ?)" for _ in cleaned)
        parameters: list[Any] = []
        for term in cleaned:
            pattern = f"%{term}%"
            parameters.extend((pattern, pattern))
        parameters.append(limit)
        statement = f"""
            SELECT
                d.id AS document_id,
                d.title,
                v.content_text AS content,
                d.canonical_url AS url,
                d.published_at,
                10.0 AS rank,
                d.metadata_json,
                d.status,
                s.id AS source_id,
                s.name AS source_name,
                s.source_grade,
                s.tags_json
            FROM documents AS d
            JOIN versions AS v ON v.id = d.current_version_id
            JOIN sources AS s ON s.id = d.source_id
            WHERE d.status = 'active'
              AND s.enabled = 1
              AND coalesce(
                  json_extract(d.metadata_json, '$.factReview.status'),
                  ''
              ) != 'pending'
              AND coalesce(
                  json_extract(d.metadata_json, '$.ocrNeedsReview'),
                  0
              ) != 1
              AND NOT EXISTS (
                  SELECT 1
                  FROM cross_document_reviews AS review
                  JOIN cross_document_review_targets AS target
                    ON target.review_id = review.id
                  WHERE review.status = 'pending'
                    AND target.blocked = 1
                    AND target.target_document_id = d.id
              )
              AND ({predicates})
            ORDER BY d.updated_at DESC
            LIMIT ?
        """
        with self.connect() as connection:
            rows = connection.execute(statement, parameters).fetchall()
        candidates = [self._candidate(row) for row in rows]
        return [
            candidate
            for candidate in candidates
            if is_retrieval_eligible(
                title=str(candidate["title"]),
                url=str(candidate["url"]),
                content=str(candidate["content"]),
                metadata=candidate["metadata"],
            )
        ]

    @staticmethod
    def _candidate(row: sqlite3.Row) -> dict[str, Any]:
        metadata = _load_json(row["metadata_json"], {})
        metadata.update(
            {
                "sourceId": row["source_id"],
                "sourceName": row["source_name"],
                "sourceGrade": row["source_grade"],
                "tags": _load_json(row["tags_json"], []),
                "documentStatus": row["status"],
            }
        )
        metadata.setdefault("status", row["status"])
        return {
            "id": row["document_id"],
            "title": row["title"],
            "content": row["content"],
            "url": row["url"],
            "published_at": row["published_at"],
            "rank": float(row["rank"]),
            "metadata": metadata,
        }
