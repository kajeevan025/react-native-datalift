# DataLift – Training → Plugin Integration Guide

This document explains how the two DataLift repositories fit together and how to keep them in sync.

---

## Repository Overview

```
datalift-model-training/          react-native-datalift/
──────────────────────────        ──────────────────────────────────
scripts/finetune-layoutlmv3.py    src/            TypeScript SDK
scripts/export-layoutlmv3.py      android/        Kotlin native module
data/labels.json                  ios/            Swift native module
DataSet/                          datalift-models/ Bundled model assets
dist/finetuned/   ──────────────► datalift-models/ (via sync-models.sh)
dist/models/      ──────────────► GitHub Release "models-v1"
                                       │
                                  runtime download via ModelManager.ts
                                  (when autoDownloadLayoutLMv3: true)
```

---

## Model Artefacts

| File | Source | Destination | Required by |
|------|--------|-------------|-------------|
| `labels.json` | `dist/models/labels.json` | `datalift-models/labels.json` | Both platforms |
| `vocab.json` | `dist/models/vocab.json` | `datalift-models/vocab.json` | Both platforms |
| `merges.txt` | `dist/models/merges.txt` | `datalift-models/merges.txt` | **Android only** — BPE tokeniser |
| `layoutlmv3-base-doc-android.onnx` | `dist/models/` | `datalift-models/` | Android (bundled in APK assets) |
| `layoutlmv3-base-doc-coreml.mlpackage.zip` | `dist/models/` | GitHub Release only | iOS (downloaded at runtime) |

> **Critical:** `merges.txt` is NOT optional for Android. Without it, the RoBERTa BPE
> tokeniser in `LayoutLMv3OnnxEngine.kt` falls back to an empty vocabulary map, producing
> random token IDs and zero useful predictions from the model.

---

## Label Schema (39 Labels)

The label schema is defined in `datalift-model-training/scripts/finetune-layoutlmv3.py` as
`LABEL2ID` and must stay in sync with:

- `react-native-datalift/android/src/main/java/com/datalift/LayoutLMv3OnnxEngine.kt` → `defaultLabels()`
- `react-native-datalift/ios/DataLift/LayoutLMv3OnnxEngine.swift` → `defaultLabels()`
- `datalift-models/labels.json` (exported during training)
- `datalift-model-training/dist/models/labels.json` (exported during training)

All four must map the same integer IDs to the same label strings. **Never edit any one
without updating all others.**

Current schema (39 labels, 0-indexed):

| ID | Label | ID | Label |
|----|-------|----|-------|
| 0 | O | 20 | I-ORDER_NUMBER |
| 1 | B-INVOICE_NUMBER | 21 | B-GRAND_TOTAL |
| 2 | I-INVOICE_NUMBER | 22 | I-GRAND_TOTAL |
| 3 | B-RECEIPT_NUMBER | 23 | B-SUBTOTAL |
| 4 | I-RECEIPT_NUMBER | 24 | I-SUBTOTAL |
| 5 | B-DATE | 25 | B-TOTAL_TAX |
| 6 | I-DATE | 26 | I-TOTAL_TAX |
| 7 | B-DUE_DATE | 27 | B-AMOUNT_DUE |
| 8 | I-DUE_DATE | 28 | I-AMOUNT_DUE |
| 9 | B-VENDOR_NAME | 29 | B-ITEM_DESCRIPTION |
| 10 | I-VENDOR_NAME | 30 | I-ITEM_DESCRIPTION |
| 11 | B-VENDOR_ADDRESS | 31 | B-ITEM_QUANTITY |
| 12 | I-VENDOR_ADDRESS | 32 | I-ITEM_QUANTITY |
| 13 | B-BUYER_NAME | 33 | B-ITEM_UNIT_PRICE |
| 14 | I-BUYER_NAME | 34 | I-ITEM_UNIT_PRICE |
| 15 | B-BUYER_ADDRESS | 35 | B-ITEM_TOTAL |
| 16 | I-BUYER_ADDRESS | 36 | I-ITEM_TOTAL |
| 17 | B-PO_NUMBER | 37 | B-PAYMENT_METHOD |
| 18 | I-PO_NUMBER | 38 | I-PAYMENT_METHOD |
| 19 | B-ORDER_NUMBER | | |

---

## Extraction Pipeline

```
DataLift.extract({ image })
   │
   ├─ Stage 1: OCREngine
   │     iOS: Apple Vision (VNRecognizeTextRequest)
   │     Android: Google ML Kit TextRecognition
   │     Fallback: Tesseract.js (if native module not linked)
   │
   ├─ Stage 2: RuleBasedParser
   │     TypeScript regex + column-table / vertical-form / multi-line NLP
   │     Extracts: supplier, buyer, transaction, line items, totals,
   │               payment details, delivery details, notes
   │
   ├─ Stage 3: ConfidenceEngine
   │     5-factor weighted score (ocr, fields, numeric, docType, keyword)
   │     Returns overall 0–1 score + per-factor breakdown
   │
   ├─ Stage 4: LayoutLMv3 (optional — skipped if model not present)
   │     iOS: CoreML MLModel (.mlpackage.zip → unzip → compile → .mlmodelc)
   │     Android: ONNX Runtime Mobile (.onnx + BPE vocab/merges)
   │     Input: raw OCR text + bounding-box tokens + image pixel_values
   │     Output: per-token BIO entity labels → merged fields
   │     Merge strategy: fill-only when modelConf < 0.75; override when ≥ 0.75
   │     Re-scores confidence after filling gaps
   │
   └─ Stage 5: AIEngine (optional — triggered when confidence < threshold)
         Generic AI provider fallback (e.g. HuggingFace API)
         Non-fatal: rule-based result returned if AI fails
```

