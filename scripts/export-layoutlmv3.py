#!/usr/bin/env python3
"""
DataLift – LayoutLMv3 Mobile Export Script
===========================================
Exports a fine-tuned LayoutLMv3 model to:
  • int8-quantized ONNX  →  Android (ONNX Runtime Mobile)
  • CoreML .mlpackage    →  iOS     (CoreML on-device)

Run AFTER finetune-layoutlmv3.py.

Usage
-----
  python scripts/export-layoutlmv3.py \
      --model-dir  ./dist/finetuned \
      --output-dir ./dist/models

Requirements
------------
  pip install transformers optimum[exporters] onnxruntime torch coremltools Pillow

Outputs (upload all to GitHub Release tagged 'models-v1')
---------
  dist/models/
    layoutlmv3-base-doc-android.onnx
    layoutlmv3-base-doc-coreml.mlpackage.zip   (macOS only)
    labels.json
    vocab.json
"""

import argparse
import json
import os
import platform
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path


# ─── Helpers ──────────────────────────────────────────────────────────────────

def require(package: str, install_hint: str = ""):
    try:
        __import__(package)
    except ImportError:
        hint = install_hint or f"pip install {package}"
        print(f"[ERROR] Missing package '{package}'. Install with:\n  {hint}")
        sys.exit(1)


def find_onnx_file(directory: str) -> str:
    """Return the first .onnx file found in a directory tree."""
    for root, _, files in os.walk(directory):
        for f in files:
            if f.endswith(".onnx") and not f.endswith("_quantized.onnx"):
                return os.path.join(root, f)
    return ""


# ─── Step 1: Export to ONNX ───────────────────────────────────────────────────

def export_to_onnx(model_dir: str, onnx_dir: str) -> str:
    """Export fine-tuned model to ONNX via optimum."""
    require("optimum", "pip install 'optimum[exporters]'")
    from optimum.exporters.onnx import main_export

    print(f"\n[1/4] Exporting {model_dir} → ONNX (opset 14) ...")
    os.makedirs(onnx_dir, exist_ok=True)

    main_export(
        model_name_or_path=model_dir,
        output=onnx_dir,
        task="token-classification",
        opset=14,
        optimize="O2",           # graph-level optimizations
        monolith=True,           # single-file export
        no_post_process=False,
    )

    onnx_path = find_onnx_file(onnx_dir)
    if not onnx_path:
        raise FileNotFoundError(f"ONNX export produced no .onnx file in {onnx_dir}")

    print(f"  ONNX model: {onnx_path}")
    sz = os.path.getsize(onnx_path) / 1024 / 1024
    print(f"  Size:       {sz:.1f} MB")
    return onnx_path


# ─── Step 2: Quantize ONNX → int8 (Android) ──────────────────────────────────

def quantize_onnx(onnx_path: str, android_out: str) -> str:
    """Apply dynamic int8 quantization for Android ONNX Runtime Mobile."""
    require("onnxruntime")
    from onnxruntime.quantization import quantize_dynamic, QuantType

    print(f"\n[2/4] Quantizing → int8 for Android ...")
    quantize_dynamic(
        model_input=onnx_path,
        model_output=android_out,
        weight_type=QuantType.QInt8,
        optimize_model=True,
        per_channel=False,   # per-channel is slower on mobile, skip
        reduce_range=False,
    )

    sz = os.path.getsize(android_out) / 1024 / 1024
    print(f"  int8 ONNX: {android_out}  ({sz:.1f} MB)")
    return android_out


# ─── Step 3: Convert ONNX → CoreML (iOS, macOS only) ─────────────────────────

