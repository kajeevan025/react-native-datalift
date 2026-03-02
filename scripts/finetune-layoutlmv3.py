#!/usr/bin/env python3
"""
DataLift – LayoutLMv3 Fine-Tuning Script
=========================================
Fine-tunes microsoft/layoutlmv3-base on the CORD receipt/invoice dataset
(and optionally on a custom dataset) for token-classification with the DataLift
invoice entity label schema.

Usage
-----
  python scripts/finetune-layoutlmv3.py [--output-dir ./dist/finetuned] \
                                         [--epochs 10] \
                                         [--batch-size 4] \
                                         [--base-model microsoft/layoutlmv3-base]

Requirements
------------
  pip install transformers datasets seqeval torch Pillow torchvision

Label Schema (38 classes)
-------------------------
Designed to pass DataLift's iOS/Android validateLabelMap:
  * O (outside) is always index 0
  * At least 3 of: INVOICE, RECEIPT, ORDER, PO, DATE, VENDOR, TOTAL, DUE
  * All covered: INVOICE, RECEIPT, ORDER, PO, DATE, VENDOR, TOTAL, DUE (8/8)
"""

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

# ── Label schema ───────────────────────────────────────────────────────────────

LABEL2ID: Dict[str, int] = {
    "O":                    0,
    "B-INVOICE_NUMBER":     1,
    "I-INVOICE_NUMBER":     2,
    "B-RECEIPT_NUMBER":     3,
    "I-RECEIPT_NUMBER":     4,
    "B-DATE":               5,
    "I-DATE":               6,
    "B-DUE_DATE":           7,
    "I-DUE_DATE":           8,
    "B-VENDOR_NAME":        9,
    "I-VENDOR_NAME":        10,
    "B-VENDOR_ADDRESS":     11,
    "I-VENDOR_ADDRESS":     12,
    "B-BUYER_NAME":         13,
    "I-BUYER_NAME":         14,
    "B-BUYER_ADDRESS":      15,
    "I-BUYER_ADDRESS":      16,
    "B-PO_NUMBER":          17,
    "I-PO_NUMBER":          18,
    "B-ORDER_NUMBER":       19,
    "I-ORDER_NUMBER":       20,
    "B-GRAND_TOTAL":        21,
    "I-GRAND_TOTAL":        22,
    "B-SUBTOTAL":           23,
    "I-SUBTOTAL":           24,
    "B-TOTAL_TAX":          25,
    "I-TOTAL_TAX":          26,
    "B-AMOUNT_DUE":         27,
    "I-AMOUNT_DUE":         28,
    "B-ITEM_DESCRIPTION":   29,
    "I-ITEM_DESCRIPTION":   30,
    "B-ITEM_QUANTITY":      31,
    "I-ITEM_QUANTITY":      32,
    "B-ITEM_UNIT_PRICE":    33,
    "I-ITEM_UNIT_PRICE":    34,
    "B-ITEM_TOTAL":         35,
    "I-ITEM_TOTAL":         36,
    "B-PAYMENT_METHOD":     37,
    "I-PAYMENT_METHOD":     38,
}

ID2LABEL: Dict[int, str] = {v: k for k, v in LABEL2ID.items()}
NUM_LABELS = len(LABEL2ID)

# ── CORD → DataLift label mapping ─────────────────────────────────────────────