---

## How Models Are Resolved (Android)

Priority order in `_extractImpl` / `ModelManager.ensureModel()`:

1. **Bundled assets** — `LayoutLMv3OnnxEngine.kt` calls `resolveBundlePath()` which extracts
   `layoutlmv3-base-doc-android.onnx` from APK `assets/` to `filesDir/models/` on first run.
   `vocab.json`, `merges.txt`, and `labels.json` are extracted from assets the same way.

2. **Device storage** — `ModelManager.getStoredModelPaths()` checks
   `<filesDir>/DataLift/models/layoutlmv3/` for previously-downloaded files.

3. **Remote download** — `ModelManager.downloadModel()` downloads from GitHub Releases
   `models-v1` tag when `autoDownloadLayoutLMv3: true`.

4. **Skip** — If none of the above succeed, Stage 4 is silently skipped.

## How Models Are Resolved (iOS)

The CoreML model is **not** bundled in the pod (too large, ~221 MB).

1. **Device storage** — same check as Android but looks for `.mlpackage.zip`.
2. **Remote download** — downloads `.mlpackage.zip`, unzips it to `.mlpackage`,
   then compiles it to a cached `.mlmodelc` directory using `MLModel.compileModel()`.
3. **Skip** — if model not ready, Stages 1–3 + Stage 5 still run.

---

## Android: How BPE Tokenisation Works

`LayoutLMv3OnnxEngine.kt` tokenises the raw OCR text using RoBERTa byte-level BPE:

1. Loads `vocab.json` from the same directory as the `.onnx` model file.
2. Loads `merges.txt` (BPE merge rules) from the same directory.
3. Encodes each word using the BPE merge algorithm.
4. Assigns normalised bounding box coordinates per-token based on line/word position.
5. Pads/truncates to 512 tokens (matching the ONNX model's sequence length).

**If `merges.txt` is missing**, `loadVocab()` returns an empty `BPEVocab`, all words
fall back to `<unk>` (ID 3), and the model produces random/degenerate predictions.

---

## Updating the Model

When you fine-tune and export a new model:

```bash
# 1. Fine-tune (in datalift-model-training/)
python scripts/finetune-layoutlmv3.py \
  --base-model microsoft/layoutlmv3-base \
  --output-dir ./dist/finetuned \
  --epochs 10

# 2. Export for mobile
python scripts/export-layoutlmv3.py \
  --model-dir ./dist/finetuned \
  --output-dir ./dist/models

# 3. Sync to plugin (in react-native-datalift/)
bash scripts/sync-models.sh

# 4. Upload all 5 files to GitHub Release "models-v1"
#    labels.json, vocab.json, merges.txt,
#    layoutlmv3-base-doc-android.onnx,
#    layoutlmv3-base-doc-coreml.mlpackage.zip

# 5. Rebuild the TypeScript library
yarn build
```

---

## iOS: CoreML Model Loading Flow

```
DataLiftModule.swift  → predictLayoutLMv3()
  → LayoutLMv3OnnxEngine.swift.predict()
     → getModel(modelPath: "/path/to/model.mlpackage.zip")
        • .mlpackage.zip   → DataLiftZipExtractor.extractZip() → .mlpackage
                           → MLModel.compileModel() → .mlmodelc (cached)
        • .mlpackage       → MLModel.compileModel() → .mlmodelc (cached)
        • anything else    → MLModel(contentsOf:) directly
     → buildFeatureProvider() — input_ids, attention_mask, bbox, pixel_values
     → mlModel.prediction()
     → readLogits() → decodeEntities() → entitiesToFields()
```

The compiled `.mlmodelc` is stored next to the source file and reused across launches
to avoid recompilation overhead (~5–10 s on first load).

---

## Android: ONNX Inference Flow

```
DataLiftModule.kt  → predictLayoutLMv3()
  → LayoutLMv3OnnxEngine.kt.predict()
     → getSession(modelPath)   — loads ONNX model via OrtEnvironment
     → loadLabels(labelsPath)  — JSON object/array/plain-text formats all supported
     → loadVocab(modelDir)     — vocab.json + merges.txt
     → encode(text, bpeVocab) — RoBERTa BPE → token IDs + bounding boxes (1×512)
     → imageToTensorData()     — Bitmap → normalised float tensor (1×3×224×224)
     → session.run()           — ONNX inference
     → decodeEntities()        — softmax + threshold 0.88 + BIO merge
     → entitiesToFields()      — entity spans → schema fields map
```

---

## Key Files at a Glance

| File | Role |
|------|------|
| `datalift-model-training/scripts/finetune-layoutlmv3.py` | Label schema definition + training |
| `datalift-model-training/scripts/export-layoutlmv3.py` | ONNX + CoreML export |
| `react-native-datalift/scripts/sync-models.sh` | Sync artefacts from training to plugin |
| `react-native-datalift/datalift-models/` | Bundled model assets (Android APK assets) |
| `react-native-datalift/src/utils/ModelManager.ts` | Model discovery + download lifecycle |
| `react-native-datalift/src/core/DataLift.ts` | Main SDK — orchestrates all stages |
| `react-native-datalift/android/.../LayoutLMv3OnnxEngine.kt` | Android ONNX inference |
| `react-native-datalift/ios/DataLift/LayoutLMv3OnnxEngine.swift` | iOS CoreML inference |
| `react-native-datalift/android/build.gradle` | Bundles datalift-models/ as APK assets |
| `react-native-datalift/react-native-datalift.podspec` | Bundles labels.json + vocab.json as iOS resources |
