from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit


def _optional(name: str) -> str | None:
    value = os.getenv(name, "").strip()
    return value or None


def _positive_int(name: str, default: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except ValueError:
        return default
    return value if value > 0 else default


def _positive_float(name: str, default: float) -> float:
    try:
        value = float(os.getenv(name, str(default)))
    except ValueError:
        return default
    return value if value > 0 else default


def _boolean(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().casefold() in {"1", "true", "yes", "on"}


def _local_proxy(name: str) -> str | None:
    value = _optional(name)
    if value is None:
        return None
    parts = urlsplit(value)
    if parts.scheme not in {"http", "https"} or parts.hostname not in {
        "127.0.0.1",
        "localhost",
        "::1",
    }:
        raise ValueError(f"{name} 只允许本机 http/https 代理")
    return value


@dataclass(frozen=True, slots=True)
class Settings:
    database_path: Path
    api_key: str | None
    dify_api_url: str | None
    dify_dataset_id: str | None
    dify_api_key: str | None
    dify_timeout_seconds: float
    fetch_timeout_seconds: float
    max_fetch_bytes: int
    user_agent: str
    allow_fake_ip_dns: bool
    proxy_url: str | None
    vision_ocr_path: str | None
    tesseract_path: str | None
    tessdata_dir: Path | None
    ocr_timeout_seconds: float
    ocr_max_images: int
    ocr_trigger_chars: int

    @property
    def dify_configured(self) -> bool:
        return bool(
            self.dify_api_url and self.dify_dataset_id and self.dify_api_key
        )

    @property
    def ocr_configured(self) -> bool:
        return bool(
            self.vision_ocr_path
            or (self.tesseract_path and self.tessdata_dir)
        )

    @classmethod
    def from_env(cls) -> "Settings":
        default_db = Path(__file__).resolve().parents[1] / "data" / "knowledge.db"
        return cls(
            database_path=Path(os.getenv("KB_DATABASE_PATH", str(default_db))).expanduser(),
            api_key=_optional("KB_API_KEY"),
            dify_api_url=_optional("DIFY_API_URL"),
            dify_dataset_id=_optional("DIFY_DATASET_ID"),
            dify_api_key=_optional("DIFY_DATASET_API_KEY") or _optional("DIFY_API_KEY"),
            dify_timeout_seconds=_positive_float("DIFY_TIMEOUT_SECONDS", 12.0),
            fetch_timeout_seconds=_positive_float("FETCH_TIMEOUT_SECONDS", 20.0),
            max_fetch_bytes=_positive_int("MAX_FETCH_BYTES", 10 * 1024 * 1024),
            user_agent=os.getenv(
                "KB_USER_AGENT",
                "JobSearchAgentKnowledgeBot/0.1 (+public-recruitment-research)",
            ).strip(),
            allow_fake_ip_dns=_boolean("KB_ALLOW_FAKE_IP_DNS", False),
            proxy_url=_local_proxy("KB_PROXY_URL"),
            vision_ocr_path=_optional("KB_VISION_OCR_PATH"),
            tesseract_path=_optional("KB_TESSERACT_PATH"),
            tessdata_dir=(
                Path(value).expanduser()
                if (value := _optional("KB_TESSDATA_DIR"))
                else None
            ),
            ocr_timeout_seconds=_positive_float("KB_OCR_TIMEOUT_SECONDS", 90.0),
            ocr_max_images=min(_positive_int("KB_OCR_MAX_IMAGES", 3), 10),
            ocr_trigger_chars=_positive_int("KB_OCR_TRIGGER_CHARS", 200),
        )
