#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_lib.sh
source "$SCRIPT_DIR/_lib.sh"

TESSDATA_VERSION="4.1.0"
CHI_SIM_SHA256="a5fcb6f0db1e1d6d8522f39db4e848f05984669172e584e8d76b6b3141e1f730"
CHI_SIM_URL="https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/${TESSDATA_VERSION}/chi_sim.traineddata"
TESSERACT_BIN="${KB_TESSERACT_PATH:-$(command -v tesseract || true)}"
TESSDATA_DIR="${KB_TESSDATA_DIR:-$HOME/.local/share/tokensoff/tessdata}"
SYSTEM_TESSDATA_DIR="${KB_SYSTEM_TESSDATA_DIR:-/opt/homebrew/share/tessdata}"
VISION_OCR_SOURCE="$SCRIPT_DIR/vision-ocr.swift"
VISION_OCR_TARGET="${KB_VISION_OCR_PATH:-$HOME/.local/bin/tokensoff-vision-ocr}"

[[ -n "$TESSERACT_BIN" && -x "$TESSERACT_BIN" ]] || die "没有找到可执行的 Tesseract：${TESSERACT_BIN:-未配置}"
require_command curl
require_command shasum
require_command install

mkdir -p "$TESSDATA_DIR"
chmod 700 "$TESSDATA_DIR"

verify_sha256() {
  local file="$1"
  local expected="$2"
  local actual
  actual="$(shasum -a 256 "$file" | awk '{print $1}')"
  [[ "$actual" == "$expected" ]] || die "OCR 中文模型 checksum 不匹配：$file"
}

chi_sim_target="$TESSDATA_DIR/chi_sim.traineddata"
if [[ -f "$chi_sim_target" ]]; then
  verify_sha256 "$chi_sim_target" "$CHI_SIM_SHA256"
  log "OCR 中文模型已存在且 checksum 正确"
else
  temp_file="$(mktemp "$TESSDATA_DIR/.chi_sim.XXXXXX")"
  trap 'rm -f "${temp_file:-}"' EXIT
  log "下载固定版本 OCR 中文模型：tessdata_fast $TESSDATA_VERSION"
  curl \
    --fail \
    --location \
    --proto '=https' \
    --tlsv1.2 \
    --retry 3 \
    --connect-timeout 15 \
    --max-time 180 \
    --output "$temp_file" \
    "$CHI_SIM_URL"
  verify_sha256 "$temp_file" "$CHI_SIM_SHA256"
  install -m 644 "$temp_file" "$chi_sim_target"
  rm -f "$temp_file"
  trap - EXIT
fi

eng_target="$TESSDATA_DIR/eng.traineddata"
if [[ ! -s "$eng_target" ]]; then
  eng_source="$SYSTEM_TESSDATA_DIR/eng.traineddata"
  [[ -s "$eng_source" ]] || die "没有找到 Tesseract 英文模型：$eng_source"
  install -m 644 "$eng_source" "$eng_target"
  log "已复制 Tesseract 英文模型到项目私有 tessdata 目录"
fi

languages="$($TESSERACT_BIN --tessdata-dir "$TESSDATA_DIR" --list-langs 2>/dev/null)"
grep -qx "chi_sim" <<<"$languages" || die "Tesseract 未识别 chi_sim 模型"
grep -qx "eng" <<<"$languages" || die "Tesseract 未识别 eng 模型"

if [[ "$(uname -s)" == "Darwin" ]] && command -v swiftc >/dev/null 2>&1; then
  [[ -f "$VISION_OCR_SOURCE" ]] || die "缺少 Apple Vision OCR 源码：$VISION_OCR_SOURCE"
  mkdir -p "$(dirname "$VISION_OCR_TARGET")"
  chmod 700 "$(dirname "$VISION_OCR_TARGET")"
  if [[ ! -x "$VISION_OCR_TARGET" || "$VISION_OCR_SOURCE" -nt "$VISION_OCR_TARGET" ]]; then
    temp_binary="$(mktemp "$(dirname "$VISION_OCR_TARGET")/.vision-ocr.XXXXXX")"
    trap 'rm -f "${temp_file:-}" "${temp_binary:-}"' EXIT
    swiftc -O "$VISION_OCR_SOURCE" -o "$temp_binary"
    install -m 755 "$temp_binary" "$VISION_OCR_TARGET"
    rm -f "$temp_binary"
    trap - EXIT
    log "已编译 Apple Vision 高精度中文 OCR"
  else
    log "Apple Vision OCR 已是最新版本"
  fi
else
  warn "当前系统不能编译 Apple Vision OCR，将使用 Tesseract 兜底"
fi

log "知识库 OCR 已准备好：$TESSERACT_BIN / $TESSDATA_DIR"