def export_to_coreml(onnx_path: str, ios_out_dir: str, ios_zip: str) -> Optional[str]:
    """Convert ONNX model to CoreML .mlpackage for iOS."""
    if platform.system() != "Darwin":
        print("\n[3/4] Skipping CoreML export (macOS required)")
        return None

    require("coremltools", "pip install coremltools")
    import coremltools as ct

    print(f"\n[3/4] Converting ONNX → CoreML (.mlpackage) ...")

    # Use ct.convert with ONNX source
    model = ct.convert(
        onnx_path,
        convert_to="mlprogram",
        minimum_deployment_target=ct.target.iOS16,
        compute_precision=ct.precision.FLOAT16,
        inputs=[
            ct.TensorType(name="input_ids",      shape=(1, 512), dtype=int),
            ct.TensorType(name="attention_mask",  shape=(1, 512), dtype=int),
            ct.TensorType(name="bbox",            shape=(1, 512, 4), dtype=int),
            ct.TensorType(name="token_type_ids",  shape=(1, 512), dtype=int),
            ct.TensorType(name="pixel_values",    shape=(1, 3, 224, 224)),
        ],
        outputs=[ct.TensorType(name="logits")],
    )

    # Set model metadata
    model.short_description = "LayoutLMv3 invoice/receipt token classification for DataLift"
    model.author = "DataLift – fine-tuned from microsoft/layoutlmv3-base"
    model.version = "1.0"

    os.makedirs(ios_out_dir, exist_ok=True)
    model.save(ios_out_dir)
    sz = sum(f.stat().st_size for f in Path(ios_out_dir).rglob("*") if f.is_file()) / 1024 / 1024
    print(f"  CoreML package: {ios_out_dir}  ({sz:.1f} MB)")

    # Zip the .mlpackage bundle
    print(f"  Zipping → {ios_zip} ...")
    with zipfile.ZipFile(ios_zip, "w", zipfile.ZIP_DEFLATED) as zf:
        for fp in Path(ios_out_dir).rglob("*"):
            zf.write(fp, fp.relative_to(Path(ios_out_dir).parent))

    zip_sz = os.path.getsize(ios_zip) / 1024 / 1024
    print(f"  iOS zip: {ios_zip}  ({zip_sz:.1f} MB)")
    return ios_zip


# ─── Step 4: Copy labels.json + vocab.json ───────────────────────────────────

def copy_assets(model_dir: str, output_dir: str):
    """Copy labels.json and vocab.json from the fine-tuned model directory."""
    print(f"\n[4/4] Copying labels.json and vocab.json ...")
    os.makedirs(output_dir, exist_ok=True)

    labels_src = os.path.join(model_dir, "labels.json")
    vocab_src  = os.path.join(model_dir, "vocab.json")

    # If vocab.json isn't in model dir, generate it from tokenizer
    if not os.path.exists(vocab_src):
        print("  vocab.json not found — regenerating from tokenizer...")
        try:
            from transformers import AutoTokenizer
            tok = AutoTokenizer.from_pretrained(model_dir)
            vocab_src_tmp = os.path.join(output_dir, "vocab.json")
            with open(vocab_src_tmp, "w") as f:
                json.dump(tok.get_vocab(), f)
            print(f"  vocab.json  → {vocab_src_tmp}  ({len(tok.get_vocab())} tokens)")
            vocab_src = None  # already written
        except Exception as e:
            print(f"  [WARN] Could not regenerate vocab.json: {e}")

    if os.path.exists(labels_src):
        dst = os.path.join(output_dir, "labels.json")
        shutil.copy2(labels_src, dst)
        with open(dst) as f:
            count = len(json.load(f))
        print(f"  labels.json → {dst}  ({count} labels)")
    else:
        # Write the default DataLift label schema
        print("  labels.json not found in model dir — writing default DataLift schema")
        write_default_labels(os.path.join(output_dir, "labels.json"))

    if vocab_src and os.path.exists(vocab_src):
        dst = os.path.join(output_dir, "vocab.json")
        shutil.copy2(vocab_src, dst)
        with open(dst) as f:
            count = len(json.load(f))
        print(f"  vocab.json  → {dst}  ({count} tokens)")


def write_default_labels(path: str):
    """Write the DataLift invoice entity label schema."""
    labels = {
        "0":  "O",
        "1":  "B-INVOICE_NUMBER",
        "2":  "I-INVOICE_NUMBER",
        "3":  "B-RECEIPT_NUMBER",
        "4":  "I-RECEIPT_NUMBER",
        "5":  "B-DATE",
        "6":  "I-DATE",
        "7":  "B-DUE_DATE",
        "8":  "I-DUE_DATE",
        "9":  "B-VENDOR_NAME",
        "10": "I-VENDOR_NAME",
        "11": "B-VENDOR_ADDRESS",
        "12": "I-VENDOR_ADDRESS",
        "13": "B-BUYER_NAME",
        "14": "I-BUYER_NAME",
        "15": "B-BUYER_ADDRESS",
        "16": "I-BUYER_ADDRESS",
        "17": "B-PO_NUMBER",
        "18": "I-PO_NUMBER",
        "19": "B-ORDER_NUMBER",
        "20": "I-ORDER_NUMBER",
        "21": "B-GRAND_TOTAL",
        "22": "I-GRAND_TOTAL",
        "23": "B-SUBTOTAL",
        "24": "I-SUBTOTAL",
        "25": "B-TOTAL_TAX",
        "26": "I-TOTAL_TAX",
        "27": "B-AMOUNT_DUE",
        "28": "I-AMOUNT_DUE",
        "29": "B-ITEM_DESCRIPTION",
        "30": "I-ITEM_DESCRIPTION",
        "31": "B-ITEM_QUANTITY",
        "32": "I-ITEM_QUANTITY",
        "33": "B-ITEM_UNIT_PRICE",
        "34": "I-ITEM_UNIT_PRICE",
        "35": "B-ITEM_TOTAL",
        "36": "I-ITEM_TOTAL",
        "37": "B-PAYMENT_METHOD",
        "38": "I-PAYMENT_METHOD",
    }
    with open(path, "w") as f:
        json.dump(labels, f, indent=2)
    print(f"  labels.json → {path}  ({len(labels)} labels)")


