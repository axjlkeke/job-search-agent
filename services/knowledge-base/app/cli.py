from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Sequence

from .config import Settings
from .database import KnowledgeDatabase
from .ingestion import SyncError, sync_enabled_sources, sync_source
from .reconciliation import reconcile_dify_documents


def _print(value: Any) -> None:
    print(json.dumps(value, ensure_ascii=False, indent=2))


def _source_commands(subparsers: argparse._SubParsersAction) -> None:
    source = subparsers.add_parser("source", help="管理来源注册表")
    actions = source.add_subparsers(dest="source_action", required=True)

    add = actions.add_parser("add", help="登记并启用一个来源")
    add.add_argument("--name", required=True)
    add.add_argument("--url", required=True)
    add.add_argument("--type", choices=["auto", "html", "pdf", "text"], default="auto")
    add.add_argument("--grade", default="A")
    add.add_argument("--authority", default="official")
    add.add_argument("--tag", action="append", default=[])
    add.add_argument("--follow-links", action="store_true")
    add.add_argument("--max-documents", type=int, default=1)
    add.add_argument("--allowed-host", action="append", default=[])
    add.add_argument("--include-path", action="append", default=[])
    add.add_argument("--exclude-path", action="append", default=[])

    actions.add_parser("list", help="列出来源")

    enable = actions.add_parser("enable", help="审核后启用来源")
    enable.add_argument("source")
    disable = actions.add_parser("disable", help="停用来源")
    disable.add_argument("source")

    seed = actions.add_parser("import", help="导入 JSON 来源种子")
    seed.add_argument("file", type=Path)


def _fact_review_commands(subparsers: argparse._SubParsersAction) -> None:
    review = subparsers.add_parser(
        "fact-review",
        help="审核招聘公告关键事实变化",
    )
    actions = review.add_subparsers(dest="fact_review_action", required=True)
    list_action = actions.add_parser("list", help="列出待审核候选版本")
    list_action.add_argument("--limit", type=int, default=100)
    approve = actions.add_parser("approve", help="批准候选版本成为当前版本")
    approve.add_argument("document_id")
    reject = actions.add_parser("reject", help="驳回候选版本并保留当前版本")
    reject.add_argument("document_id")


def _cross_review_commands(subparsers: argparse._SubParsersAction) -> None:
    review = subparsers.add_parser(
        "cross-review",
        help="审核新 URL 的更正、撤回或延期公告",
    )
    actions = review.add_subparsers(dest="cross_review_action", required=True)
    list_action = actions.add_parser("list", help="列出待审核跨公告关系")
    list_action.add_argument("--limit", type=int, default=100)
    approve = actions.add_parser(
        "approve",
        help="批准关系；仅整批终止会直接替代旧公告",
    )
    approve.add_argument("review_id")
    approve.add_argument("--target-document-id")
    reject = actions.add_parser(
        "reject",
        help="驳回关系并将新公告作为独立资料启用",
    )
    reject.add_argument("review_id")
    reconciliation_list = actions.add_parser(
        "reconciliation-list",
        help="列出已批准但仍需合并核验的跨公告变更",
    )
    reconciliation_list.add_argument("--limit", type=int, default=100)
    reconcile = actions.add_parser(
        "reconcile",
        help="完成原公告有效范围对账",
    )
    reconcile.add_argument("review_id")
    reconcile.add_argument("--replacement-document-id", required=True)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="knowledge-base", description="求职 Agent 知识库维护工具")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("init", help="初始化 SQLite 数据库")
    _source_commands(commands)
    sync = commands.add_parser("sync", help="同步一个或一批已启用来源")
    sync.add_argument("source", nargs="?", help="来源 ID、名称或 URL")
    sync.add_argument("--all", action="store_true", help="同步全部已启用来源")
    sync.add_argument("--limit-sources", type=int, default=20)
    coverage = commands.add_parser("coverage", help="输出来源与资料覆盖率报告")
    coverage.add_argument("--stale-after-days", type=int, default=14)
    reconcile = commands.add_parser("dify-reconcile", help="对账 Dify 异步索引状态")
    reconcile.add_argument("--limit", type=int, default=200)
    _fact_review_commands(commands)
    _cross_review_commands(commands)
    return parser


