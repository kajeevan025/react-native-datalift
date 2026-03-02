#!/usr/bin/env bash
# scripts/prepare-model.sh
#
# Prepares LayoutLMv3 model assets for distribution via GitHub Releases.
#
# What this script does
# ─────────────────────
# 1. Downloads microsoft/layoutlmv3-base from HuggingFace (or a fine-tuned fork)
# 2. Converts to CoreML (.mlpackage) for iOS   → via coremltools
# 3. Exports int8-quantized ONNX for Android   → via optimum / onnxruntime-tools
# 4. Downloads/generates labels.json + vocab.json
# 5. Packages each asset into the release-ready files expected by ModelManager.ts
#
# Requirements
# ─────────────────────
#   Python 3.9+
#   pip install transformers coremltools optimum onnxruntime torch
#   (macOS is required for CoreML conversion)
#
# Usage
# ─────
#   bash scripts/prepare-model.sh [MODEL_ID] [OUTPUT_DIR]
#
# Examples
#   bash scripts/prepare-model.sh                               # defaults below
#   bash scripts/prepare-model.sh microsoft/layoutlmv3-base ./dist/models
#
# After running, upload the files in OUTPUT_DIR as assets to a GitHub Release
# tagged "models-v1" on https://github.com/kajeevan025/react-native-datalift

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MODEL_ID="${1:-microsoft/layoutlmv3-base}"
OUTPUT_DIR="${2:-${ROOT_DIR}/dist/models}"
PYTHON="${PYTHON:-python3}"

echo ""
echo "┌──────────────────────────────────────────────────────────┐"
echo "│  DataLift – LayoutLMv3 model preparation                 │"
echo "│  Model  : ${MODEL_ID}"
echo "│  Output : ${OUTPUT_DIR}"
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
  echo "[WARN] CoreML conversion is only supported on macOS. The iOS model will be skipped."
  SKIP_IOS=1
else
  SKIP_IOS=0
fi

mkdir -p "${OUTPUT_DIR}/tmp"

# ── 1. Install Python dependencies ────────────────────────────────────────────

echo ""
echo "[1/5] Installing Python dependencies..."
"$PYTHON" -m pip install --quiet --upgrade \
  transformers \
  torch \
  onnx \
  onnxruntime \
  optimum[exporters] \
  ${SKIP_IOS:-coremltools}

# ── 2. Export to ONNX ─────────────────────────────────────────────────────────

echo ""
echo "[2/5] Exporting ${MODEL_ID} → ONNX..."
ONNX_DIR="${OUTPUT_DIR}/tmp/onnx"
mkdir -p "${ONNX_DIR}"

"$PYTHON" - <<PYEOF
from optimum.exporters.onnx import main_export
main_export(
    model_name_or_path="${MODEL_ID}",
    output="${ONNX_DIR}",
    task="token-classification",
    opset=14,
)
print("[optimum] ONNX export complete")
PYEOF

ONNX_SRC="${ONNX_DIR}/model.onnx"
if [ ! -f "${ONNX_SRC}" ]; then
  # Some exporters write to model_optimized.onnx
  ONNX_SRC=$(find "${ONNX_DIR}" -name "*.onnx" | head -1)
fi

if [ -z "${ONNX_SRC}" ]; then
  echo "ERROR: ONNX export produced no .onnx file in ${ONNX_DIR}"
  exit 1
fi
echo "[INFO] ONNX model at: ${ONNX_SRC}"

# ── 3. Quantize ONNX (int8) for Android ──────────────────────────────────────

echo ""
echo "[3/5] Quantizing ONNX → int8 for Android..."
ANDROID_MODEL="${OUTPUT_DIR}/layoutlmv3-base-doc-android.onnx"

"$PYTHON" - <<PYEOF
from onnxruntime.quantization import quantize_dynamic, QuantType
quantize_dynamic(
    model_input="${ONNX_SRC}",
    model_output="${ANDROID_MODEL}",
    weight_type=QuantType.QInt8,
)
print("[onnxruntime] int8 quantization complete → ${ANDROID_MODEL}")
PYEOF

