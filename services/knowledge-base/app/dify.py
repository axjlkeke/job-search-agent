from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

import httpx

from .config import Settings


class DifyDocumentError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class DifyDocumentSyncReceipt:
    remote_document_id: str
    batch_id: str


@dataclass(frozen=True, slots=True)
class DifyDocumentIndexStatus:
    remote_document_id: str
    indexing_status: str
    error: str | None = None


def _dataset_base(settings: Settings) -> str:
    assert settings.dify_api_url and settings.dify_dataset_id
    base = settings.dify_api_url.rstrip("/")
    if "{dataset_id}" in base:
        expanded = base.replace("{dataset_id}", settings.dify_dataset_id)
        return re.sub(r"/retrieve$", "", expanded)
    match = re.match(r"^(.*?/datasets/[^/]+)(?:/retrieve)?$", base)
    if match:
        return match.group(1)
    return f"{base}/datasets/{settings.dify_dataset_id}"


def sync_document_to_dify(
    settings: Settings,
    *,
    title: str,
    content: str,
    remote_document_id: str | None,
) -> DifyDocumentSyncReceipt:
    if not settings.dify_configured:
        raise DifyDocumentError("Dify dataset API 未配置")
    assert settings.dify_api_key
    dataset_base = _dataset_base(settings)
    headers = {
        "Authorization": f"Bearer {settings.dify_api_key}",
        "Content-Type": "application/json",
    }
    if remote_document_id:
        endpoint = f"{dataset_base}/documents/{remote_document_id}/update-by-text"
        payload: dict[str, Any] = {
            "name": title[:500],
            "text": content,
            "process_rule": {"mode": "automatic"},
        }
    else:
        endpoint = f"{dataset_base}/document/create-by-text"
        payload = {
            "name": title[:500],
            "text": content,
            "indexing_technique": "high_quality",
            "process_rule": {"mode": "automatic"},
        }
    try:
        response = httpx.post(
            endpoint,
            headers=headers,
            json=payload,
            timeout=settings.dify_timeout_seconds,
        )
        response.raise_for_status()
        result = response.json()
    except httpx.HTTPStatusError as error:
        operation = "更新" if remote_document_id else "创建"
        detail = ""
        raw_detail = ""
        try:
            payload_detail = error.response.json()
            if isinstance(payload_detail, dict):
                value = payload_detail.get("message") or payload_detail.get("code")
                if isinstance(value, str):
                    raw_detail = value
                    detail = f"：{value[:300]}"
        except ValueError:
            pass
        if (
            remote_document_id
            and error.response.status_code == 400
            and "document is not available" in raw_detail.casefold()
        ):
            try:
                delete_response = httpx.delete(
                    f"{dataset_base}/documents/{remote_document_id}",
                    headers=headers,
                    timeout=settings.dify_timeout_seconds,
                )
                if delete_response.status_code != 404:
                    delete_response.raise_for_status()
            except httpx.HTTPError as delete_error:
                raise DifyDocumentError("Dify 无法清理不可用的旧文档") from delete_error
            return sync_document_to_dify(
                settings,
                title=title,
                content=content,
                remote_document_id=None,
            )
        raise DifyDocumentError(
            f"Dify 文档{operation}失败（HTTP {error.response.status_code}）{detail}"
        ) from error
    except (httpx.HTTPError, ValueError) as error:
        operation = "更新" if remote_document_id else "创建"
        raise DifyDocumentError(f"Dify 文档{operation}失败") from error
    document = result.get("document") if isinstance(result, dict) else None
    returned_id = document.get("id") if isinstance(document, dict) else None
    batch_id = result.get("batch") if isinstance(result, dict) else None
    if not isinstance(returned_id, str) or not returned_id.strip():
        # update-by-text 的部分版本可能只返回批次信息；已有映射仍可安全复用。
        if remote_document_id:
            returned_id = remote_document_id
        else:
            raise DifyDocumentError("Dify 创建响应缺少 document.id")
    if remote_document_id and returned_id != remote_document_id:
        raise DifyDocumentError("Dify 更新响应的 document.id 与本地映射不一致")
    if not isinstance(batch_id, str) or not batch_id.strip():
        raise DifyDocumentError("Dify 响应缺少可跟踪的 batch")
    return DifyDocumentSyncReceipt(
        remote_document_id=returned_id,
        batch_id=batch_id,
    )


def get_dify_document_index_status(
    settings: Settings,
    *,
    batch_id: str,
    remote_document_id: str,
) -> DifyDocumentIndexStatus:
    if not settings.dify_configured:
        raise DifyDocumentError("Dify dataset API 未配置")
    assert settings.dify_api_key
    endpoint = f"{_dataset_base(settings)}/documents/{batch_id}/indexing-status"
    try:
        response = httpx.get(
            endpoint,
            headers={"Authorization": f"Bearer {settings.dify_api_key}"},
            timeout=settings.dify_timeout_seconds,
        )
        response.raise_for_status()
        result = response.json()
    except httpx.HTTPStatusError as error:
        raise DifyDocumentError(
            f"Dify 索引状态查询失败（HTTP {error.response.status_code}）"
        ) from error
    except (httpx.HTTPError, ValueError) as error:
        raise DifyDocumentError("Dify 索引状态查询失败") from error

    items = result.get("data") if isinstance(result, dict) else None
    if not isinstance(items, list):
        raise DifyDocumentError("Dify 索引状态响应缺少 data")
    item = next(
        (
            value
            for value in items
            if isinstance(value, dict) and value.get("id") == remote_document_id
        ),
        None,
    )
    if item is None:
        raise DifyDocumentError("Dify 索引批次未返回对应文档")
    status = item.get("indexing_status")
    allowed_statuses = {
        "waiting",
        "parsing",
        "cleaning",
        "splitting",
        "indexing",
        "completed",
        "error",
        "paused",
    }
    if not isinstance(status, str) or status not in allowed_statuses:
        raise DifyDocumentError("Dify 返回未知索引状态")
    raw_error = item.get("error")
    return DifyDocumentIndexStatus(
        remote_document_id=remote_document_id,
        indexing_status=status,
        error=raw_error[:2_000] if isinstance(raw_error, str) and raw_error else None,
    )
