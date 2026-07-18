from __future__ import annotations

from pathlib import Path

from app.cli import _import_sources
from app.database import KnowledgeDatabase


def test_official_seed_imports_disabled(tmp_path):
    database = KnowledgeDatabase(tmp_path / "kb.db")
    database.initialize()
    seed = Path(__file__).resolve().parents[1] / "examples" / "sources.json"
    imported = _import_sources(database, seed)
    assert len(imported) == 4
    assert all(source["authority"] == "official" for source in imported)
    assert all(source["enabled"] is False for source in imported)
    assert all(source["allowed_hosts"] for source in imported)


def test_reviewed_seed_is_narrowly_scoped_and_enabled(tmp_path):
    database = KnowledgeDatabase(tmp_path / "kb.db")
    database.initialize()
    seed = Path(__file__).resolve().parents[1] / "examples" / "verified-sources.json"
    imported = _import_sources(database, seed)

    assert len(imported) == 2
    assert all(source["authority"] == "official" for source in imported)
    assert all(source["source_grade"] == "B" for source in imported)
    assert all(source["url"].startswith("http://www.sasac.gov.cn/") for source in imported)
    assert all(source["enabled"] is True for source in imported)
    assert all(source["allowed_hosts"] == ["www.sasac.gov.cn"] for source in imported)
    assert all(source["include_paths"] for source in imported)
    assert imported[0]["max_documents"] == 50
    assert imported[1]["max_documents"] == 1