CORD_LABEL_MAP: Dict[str, str] = {
    # Item fields
    "menu.nm":              "ITEM_DESCRIPTION",
    "menu.num":             "ITEM_QUANTITY",
    "menu.unitprice":       "ITEM_UNIT_PRICE",
    "menu.cnt":             "ITEM_QUANTITY",
    "menu.price":           "ITEM_TOTAL",
    "menu.itemsubtotal":    "ITEM_TOTAL",
    "menu.discountprice":   "ITEM_UNIT_PRICE",
    "menu.sub_nm":          "ITEM_DESCRIPTION",
    "menu.sub_price":       "ITEM_TOTAL",
    # Totals
    "subtotal.subtotal_price":      "SUBTOTAL",
    "subtotal.tax_price":           "TOTAL_TAX",
    "subtotal.service_price":       "SUBTOTAL",
    "subtotal.discount_price":      "SUBTOTAL",
    "subtotal.othersvc_price":      "SUBTOTAL",
    # Grand total / amount due
    "total.total_price":        "GRAND_TOTAL",
    "total.total_etc":          "AMOUNT_DUE",
    "total.cashprice":          "AMOUNT_DUE",
    "total.changeprice":        "AMOUNT_DUE",
    "total.creditcardprice":    "GRAND_TOTAL",
    "total.emoneyprice":        "GRAND_TOTAL",
    "total.menutype_cnt":       "O",
    # Receipt metadata
    "info.store_name":          "VENDOR_NAME",
    "info.store_addr":          "VENDOR_ADDRESS",
    "info.date":                "DATE",
    "info.time":                "DATE",
    "info.phone":               "O",
    "info.etc":                 "O",
    # Fallback
    "void_menu.nm":             "O",
    "void_menu.price":          "O",
}


def cord_tag_to_datalift(cord_tag: str) -> str:
    """Map a CORD annotation tag to the corresponding DataLift entity type.
    Returns the entity type string (without B-/I- prefix).
    """
    if cord_tag == "O" or cord_tag is None:
        return "O"
    return CORD_LABEL_MAP.get(cord_tag, "O")


def bio_encode(words: List[str], cord_tags: List[str]) -> List[str]:
    """Convert a word sequence with CORD tags to B-/I-/O labels."""
    labels: List[str] = []
    prev_entity = ""
    for tag in cord_tags:
        entity = cord_tag_to_datalift(tag)
        if entity == "O":
            labels.append("O")
            prev_entity = ""
        elif entity == prev_entity:
            labels.append(f"I-{entity}")
        else:
            labels.append(f"B-{entity}")
            prev_entity = entity
    return labels


# ── Dataset preparation ───────────────────────────────────────────────────────

def prepare_cord_dataset(processor, max_length: int = 512):
    """Load and pre-process the CORD dataset from HuggingFace."""
    try:
        from datasets import load_dataset
    except ImportError:
        print("[ERROR] 'datasets' package not found. Run: pip install datasets")
        sys.exit(1)

    print("[data] Loading CORD dataset from HuggingFace...")
    dataset = load_dataset("naver-clova-ix/cord-v2")

    def tokenize_and_align_labels(examples):
        images = examples["image"]
        all_words = examples["words"]
        all_bboxes = examples["bboxes"]
        all_labels_raw = examples["ner_tags"]

        # Normalize bounding boxes to [0, 1000] range expected by LayoutLMv3
        def normalize_bbox(bbox, width, height):
            return [
                int(1000 * bbox[0] / width),
                int(1000 * bbox[1] / height),
                int(1000 * bbox[2] / width),
                int(1000 * bbox[3] / height),
            ]

        encoding = processor(
            images,
            all_words,
            boxes=[
                [normalize_bbox(b, img.width, img.height) for b, img in zip(bboxes, [images[i]] * len(bboxes))]
                for i, bboxes in enumerate(all_bboxes)
            ],
            word_labels=all_labels_raw,
            truncation=True,
            padding="max_length",
            max_length=max_length,
            return_tensors="pt",
        )
        return encoding

    print("[data] Tokenizing CORD splits...")
    tokenized_dataset = dataset.map(
        tokenize_and_align_labels,
        batched=True,
        remove_columns=dataset["train"].column_names,
    )
    tokenized_dataset.set_format("torch")
    return tokenized_dataset


