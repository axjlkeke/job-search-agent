from __future__ import annotations

import httpx
from fastapi.testclient import TestClient

from app.main import create_app

from conftest import make_settings


def _seed(app) -> str:
    database = app.state.database
    source = database.register_source(name="中国石油招聘", url="https://example.com/cnpc")
    result = database.upsert_document(
        source=source,
        canonical_url="https://example.com/cnpc/notice-1",
        title="中国石油高校毕业生招聘公告",
        content="中国石油发布高校毕业生招聘公告，专业条件、报名时间与资格审查要求以官方页面为准。",
        content_hash="cnpc-v1",
        mime_type="text/html",
        published_at="2026-07-01",
        metadata={"status": "active"},
    )
    return result["document_id"]


def test_health_is_public_but_data_endpoints_can_require_bearer(tmp_path):
    app = create_app(make_settings(tmp_path, api_key="secret-test-key"))
    with TestClient(app) as client:
        assert client.get("/health").status_code == 200
        health = client.get("/health").json()
        assert health["authRequired"] is True
        assert health["ocrConfigured"] is False
        assert client.get("/stats").status_code == 401
        response = client.get(
            "/stats", headers={"Authorization": "Bearer secret-test-key"}
        )
        assert response.status_code == 200
        assert response.json()["documents"] == 0
        assert client.get("/coverage").status_code == 401
        coverage = client.get(
            "/coverage", headers={"Authorization": "Bearer secret-test-key"}
        )
        assert coverage.status_code == 200
        assert coverage.json()["summary"]["registeredSources"] == 0


def test_search_returns_existing_frontend_contract(tmp_path):
    app = create_app(make_settings(tmp_path))
    with TestClient(app) as client:
        _seed(app)
        response = client.post(
            "/search",
            json={
                "query": "中国石油校招",
                "topK": 3,
                "profile": {"degreeLevel": "本科", "major": "计算机"},
                "target": {"companies": ["中国石油"], "jobTitles": ["信息技术"]},
                "filters": {"status": "recruiting", "validAt": "2026-07-13"},
            },
        )
    assert response.status_code == 200
    payload = response.json()
    assert payload["engine"] == "sqlite_fts5"
    assert payload["fallbackUsed"] is False
    assert payload["results"][0].keys() == {
        "id",
        "title",
        "snippet",
        "url",
        "publishedAt",
        "score",
    }


def test_unmapped_dify_records_are_rejected(monkeypatch, tmp_path):
    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {
                "records": [
                    {
                        "score": 0.92,
                        "segment": {
                            "id": "segment-1",
                            "content": "招聘公告原文片段",
                            "document": {
                                "id": "document-1",
                                "name": "国家电网招聘公告",
                                "doc_metadata": {
                                    "url": "https://example.com/sgcc/1",
                                    "publishedAt": "2026-07-10",
                                },
                            },
                        },
                    }
                ]
            }

    monkeypatch.setattr("app.retrieval.httpx.post", lambda *args, **kwargs: FakeResponse())
    app = create_app(make_settings(tmp_path, dify=True))
    with TestClient(app) as client:
        response = client.post("/search", json={"query": "国家电网", "topK": 6})
    assert response.status_code == 200
    assert response.json() == {
        "results": [],
        "engine": "sqlite_fts5",
        "fallbackUsed": True,
    }