def _import_sources(database: KnowledgeDatabase, path: Path) -> list[dict[str, Any]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    sources = payload.get("sources") if isinstance(payload, dict) else payload
    if not isinstance(sources, list):
        raise ValueError("种子文件必须是数组，或包含 sources 数组")
    imported = []
    for item in sources:
        if not isinstance(item, dict):
            raise ValueError("每个来源必须是对象")
        imported.append(
            database.register_source(
                name=str(item["name"]),
                url=str(item["url"]),
                source_type=str(item.get("source_type", "auto")),
                source_grade=str(item.get("source_grade", "A")),
                authority=str(item.get("authority", "official")),
                tags=[str(value) for value in item.get("tags", [])],
                follow_links=bool(item.get("follow_links", False)),
                max_documents=int(item.get("max_documents", 1)),
                enabled=bool(item.get("enabled", False)),
                allowed_hosts=[str(value) for value in item.get("allowed_hosts", [])],
                include_paths=[str(value) for value in item.get("include_paths", [])],
                exclude_paths=[str(value) for value in item.get("exclude_paths", [])],
            )
        )
    return imported


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    settings = Settings.from_env()
    database = KnowledgeDatabase(settings.database_path)
    database.initialize()

    if args.command == "init":
        _print({"status": "ok", "database": str(database.path)})
        return 0
    if args.command == "coverage":
        _print(database.coverage_report(args.stale_after_days))
        return 0
    if args.command == "dify-reconcile":
        result = reconcile_dify_documents(database, settings, limit=args.limit)
        _print(result)
        return 0 if result["status"] in {"success", "noop", "not-configured"} else 1
    if args.command == "sync":
        if args.all == bool(args.source):
            _print(
                {
                    "status": "error",
                    "message": "请提供一个来源，或只使用 --all",
                }
            )
            return 2
        if args.all:
            result = sync_enabled_sources(
                database,
                settings,
                limit_sources=args.limit_sources,
            )
            _print(result)
            return 0 if result["status"] in {"success", "noop"} else 1
        try:
            result = sync_source(database, settings, args.source)
        except SyncError as error:
            _print({"status": "error", "message": str(error)})
            return 1
        _print(result)
        return 0 if result["status"] in {"success", "partial"} else 1
    if args.command == "fact-review":
        if args.fact_review_action == "list":
            _print(database.list_fact_reviews(limit=args.limit))
            return 0
        decision = (
            "approve" if args.fact_review_action == "approve" else "reject"
        )
        result = database.resolve_fact_review(
            document_id=args.document_id,
            decision=decision,
        )
        if result is None:
            _print(
                {
                    "status": "error",
                    "message": "文档不存在或当前没有待审核事实变更",
                }
            )
            return 1
        result["nextAction"] = (
            "重新同步该来源并运行 dify-reconcile"
            if decision == "approve"
            else "无需同步；当前已审核版本继续生效"
        )
        _print(result)
        return 0
    if args.command == "cross-review":
        if args.cross_review_action == "list":
            _print(database.list_cross_document_reviews(limit=args.limit))
            return 0
        if args.cross_review_action == "reconciliation-list":
            _print(
                database.list_cross_document_reconciliations(
                    limit=args.limit
                )
            )
            return 0
        if args.cross_review_action == "reconcile":
            try:
                result = database.resolve_cross_document_reconciliation(
                    review_id=args.review_id,
                    replacement_document_id=args.replacement_document_id,
                )
            except ValueError as error:
                _print({"status": "error", "message": str(error)})
                return 1
            if result is None:
                _print(
                    {
                        "status": "error",
                        "message": "待对账关系不存在或已经处理",
                    }
                )
                return 1
            result["nextAction"] = (
                "运行 dify-reconcile，并复核新通知与最终有效公告均可检索"
            )
            _print(result)
            return 0
        decision = (
            "approve" if args.cross_review_action == "approve" else "reject"
        )
        try:
            result = database.resolve_cross_document_review(
                review_id=args.review_id,
                decision=decision,
                target_document_id=(
                    args.target_document_id if decision == "approve" else None
                ),
            )
        except ValueError as error:
            _print({"status": "error", "message": str(error)})
            return 1
        if result is None:
            _print(
                {
                    "status": "error",
                    "message": "审核不存在或已经处理",
                }
            )
            return 1
        result["nextAction"] = (
            "先更新或指定包含完整有效范围的公告，再执行 "
            "cross-review reconcile；随后运行 dify-reconcile"
            if result.get("requiresReconciliation")
            else "重新同步该来源并运行 dify-reconcile"
        )
        _print(result)
        return 0

    if args.source_action == "add":
        _print(
            database.register_source(
                name=args.name,
                url=args.url,
                source_type=args.type,
                source_grade=args.grade,
                authority=args.authority,
                tags=args.tag,
                follow_links=args.follow_links,
                max_documents=args.max_documents,
                allowed_hosts=args.allowed_host,
                include_paths=args.include_path,
                exclude_paths=args.exclude_path,
            )
        )
    elif args.source_action == "list":
        _print(database.list_sources())
    elif args.source_action == "enable":
        source = database.set_source_enabled(args.source, True)
        if source is None:
            _print({"status": "error", "message": "来源不存在"})
            return 1
        _print(source)
    elif args.source_action == "disable":
        source = database.set_source_enabled(args.source, False)
        if source is None:
            _print({"status": "error", "message": "来源不存在"})
            return 1
        _print(source)
    elif args.source_action == "import":
        _print(_import_sources(database, args.file))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
