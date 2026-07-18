from __future__ import annotations

import hmac
from contextlib import asynccontextmanager
from typing import Annotated, Any

from fastapi import Depends, FastAPI, Header, HTTPException, Request, status

from . import __version__
from .config import Settings
from .database import KnowledgeDatabase
from .ingestion import SyncError, sync_source
from .retrieval import search
from .schemas import (
    SearchRequest,
    SearchResponse,
    SourceCreate,
    SourceView,
)


def _database(request: Request) -> KnowledgeDatabase:
    return request.app.state.database


def _settings(request: Request) -> Settings:
    return request.app.state.settings


def require_bearer(
    request: Request,
    authorization: Annotated[str | None, Header()] = None,
) -> None:
    api_key = _settings(request).api_key
    if not api_key:
        return
    scheme, _, token = (authorization or "").partition(" ")
    if scheme.casefold() != "bearer" or not hmac.compare_digest(token, api_key):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="缺少或无效的 Bearer 凭证",
            headers={"WWW-Authenticate": "Bearer"},
        )


def create_app(settings: Settings | None = None) -> FastAPI:
    resolved_settings = settings or Settings.from_env()
    database = KnowledgeDatabase(resolved_settings.database_path)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        database.initialize()
        yield

    app = FastAPI(
        title="求职 Agent 知识库服务",
        version=__version__,
        lifespan=lifespan,
    )
    app.state.settings = resolved_settings
    app.state.database = database

    @app.get("/health")
    def health() -> dict[str, Any]:
        database_ok = database.ping()
        return {
            "status": "ok" if database_ok else "error",
            "version": __version__,
            "database": "ok" if database_ok else "unavailable",
            "retrieval": "dify" if resolved_settings.dify_configured else "sqlite_fts5",
            "difyConfigured": resolved_settings.dify_configured,
            "ocrConfigured": resolved_settings.ocr_configured,
            "authRequired": bool(resolved_settings.api_key),
        }

    @app.get("/stats", dependencies=[Depends(require_bearer)])
    def stats() -> dict[str, Any]:
        return {**database.stats(), "difyConfigured": resolved_settings.dify_configured}

    @app.post(
        "/search",
        response_model=SearchResponse,
        dependencies=[Depends(require_bearer)],
    )
    def search_endpoint(payload: SearchRequest) -> SearchResponse:
        results, engine, fallback_used = search(database, resolved_settings, payload)
        return SearchResponse(
            results=results,
            engine=engine,
            fallbackUsed=fallback_used,
        )

    @app.get(
        "/sources",
        response_model=list[SourceView],
        dependencies=[Depends(require_bearer)],
    )
    def sources() -> list[dict[str, Any]]:
        return database.list_sources()

    @app.post(
        "/sources",
        response_model=SourceView,
        status_code=status.HTTP_201_CREATED,
        dependencies=[Depends(require_bearer)],
    )
    def create_source(payload: SourceCreate) -> dict[str, Any]:
        return database.register_source(
            name=payload.name,
            url=str(payload.url),
            source_type=payload.source_type,
            source_grade=payload.source_grade,
            authority=payload.authority,
            tags=payload.tags,
            follow_links=payload.follow_links,
            max_documents=payload.max_documents,
            allowed_hosts=payload.allowed_hosts,
            include_paths=payload.include_paths,
            exclude_paths=payload.exclude_paths,
        )

    @app.get("/coverage", dependencies=[Depends(require_bearer)])
    def coverage(stale_after_days: int = 14) -> dict[str, Any]:
        return database.coverage_report(stale_after_days)

    @app.post(
        "/sources/{source_id}/sync",
        dependencies=[Depends(require_bearer)],
    )
    def sync_source_endpoint(source_id: str) -> dict[str, Any]:
        try:
            return sync_source(database, resolved_settings, source_id)
        except SyncError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error

    return app


app = create_app()
