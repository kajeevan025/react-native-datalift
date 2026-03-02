#!/usr/bin/env bash
# scripts/prepare-model.sh
#
# Prepares LayoutLMv3 model assets for distribution via GitHub Releases.
#
# What this script does (full pipeline)
# ─────────────────────────────────────
# 1. Fine-tunes microsoft/layoutlmv3-base on invoice/receipt data (CORD dataset)
#    → scripts/finetune-layoutlmv3.py  →  dist/finetuned/
# 2. Exports the fine-tuned model to int8 ONNX (Android) + CoreML (iOS)
#    → scripts/export-layoutlmv3.py   →  dist/models/
# 3. Final assets in dist/models/ are ready to upload to GitHub Release 'models-v1'
#
# Requirements
# ─────────────────────
#   Python 3.9+
#   pip install transformers torch datasets seqeval coremltools optimum[exporters] onnxruntime
#   (macOS is required for CoreML conversion)
#
# Usage
# ─────
#   bash scripts/prepare-model.sh [OPTIONS]
#
# Options
#   --skip-finetune      Skip training; use existing dist/finetuned/ model
#   --skip-ios           Skip CoreML (iOS) export
#   --skip-android       Skip ONNX int8 (Android) export
#   --epochs N           Number of fine-tuning epochs (default: 10)
#   --base-model ID      HuggingFace model ID to fine-tune (default: microsoft/layoutlmv3-base)
#   --finetune-dir DIR   Directory to save/load fine-tuned model (default: ./dist/finetuned)
#   --output-dir DIR     Directory to save release assets (default: ./dist/models)
#   --custom-data PATH   Path to custom JSON training data (optional)
#
# Examples
#   bash scripts/prepare-model.sh
#   bash scripts/prepare-model.sh --skip-finetune
#   bash scripts/prepare-model.sh --epochs 5 --skip-ios
#
# After running, upload ALL files in OUTPUT_DIR to a GitHub Release tagged 'models-v1'

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPTS_DIR="${ROOT_DIR}/scripts"
PYTHON="${PYTHON:-python3}"

# ── Parse arguments ───────────────────────────────────────────────────────────
SKIP_FINETUNE=0
SKIP_IOS=0
SKIP_ANDROID=0
EPOCHS=10
BASE_MODEL="microsoft/layoutlmv3-base"
FINETUNE_DIR="${ROOT_DIR}/dist/finetuned"
OUTPUT_DIR="${ROOT_DIR}/dist/models"
CUSTOM_DATA=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-finetune)  SKIP_FINETUNE=1 ; shift ;;
    --skip-ios)       SKIP_IOS=1      ; shift ;;
    --skip-android)   SKIP_ANDROID=1  ; shift ;;
    --epochs)         EPOCHS="$2"     ; shift 2 ;;
    --base-model)     BASE_MODEL="$2" ; shift 2 ;;
    --finetune-dir)   FINETUNE_DIR="$2"; shift 2 ;;
    --output-dir)     OUTPUT_DIR="$2" ; shift 2 ;;
    --custom-data)    CUSTOM_DATA="$2"; shift 2 ;;
    *) echo "[WARN] Unknown option: $1"; shift ;;
  esac
done

echo ""
echo "┌──────────────────────────────────────────────────────────┐"
echo "│  DataLift – LayoutLMv3 full pipeline                     │"
echo "│  Base model   : ${BASE_MODEL}"
echo "│  Finetune dir : ${FINETUNE_DIR}"
echo "│  Output dir   : ${OUTPUT_DIR}"
echo "│  Epochs       : ${EPOCHS}"
echo "└──────────────────────────────────────────────────────────┘"
echo ""

# ── 0. Sanity checks ──────────────────────────────────────────────────────────

if ! command -v "$PYTHON" &>/dev/null; then
  echo "ERROR: Python 3 not found. Install Python 3.9+ and re-run."
  exit 1
fi

