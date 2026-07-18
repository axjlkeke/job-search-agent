from __future__ import annotations

import httpx
import pytest

from app.dify import (
    DifyDocumentError,
    DifyDocumentIndexStatus,
    DifyDocumentSyncReceipt,
    get_dify_document_index_status,
    sync_document_to_dify,
)

from conftest import make_settings


class FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self.payload


def test_create_document_returns_remote_id_and_batch(monkeypatch, tmp_path):
    settings = make_settings(tmp_path, dify=True)
    request = {}

    def fake_post(endpoint, **kwargs):
        request["endpoint"] = endpoint
        request["json"] = kwargs["json"]
        return FakeResponse(
            {
                "document": {"id": "remote-document-1"},
                "batch": "batch-create-1",
            }
        )

    monkeypatch.setattr("app.dify.httpx.post", fake_post)
    receipt = sync_document_to_dify(
        settings,
        title="官方招聘公告",
        content="这是用于测试 Dify 创建契约的完整招聘正文。",
        remote_document_id=None,
    )

    assert receipt == DifyDocumentSyncReceipt(
        remote_document_id="remote-document-1",
        batch_id="batch-create-1",
    )
    assert request["endpoint"].endswith(
        "/datasets/dataset-test/document/create-by-text"
    )
    assert request["json"]["indexing_technique"] == "high_quality"


def test_update_requires_trackable_batch(monkeypatch, tmp_path):
    settings = make_settings(tmp_path, dify=True)
    monkeypatch.setattr(
        "app.dify.httpx.post",
        lambda *args, **kwargs: FakeResponse(
            {"document": {"id": "remote-document-1"}}
        ),
    )

    with pytest.raises(DifyDocumentError, match="batch"):
        sync_document_to_dify(
            settings,
            title="官方招聘公告",
            content="这是用于测试 Dify 更新契约的完整招聘正文。",
            remote_document_id="remote-document-1",
        )


def test_unavailable_document_is_deleted_and_recreated(monkeypatch, tmp_path):
    settings = make_settings(tmp_path, dify=True)
    posted_endpoints = []
    deleted_endpoints = []

    def fake_post(endpoint, **kwargs):
        posted_endpoints.append(endpoint)
        if len(posted_endpoints) == 1:
            response = httpx.Response(
                400,
                request=httpx.Request("POST", endpoint),
                json={"message": "Document is not available"},
            )
            response.raise_for_status()
        return FakeResponse(
            {
                "document": {"id": "remote-document-2"},
                "batch": "batch-recreate-1",
            }
        )

    def fake_delete(endpoint, **kwargs):
        deleted_endpoints.append(endpoint)
        return httpx.Response(204, request=httpx.Request("DELETE", endpoint))

    monkeypatch.setattr("app.dify.httpx.post", fake_post)
    monkeypatch.setattr("app.dify.httpx.delete", fake_delete)

    receipt = sync_document_to_dify(
        settings,
        title="官方招聘公告",
        content="这是用于测试 Dify 异常文档恢复的完整招聘正文。",
        remote_document_id="remote-document-1",
    )

    assert receipt.remote_document_id == "remote-document-2"
    assert posted_endpoints[0].endswith(
        "/documents/remote-document-1/update-by-text"
    )
    assert posted_endpoints[1].endswith("/document/create-by-text")
    assert deleted_endpoints[0].endswith("/documents/remote-document-1")


def test_get_document_index_status_requires_matching_document(monkeypatch, tmp_path):
    settings = make_settings(tmp_path, dify=True)
    request = {}

    def fake_get(endpoint, **kwargs):
        request["endpoint"] = endpoint
        return FakeResponse(
            {
                "data": [
                    {
                        "id": "remote-document-1",
                        "indexing_status": "completed",
                        "error": None,
                    }
                ]
            }
        )

    monkeypatch.setattr("app.dify.httpx.get", fake_get)
    status = get_dify_document_index_status(
        settings,
        batch_id="batch-create-1",
        remote_document_id="remote-document-1",
    )

    assert status == DifyDocumentIndexStatus(
        remote_document_id="remote-document-1",
        indexing_status="completed",
    )
    assert request["endpoint"].endswith(
        "/documents/batch-create-1/indexing-status"
    )


def test_get_document_index_status_rejects_unknown_or_mismatched_response(
    monkeypatch, tmp_path
):
    settings = make_settings(tmp_path, dify=True)
    monkeypatch.setattr(
        "app.dify.httpx.get",
        lambda *args, **kwargs: FakeResponse(
            {"data": [{"id": "other-document", "indexing_status": "completed"}]}
        ),
    )
    with pytest.raises(DifyDocumentError, match="对应文档"):
        get_dify_document_index_status(
            settings,
            batch_id="batch-create-1",
            remote_document_id="remote-document-1",
        )

    monkeypatch.setattr(
        "app.dify.httpx.get",
        lambda *args, **kwargs: FakeResponse(
            {"data": [{"id": "remote-document-1", "indexing_status": "mystery"}]}
        ),
    )
    with pytest.raises(DifyDocumentError, match="未知"):
        get_dify_document_index_status(
            settings,
            batch_id="batch-create-1",
            remote_document_id="remote-document-1",
        )
