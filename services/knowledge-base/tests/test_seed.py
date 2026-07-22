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


def test_high_frequency_enterprise_seed_uses_reviewed_static_official_pages(
    tmp_path,
):
    database = KnowledgeDatabase(tmp_path / "kb.db")
    database.initialize()
    seed = (
        Path(__file__).resolve().parents[1]
        / "examples"
        / "verified-high-frequency-enterprises.json"
    )
    imported = _import_sources(database, seed)

    assert [source["name"] for source in imported] == [
        "国家电网2026年第三批高校毕业生招聘公告",
        "中国石油2026年春季高校毕业生招聘公告",
        "中国石化2026年度校园招聘启动公告",
        "中国移动2026春季校园招聘公告",
        "中车长春轨道客车股份有限公司2026校园招聘公告",
        "中国能建投资集团2026年校园招聘公告",
    ]
    assert all(source["authority"] == "official" for source in imported)
    assert all(source["source_grade"] == "B" for source in imported)
    assert all(
        source["url"].startswith(("http://", "https://"))
        for source in imported
    )
    assert all(source["enabled"] is True for source in imported)
    assert all(source["follow_links"] is False for source in imported)
    assert all(source["max_documents"] == 1 for source in imported)
    assert all(len(source["allowed_hosts"]) == 1 for source in imported)
    assert all(len(source["include_paths"]) == 1 for source in imported)
    expected_enterprises = {
        "国家电网",
        "中国石油",
        "中国石化",
        "中国移动",
        "中国中车",
        "中国能建",
    }
    assert expected_enterprises == {
        next(tag for tag in source["tags"] if tag in expected_enterprises)
        for source in imported
    }
