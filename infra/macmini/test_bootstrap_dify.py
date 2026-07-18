from __future__ import annotations

import importlib.util
import stat
import sys
import tempfile
import unittest
from argparse import Namespace
from pathlib import Path
from unittest import mock


MODULE_PATH = Path(__file__).with_name("bootstrap-dify.py")
SPEC = importlib.util.spec_from_file_location("bootstrap_dify", MODULE_PATH)
assert SPEC and SPEC.loader
bootstrap = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = bootstrap
SPEC.loader.exec_module(bootstrap)


class BootstrapDifyTests(unittest.TestCase):
    def make_config(self, directory: str) -> bootstrap.BootstrapConfig:
        root = Path(directory)
        return bootstrap.BootstrapConfig(
            project_root=root,
            env_file=root / "env.local",
            secret_file=root / "secret.env",
            runtime_env=root / ".env.production",
            dify_env=root / "dify" / ".env",
            dify_base_url="http://127.0.0.1:8000",
            ollama_api_url="http://127.0.0.1:11434",
            ollama_provider_base_url="http://host.docker.internal:11434",
            marketplace_url="https://marketplace.dify.ai",
            admin_email="admin@tokensoff.com",
            admin_name="Tokensoff Admin",
            admin_language="zh-Hans",
            init_password="init-secret",
            admin_password="A1admin-secret",
            admin_api_key="adm_admin-secret",
            workspace_id="workspace-id",
            workspace_name="",
            embedding_model="qwen3-embedding:0.6b",
            llm_model="qwen2.5:1.5b",
            dataset_name="央国企真实知识库",
            dataset_description="test",
            dataset_id="dataset-id",
            dataset_api_key="dataset-secret",
            app_name="央国企求职决策助手",
            app_description="test",
            app_id="app-id",
            app_api_key="app-secret",
            smoke_query="test",
            timeout=10,
            poll_timeout=10,
        )

    def test_read_env_file_expands_known_values_without_executing_shell(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "runtime.env"
            path.write_text(
                'HOME_ROOT="/srv/test"\nAPP_REPO_DIR="$HOME_ROOT/app"\nDANGEROUS="$(touch /tmp/must-not-exist)"\n',
                encoding="utf-8",
            )
            values = bootstrap.read_env_file(path, {})
            self.assertEqual(values["APP_REPO_DIR"], "/srv/test/app")
            self.assertEqual(values["DANGEROUS"], "$(touch /tmp/must-not-exist)")
            self.assertFalse(Path("/tmp/must-not-exist").exists())

    def test_redactor_removes_secret_and_bearer(self) -> None:
        redactor = bootstrap.Redactor(["top-secret-value"])
        text = redactor.redact("top-secret-value Authorization: Bearer another-secret")
        self.assertNotIn("top-secret-value", text)
        self.assertNotIn("another-secret", text)
        self.assertIn("[REDACTED]", text)

    def test_trusted_ssl_context_falls_back_to_system_ca_bundle(self) -> None:
        context = object()
        verify_paths = mock.Mock(cafile=None, openssl_cafile="/missing/python-cert.pem")
        with (
            mock.patch.dict(bootstrap.os.environ, {}, clear=True),
            mock.patch.object(bootstrap.ssl, "get_default_verify_paths", return_value=verify_paths),
            mock.patch.object(
                bootstrap.Path,
                "is_file",
                autospec=True,
                side_effect=lambda path: str(path) == "/etc/ssl/cert.pem",
            ),
            mock.patch.object(bootstrap.ssl, "create_default_context", return_value=context) as create,
        ):
            self.assertIs(bootstrap.trusted_ssl_context(), context)

        create.assert_called_once_with(cafile="/etc/ssl/cert.pem")

    def test_write_env_updates_is_atomic_idempotent_and_private(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / ".env.production"
            path.write_text("KEEP=value\nDIFY_API_KEY=old\n", encoding="utf-8")
            self.assertTrue(bootstrap.write_env_updates(path, {"DIFY_API_KEY": "new", "DIFY_DATASET_ID": "id"}))
            self.assertFalse(bootstrap.write_env_updates(path, {"DIFY_API_KEY": "new", "DIFY_DATASET_ID": "id"}))
            content = path.read_text(encoding="utf-8")
            self.assertIn("KEEP=value", content)
            self.assertIn("DIFY_API_KEY=new", content)
            self.assertIn("DIFY_DATASET_ID=id", content)
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)

    def test_chatflow_has_exact_six_inputs_rag_and_citations(self) -> None:
        graph, features = bootstrap.build_chatflow("dataset-id", "qwen2.5:1.5b")
        nodes = {node["id"]: node for node in graph["nodes"]}
        variables = {item["variable"] for item in nodes["start"]["data"]["variables"]}
        self.assertEqual(variables, set(bootstrap.INPUT_VARIABLES))
        self.assertEqual(set(nodes), {"start", "llm", "answer"})
        self.assertNotIn(
            "knowledge-retrieval", {node["data"]["type"] for node in graph["nodes"]}
        )
        self.assertFalse(nodes["llm"]["data"]["context"]["enabled"])
        self.assertEqual(nodes["llm"]["data"]["context"]["variable_selector"], [])
        self.assertEqual(nodes["llm"]["data"]["model"]["provider"], bootstrap.PROVIDER_ID)
        self.assertEqual(nodes["llm"]["data"]["model"]["name"], "qwen2.5:1.5b")
        prompt = nodes["llm"]["data"]["prompt_template"][0]["text"]
        self.assertIn("[资料1]", prompt)
        self.assertIn("半角方括号", prompt)
        self.assertIn("不要加粗", prompt)
        self.assertIn("不要用圆括号", prompt)
        self.assertIn("<reference_date>{{#start.reference_date#}}</reference_date>", prompt)
        self.assertFalse(features["retriever_resource"]["enabled"])

    def test_extract_input_variables_accepts_old_and_new_shapes(self) -> None:
        value = [
            {"text-input": {"variable": "policy_version"}},
            {"variable": "profile_context", "type": "paragraph"},
        ]
        self.assertEqual(
            bootstrap.extract_input_variables(value),
            {"policy_version", "profile_context"},
        )

    def test_select_workspace_requires_unambiguous_choice(self) -> None:
        workspaces = [{"id": "one", "name": "A"}, {"id": "two", "name": "B"}]
        with self.assertRaises(bootstrap.BootstrapError):
            bootstrap.select_workspace(workspaces)
        selected = bootstrap.select_workspace(workspaces, wanted_id="two")
        self.assertEqual(selected["name"], "B")

    def test_missing_chat_model_returns_pending_after_preserving_app_and_keys(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config = self.make_config(directory)
            args = Namespace(dry_run=False, pull_models=False)
            dataset = {"id": config.dataset_id}
            with (
                mock.patch.object(bootstrap, "ensure_generated_secrets"),
                mock.patch.object(bootstrap, "configure_dify_auth"),
                mock.patch.object(bootstrap, "wait_for_dify"),
                mock.patch.object(bootstrap, "ensure_setup"),
                mock.patch.object(bootstrap, "ensure_workspace", return_value=config.workspace_id),
                mock.patch.object(bootstrap, "ensure_ollama_plugin"),
                mock.patch.object(bootstrap, "ollama_models", return_value={config.embedding_model}),
                mock.patch.object(bootstrap, "ensure_model_credential"),
                mock.patch.object(bootstrap, "set_default_models") as defaults,
                mock.patch.object(bootstrap, "ensure_dataset_key", return_value=config.dataset_api_key),
                mock.patch.object(bootstrap, "ensure_dataset", return_value=dataset),
                mock.patch.object(bootstrap, "ensure_app"),
                mock.patch.object(bootstrap, "sync_and_publish_chatflow", return_value=False) as sync,
                mock.patch.object(bootstrap, "ensure_app_key", return_value=config.app_api_key) as app_key,
                mock.patch.object(bootstrap, "persist_runtime") as persist,
                mock.patch.object(bootstrap, "verify_parameters") as parameters,
                mock.patch.object(bootstrap, "smoke_test_chat") as smoke,
            ):
                result = bootstrap.run_bootstrap(config, args)

            self.assertEqual(result, bootstrap.EXIT_PENDING)
            sync.assert_called_once_with(config, mock.ANY, config.workspace_id, publish=False)
            app_key.assert_called_once()
            persist.assert_called_once_with(config)
            defaults.assert_not_called()
            parameters.assert_not_called()
            smoke.assert_not_called()


if __name__ == "__main__":
    unittest.main()
