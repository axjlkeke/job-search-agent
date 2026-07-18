from __future__ import annotations

import json

from app.cli import main
from app.database import KnowledgeDatabase


def test_cross_review_cli_lists_and_rejects_pending_relation(
    monkeypatch, tmp_path, capsys
):
    path = tmp_path / "knowledge.db"
    monkeypatch.setenv("KB_DATABASE_PATH", str(path))
    database = KnowledgeDatabase(path)
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
        title="关于调整招聘安排的公告",
        content="本次招聘安排调整。",
        content_hash="correction-v1",
        mime_type="text/html",
        published_at=None,
        metadata={},
        analysis={
            "requiresReview": True,
            "relationType": "corrected",
            "suggestedTargets": [
                {
                    "documentId": original["document_id"],
                    "score": 0.8,
                    "blocked": True,
                    "evidence": ["title_similarity"],
                }
            ],
        },
    )

    assert main(["cross-review", "list"]) == 0
    listed = json.loads(capsys.readouterr().out)
    assert listed[0]["reviewId"] == candidate["cross_review_id"]
    assert listed[0]["targets"][0]["documentId"] == original["document_id"]

    assert main(
        ["cross-review", "reject", candidate["cross_review_id"]]
    ) == 0
    resolved = json.loads(capsys.readouterr().out)
    assert resolved["decision"] == "reject"
    assert resolved["requiresDifySync"] is True
    assert main(["cross-review", "list"]) == 0
    assert json.loads(capsys.readouterr().out) == []


def test_cross_review_cli_lists_and_completes_reconciliation(
    monkeypatch, tmp_path, capsys
):
    path = tmp_path / "knowledge.db"
    monkeypatch.setenv("KB_DATABASE_PATH", str(path))
    database = KnowledgeDatabase(path)
    database.initialize()
    source = database.register_source(
        name="官方招聘公告",
        url="https://official.example.test/jobs",
    )
    original = database.upsert_document(
        source=source,
        canonical_url="https://official.example.test/jobs/original",
        title="某央企招聘公告",
        content="原报名截止日期为2026年8月31日。",
        content_hash="original-v1",
        mime_type="text/html",
        published_at=None,
    )
    candidate = database.create_cross_document_review(
        source=source,
        canonical_url="https://official.example.test/jobs/delayed",
        title="关于延长报名时间的通知",
        content="报名截止日期延长至2026年9月15日。",
        content_hash="delayed-v1",
        mime_type="text/html",
        published_at=None,
        metadata={},
        analysis={
            "requiresReview": True,
            "relationType": "delayed",
            "changeScope": "unknown",
            "resolutionMode": "reconcile",
            "suggestedTargets": [
                {
                    "documentId": original["document_id"],
                    "score": 1.0,
                    "blocked": True,
                    "evidence": ["explicit_link"],
                }
            ],
        },
    )

    assert main(
        ["cross-review", "approve", candidate["cross_review_id"]]
    ) == 0
    approved = json.loads(capsys.readouterr().out)
    assert approved["requiresReconciliation"] is True
    assert "cross-review reconcile" in approved["nextAction"]

    assert main(["cross-review", "reconciliation-list"]) == 0
    pending = json.loads(capsys.readouterr().out)
    assert pending[0]["reviewId"] == candidate["cross_review_id"]
    assert pending[0]["targetDocumentId"] == original["document_id"]

    assert main(
        [
            "cross-review",
            "reconcile",
            candidate["cross_review_id"],
            "--replacement-document-id",
            original["document_id"],
        ]
    ) == 1
    unchanged = json.loads(capsys.readouterr().out)
    assert "内容尚未更新" in unchanged["message"]

    database.upsert_document(
        source=source,
        canonical_url="https://official.example.test/jobs/original",
        title="某央企招聘公告（已合并延期安排）",
        content="报名截止日期已延长至2026年9月15日。",
        content_hash="original-v2",
        mime_type="text/html",
        published_at=None,
    )
    assert main(
        [
            "cross-review",
            "reconcile",
            candidate["cross_review_id"],
            "--replacement-document-id",
            original["document_id"],
        ]
    ) == 0
    reconciled = json.loads(capsys.readouterr().out)
    assert reconciled["resolution"] == "reactivated_updated_target"
    assert main(["cross-review", "reconciliation-list"]) == 0
    assert json.loads(capsys.readouterr().out) == []