def prepare_custom_dataset(data_path: str, processor, max_length: int = 512):
    """
    Load a custom JSON dataset in the following format:
    [
      {
        "image": "/path/to/image.jpg",   (optional — use dummy if not available)
        "words": ["INVOICE", "#", "INV-001", ...],
        "bboxes": [[x0,y0,x1,y1], ...],   (normalised to [0,1000])
        "labels": ["B-INVOICE_NUMBER", "B-INVOICE_NUMBER", "I-INVOICE_NUMBER", ...]
      },
      ...
    ]
    """
    try:
        from datasets import Dataset
        from PIL import Image
    except ImportError:
        print("[ERROR] Run: pip install datasets Pillow")
        sys.exit(1)

    print(f"[data] Loading custom dataset from {data_path} ...")
    with open(data_path) as f:
        raw = json.load(f)

    def make_encoding(item):
        if item.get("image") and os.path.exists(item["image"]):
            img = Image.open(item["image"]).convert("RGB")
        else:
            img = Image.new("RGB", (1000, 1000), color=(255, 255, 255))

        label_ids = [LABEL2ID.get(lbl, 0) for lbl in item["labels"]]
        enc = processor(
            img,
            item["words"],
            boxes=item["bboxes"],
            word_labels=label_ids,
            truncation=True,
            padding="max_length",
            max_length=max_length,
            return_tensors="pt",
        )
        return {k: v.squeeze(0) for k, v in enc.items()}

    records = [make_encoding(it) for it in raw]
    return Dataset.from_list(records)


# ── Training ──────────────────────────────────────────────────────────────────

def train(
    base_model: str,
    output_dir: str,
    epochs: int,
    batch_size: int,
    learning_rate: float,
    custom_data_path: Optional[str],
    max_length: int,
    fp16: bool,
):
    try:
        import torch
        from transformers import (
            AutoProcessor,
            LayoutLMv3ForTokenClassification,
            TrainingArguments,
            Trainer,
            EarlyStoppingCallback,
            DataCollatorForTokenClassification,
        )
        from seqeval.metrics import classification_report, f1_score
        import numpy as np
    except ImportError as e:
        print(f"[ERROR] Missing dependency: {e}")
        print("Run: pip install transformers datasets seqeval torch torchvision Pillow")
        sys.exit(1)

    print(f"\n[train] Base model  : {base_model}")
    print(f"[train] Output dir  : {output_dir}")
    print(f"[train] Epochs      : {epochs}")
    print(f"[train] Batch size  : {batch_size}")
    print(f"[train] Num labels  : {NUM_LABELS}")
    print()

    os.makedirs(output_dir, exist_ok=True)

    # ── Load processor ─────────────────────────────────────────────────────
    print("[1/5] Loading processor...")
    processor = AutoProcessor.from_pretrained(
        base_model,
        apply_ocr=False,   # We supply pre-tokenised words from OCR
    )

    # ── Load dataset ───────────────────────────────────────────────────────
    print("[2/5] Preparing dataset...")
    if custom_data_path:
        train_dataset = prepare_custom_dataset(custom_data_path, processor, max_length)
        eval_dataset = train_dataset  # Use same for eval if no split provided
    else:
        tokenized = prepare_cord_dataset(processor, max_length)
        train_dataset = tokenized["train"]
        eval_dataset = tokenized.get("validation") or tokenized.get("test") or train_dataset

    print(f"       Train: {len(train_dataset)} samples")
    print(f"       Eval : {len(eval_dataset)} samples")

    # ── Load model ─────────────────────────────────────────────────────────
    print("[3/5] Loading LayoutLMv3ForTokenClassification...")
    model = LayoutLMv3ForTokenClassification.from_pretrained(
        base_model,
        num_labels=NUM_LABELS,
        id2label=ID2LABEL,
        label2id=LABEL2ID,
        ignore_mismatched_sizes=True,
    )

    # ── Compute metrics ────────────────────────────────────────────────────
    def compute_metrics(eval_preds):
        logits, label_ids = eval_preds
        preds = np.argmax(logits, axis=-1)

        true_labels_list, pred_labels_list = [], []
        for pred_row, label_row in zip(preds, label_ids):
            true_seq, pred_seq = [], []
            for p, l in zip(pred_row, label_row):
                if l == -100:
                    continue
                true_seq.append(ID2LABEL.get(int(l), "O"))
                pred_seq.append(ID2LABEL.get(int(p), "O"))
            true_labels_list.append(true_seq)
            pred_labels_list.append(pred_seq)

        f1 = f1_score(true_labels_list, pred_labels_list)
        print("\n" + classification_report(true_labels_list, pred_labels_list))
        return {"f1": f1}

    # ── Training arguments ─────────────────────────────────────────────────
    use_fp16 = fp16 and torch.cuda.is_available()
    training_args = TrainingArguments(
        output_dir=output_dir,
        num_train_epochs=epochs,
        per_device_train_batch_size=batch_size,
        per_device_eval_batch_size=batch_size,
        learning_rate=learning_rate,
        weight_decay=0.01,
        warmup_ratio=0.1,
        lr_scheduler_type="cosine",
        evaluation_strategy="epoch",
        save_strategy="epoch",
        load_best_model_at_end=True,
        metric_for_best_model="f1",
        logging_steps=50,
        report_to="none",
        fp16=use_fp16,
        dataloader_num_workers=0,
        remove_unused_columns=False,
    )

    data_collator = DataCollatorForTokenClassification(
        processor.tokenizer,
        padding=True,
        pad_to_multiple_of=8,
    )

    # ── Train ──────────────────────────────────────────────────────────────
    print("[4/5] Starting training...")
    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=train_dataset,
        eval_dataset=eval_dataset,
        tokenizer=processor.tokenizer,
        data_collator=data_collator,
        compute_metrics=compute_metrics,
        callbacks=[EarlyStoppingCallback(early_stopping_patience=3)],
    )
    trainer.train()

    # ── Save ───────────────────────────────────────────────────────────────
    print("[5/5] Saving fine-tuned model and assets...")
    trainer.save_model(output_dir)
    processor.save_pretrained(output_dir)

    # Write labels.json (DataLift runtime format: {"0": "O", "1": "B-INVOICE_NUMBER", ...})
    labels_path = os.path.join(output_dir, "labels.json")
    with open(labels_path, "w") as f:
        json.dump({str(k): v for k, v in ID2LABEL.items()}, f, indent=2)
    print(f"  labels.json → {labels_path}  ({NUM_LABELS} labels)")

    # Write vocab.json (token → id, needed by iOS tokenizer)
    vocab = processor.tokenizer.get_vocab()
    vocab_path = os.path.join(output_dir, "vocab.json")
    with open(vocab_path, "w") as f:
        json.dump(vocab, f)
    print(f"  vocab.json  → {vocab_path}  ({len(vocab)} tokens)")

    print(f"\n[done] Fine-tuned model saved to: {output_dir}")
    print("       Next step: run  python scripts/export-layoutlmv3.py  to export for mobile.")


