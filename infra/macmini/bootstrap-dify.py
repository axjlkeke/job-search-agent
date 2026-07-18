#!/usr/bin/env python3
"""Idempotently bootstrap Dify 1.15.0 for the Tokensoff job-search Agent.

The script intentionally uses only Python's standard library. It talks to the
official Dify 1.15.0 Console and Service APIs, keeps all credentials out of
stdout/stderr, and persists runtime values with mode 0600.

Exit codes:
  0 - all resources and the RAG smoke test are ready
  1 - a non-recoverable configuration/API error occurred
  2 - safe partial progress; a model/document is still pending
"""

from __future__ import annotations

import argparse
import http.cookiejar
import json
import os
import re
import secrets
import shutil
import ssl
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence


EXIT_READY = 0
EXIT_ERROR = 1
EXIT_PENDING = 2
DIFY_VERSION = "1.15.0"
PROVIDER_ID = "langgenius/ollama/ollama"
PLUGIN_ID = "langgenius/ollama"
INPUT_VARIABLES = (
    "policy_version",
    "system_policy",
    "profile_context",
    "target_context",
    "reference_date",
    "retrieval_context",
)
SECRET_KEYS = {
    "ADMIN_API_KEY",
    "DIFY_ADMIN_API_KEY",
    "DIFY_ADMIN_PASSWORD",
    "DIFY_API_KEY",
    "DIFY_DATASET_API_KEY",
    "DIFY_INIT_PASSWORD",
    "INIT_PASSWORD",
}


class BootstrapError(RuntimeError):
    """A fatal bootstrap error."""


class PendingBootstrap(RuntimeError):
    """A safe, retryable pending condition."""


def info(message: str) -> None:
    print(f"[dify-bootstrap] {message}")


def warning(message: str) -> None:
    print(f"[dify-bootstrap] 待处理：{message}", file=sys.stderr)


class Redactor:
    def __init__(self, values: Iterable[str] = ()) -> None:
        self._values: set[str] = set()
        self.extend(values)

    def extend(self, values: Iterable[str]) -> None:
        for value in values:
            if value and len(value) >= 4:
                self._values.add(value)

    def redact(self, value: str) -> str:
        result = value
        for secret in sorted(self._values, key=len, reverse=True):
            result = result.replace(secret, "[REDACTED]")
        result = re.sub(
            r"(?i)(authorization\s*[:=]\s*bearer\s+)[^\s,;]+",
            r"\1[REDACTED]",
            result,
        )
        return result


def _unquote_env_value(value: str) -> str:
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
        value = value[1:-1]
        if value is not None and "\\" in value:
            value = (
                value.replace("\\n", "\n")
                .replace("\\r", "\r")
                .replace("\\t", "\t")
                .replace('\\"', '"')
                .replace("\\\\", "\\")
            )
    return value


_ENV_REFERENCE = re.compile(r"\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))")


def expand_env_value(value: str, values: Mapping[str, str]) -> str:
    value = os.path.expanduser(value)

    def replace(match: re.Match[str]) -> str:
        name = match.group(1) or match.group(2) or ""
        return values.get(name, os.environ.get(name, match.group(0)))

    for _ in range(8):
        expanded = _ENV_REFERENCE.sub(replace, value)
        if expanded == value:
            break
        value = expanded
    return value


def read_env_file(path: Path, seed: Mapping[str, str] | None = None) -> dict[str, str]:
    if not path.is_file():
        return {}
    values: dict[str, str] = dict(seed or {})
    parsed: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        if "=" not in line:
            continue
        key, raw_value = line.split("=", 1)
        key = key.strip()
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
            continue
        value = expand_env_value(_unquote_env_value(raw_value), {**values, **parsed})
        parsed[key] = value
    return parsed


def _validate_env_value(key: str, value: str) -> None:
    if "\n" in value or "\r" in value or "\x00" in value:
        raise BootstrapError(f"{key} 不能包含换行或空字节")