def test_dify_results_are_enriched_and_same_document_segments_are_merged(
    monkeypatch, tmp_path
):
    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {
                "records": [
                    {
                        "score": 0.94,
                        "segment": {
                            "id": "segment-1",
                            "content": "第一段官方招聘原文",
                            "document": {
                                "id": "remote-document-1",
                                "name": "Dify 中的标题",
                            },
                        },
                    },
                    {
                        "score": 0.91,
                        "segment": {
                            "id": "segment-2",
                            "content": "同一文档的第二段，应合并到一条引用中",
                            "document": {
                                "id": "remote-document-1",
                                "name": "Dify 中的标题",
                            },
                        },
                    },
                ]
            }

    monkeypatch.setattr("app.retrieval.httpx.post", lambda *args, **kwargs: FakeResponse())
    app = create_app(make_settings(tmp_path, dify=True))
    with TestClient(app) as client:
        document_id = _seed(app)
        app.state.database.save_dify_mapping(
            local_document_id=document_id,
            remote_document_id="remote-document-1",
            last_content_hash="cnpc-v1",
            last_batch_id="completed-batch",
            status="synced",
        )
        response = client.post("/search", json={"query": "中国石油", "topK": 6})

    assert response.status_code == 200
    payload = response.json()
    assert payload["engine"] == "dify"
    assert payload["fallbackUsed"] is False
    assert payload["results"] == [
        {
            "id": "segment-1",
            "title": "中国石油高校毕业生招聘公告",
            "snippet": "第一段官方招聘原文 … 同一文档的第二段，应合并到一条引用中",
            "url": "https://example.com/cnpc/notice-1",
            "publishedAt": "2026-07-01",
            "score": 0.94,
        }
    ]