# ── CLI ───────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Fine-tune LayoutLMv3 for DataLift invoice extraction")
    parser.add_argument("--base-model", default="microsoft/layoutlmv3-base",
                        help="HuggingFace model ID to start from (default: microsoft/layoutlmv3-base)")
    parser.add_argument("--output-dir", default="./dist/finetuned",
                        help="Directory to save the fine-tuned model")
    parser.add_argument("--epochs", type=int, default=10,
                        help="Number of training epochs (default: 10)")
    parser.add_argument("--batch-size", type=int, default=4,
                        help="Training batch size per device (default: 4)")
    parser.add_argument("--learning-rate", type=float, default=5e-5,
                        help="Learning rate (default: 5e-5)")
    parser.add_argument("--max-length", type=int, default=512,
                        help="Maximum sequence length (default: 512)")
    parser.add_argument("--fp16", action="store_true",
                        help="Enable mixed precision training (requires CUDA GPU)")
    parser.add_argument("--custom-data", default=None,
                        help="Path to custom JSON dataset (skips CORD if provided)")
    args = parser.parse_args()

    train(
        base_model=args.base_model,
        output_dir=args.output_dir,
        epochs=args.epochs,
        batch_size=args.batch_size,
        learning_rate=args.learning_rate,
        custom_data_path=args.custom_data,
        max_length=args.max_length,
        fp16=args.fp16,
    )


if __name__ == "__main__":
    main()