PYTHON_VERSION=$("$PYTHON" -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
echo "[INFO] Using Python $PYTHON_VERSION at $("$PYTHON" -c "import sys; print(sys.executable)")"

if [[ "$(uname)" != "Darwin" ]]; then
  echo "[WARN] CoreML conversion is only supported on macOS. iOS model will be skipped."
  SKIP_IOS=1
fi

mkdir -p "${OUTPUT_DIR}"

# ── 1. Install Python dependencies ────────────────────────────────────────────

echo ""
echo "[1/3] Installing Python dependencies..."

CORE_DEPS="transformers torch datasets seqeval onnx onnxruntime 'optimum[exporters]'"
if [[ "${SKIP_IOS}" == "0" ]]; then
  CORE_DEPS="${CORE_DEPS} coremltools"
fi

"$PYTHON" -m pip install --quiet --upgrade ${CORE_DEPS}
echo "      Dependencies installed."

# ── 2. Fine-tune ──────────────────────────────────────────────────────────────

if [[ "${SKIP_FINETUNE}" == "1" ]]; then
  echo ""
  echo "[2/3] Skipping fine-tuning (--skip-finetune) — using: ${FINETUNE_DIR}"
  if [[ ! -d "${FINETUNE_DIR}" ]]; then
    echo "ERROR: --skip-finetune specified but ${FINETUNE_DIR} does not exist."
    echo "       Run without --skip-finetune first to train the model."
    exit 1
  fi
else
  echo ""
  echo "[2/3] Fine-tuning LayoutLMv3 on invoice/receipt data..."
  echo "      This may take 30-90 minutes on a GPU-equipped machine."
  echo ""

  FINETUNE_ARGS=(
    "$SCRIPTS_DIR/finetune-layoutlmv3.py"
    "--base-model" "${BASE_MODEL}"
    "--output-dir" "${FINETUNE_DIR}"
    "--epochs" "${EPOCHS}"
  )
  if [[ -n "${CUSTOM_DATA}" ]]; then
    FINETUNE_ARGS+=("--custom-data" "${CUSTOM_DATA}")
  fi

  "$PYTHON" "${FINETUNE_ARGS[@]}"
  echo ""
  echo "[INFO] Fine-tuned model saved to: ${FINETUNE_DIR}"
fi

# ── 3. Export models ──────────────────────────────────────────────────────────

echo ""
echo "[3/3] Exporting model assets for iOS + Android..."

EXPORT_ARGS=(
  "$SCRIPTS_DIR/export-layoutlmv3.py"
  "--model-dir"  "${FINETUNE_DIR}"
  "--output-dir" "${OUTPUT_DIR}"
)
if [[ "${SKIP_IOS}" == "1" ]];     then EXPORT_ARGS+=("--skip-ios");     fi
if [[ "${SKIP_ANDROID}" == "1" ]]; then EXPORT_ARGS+=("--skip-android"); fi

"$PYTHON" "${EXPORT_ARGS[@]}"

# ── Summary ───────────────────────────────────────────────────────────────────

echo ""
echo "┌──────────────────────────────────────────────────────────────────┐"
echo "│  Release assets ready                                            │"
echo "├──────────────────────────────────────────────────────────────────┤"
find "${OUTPUT_DIR}" -maxdepth 1 -type f | sort | while read -r fp; do
  fname=$(basename "$fp")
  size=$(du -sh "$fp" 2>/dev/null | cut -f1)
  printf "│  %-50s %8s  │\n" "${fname}" "${size}"
done
echo "└──────────────────────────────────────────────────────────────────┘"
echo ""
echo "Next steps:"
echo "  1. Go to https://github.com/kajeevan025/react-native-datalift/releases"
echo "  2. Create (or edit) release tagged 'models-v1'"
echo "  3. Upload ALL files from: ${OUTPUT_DIR}/"
echo "       • layoutlmv3-base-doc-android.onnx"
echo "       • layoutlmv3-base-doc-coreml.mlpackage.zip   (iOS)"
echo "       • labels.json"
echo "       • vocab.json"
echo ""
echo "  4. In your React Native app:"
echo "       DataLift.configure({ autoDownloadLayoutLMv3: true });"
echo "       await DataLift.prepareModel();"
echo ""
echo "[DataLift] Pipeline complete."