# ── 4. Convert to CoreML for iOS ──────────────────────────────────────────────

if [[ "${SKIP_IOS}" == "0" ]]; then
  echo ""
  echo "[4/5] Converting ONNX → CoreML (.mlpackage) for iOS..."
  IOS_MODEL="${OUTPUT_DIR}/layoutlmv3-base-doc-coreml.mlpackage"

  "$PYTHON" - <<PYEOF
import coremltools as ct
import numpy as np

model = ct.convert(
    "${ONNX_SRC}",
    convert_to="mlprogram",
    minimum_deployment_target=ct.target.iOS16,
    compute_precision=ct.precision.FLOAT16,
    outputs=[ct.TensorType(name="logits")],
)
model.save("${IOS_MODEL}")
print("[coremltools] CoreML mlpackage saved → ${IOS_MODEL}")
PYEOF

  # Zip the .mlpackage (it is a directory bundle on disk)
  echo "[INFO] Zipping CoreML package..."
  cd "${OUTPUT_DIR}"
  zip -r "layoutlmv3-base-doc-coreml.mlpackage.zip" \
    "layoutlmv3-base-doc-coreml.mlpackage" \
    --quiet
  cd "${ROOT_DIR}"
  echo "[INFO] iOS zip: ${OUTPUT_DIR}/layoutlmv3-base-doc-coreml.mlpackage.zip"
else
  echo "[4/5] Skipping CoreML conversion (not macOS)"
fi

# ── 5. Export labels.json + vocab.json ────────────────────────────────────────

echo ""
echo "[5/5] Exporting labels.json and vocab.json..."

"$PYTHON" - <<PYEOF
import json, os
from transformers import AutoTokenizer, AutoConfig

cfg = AutoConfig.from_pretrained("${MODEL_ID}")
tok = AutoTokenizer.from_pretrained("${MODEL_ID}")

# labels.json  – id → label string mapping
id2label = cfg.id2label if hasattr(cfg, "id2label") and cfg.id2label else {
    "0": "O",
    "1": "B-HEADER", "2": "I-HEADER",
    "3": "B-QUESTION", "4": "I-QUESTION",
    "5": "B-ANSWER", "6": "I-ANSWER",
}
# Cast keys to ints for consistent ordering
id2label = {str(k): v for k, v in id2label.items()}

labels_path = os.path.join("${OUTPUT_DIR}", "labels.json")
with open(labels_path, "w") as f:
    json.dump(id2label, f, indent=2)
print(f"[labels] {len(id2label)} labels → {labels_path}")

# vocab.json  – token → id mapping (subset of full HF tokenizer)
vocab = tok.get_vocab()
vocab_path = os.path.join("${OUTPUT_DIR}", "vocab.json")
with open(vocab_path, "w") as f:
    json.dump(vocab, f)
print(f"[vocab] {len(vocab)} tokens → {vocab_path}")
PYEOF

# ── Summary ───────────────────────────────────────────────────────────────────

echo ""
echo "┌──────────────────────────────────────────────────────────────────┐"
echo "│  Prepared model assets                                           │"
echo "├──────────────────────────────────────────────────────────────────┤"
ls -lh "${OUTPUT_DIR}"/*.onnx "${OUTPUT_DIR}"/*.zip "${OUTPUT_DIR}"/*.json 2>/dev/null | \
  awk '{printf "│  %-60s  │\n", $NF " (" $5 ")"}' || true
echo "└──────────────────────────────────────────────────────────────────┘"
echo ""
echo "Next steps:"
echo "  1. Go to https://github.com/kajeevan025/react-native-datalift/releases"
echo "  2. Create a new release tagged 'models-v1'"
echo "  3. Upload ALL files from: ${OUTPUT_DIR}/"
echo "     • layoutlmv3-base-doc-android.onnx"
echo "     • layoutlmv3-base-doc-coreml.mlpackage.zip   (macOS only)"
echo "     • labels.json"
echo "     • vocab.json"
echo ""
echo "[DataLift] Done. Users can now call DataLift.prepareModel({ autoDownload: true })"