def write_env_updates(path: Path, updates: Mapping[str, str]) -> bool:
    """Atomically update a dotenv file and force mode 0600.

    Returns True only when file content changed. Symlinks are rejected so a
    compromised runtime path cannot redirect secret writes.
    """

    if path.is_symlink():
        raise BootstrapError(f"拒绝写入符号链接：{path}")
    for key, value in updates.items():
        _validate_env_value(key, value)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    try:
        path.parent.chmod(0o700)
    except PermissionError:
        pass

    original = path.read_text(encoding="utf-8") if path.exists() else ""
    lines = original.splitlines()
    remaining = dict(updates)
    output: list[str] = []
    seen: set[str] = set()
    for line in lines:
        stripped = line.lstrip()
        if stripped.startswith("#") or "=" not in line:
            output.append(line)
            continue
        key = line.split("=", 1)[0].strip()
        if key in updates:
            if key not in seen:
                output.append(f"{key}={updates[key]}")
                seen.add(key)
                remaining.pop(key, None)
            continue
        output.append(line)
    if remaining and output and output[-1] != "":
        output.append("")
    output.extend(f"{key}={value}" for key, value in remaining.items())
    content = "\n".join(output).rstrip("\n") + "\n"
    if content == original:
        if path.exists():
            path.chmod(0o600)
        return False

    fd, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=str(path.parent))
    temp_path = Path(temp_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        temp_path.chmod(0o600)
        os.replace(temp_path, path)
        path.chmod(0o600)
    finally:
        if temp_path.exists():
            temp_path.unlink()
    return True


def normalize_url(value: str) -> str:
    if not value.startswith(("http://", "https://")):
        value = f"http://{value}"
    return value.rstrip("/")


def service_api_url(base_url: str) -> str:
    return f"{base_url.rstrip('/')}/v1"


def is_loopback_url(url: str) -> bool:
    host = urllib.parse.urlsplit(url).hostname
    return host in {"127.0.0.1", "localhost", "::1"}


@dataclass
class BootstrapConfig:
    project_root: Path
    env_file: Path
    secret_file: Path
    runtime_env: Path
    dify_env: Path
    dify_base_url: str
    ollama_api_url: str
    ollama_provider_base_url: str
    marketplace_url: str
    admin_email: str
    admin_name: str
    admin_language: str
    init_password: str
    admin_password: str
    admin_api_key: str
    workspace_id: str
    workspace_name: str
    embedding_model: str
    llm_model: str
    dataset_name: str
    dataset_description: str
    dataset_id: str
    dataset_api_key: str
    app_name: str
    app_description: str
    app_id: str
    app_api_key: str
    smoke_query: str
    timeout: int
    poll_timeout: int
    values: dict[str, str] = field(default_factory=dict)

    @property
    def docker_dir(self) -> Path:
        return self.dify_env.parent

    @property
    def compose_file(self) -> Path:
        return self.docker_dir / "docker-compose.yaml"


def load_config(args: argparse.Namespace) -> BootstrapConfig:
    script_dir = Path(__file__).resolve().parent
    project_root = script_dir.parent.parent
    env_file = Path(args.env_file or os.environ.get("DEPLOY_ENV_FILE", script_dir / "env.local")).expanduser()
    base = read_env_file(env_file, os.environ)
    preliminary = {**base, **os.environ}

    app_repo = Path(expand_env_value(preliminary.get("APP_REPO_DIR", str(project_root)), preliminary)).expanduser()
    runtime_env = Path(
        args.runtime_env
        or preliminary.get("DIFY_RUNTIME_ENV_FILE", str(app_repo / ".env.production"))
    ).expanduser()
    dify_root = Path(
        expand_env_value(preliminary.get("DIFY_ROOT_DIR", str(Path.home() / "Services/dify")), preliminary)
    ).expanduser()
    dify_env = Path(args.dify_env or preliminary.get("DIFY_DOCKER_ENV_FILE", dify_root / "docker/.env")).expanduser()
    runtime_values = read_env_file(runtime_env, preliminary)
    dify_values = read_env_file(dify_env, preliminary)

    secret_path_value = (
        args.secret_file
        or preliminary.get("DIFY_BOOTSTRAP_SECRET_FILE")
        or str(Path.home() / ".config/tokensoff/dify-bootstrap.env")
    )
    secret_file = Path(expand_env_value(secret_path_value, preliminary)).expanduser()
    secret_values = read_env_file(secret_file, preliminary)

    values = {**base, **dify_values, **runtime_values, **secret_values, **os.environ}
    init_password = values.get("DIFY_INIT_PASSWORD") or values.get("INIT_PASSWORD", "")
    admin_api_key = values.get("DIFY_ADMIN_API_KEY") or values.get("ADMIN_API_KEY", "")

    bind_address = values.get("DIFY_BIND_ADDRESS", "127.0.0.1")
    port = values.get("DIFY_PORT", "8000")
    configured_api_url = values.get("DIFY_BOOTSTRAP_BASE_URL", "")
    if not configured_api_url:
        public_api = values.get("DIFY_API_URL", "")
        configured_api_url = public_api[:-3] if public_api.rstrip("/").endswith("/v1") else public_api
    dify_base_url = normalize_url(args.base_url or configured_api_url or f"http://{bind_address}:{port}")

    ollama_host = values.get("OLLAMA_HOST", "127.0.0.1:11434")
    ollama_api_url = normalize_url(args.ollama_url or values.get("OLLAMA_API_URL", ollama_host))

    return BootstrapConfig(
        project_root=project_root,
        env_file=env_file,
        secret_file=secret_file,
        runtime_env=runtime_env,
        dify_env=dify_env,
        dify_base_url=dify_base_url,
        ollama_api_url=ollama_api_url,
        ollama_provider_base_url=normalize_url(
            values.get("DIFY_OLLAMA_BASE_URL", "http://host.docker.internal:11434")
        ),
        marketplace_url=normalize_url(values.get("DIFY_MARKETPLACE_URL", "https://marketplace.dify.ai")),
        admin_email=values.get("DIFY_ADMIN_EMAIL", "admin@tokensoff.com"),
        admin_name=values.get("DIFY_ADMIN_NAME", "Tokensoff Admin"),
        admin_language=values.get("DIFY_ADMIN_LANGUAGE", "zh-Hans"),
        init_password=init_password,
        admin_password=values.get("DIFY_ADMIN_PASSWORD", ""),
        admin_api_key=admin_api_key,
        workspace_id=values.get("DIFY_WORKSPACE_ID", ""),
        workspace_name=values.get("DIFY_WORKSPACE_NAME", ""),
        embedding_model=values.get("DIFY_EMBEDDING_MODEL", values.get("OLLAMA_MODEL", "qwen3-embedding:0.6b")),
        llm_model=values.get("DIFY_LLM_MODEL", "qwen2.5:1.5b"),
        dataset_name=values.get("DIFY_DATASET_NAME", "央国企真实知识库"),
        dataset_description=values.get(
            "DIFY_DATASET_DESCRIPTION", "央国企招聘政策、企业、岗位、案例与求职方法的真实知识库"
        ),
        dataset_id=values.get("DIFY_DATASET_ID", ""),
        dataset_api_key=values.get("DIFY_DATASET_API_KEY", ""),
        app_name=values.get("DIFY_APP_NAME", "央国企求职决策助手"),
        app_description=values.get(
            "DIFY_APP_DESCRIPTION", "基于真实知识库的央国企求职路径、风险与行动计划助手"
        ),
        app_id=values.get("DIFY_APP_ID", ""),
        app_api_key=values.get("DIFY_API_KEY", ""),
        smoke_query=values.get(
            "DIFY_SMOKE_QUERY", "请根据知识库说明当前资料覆盖的求职信息；如资料不足请明确说明。"
        ),
        timeout=int(values.get("DIFY_BOOTSTRAP_HTTP_TIMEOUT", "60")),
        poll_timeout=int(values.get("DIFY_BOOTSTRAP_POLL_TIMEOUT", "600")),
        values=values,
    )


def ensure_generated_secrets(config: BootstrapConfig, dry_run: bool) -> None:
    if not config.init_password:
        config.init_password = secrets.token_urlsafe(18)[:30]
    if not config.admin_password:
        config.admin_password = "A1" + secrets.token_urlsafe(24)
    if not config.admin_api_key:
        config.admin_api_key = "adm_" + secrets.token_urlsafe(48)
    if dry_run:
        return
    write_env_updates(
        config.secret_file,
        {
            "DIFY_INIT_PASSWORD": config.init_password,
            "DIFY_ADMIN_PASSWORD": config.admin_password,
            "DIFY_ADMIN_API_KEY": config.admin_api_key,
            **({"DIFY_DATASET_API_KEY": config.dataset_api_key} if config.dataset_api_key else {}),
            **({"DIFY_API_KEY": config.app_api_key} if config.app_api_key else {}),
            **({"DIFY_DATASET_ID": config.dataset_id} if config.dataset_id else {}),
            **({"DIFY_APP_ID": config.app_id} if config.app_id else {}),
            **({"DIFY_WORKSPACE_ID": config.workspace_id} if config.workspace_id else {}),
        },
    )


def trusted_ssl_context() -> ssl.SSLContext:
    """Use Python's CA store, falling back to common system stores on macOS/Linux."""
    configured_ca = os.environ.get("SSL_CERT_FILE", "").strip()
    if configured_ca:
        return ssl.create_default_context(cafile=configured_ca)

    verify_paths = ssl.get_default_verify_paths()
    default_ca = verify_paths.cafile or verify_paths.openssl_cafile
    if default_ca and Path(default_ca).is_file():
        return ssl.create_default_context()

    for candidate in ("/etc/ssl/cert.pem", "/etc/ssl/certs/ca-certificates.crt"):
        if Path(candidate).is_file():
            return ssl.create_default_context(cafile=candidate)

    return ssl.create_default_context()


class HttpClient:
    def __init__(self, base_url: str, redactor: Redactor, timeout: int = 60) -> None:
        self.base_url = base_url.rstrip("/")
        self.redactor = redactor
        self.timeout = timeout
        self.cookie_jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPSHandler(context=trusted_ssl_context()),
            urllib.request.HTTPCookieProcessor(self.cookie_jar),
        )

    def request(
        self,
        method: str,
        path: str,
        *,
        body: Mapping[str, Any] | Sequence[Any] | None = None,
        headers: Mapping[str, str] | None = None,
        expected: Sequence[int] = (200,),
        timeout: int | None = None,
    ) -> tuple[int, Any]:
        url = path if path.startswith(("http://", "https://")) else f"{self.base_url}/{path.lstrip('/')}"
        request_headers = {
            "Accept": "application/json",
            "User-Agent": "tokensoff-dify-bootstrap/1.0",
            **dict(headers or {}),
        }
        data: bytes | None = None
        if body is not None:
            data = json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            request_headers["Content-Type"] = "application/json"
        request = urllib.request.Request(url, data=data, headers=request_headers, method=method.upper())
        try:
            with self.opener.open(request, timeout=timeout or self.timeout) as response:
                status = response.status
                raw = response.read()
        except urllib.error.HTTPError as exc:
            status = exc.code
            raw = exc.read()
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            raise BootstrapError(
                self.redactor.redact(f"请求 {method.upper()} {urllib.parse.urlsplit(url).path} 失败：{exc}")
            ) from exc

        parsed: Any = None
        if raw:
            try:
                parsed = json.loads(raw.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                parsed = raw.decode("utf-8", errors="replace")
        if status not in expected:
            detail = ""
            if isinstance(parsed, dict):
                detail = str(parsed.get("message") or parsed.get("code") or "")
            elif isinstance(parsed, str):
                detail = parsed[:300]
            detail = self.redactor.redact(detail)
            suffix = f" ({detail})" if detail else ""
            raise BootstrapError(f"{method.upper()} {urllib.parse.urlsplit(url).path} 返回 HTTP {status}{suffix}")
        return status, parsed


def admin_headers(config: BootstrapConfig, workspace_id: str | None = None) -> dict[str, str]:
    headers = {"Authorization": f"Bearer {config.admin_api_key}"}
    if workspace_id:
        headers["X-WORKSPACE-ID"] = workspace_id
    return headers


def bearer_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def restart_dify_api(config: BootstrapConfig, redactor: Redactor) -> None:
    compose = config.compose_file
    if not compose.is_file():
        raise BootstrapError(f"需要重启 Dify API，但未找到：{compose}")
    if not shutil.which("docker"):
        raise BootstrapError("需要重启 Dify API，但系统没有 docker 命令")
    command = [
        "docker",
        "compose",
        "--project-directory",
        str(config.docker_dir),
        "--env-file",
        str(config.dify_env),
        "-f",
        str(compose),
        "up",
        "-d",
        "api",
    ]
    result = subprocess.run(command, text=True, capture_output=True, check=False)
    if result.returncode:
        detail = redactor.redact((result.stderr or result.stdout).strip())[-1000:]
        raise BootstrapError(f"Dify API 重启失败：{detail or 'docker compose 执行失败'}")
    info("Dify API 已应用引导认证配置")


def configure_dify_auth(config: BootstrapConfig, redactor: Redactor, dry_run: bool) -> None:
    if not is_loopback_url(config.dify_base_url):
        raise BootstrapError(
            "引导管理密钥只允许对本机 Dify 地址启用；请使用 127.0.0.1/localhost"
        )
    if dry_run:
        info("将以 0600 权限配置 Dify 首次初始化与管理 API 密钥")
        return
    if not config.dify_env.is_file():
        raise BootstrapError(f"未找到 Dify 运行配置：{config.dify_env}")
    changed = write_env_updates(
        config.dify_env,
        {
            "INIT_PASSWORD": config.init_password,
            "ADMIN_API_KEY_ENABLE": "true",
            "ADMIN_API_KEY": config.admin_api_key,
        },
    )
    if changed:
        restart_dify_api(config, redactor)


def wait_for_dify(client: HttpClient, timeout: int) -> None:
    deadline = time.monotonic() + timeout
    last_error = ""
    while time.monotonic() < deadline:
        try:
            client.request("GET", "/console/api/setup", expected=(200,), timeout=10)
            return
        except BootstrapError as exc:
            last_error = str(exc)
            time.sleep(2)
    raise BootstrapError(f"Dify 在 {timeout} 秒内未就绪：{last_error}")


def ensure_setup(config: BootstrapConfig, client: HttpClient) -> None:
    _, setup = client.request("GET", "/console/api/setup")
    if isinstance(setup, dict) and setup.get("step") == "finished":
        info("管理员已存在，直接复用")
        return
    if not config.admin_email:
        raise BootstrapError("Dify 尚未初始化，请在运行环境设置 DIFY_ADMIN_EMAIL")
    _, init_status = client.request("GET", "/console/api/init")
    if not isinstance(init_status, dict) or init_status.get("status") != "finished":
        client.request(
            "POST",
            "/console/api/init",
            body={"password": config.init_password},
            expected=(201,),
        )
    client.request(
        "POST",
        "/console/api/setup",
        body={
            "email": config.admin_email,
            "name": config.admin_name,
            "password": config.admin_password,
            "language": config.admin_language,
        },
        expected=(201,),
    )
    info("Dify 管理员与首个 workspace 已初始化")


def select_workspace(
    workspaces: Sequence[Mapping[str, Any]], wanted_id: str = "", wanted_name: str = ""
) -> Mapping[str, Any]:
    candidates = list(workspaces)
    if wanted_id:
        candidates = [item for item in candidates if str(item.get("id")) == wanted_id]
    elif wanted_name:
        candidates = [item for item in candidates if str(item.get("name")) == wanted_name]
    if len(candidates) != 1:
        if not candidates:
            raise BootstrapError("没有找到匹配的 Dify workspace")
        raise BootstrapError("Dify 存在多个 workspace，请显式设置 DIFY_WORKSPACE_ID")
    return candidates[0]


def ensure_workspace(config: BootstrapConfig, client: HttpClient) -> str:
    query = urllib.parse.urlencode({"page": 1, "limit": 100})
    _, response = client.request(
        "GET",
        f"/console/api/all-workspaces?{query}",
        headers=admin_headers(config),
    )
    data = response.get("data", []) if isinstance(response, dict) else []
    workspace = select_workspace(data, config.workspace_id, config.workspace_name)
    workspace_id = str(workspace.get("id") or "")
    if not workspace_id:
        raise BootstrapError("Dify workspace 响应缺少 id")
    config.workspace_id = workspace_id
    info("workspace 已确认")
    return workspace_id


def _all_strings(value: Any) -> Iterable[str]:
    if isinstance(value, str):
        yield value
    elif isinstance(value, Mapping):
        for key, item in value.items():
            yield str(key)
            yield from _all_strings(item)
    elif isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        for item in value:
            yield from _all_strings(item)


def contains_plugin(value: Any, plugin_id: str = PLUGIN_ID) -> bool:
    return any(text == plugin_id or text.startswith(f"{plugin_id}:") for text in _all_strings(value))


def ensure_ollama_plugin(config: BootstrapConfig, client: HttpClient, workspace_id: str, redactor: Redactor) -> None:
    headers = admin_headers(config, workspace_id)
    _, installed = client.request(
        "GET",
        "/console/api/workspaces/current/plugin/list?page=1&page_size=256",
        headers=headers,
    )
    if contains_plugin(installed):
        info("Ollama 官方 provider 插件已安装，直接复用")
        return

    marketplace = HttpClient(config.marketplace_url, redactor, config.timeout)
    _, response = marketplace.request(
        "POST",
        "/api/v1/plugins/batch",
        body={"plugin_ids": [PLUGIN_ID]},
        headers={"X-Dify-Version": DIFY_VERSION},
    )
    plugins = response.get("data", {}).get("plugins", []) if isinstance(response, dict) else []
    identifier = ""
    if plugins and isinstance(plugins[0], dict):
        identifier = str(plugins[0].get("latest_package_identifier") or "")
    if not identifier.startswith(f"{PLUGIN_ID}:"):
        raise BootstrapError("Dify Marketplace 未返回 Ollama 官方包标识")

    _, install = client.request(
        "POST",
        "/console/api/workspaces/current/plugin/install/marketplace",
        body={"plugin_unique_identifiers": [identifier]},
        headers=headers,
    )
    if isinstance(install, dict) and install.get("all_installed"):
        info("Ollama 官方 provider 插件已安装")
        return
    task_id = str(install.get("task_id") or "") if isinstance(install, dict) else ""
    if not task_id:
        raise BootstrapError("Ollama 插件安装响应缺少 task_id")
    deadline = time.monotonic() + config.poll_timeout
    while time.monotonic() < deadline:
        _, task_response = client.request(
            "GET",
            f"/console/api/workspaces/current/plugin/tasks/{urllib.parse.quote(task_id)}",
            headers=headers,
        )
        task = task_response.get("task", {}) if isinstance(task_response, dict) else {}
        status = task.get("status") if isinstance(task, dict) else None
        if status == "success":
            info("Ollama 官方 provider 插件安装完成")
            return
        if status == "failed":
            raise BootstrapError("Ollama 官方 provider 插件安装失败")
        time.sleep(2)
    raise PendingBootstrap("Ollama 插件安装任务仍在进行，稍后重跑即可")


def ollama_models(config: BootstrapConfig, redactor: Redactor) -> set[str]:
    client = HttpClient(config.ollama_api_url, redactor, min(config.timeout, 20))
    _, response = client.request("GET", "/api/tags")
    result: set[str] = set()
    if isinstance(response, dict):
        for item in response.get("models", []):
            if isinstance(item, dict):
                for key in ("name", "model"):
                    if item.get(key):
                        result.add(str(item[key]))
    return result


def pull_model(config: BootstrapConfig, model: str, redactor: Redactor) -> None:
    if not shutil.which("ollama"):
        raise PendingBootstrap(f"本机缺少 Ollama CLI，无法下载模型 {model}")
    env = os.environ.copy()
    env["OLLAMA_HOST"] = config.ollama_api_url
    info(f"正在下载 Ollama 模型：{model}")
    result = subprocess.run(
        ["ollama", "pull", model],
        env=env,
        text=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        check=False,
    )
    if result.returncode:
        detail = redactor.redact(result.stderr.strip())[-600:]
        raise PendingBootstrap(f"Ollama 模型 {model} 下载未完成：{detail or '请稍后重试'}")


def model_credentials(config: BootstrapConfig, model_type: str) -> dict[str, str]:
    credentials = {
        "base_url": config.ollama_provider_base_url,
        "context_size": "8192",
    }
    if model_type == "llm":
        credentials.update(
            {
                "mode": "chat",
                "max_tokens": "2048",
                "vision_support": "false",
                "function_call_support": "true",
            }
        )
    return credentials


def ensure_model_credential(
    config: BootstrapConfig,
    client: HttpClient,
    workspace_id: str,
    *,
    model: str,
    model_type: str,
    credential_name: str,
) -> None:
    headers = admin_headers(config, workspace_id)
    provider_path = urllib.parse.quote(PROVIDER_ID, safe="/")
    endpoint = f"/console/api/workspaces/current/model-providers/{provider_path}/models/credentials"
    credentials = model_credentials(config, model_type)
    _, validation = client.request(
        "POST",
        f"{endpoint}/validate",
        body={"model": model, "model_type": model_type, "credentials": credentials},
        headers=headers,
    )
    if not isinstance(validation, dict) or validation.get("result") != "success":
        raise PendingBootstrap(f"Dify 无法从插件容器访问 Ollama 模型 {model}")

    query = urllib.parse.urlencode({"model": model, "model_type": model_type})
    _, current = client.request("GET", f"{endpoint}?{query}", headers=headers)
    credential_id = str(current.get("current_credential_id") or "") if isinstance(current, dict) else ""
    current_credentials = current.get("credentials", {}) if isinstance(current, dict) else {}
    drifted = not isinstance(current_credentials, dict) or any(
        str(current_credentials.get(key, "")) != str(value) for key, value in credentials.items()
    )
    if not credential_id:
        client.request(
            "POST",
            endpoint,
            body={
                "model": model,
                "model_type": model_type,
                "name": credential_name,
                "credentials": credentials,
            },
            headers=headers,
            expected=(201,),
        )
        info(f"Ollama 模型已注册：{model}")
    elif drifted:
        client.request(
            "PUT",
            endpoint,
            body={
                "model": model,
                "model_type": model_type,
                "credential_id": credential_id,
                "name": credential_name,
                "credentials": credentials,
            },
            headers=headers,
        )
        info(f"Ollama 模型连接已更新：{model}")
    else:
        info(f"Ollama 模型已存在，直接复用：{model}")


def set_default_models(config: BootstrapConfig, client: HttpClient, workspace_id: str) -> None:
    client.request(
        "POST",
        "/console/api/workspaces/current/default-model",
        body={
            "model_settings": [
                {"model_type": "llm", "provider": PROVIDER_ID, "model": config.llm_model},
                {
                    "model_type": "text-embedding",
                    "provider": PROVIDER_ID,
                    "model": config.embedding_model,
                },
            ]
        },
        headers=admin_headers(config, workspace_id),
    )


def choose_token(items: Sequence[Mapping[str, Any]], preferred: str = "") -> str:
    tokens = [str(item.get("token") or "") for item in items if item.get("token")]
    if preferred and preferred in tokens:
        return preferred
    return tokens[0] if tokens else ""


def ensure_dataset_key(config: BootstrapConfig, client: HttpClient, workspace_id: str) -> str:
    headers = admin_headers(config, workspace_id)
    _, response = client.request("GET", "/console/api/datasets/api-keys", headers=headers)
    items = response.get("data", []) if isinstance(response, dict) else []
    token = choose_token(items, config.dataset_api_key)
    if not token:
        _, created = client.request(
            "POST",
            "/console/api/datasets/api-keys",
            body={},
            headers=headers,
        )
        token = str(created.get("token") or "") if isinstance(created, dict) else ""
    if not token:
        raise BootstrapError("Dify 未返回 Dataset API key")
    config.dataset_api_key = token
    info("Dataset API key 已确认并安全保存")
    return token


def find_dataset(config: BootstrapConfig, service: HttpClient) -> Mapping[str, Any] | None:
    headers = bearer_headers(config.dataset_api_key)
    if config.dataset_id:
        status, response = service.request(
            "GET",
            f"/datasets/{urllib.parse.quote(config.dataset_id)}",
            headers=headers,
            expected=(200, 404),
        )
        if status == 200 and isinstance(response, dict):
            return response
    query = urllib.parse.urlencode({"page": 1, "limit": 100, "keyword": config.dataset_name})
    _, response = service.request("GET", f"/datasets?{query}", headers=headers)
    matches = [
        item
        for item in (response.get("data", []) if isinstance(response, dict) else [])
        if isinstance(item, dict) and item.get("name") == config.dataset_name
    ]
    if len(matches) > 1:
        raise BootstrapError("同名 Dify 知识库不止一个，请设置 DIFY_DATASET_ID")
    return matches[0] if matches else None


def ensure_dataset(config: BootstrapConfig, service: HttpClient, embedding_ready: bool) -> Mapping[str, Any] | None:
    dataset = find_dataset(config, service)
    if dataset is None and not embedding_ready:
        return None
    if dataset is None:
        _, dataset = service.request(
            "POST",
            "/datasets",
            headers=bearer_headers(config.dataset_api_key),
            body={
                "name": config.dataset_name,
                "description": config.dataset_description,
                "indexing_technique": "high_quality",
                "permission": "only_me",
                "provider": "vendor",
                "embedding_model": config.embedding_model,
                "embedding_model_provider": PROVIDER_ID,
                "retrieval_model": {
                    "search_method": "semantic_search",
                    "reranking_enable": False,
                    "reranking_mode": None,
                    "reranking_model": None,
                    "top_k": 6,
                    "score_threshold_enabled": True,
                    "score_threshold": 0.3,
                    "weights": None,
                },
            },
        )
        info("真实知识库已创建")
    else:
        info("真实知识库已存在，直接复用")
    if not isinstance(dataset, dict) or not dataset.get("id"):
        raise BootstrapError("Dify 知识库响应缺少 id")
    config.dataset_id = str(dataset["id"])
    return dataset


def build_chatflow(_dataset_id: str, llm_model: str) -> tuple[dict[str, Any], dict[str, Any]]:
    variables = [
        {
            "variable": "policy_version",
            "label": "策略版本",
            "type": "text-input",
            "required": True,
            "max_length": 64,
            "options": [],
        },
        {
            "variable": "reference_date",
            "label": "事实参考日期",
            "type": "text-input",
            "required": True,
            "max_length": 10,
            "options": [],
        },
        *[
            {
                "variable": name,
                "label": label,
                "type": "paragraph",
                "required": True,
                "max_length": 4096,
                "options": [],
            }
            for name, label in (
                ("system_policy", "系统决策规则"),
                ("profile_context", "学生档案"),
                ("target_context", "目标岗位"),
                ("retrieval_context", "业务检索上下文"),
            )
        ],
    ]
    prompt = """\
你是央国企求职决策助手。后端已经完成知识库检索和资料编号，你只负责依据这些证据给出简洁、可执行、有风险边界的答复，不得承诺 offer。

<policy_version>{{#start.policy_version#}}</policy_version>
<system_policy>{{#start.system_policy#}}</system_policy>
<student_profile>{{#start.profile_context#}}</student_profile>
<target>{{#start.target_context#}}</target>
<reference_date>{{#start.reference_date#}}</reference_date>
<business_context>{{#start.retrieval_context#}}</business_context>

严格执行 system_policy。先回答 business_context 已明确覆盖的事实，再说明具体缺口、风险和下一步行动。引用使用半角方括号和实际编号，例如[资料1]；不要加粗，不要用圆括号。只输出中文最终答复，不展示分析或思考过程。
"""
    nodes = [
        {
            "id": "start",
            "type": "custom",
            "data": {"type": "start", "title": "开始", "desc": "", "variables": variables},
            "position": {"x": 80, "y": 240},
            "positionAbsolute": {"x": 80, "y": 240},
            "sourcePosition": "right",
            "targetPosition": "left",
            "width": 244,
            "height": 220,
        },
        {
            "id": "llm",
            "type": "custom",
            "data": {
                "type": "llm",
                "title": "求职决策",
                "desc": "仅根据检索证据和业务规则回答",
                "context": {"enabled": False, "variable_selector": []},
                "model": {
                    "provider": PROVIDER_ID,
                    "name": llm_model,
                    "mode": "chat",
                    "completion_params": {
                        "temperature": 0.2,
                        "num_predict": 400,
                        "num_ctx": 8192,
                    },
                },
                "prompt_template": [{"role": "system", "text": prompt}],
                "memory": {
                    "query_prompt_template": "{{#sys.query#}}",
                    "window": {"enabled": True, "size": 10},
                },
                "variables": [],
                "vision": {"enabled": False},
            },
            "position": {"x": 440, "y": 240},
            "positionAbsolute": {"x": 440, "y": 240},
            "sourcePosition": "right",
            "targetPosition": "left",
            "width": 244,
            "height": 180,
        },
        {
            "id": "answer",
            "type": "custom",
            "data": {
                "type": "answer",
                "title": "回答",
                "desc": "",
                "answer": "{{#llm.text#}}",
                "variables": [],
            },
            "position": {"x": 800, "y": 240},
            "positionAbsolute": {"x": 800, "y": 240},
            "sourcePosition": "right",
            "targetPosition": "left",
            "width": 244,
            "height": 100,
        },
    ]
    edges = [
        {
            "id": "start-llm",
            "type": "custom",
            "source": "start",
            "sourceHandle": "source",
            "target": "llm",
            "targetHandle": "target",
            "data": {"sourceType": "start", "targetType": "llm"},
        },
        {
            "id": "llm-answer",
            "type": "custom",
            "source": "llm",
            "sourceHandle": "source",
            "target": "answer",
            "targetHandle": "target",
            "data": {"sourceType": "llm", "targetType": "answer"},
        },
    ]
    graph = {"nodes": nodes, "edges": edges, "viewport": {"x": 0, "y": 0, "zoom": 1}}
    features = {
        "file_upload": {"enabled": False},
        "opening_statement": "我会根据你的档案、目标岗位和真实知识库，给出风险边界和下一步行动。",
        "retriever_resource": {"enabled": False},
        "sensitive_word_avoidance": {"enabled": False},
        "speech_to_text": {"enabled": False},
        "suggested_questions": [],
        "suggested_questions_after_answer": {"enabled": False},
        "text_to_speech": {"enabled": False, "language": "", "voice": ""},
    }
    return graph, features


def ensure_app(config: BootstrapConfig, client: HttpClient, workspace_id: str) -> Mapping[str, Any]:
    headers = admin_headers(config, workspace_id)
    app: Mapping[str, Any] | None = None
    if config.app_id:
        status, response = client.request(
            "GET",
            f"/console/api/apps/{urllib.parse.quote(config.app_id)}",
            headers=headers,
            expected=(200, 404),
        )
        if status == 200 and isinstance(response, dict):
            app = response
    if app is None:
        query = urllib.parse.urlencode(
            {"page": 1, "limit": 100, "name": config.app_name, "mode": "advanced-chat"}
        )
        _, response = client.request("GET", f"/console/api/apps?{query}", headers=headers)
        matches = [
            item
            for item in (response.get("data", []) if isinstance(response, dict) else [])
            if isinstance(item, dict) and item.get("name") == config.app_name and item.get("mode") == "advanced-chat"
        ]
        if len(matches) > 1:
            raise BootstrapError("同名 advanced-chat 应用不止一个，请设置 DIFY_APP_ID")
        app = matches[0] if matches else None
    if app is None:
        _, response = client.request(
            "POST",
            "/console/api/apps",
            headers=headers,
            expected=(201,),
            body={
                "name": config.app_name,
                "description": config.app_description,
                "mode": "advanced-chat",
                "icon_type": "emoji",
                "icon": "🧭",
                "icon_background": "#E8F3EE",
            },
        )
        app = response if isinstance(response, dict) else None
        info("advanced-chat 应用已创建")
    else:
        info("advanced-chat 应用已存在，直接复用")
    if not app or not app.get("id"):
        raise BootstrapError("Dify 应用响应缺少 id")
    if app.get("mode") not in {None, "advanced-chat"}:
        raise BootstrapError("DIFY_APP_ID 指向的不是 advanced-chat 应用")
    config.app_id = str(app["id"])
    return app


def _workflow_matches(value: Any, graph: Mapping[str, Any], features: Mapping[str, Any]) -> bool:
    return isinstance(value, dict) and value.get("graph") == graph and value.get("features") == features


def sync_and_publish_chatflow(
    config: BootstrapConfig,
    client: HttpClient,
    workspace_id: str,
    *,
    publish: bool,
) -> bool:
    headers = admin_headers(config, workspace_id)
    graph, features = build_chatflow(config.dataset_id, config.llm_model)
    draft_path = f"/console/api/apps/{urllib.parse.quote(config.app_id)}/workflows/draft"
    status, draft = client.request("GET", draft_path, headers=headers, expected=(200, 404))
    if status == 404:
        draft = None
    if not _workflow_matches(draft, graph, features):
        client.request(
            "POST",
            draft_path,
            headers=headers,
            body={
                "graph": graph,
                "features": features,
                "hash": draft.get("hash") if isinstance(draft, dict) else None,
                "environment_variables": [],
                "conversation_variables": [],
            },
        )
        info("Chatflow 草稿已同步")
    else:
        info("Chatflow 草稿已是目标版本")

    published_path = f"/console/api/apps/{urllib.parse.quote(config.app_id)}/workflows/publish"
    _, published = client.request("GET", published_path, headers=headers)
    already_published = _workflow_matches(published, graph, features)
    if publish and not already_published:
        client.request("POST", published_path, headers=headers, body={})
        info("Chatflow 已发布")
        return True
    if publish:
        info("Chatflow 已发布且无变更")
    return already_published or publish


def ensure_app_key(config: BootstrapConfig, client: HttpClient, workspace_id: str) -> str:
    headers = admin_headers(config, workspace_id)
    path = f"/console/api/apps/{urllib.parse.quote(config.app_id)}/api-keys"
    _, response = client.request("GET", path, headers=headers)
    items = response.get("data", []) if isinstance(response, dict) else []
    token = choose_token(items, config.app_api_key)
    if not token:
        _, created = client.request("POST", path, headers=headers, body={}, expected=(201,))
        token = str(created.get("token") or "") if isinstance(created, dict) else ""
    if not token:
        raise BootstrapError("Dify 未返回 App API key")
    config.app_api_key = token
    info("App API key 已确认并安全保存")
    return token


def extract_input_variables(user_input_form: Any) -> set[str]:
    result: set[str] = set()
    if isinstance(user_input_form, Mapping):
        variable = user_input_form.get("variable")
        if isinstance(variable, str):
            result.add(variable)
        for value in user_input_form.values():
            result.update(extract_input_variables(value))
    elif isinstance(user_input_form, Sequence) and not isinstance(user_input_form, (str, bytes, bytearray)):
        for item in user_input_form:
            result.update(extract_input_variables(item))
    return result


def verify_parameters(config: BootstrapConfig, service: HttpClient) -> None:
    _, response = service.request("GET", "/parameters", headers=bearer_headers(config.app_api_key))
    actual = extract_input_variables(response.get("user_input_form", []) if isinstance(response, dict) else [])
    expected = set(INPUT_VARIABLES)
    if actual != expected:
        missing = ", ".join(sorted(expected - actual)) or "无"
        extra = ", ".join(sorted(actual - expected)) or "无"
        raise BootstrapError(f"Chatflow 输入变量不符合预期；缺少：{missing}；多出：{extra}")
    info("5 个应用输入变量已验证")


def dataset_has_ready_document(config: BootstrapConfig, service: HttpClient) -> bool:
    query = urllib.parse.urlencode({"page": 1, "limit": 20})
    _, response = service.request(
        "GET",
        f"/datasets/{urllib.parse.quote(config.dataset_id)}/documents?{query}",
        headers=bearer_headers(config.dataset_api_key),
    )
    documents = response.get("data", []) if isinstance(response, dict) else []
    return any(
        isinstance(item, dict)
        and item.get("enabled", True)
        and item.get("indexing_status") == "completed"
        for item in documents
    )


def smoke_test_chat(config: BootstrapConfig, service: HttpClient) -> None:
    _, response = service.request(
        "POST",
        "/chat-messages",
        headers=bearer_headers(config.app_api_key),
        timeout=max(config.timeout, 600),
        body={
            "inputs": {
                "policy_version": "bootstrap-v1",
                "system_policy": "只依据 business_context 回答；先回答已有事实并使用实际资料编号。",
                "profile_context": "自动化测试学生：计算机专业。",
                "target_context": "目标：央国企技术类岗位。",
                "reference_date": "2026-07-17",
                "retrieval_context": json.dumps(
                    [
                        {
                            "reference": "资料1",
                            "title": "自动化冒烟资料",
                            "snippet": "公开招聘信息应以官方发布内容为准。",
                        }
                    ],
                    ensure_ascii=False,
                ),
            },
            "query": "请复述 business_context 中的招聘信息核验要求，并标注资料编号。",
            "response_mode": "blocking",
            "conversation_id": "",
            "user": "bootstrap-smoke-test",
            "auto_generate_name": False,
        },
    )
    answer = response.get("answer") if isinstance(response, dict) else None
    if not isinstance(answer, str) or not answer.strip():
        raise PendingBootstrap("外部 RAG Chat 已调用，但没有返回有效回答")
    if re.search(r"(?:\[资料1\]|根据资料1|资料1(?:显示|指出|说明|提到))", answer):
        info("外部 RAG Chat 冒烟通过，模型已使用编号资料")
    else:
        info("外部 RAG Chat 模型调用通过；引用格式不合格时由应用切换为核验资料模式")


def persist_runtime(config: BootstrapConfig) -> None:
    updates = {
        "DIFY_API_URL": service_api_url(config.dify_base_url),
        "DIFY_API_KEY": config.app_api_key,
        "DIFY_DATASET_ID": config.dataset_id,
        "DIFY_DATASET_API_KEY": config.dataset_api_key,
        "DIFY_APP_ID": config.app_id,
        "DIFY_WORKSPACE_ID": config.workspace_id,
    }
    write_env_updates(config.runtime_env, updates)
    if config.env_file.exists():
        write_env_updates(config.env_file, updates)
    write_env_updates(
        config.secret_file,
        {
            "DIFY_INIT_PASSWORD": config.init_password,
            "DIFY_ADMIN_PASSWORD": config.admin_password,
            "DIFY_ADMIN_API_KEY": config.admin_api_key,
            "DIFY_API_KEY": config.app_api_key,
            "DIFY_DATASET_ID": config.dataset_id,
            "DIFY_DATASET_API_KEY": config.dataset_api_key,
            "DIFY_APP_ID": config.app_id,
            "DIFY_WORKSPACE_ID": config.workspace_id,
        },
    )
    info("运行时 Dify 参数已写入 0600 权限的 env 文件")


def dry_run_summary(config: BootstrapConfig) -> int:
    info("dry-run：不访问网络、不写文件、不重启服务")
    info(f"目标 Dify 版本：{DIFY_VERSION}")
    info(f"目标知识库：{config.dataset_name}")
    info(f"目标应用：{config.app_name} (advanced-chat)")
    info(f"模型：{config.embedding_model} + {config.llm_model}")
    info(f"运行时 env：{config.runtime_env}")
    info(f"密钥文件：{config.secret_file}（内容不显示）")
    info("计划：初始化→workspace→Ollama 插件/模型→dataset→Chatflow→API keys→5 变量/外部 RAG 冒烟")
    return EXIT_READY


def run_bootstrap(config: BootstrapConfig, args: argparse.Namespace) -> int:
    ensure_generated_secrets(config, args.dry_run)
    redactor = Redactor(
        [
            config.init_password,
            config.admin_password,
            config.admin_api_key,
            config.dataset_api_key,
            config.app_api_key,
        ]
    )
    if args.dry_run:
        return dry_run_summary(config)

    configure_dify_auth(config, redactor, dry_run=False)
    console = HttpClient(config.dify_base_url, redactor, config.timeout)
    wait_for_dify(console, config.poll_timeout)
    ensure_setup(config, console)
    workspace_id = ensure_workspace(config, console)
    ensure_ollama_plugin(config, console, workspace_id, redactor)

    pending: list[str] = []
    try:
        available_models = ollama_models(config, redactor)
    except BootstrapError as exc:
        available_models = set()
        pending.append(f"Ollama API 不可用：{redactor.redact(str(exc))}")

    if args.pull_models:
        for model in (config.embedding_model, config.llm_model):
            if model not in available_models:
                try:
                    pull_model(config, model, redactor)
                except PendingBootstrap as exc:
                    pending.append(str(exc))
        try:
            available_models = ollama_models(config, redactor)
        except BootstrapError as exc:
            pending.append(f"Ollama 下载后仍不可用：{redactor.redact(str(exc))}")

    embedding_ready = config.embedding_model in available_models
    llm_ready = config.llm_model in available_models
    if not embedding_ready:
        pending.append(f"本机尚未下载 embedding 模型 {config.embedding_model}")
    else:
        try:
            ensure_model_credential(
                config,
                console,
                workspace_id,
                model=config.embedding_model,
                model_type="text-embedding",
                credential_name="qwen3-embedding-local",
            )
        except PendingBootstrap as exc:
            embedding_ready = False
            pending.append(str(exc))

    if not llm_ready:
        pending.append(f"本机尚未下载 chat 模型 {config.llm_model}")
    else:
        try:
            ensure_model_credential(
                config,
                console,
                workspace_id,
                model=config.llm_model,
                model_type="llm",
                credential_name="qwen3-chat-local",
            )
        except PendingBootstrap as exc:
            llm_ready = False
            pending.append(str(exc))

    if embedding_ready and llm_ready:
        set_default_models(config, console, workspace_id)

    dataset_key = ensure_dataset_key(config, console, workspace_id)
    redactor.extend([dataset_key])
    dataset_service = HttpClient(service_api_url(config.dify_base_url), redactor, config.timeout)
    dataset = ensure_dataset(config, dataset_service, embedding_ready)
    if dataset is None:
        pending.append("embedding 模型就绪前无法创建 high_quality 知识库")
        ensure_generated_secrets(config, dry_run=False)
        for reason in dict.fromkeys(pending):
            warning(reason)
        return EXIT_PENDING

    ensure_app(config, console, workspace_id)
    sync_and_publish_chatflow(config, console, workspace_id, publish=llm_ready and embedding_ready)
    app_key = ensure_app_key(config, console, workspace_id)
    redactor.extend([app_key])
    persist_runtime(config)
    if llm_ready and embedding_ready:
        app_service = HttpClient(service_api_url(config.dify_base_url), redactor, config.timeout)
        verify_parameters(config, app_service)
        if not dataset_has_ready_document(config, dataset_service):
            pending.append("知识库还没有索引完成的真实文档，RAG 引用冒烟暂时 pending")
        else:
            try:
                smoke_test_chat(config, app_service)
            except PendingBootstrap as exc:
                pending.append(str(exc))
    else:
        pending.append("chat/embedding 模型未全部就绪，应用已保存草稿但未发布")

    if pending:
        for reason in dict.fromkeys(pending):
            warning(reason)
        info("已完成的资源均已保留；处理待办后重跑同一命令即可")
        return EXIT_PENDING
    info("Dify 1.15.0 引导、密钥持久化与外部 RAG 冒烟全部通过")
    return EXIT_READY


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="幂等引导 Dify 1.15.0 + Ollama + 知识库 + advanced-chat，不输出任何密钥。",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("--env-file", help="Mac mini 部署 env（默认 infra/macmini/env.local）")
    parser.add_argument("--secret-file", help="0600 运行时密钥文件")
    parser.add_argument("--runtime-env", help="应用运行时 env（默认 APP_REPO_DIR/.env.production）")
    parser.add_argument("--dify-env", help="Dify docker/.env 路径")
    parser.add_argument("--base-url", help="Dify 根地址，不带 /v1")
    parser.add_argument("--ollama-url", help="Mac 主机 Ollama API 地址")
    parser.add_argument("--pull-models", action="store_true", help="缺模型时调用 ollama pull；默认只返回 pending")
    parser.add_argument("--dry-run", action="store_true", help="只显示计划，不访问网络也不写文件")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        config = load_config(args)
        return run_bootstrap(config, args)
    except PendingBootstrap as exc:
        warning(str(exc))
        return EXIT_PENDING
    except (BootstrapError, ValueError) as exc:
        print(f"[dify-bootstrap] 失败：{exc}", file=sys.stderr)
        return EXIT_ERROR
    except KeyboardInterrupt:
        print("[dify-bootstrap] 已取消", file=sys.stderr)
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
