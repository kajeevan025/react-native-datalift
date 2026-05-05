#!/usr/bin/env bash
# sync-models.sh
# ─────────────────────────────────────────────────────────────────────────────
# Syncs exported model artefacts from the datalift-model-training repo into
# the react-native-datalift plugin's datalift-models/ directory.
#
# Run this script after exporting new model files from the training repo:
#   cd datalift-model-training
#   python scripts/export-layoutlmv3.py --model-dir ./dist/finetuned --output-dir ./dist/models
#   cd ../react-native-datalift
#   bash scripts/sync-models.sh
#
# The script expects both repos to be siblings on the file system:
#   <parent>/
#     datalift-model-training/    ← training repo
#     react-native-datalift/      ← plugin repo  (this script lives here)
#
# You can override the training repo path:
#   TRAINING_REPO=/path/to/training bash scripts/sync-models.sh
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

PLUGIN_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TRAINING_REPO="${TRAINING_REPO:-"${PLUGIN_DIR}/../datalift-model-training"}"
MODELS_SRC="${TRAINING_REPO}/dist/models"
MODELS_DST="${PLUGIN_DIR}/datalift-models"

echo "=== DataLift Model Sync ==="
echo "  Training repo : ${TRAINING_REPO}"
echo "  Source        : ${MODELS_SRC}"
echo "  Destination   : ${MODELS_DST}"
echo ""

# Validate source directory
if [ ! -d "${MODELS_SRC}" ]; then
  echo "ERROR: Training models directory not found: ${MODELS_SRC}"
  echo ""
  echo "Run the export script first:"
  echo "  cd ${TRAINING_REPO}"
  echo "  python scripts/export-layoutlmv3.py --model-dir ./dist/finetuned --output-dir ./dist/models"
  exit 1
fi

mkdir -p "${MODELS_DST}"

# ── Required files ────────────────────────────────────────────────────────────
REQUIRED_FILES=(
  "labels.json"
  "vocab.json"
  "merges.txt"
  "layoutlmv3-base-doc-android.onnx"
)

for file in "${REQUIRED_FILES[@]}"; do
  src="${MODELS_SRC}/${file}"
  dst="${MODELS_DST}/${file}"
  if [ ! -f "${src}" ]; then
    echo "WARNING: Required file not found: ${src}"
    continue
  fi
  cp "${src}" "${dst}"
  SIZE=$(du -sh "${dst}" | cut -f1)
  echo "  ✓ ${file} (${SIZE})"
done

# ── iOS CoreML model (optional — not bundled in podspec, but useful for testing) ─
IOS_ZIP="${MODELS_SRC}/layoutlmv3-base-doc-coreml.mlpackage.zip"
if [ -f "${IOS_ZIP}" ]; then
  # Store CoreML model zip in a separate subdirectory so it isn't
  # accidentally included in the Android APK assets.
  IOS_DST_DIR="${PLUGIN_DIR}/datalift-models-ios"
  mkdir -p "${IOS_DST_DIR}"
  cp "${IOS_ZIP}" "${IOS_DST_DIR}/layoutlmv3-base-doc-coreml.mlpackage.zip"
  SIZE=$(du -sh "${IOS_DST_DIR}/layoutlmv3-base-doc-coreml.mlpackage.zip" | cut -f1)
  echo "  ✓ layoutlmv3-base-doc-coreml.mlpackage.zip (${SIZE}) → datalift-models-ios/"
  echo "    Note: Upload this to GitHub Release 'models-v1' for iOS auto-download."
else
  echo "  - layoutlmv3-base-doc-coreml.mlpackage.zip not found (iOS model — macOS export only)"
fi

echo ""
echo "=== Sync complete ==="
echo ""
echo "Next steps:"
echo "  1. Commit changes to datalift-models/"
echo "  2. Upload to GitHub Release 'models-v1' for runtime auto-download:"
echo "       labels.json, vocab.json, merges.txt"
echo "       layoutlmv3-base-doc-android.onnx"
echo "       layoutlmv3-base-doc-coreml.mlpackage.zip (macOS export required)"
echo "  3. Run 'yarn build' to rebuild the TypeScript library"
