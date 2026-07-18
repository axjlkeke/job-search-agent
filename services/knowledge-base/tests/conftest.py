from __future__ import annotations

from pathlib import Path

from app.config import Settings


def make_settings(
    tmp_path: Path,
    *,
    api_key: str | None = None,
    dify: bool = False,
    ocr: bool = False,
) -> Settings:
    return Settings(
        database_path=tmp_path / "knowledge.db",
        api_key=api_key,
        dify_api_url="https://dify.example.test/v1" if dify else None,
        dify_dataset_id="dataset-test" if dify else None,
        dify_api_key="test-only-key" if dify else None,
        dify_timeout_seconds=1.0,
        fetch_timeout_seconds=1.0,
        max_fetch_bytes=1024 * 1024,
        user_agent="knowledge-base-test/1.0",
        allow_fake_ip_dns=False,
        proxy_url=None,
        vision_ocr_path=None,
        tesseract_path="/test/tesseract" if ocr else None,
        tessdata_dir=tmp_path / "tessdata" if ocr else None,
        ocr_timeout_seconds=1.0,
        ocr_max_images=3,
        ocr_trigger_chars=200,
    )
