from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, field_validator


class SearchRequest(BaseModel):
    model_config = ConfigDict(extra="allow", populate_by_name=True)

    query: str = Field(min_length=1, max_length=2_000)
    top_k: int = Field(default=6, ge=1, le=20, alias="topK")
    filters: dict[str, Any] = Field(default_factory=dict)
    profile: dict[str, Any] = Field(default_factory=dict)
    target: dict[str, Any] = Field(default_factory=dict)

    @field_validator("query")
    @classmethod
    def clean_query(cls, value: str) -> str:
        cleaned = " ".join(value.split())
        if not cleaned:
            raise ValueError("query 不能为空")
        return cleaned


class SearchResult(BaseModel):
    id: str
    title: str
    snippet: str
    url: str | None = None
    publishedAt: str | None = None
    score: float | None = None


class SearchResponse(BaseModel):
    results: list[SearchResult]
    engine: str
    fallbackUsed: bool = False


class SourceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    url: HttpUrl
    source_type: str = Field(default="auto", pattern="^(auto|html|pdf|text)$")
    source_grade: str = Field(default="A", max_length=20)
    authority: str = Field(default="official", max_length=40)
    tags: list[str] = Field(default_factory=list)
    follow_links: bool = False
    max_documents: int = Field(default=1, ge=1, le=500)
    allowed_hosts: list[str] = Field(default_factory=list, max_length=20)
    include_paths: list[str] = Field(default_factory=list, max_length=50)
    exclude_paths: list[str] = Field(default_factory=list, max_length=50)


class SourceView(BaseModel):
    id: str
    name: str
    url: str
    source_type: str
    source_grade: str
    authority: str
    tags: list[str]
    enabled: bool
    follow_links: bool
    max_documents: int
    allowed_hosts: list[str]
    include_paths: list[str]
    exclude_paths: list[str]
    last_synced_at: str | None = None