def test_dify_uses_current_local_content_for_multi_facet_snippet_and_rejects_near_name(
    monkeypatch, tmp_path
):
    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {
                "records": [
                    {
                        "score": 0.99,
                        "segment": {
                            "id": "segment-casic",
                            "content": "中国航天科工集团2027届校园招聘全面启动。",
                            "document": {
                                "id": "remote-casic",
                                "name": "中国航天科工集团2027届校园招聘",
                            },
                        },
                    },
                    {
                        "score": 0.95,
                        "segment": {
                            "id": "segment-casc",
                            "content": (
                                "中国航天科技集团2027校招提前批正式启动。"
                                "招聘对象：2027届高校毕业生、"
                                "2026届未就业高校毕业生。"
                                "需求学科：人工智能、计算机科学与技术、软件工程。"
                            ),
                            "document": {
                                "id": "remote-casc",
                                "name": "中国航天科技集团2027校招提前批",
                            },
                        },
                    },
                ]
            }

    monkeypatch.setattr("app.retrieval.httpx.post", lambda *args, **kwargs: FakeResponse())
    app = create_app(make_settings(tmp_path, dify=True))
    with TestClient(app) as client:
        database = app.state.database
        source = database.register_source(
            name="航天央企招聘",
            url="https://official.example.test/space-jobs",
        )
        technology_content = " ".join(
            [
                "中国航天科技集团2027校招提前批正式启动。",
                "招聘对象：2027届高校毕业生、2026届未就业高校毕业生。",
                "集团和所属单位介绍。" * 80,
                "需求学科：人工智能、计算机科学与技术、软件工程。",
                "科研项目和人才培养介绍。" * 80,
                "工作地点：北京、西安、成都、保定。",
                "薪酬福利和发展支持介绍。" * 80,
                "简历投递：登录www.spacetalent.com.cn投递简历。",
            ]
        )
        technology = database.upsert_document(
            source=source,
            canonical_url="https://official.example.test/space-jobs/casc",
            title="中国航天科技集团2027校招提前批正式启动",
            content=technology_content,
            content_hash="casc-v1",
            mime_type="text/html",
            published_at="2026-06-30",
        )
        industry = database.upsert_document(
            source=source,
            canonical_url="https://official.example.test/space-jobs/casic",
            title="中国航天科工集团2027届校园招聘全面启动",
            content=(
                "中国航天科工集团2027届校园招聘全面启动，"
                "招聘单位、薪酬福利和投递入口以航天科工官网为准。"
            ),
            content_hash="casic-v1",
            mime_type="text/html",
            published_at="2026-06-29",
        )
        database.save_dify_mapping(
            local_document_id=technology["document_id"],
            remote_document_id="remote-casc",
            last_content_hash="casc-v1",
            status="synced",
        )
        database.save_dify_mapping(
            local_document_id=industry["document_id"],
            remote_document_id="remote-casic",
            last_content_hash="casic-v1",
            status="synced",
        )
        response = client.post(
            "/search",
            json={
                "query": (
                    "航天科技集团提前批面向哪些毕业生、需求专业、"
                    "工作地点和简历投递方式？"
                ),
                "topK": 6,
                "target": {"companies": ["中国航天科技集团"]},
            },
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["engine"] == "dify"
    assert payload["fallbackUsed"] is False
    assert [item["title"] for item in payload["results"]] == [
        "中国航天科技集团2027校招提前批正式启动"
    ]
    snippet = payload["results"][0]["snippet"]
    assert len(snippet) <= 2_500
    assert snippet.startswith("中国航天科技集团2027校招提前批正式启动")
    assert "2027届高校毕业生" in snippet
    assert "人工智能" in snippet
    assert "工作地点：北京、西安、成都、保定" in snippet
    assert "www.spacetalent.com.cn" in snippet
    assert "航天科工" not in snippet
    assert snippet.count("2027届高校毕业生") == 1
    assert snippet.count("需求学科") == 1


def test_dify_supplements_batch_unit_choices_and_written_test_time(
    monkeypatch, tmp_path
):
    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {
                "records": [
                    {
                        "score": 0.98,
                        "segment": {
                            "id": "segment-sgcc",
                            "content": (
                                "国家电网有限公司2026年招聘高校毕业生工作已启动。"
                                "二、招聘批次：统一组织实施四批次招聘。"
                            ),
                            "document": {
                                "id": "remote-sgcc",
                                "name": "国家电网有限公司2026年第三批招聘高校毕业生公告",
                            },
                        },
                    }
                ]
            }

    monkeypatch.setattr(
        "app.retrieval.httpx.post", lambda *args, **kwargs: FakeResponse()
    )
    app = create_app(make_settings(tmp_path, dify=True))
    with TestClient(app) as client:
        database = app.state.database
        source = database.register_source(
            name="国家电网第三批招聘",
            url="https://official.example.test/sgcc-third-batch",
        )
        content = " ".join(
            [
                "国家电网有限公司2026年第三批招聘高校毕业生公告。",
                "二、招聘批次：2026年公司统一组织实施四批次招聘，"
                "分别为国调网调提前批、第一批、第二批、第三批。",
                "公司简介和各单位情况。" * 80,
                "每人每批次招聘可填报公司二级单位志愿数量不超过3个，"
                "每个二级单位志愿下可选择2个三级单位或四级单位。",
                "简历填写和资格审查说明。" * 80,
                "（三）组织招聘笔试：公司第三批统一笔试时间"
                "初定为2026年5月17日。",
            ]
        )
        document = database.upsert_document(
            source=source,
            canonical_url="https://official.example.test/sgcc-third-batch/notice",
            title="国家电网有限公司2026年第三批招聘高校毕业生公告",
            content=content,
            content_hash="sgcc-v1",
            mime_type="text/html",
            published_at="2026-04-29",
        )
        database.save_dify_mapping(
            local_document_id=document["document_id"],
            remote_document_id="remote-sgcc",
            last_content_hash="sgcc-v1",
            status="synced",
        )
        response = client.post(
            "/search",
            json={
                "query": (
                    "国家电网2026年第三批招聘如何分批？每人最多能填几个"
                    "二级单位、每个二级单位能选几个下级单位，何时笔试？"
                ),
                "topK": 6,
                "target": {"companies": ["国家电网"]},
            },
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["engine"] == "dify"
    assert payload["fallbackUsed"] is False
    assert len(payload["results"]) == 1
    snippet = payload["results"][0]["snippet"]
    assert len(snippet) <= 2_500
    assert "四批次招聘" in snippet
    assert "二级单位志愿数量不超过3个" in snippet
    assert "可选择2个三级单位或四级单位" in snippet
    assert "2026年5月17日" in snippet


def test_dify_supplements_age_language_unit_limit_and_deadline(
    monkeypatch, tmp_path
):
    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {
                "records": [
                    {
                        "score": 0.98,
                        "segment": {
                            "id": "segment-cnpc",
                            "content": (
                                "中国石油2026年春季高校毕业生招聘主要面向"
                                "2026届高校毕业生和符合条件的留学回国人员。"
                                "博士研究生年龄不超过35岁、硕士研究生年龄"
                                "不超过30岁、本科及职业学院毕业生年龄不超过"
                                "26岁。国内应届本科毕业生大学英语四级不少于"
                                "425分。"
                            ),
                            "document": {
                                "id": "remote-cnpc",
                                "name": "中国石油2026年春季高校毕业生招聘公告",
                            },
                        },
                    }
                ]
            }

    monkeypatch.setattr(
        "app.retrieval.httpx.post", lambda *args, **kwargs: FakeResponse()
    )
    app = create_app(make_settings(tmp_path, dify=True))
    with TestClient(app) as client:
        database = app.state.database
        source = database.register_source(
            name="中国石油春季招聘",
            url="https://official.example.test/cnpc-spring",
        )
        content = " ".join(
            [
                "中国石油2026年春季高校毕业生招聘主要面向2026届高校毕业生。",
                "企业介绍和招聘原则。" * 70,
                "年龄要求：博士研究生年龄不超过35岁、硕士研究生年龄"
                "不超过30岁、本科及职业学院毕业生年龄不超过26岁。",
                "招聘程序和考试说明。" * 70,
                "外语水平要求：国内应届本科毕业生大学英语四级不少于"
                "425分，研究生大学英语六级不少于425分。",
                "资格审查和注意事项。" * 70,
                "每名毕业生最多可应聘2家招聘单位。"
                "报名时间2026年4月22日至5月15日。",
            ]
        )
        document = database.upsert_document(
            source=source,
            canonical_url="https://official.example.test/cnpc-spring/notice",
            title="中国石油2026年春季高校毕业生招聘公告",
            content=content,
            content_hash="cnpc-spring-v1",
            mime_type="text/html",
            published_at="2026-04-24",
        )
        database.save_dify_mapping(
            local_document_id=document["document_id"],
            remote_document_id="remote-cnpc",
            last_content_hash="cnpc-spring-v1",
            status="synced",
        )
        response = client.post(
            "/search",
            json={
                "query": (
                    "中国石油春招面向哪些人？博士、硕士、本科及职业学院"
                    "毕业生年龄上限分别是多少？英语四级或六级要求多少分？"
                    "最多可以应聘几个招聘单位，报名何时截止？"
                ),
                "topK": 6,
                "target": {"companies": ["中国石油"]},
            },
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["engine"] == "dify"
    assert payload["fallbackUsed"] is False
    assert len(payload["results"]) == 1
    snippet = payload["results"][0]["snippet"]
    assert len(snippet) <= 2_500
    assert "不超过35岁" in snippet
    assert "不超过30岁" in snippet
    assert "不超过26岁" in snippet
    assert "大学英语四级不少于425分" in snippet
    assert "大学英语六级不少于425分" in snippet
    assert "最多可应聘2家招聘单位" in snippet
    assert "2026年4月22日至5月15日" in snippet


def test_dify_prioritizes_all_requested_facets_over_a_long_company_intro(
    monkeypatch, tmp_path
):
    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {
                "records": [
                    {
                        "score": 0.98,
                        "segment": {
                            "id": "segment-ceec",
                            "content": (
                                "中国能建投资集团2026年校园招聘公告。"
                                + "投资集团是中国能建投资业务旗舰和核心平台。"
                                * 45
                                + "全日制硕士研究生及以上学历，"
                                "国家英语六级及以上水平。"
                            ),
                            "document": {
                                "id": "remote-ceec",
                                "name": "中国能建投资集团2026年校园招聘公告",
                            },
                        },
                    }
                ]
            }

    monkeypatch.setattr(
        "app.retrieval.httpx.post", lambda *args, **kwargs: FakeResponse()
    )
    app = create_app(make_settings(tmp_path, dify=True))
    with TestClient(app) as client:
        database = app.state.database
        source = database.register_source(
            name="中国能建投资集团校园招聘",
            url="https://official.example.test/ceec-investment",
        )
        content = " ".join(
            [
                "中国能建投资集团2026年校园招聘公告。",
                "企业发展、业务布局和人才战略介绍。" * 120,
                "福利待遇包括通讯补助、交通补助、员工公寓和员工食堂。",
                "应聘基本条件：全日制硕士研究生及以上学历，"
                "国家英语六级及以上水平。",
                "硕士年龄28岁及以下，博士年龄32岁及以下。",
                "国（境）内高校毕业生须在2026年7月31日前取得证书；"
                "国（境）外高校毕业证时间为2025年7月1日至"
                "2026年6月30日，并在2026年7月31日前取得学历认证。",
                "网申入口：https://www.iguopin.com/company?id=10685386430687539。",
            ]
        )
        document = database.upsert_document(
            source=source,
            canonical_url="https://official.example.test/ceec-investment/notice",
            title="中国能建投资集团2026年校园招聘公告",
            content=content,
            content_hash="ceec-v1",
            mime_type="text/html",
            published_at="2025-09-30",
        )
        database.save_dify_mapping(
            local_document_id=document["document_id"],
            remote_document_id="remote-ceec",
            last_content_hash="ceec-v1",
            status="synced",
        )
        response = client.post(
            "/search",
            json={
                "query": (
                    "最低学历、英语六级要求、硕士和博士年龄上限、"
                    "境内外毕业时间、福利和网申入口分别是什么？"
                ),
                "topK": 6,
                "target": {"companies": ["中国能建投资集团"]},
            },
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["engine"] == "dify"
    assert payload["fallbackUsed"] is False
    snippet = payload["results"][0]["snippet"]
    assert len(snippet) <= 2_500
    assert "全日制硕士研究生及以上学历" in snippet
    assert "国家英语六级及以上水平" in snippet
    assert "硕士年龄28岁及以下" in snippet
    assert "博士年龄32岁及以下" in snippet
    assert "2026年7月31日" in snippet
    assert "员工公寓" in snippet
    assert "https://www.iguopin.com/company?id=10685386430687539" in snippet


def test_selected_company_rejects_unrelated_mapped_dify_and_local_results(
    monkeypatch, tmp_path
):
    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {
                "records": [
                    {
                        "score": 0.94,
                        "segment": {
                            "id": "segment-unrelated",
                            "content": "中国石油发布高校毕业生招聘公告。",
                            "document": {
                                "id": "remote-document-unrelated",
                                "name": "中国石油高校毕业生招聘公告",
                            },
                        },
                    }
                ]
            }

    monkeypatch.setattr("app.retrieval.httpx.post", lambda *args, **kwargs: FakeResponse())
    app = create_app(make_settings(tmp_path, dify=True))
    with TestClient(app) as client:
        document_id = _seed(app)
        app.state.database.save_dify_mapping(
            local_document_id=document_id,
            remote_document_id="remote-document-unrelated",
            last_content_hash="cnpc-v1",
            status="synced",
        )
        response = client.post(
            "/search",
            json={
                "query": "中国长城2026全球博士人才招聘有什么要求",
                "topK": 6,
                "target": {"companies": ["中国长城"]},
            },
        )

    assert response.status_code == 200
    assert response.json() == {
        "results": [],
        "engine": "sqlite_fts5",
        "fallbackUsed": True,
    }


def test_selected_company_accepts_a_controlled_abbreviation(monkeypatch, tmp_path):
    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {
                "records": [
                    {
                        "score": 0.94,
                        "segment": {
                            "id": "segment-cnpc",
                            "content": "中国石油发布高校毕业生招聘公告。",
                            "document": {
                                "id": "remote-document-cnpc",
                                "name": "中国石油高校毕业生招聘公告",
                            },
                        },
                    }
                ]
            }

    monkeypatch.setattr("app.retrieval.httpx.post", lambda *args, **kwargs: FakeResponse())
    app = create_app(make_settings(tmp_path, dify=True))
    with TestClient(app) as client:
        document_id = _seed(app)
        app.state.database.save_dify_mapping(
            local_document_id=document_id,
            remote_document_id="remote-document-cnpc",
            last_content_hash="cnpc-v1",
            status="synced",
        )
        response = client.post(
            "/search",
            json={
                "query": "中石油校招",
                "topK": 6,
                "target": {"companies": ["中石油"]},
            },
        )

    assert response.status_code == 200
    assert response.json()["engine"] == "dify"
    assert response.json()["fallbackUsed"] is False
    assert [item["title"] for item in response.json()["results"]] == [
        "中国石油高校毕业生招聘公告"
    ]


def test_dify_query_includes_profile_and_target_within_250_chars(
    monkeypatch, tmp_path
):
    captured = {}

    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {"records": []}

    def fake_post(*args, **kwargs):
        captured["query"] = kwargs["json"]["query"]
        return FakeResponse()

    monkeypatch.setattr("app.retrieval.httpx.post", fake_post)
    app = create_app(make_settings(tmp_path, dify=True))
    with TestClient(app) as client:
        response = client.post(
            "/search",
            json={
                "query": "如何制定求职计划？" + "请结合最新招聘资料。" * 40,
                "topK": 6,
                "profile": {
                    "degreeLevel": "bachelor",
                    "major": "计算机科学与技术",
                    "graduationYear": 2027,
                },
                "target": {
                    "companies": ["国家电网"],
                    "jobTitles": ["信息通信岗"],
                },
            },
        )

    assert response.status_code == 200
    assert len(captured["query"]) <= 250
    assert "国家电网" in captured["query"]
    assert "信息通信岗" in captured["query"]
    assert "计算机科学与技术" in captured["query"]
    assert "bachelor" in captured["query"]


def test_queued_dify_document_forces_reliable_local_fallback(monkeypatch, tmp_path):
    app = create_app(make_settings(tmp_path, dify=True))
    with TestClient(app) as client:
        document_id = _seed(app)
        app.state.database.save_dify_mapping(
            local_document_id=document_id,
            remote_document_id="remote-document-queued",
            last_content_hash="cnpc-v1",
            last_batch_id="queued-batch",
            status="queued",
        )

        def should_not_call_dify(*args, **kwargs):
            raise AssertionError("Dify 索引未完成时不应参与检索")

        monkeypatch.setattr("app.retrieval.httpx.post", should_not_call_dify)
        response = client.post("/search", json={"query": "中国石油", "topK": 2})

    assert response.status_code == 200
    assert response.json()["engine"] == "sqlite_fts5"
    assert response.json()["fallbackUsed"] is True
    assert len(response.json()["results"]) == 1


def test_dify_failure_falls_back_to_local_index(monkeypatch, tmp_path):
    def fail(*args, **kwargs):
        raise httpx.ConnectError("offline")

    monkeypatch.setattr("app.retrieval.httpx.post", fail)
    app = create_app(make_settings(tmp_path, dify=True))
    with TestClient(app) as client:
        document_id = _seed(app)
        app.state.database.save_dify_mapping(
            local_document_id=document_id,
            remote_document_id="remote-document-synced",
            last_content_hash="cnpc-v1",
            last_batch_id="completed-batch",
            status="synced",
        )
        response = client.post("/search", json={"query": "中国石油", "topK": 2})
    assert response.status_code == 200
    assert response.json()["engine"] == "sqlite_fts5"
    assert response.json()["fallbackUsed"] is True
    assert len(response.json()["results"]) == 1