# ─── Summary ──────────────────────────────────────────────────────────────────

def print_summary(output_dir: str):
    print("\n" + "─" * 68)
    print("  DataLift model assets ready")
    print("─" * 68)
    for fname in sorted(os.listdir(output_dir)):
        fp = os.path.join(output_dir, fname)
        if os.path.isfile(fp):
            sz = os.path.getsize(fp) / 1024 / 1024
            print(f"  {fname:<50}  {sz:>6.1f} MB")
    print("─" * 68)
    print()
    print("Next steps:")
    print(f"  1. Go to https://github.com/kajeevan025/react-native-datalift/releases")
    print(f"  2. Create release tagged 'models-v1'")
    print(f"  3. Upload ALL files from: {output_dir}/")
    print(f"       • layoutlmv3-base-doc-android.onnx")
    print(f"       • layoutlmv3-base-doc-coreml.mlpackage.zip  (iOS)")
    print(f"       • labels.json")
    print(f"       • vocab.json")
    print()
    print("  4. In your app:")
    print("       DataLift.configure({ autoDownloadLayoutLMv3: true });")
    print("       await DataLift.prepareModel();")


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(description="Export fine-tuned LayoutLMv3 for iOS (CoreML) and Android (ONNX)")
    ap.add_argument("--model-dir",  default="./dist/finetuned",
                    help="Directory containing the fine-tuned model (output of finetune-layoutlmv3.py)")
    ap.add_argument("--output-dir", default="./dist/models",
                    help="Directory where release assets will be written")
    ap.add_argument("--skip-ios",   action="store_true",
                    help="Skip CoreML export even on macOS")
    ap.add_argument("--skip-android", action="store_true",
                    help="Skip ONNX / int8 export")
    args = ap.parse_args()

    model_dir  = os.path.abspath(args.model_dir)
    output_dir = os.path.abspath(args.output_dir)
    os.makedirs(output_dir, exist_ok=True)

    if not os.path.isdir(model_dir):
        print(f"[ERROR] model-dir not found: {model_dir}")
        print("Run  python scripts/finetune-layoutlmv3.py  first.")
        sys.exit(1)

    onnx_tmp  = os.path.join(output_dir, "_onnx_tmp")
    onnx_full = os.path.join(onnx_tmp, "model.onnx")

    android_out = os.path.join(output_dir, "layoutlmv3-base-doc-android.onnx")
    ios_dir     = os.path.join(output_dir, "layoutlmv3-base-doc-coreml.mlpackage")
    ios_zip     = ios_dir + ".zip"

    # ── ONNX export (needed for both Android and CoreML conversion) ────────
    full_onnx_path = export_to_onnx(model_dir, onnx_tmp)

    # ── Android ────────────────────────────────────────────────────────────
    if not args.skip_android:
        quantize_onnx(full_onnx_path, android_out)
    else:
        print("\n[2/4] Skipping Android ONNX quantization (--skip-android)")

    # ── iOS ────────────────────────────────────────────────────────────────
    if not args.skip_ios:
        export_to_coreml(full_onnx_path, ios_dir, ios_zip)
    else:
        print("\n[3/4] Skipping CoreML export (--skip-ios)")

    # ── Assets ─────────────────────────────────────────────────────────────
    copy_assets(model_dir, output_dir)

    # ── Cleanup temp dir ───────────────────────────────────────────────────
    shutil.rmtree(onnx_tmp, ignore_errors=True)

    print_summary(output_dir)


# Tolerate Optional not being imported at module level in older Pythons
from typing import Optional

if __name__ == "__main__":
    main()
