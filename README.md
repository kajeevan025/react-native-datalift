# react-native-datalift

> Production-ready, cross-platform TypeScript SDK for intelligent document scanning and structured data extraction in React Native applications.

**DataLift** accepts images (Base64 or file URI), runs a unified **3-stage pipeline** — native OCR → rule-based NLP parser → optional on-device LayoutLMv3 enhancement — and returns a richly-typed [`DataLiftResponse`](#dataliftresponse-schema) object from a single `await DataLift.extract(...)` call.

[![npm version](https://img.shields.io/npm/v/@kajeevan025/react-native-datalift)](https://www.npmjs.com/package/@kajeevan025/react-native-datalift)
[![license](https://img.shields.io/npm/l/@kajeevan025/react-native-datalift)](LICENSE)

## Features

- **3-stage pipeline** — Native OCR → Rule-based NLP parser → Optional LayoutLMv3 on-device AI
- **Offline-first** — Apple Vision (iOS) and Google ML Kit (Android) with Tesseract.js fallback
- **Smart parser** — Column-table, vertical-form, and multi-line block detection with address/phone/policy-text filtering
- **LayoutLMv3 integration** — CoreML on iOS, ONNX on Android; auto-fills gaps left by the parser
- **Strongly typed** — Full TypeScript strict mode, no `any`
- **Multi-document** — Invoices, receipts, purchase orders, work orders, bills, quotes, CMMS documents
- **Confidence scoring** — 5-factor composite score per extraction
- **React Native** — iOS + Android, Old & New Architecture (TurboModules), RN ≥ 0.70
- **Dual build** — ESM + CJS, works with Metro bundler and Node.js test runners

---

## Installation

```sh
yarn add @kajeevan025/react-native-datalift
```

### iOS

```sh
cd ios && pod install
```

Add camera/photo permissions to `ios/<YourApp>/Info.plist`:

```xml
<key>NSCameraUsageDescription</key>
<string>DataLift needs camera access to scan documents</string>
<key>NSPhotoLibraryUsageDescription</key>
<string>DataLift needs photo library access to pick documents</string>
```

### Android

Add to `android/app/src/main/AndroidManifest.xml`:

```xml
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" />
```

---

## Quick Start

```typescript
import { DataLift } from "@kajeevan025/react-native-datalift";

// Basic extraction — OCR + rule-based parser
const result = await DataLift.extract({
  image: "file:///path/to/document.jpg",
});

console.log(result.supplier.name); // "ACME Corp"
console.log(result.transaction.invoiceNumber); // "INV-2024-0042"
console.log(result.totals.grandTotal); // 1234.56
console.log(result.metadata.confidenceScore); // 0.87
console.log(result.parts.length); // 5  (line items)
```

---

## Input Formats

```typescript
// Base64 string (with or without data URI prefix)
await DataLift.extract({ image: "data:image/jpeg;base64,/9j/4AAQ..." });
await DataLift.extract({ image: "/9j/4AAQSkZJRgAB..." });

// File URI
await DataLift.extract({ image: "file:///path/to/scanned-doc.jpg" });
```

---

## `DataLift.extract()` Options

```typescript
interface DataLiftExtractOptions {
  /** Image to extract data from — Base64 string or file URI */
  image?: string;

  /** Hint for document type — auto-detected if omitted */
  documentType?:
    | "invoice"
    | "receipt"
    | "purchase_order"
    | "work_order"
    | "bill"
    | "quote"
    | "cmms"
    | "generic";

  /** BCP-47 language code hint for OCR — default "en" */
  language?: string;

  /** Named OCR provider — "native-mlkit" | "tesseract" (default: auto) */
  ocrProvider?: string;

  /** Confidence threshold (0–1) below which AI enhancement is triggered (default 0.65) */
  aiConfidenceThreshold?: number;

  /** AI provider instance override for this call */
  aiProvider?: AIProvider;

  /** Include raw OCR text in response.rawText */
  extractRawText?: boolean;

  /** Log verbose debug output to the console */
  debug?: boolean;

  // ── LayoutLMv3 (optional — overrides globally configured paths) ─────────
  /** Absolute path to the LayoutLMv3 model file (resolved by native) */
  layoutLMv3ModelPath?: string;
  /** Absolute path to the LayoutLMv3 labels file */
  layoutLMv3LabelsPath?: string;
  /** Throw instead of warning when LayoutLMv3 fails */
  requireLayoutLMv3?: boolean;
}
```

---

## `DataLiftResponse` Schema

```typescript
interface DataLiftResponse {
  metadata: {
    documentType: DataLiftDocumentType; // "invoice" | "receipt" | ...
    confidenceScore: number; // 0–1 composite score
    ocrProvider: string; // which OCR engine was used
    aiProviderUsed?: string; // which AI provider ran (if any)
    processingTimeMs: number;
    warnings: string[]; // non-fatal issues from any stage
  };

  supplier: {
    name: string;
    address: {
      street: string;
      city: string;
      state: string;
      postalCode: string;
      country: string;
      rawAddress: string;
    };
    contact: { phone: string; email: string; website: string };
    taxInformation?: {
      taxId: string;
      vatNumber: string;
      registrationNumber: string;
    };
  };

  buyer: {
    name: string;
    address: {
      /* same shape as supplier.address */
    };
    contact: {
      /* same shape as supplier.contact */
    };
  };

  transaction: {
    invoiceNumber: string;
    purchaseOrderNumber: string;
    invoiceDate: string; // ISO-8601 date
    dueDate: string; // ISO-8601 date
    transactionTime: string; // ISO-8601 time
    paymentTerms: string; // e.g. "Net 30"
    currency: string; // ISO-4217 e.g. "USD"
    paymentMethod: string;
    referenceNumber: string;
    workOrderNumber: string;
  };

  parts: Array<{
    lineNumber: number;
    partNumber: string;
    description: string;
    quantity: number;
    unit: string;
    unitPrice: number;
    totalAmount: number;
    currency: string;
    condition: string;
    notes: string;
  }>;

  totals: {
    subtotal: number;
    totalTax: number;
    totalDiscount: number;
    shippingCost: number;
    grandTotal: number;
    currency: string;
    amountDue: number;
    amountPaid: number;
    balanceDue: number;
  };

  rawText?: string; // Present when extractRawText: true
}
```

---

## OCR Providers

DATALIFT uses a **fallback chain** — tries each provider in order, uses first that succeeds.

| Priority | Provider                     | ID               | Notes                       |
| -------- | ---------------------------- | ---------------- | --------------------------- |
| 1        | Native ML Kit / Apple Vision | `"native-mlkit"` | Built-in with native module |
| 2        | Tesseract.js (offline)       | `"tesseract"`    | `yarn add tesseract.js`     |

### Register a custom OCR provider

```typescript
import type {
  OCRProvider,
  OCROptions,
  OCRResult,
} from "@kajeevan025/react-native-datalift";
import { registerOCRProvider } from "@kajeevan025/react-native-datalift";

const myProvider: OCRProvider = {
  name: "my-ocr",
  async extractText(options: OCROptions): Promise<OCRResult> {
    const text = await myService.process(options.imageData);
    return { text, confidence: 0.9, provider: "my-ocr" };
  },
  async isAvailable(): Promise<boolean> {
    return myService.isReady();
  },
};

registerOCRProvider(myProvider);
await DataLift.extract({ image: base64, ocrProvider: "my-ocr" });
```

---

## LayoutLMv3 On-Device AI (Optional)

LayoutLMv3 is an optional **stage 4** that fills in fields the rule-based parser missed. It runs entirely on-device — no network request.

- **iOS** uses CoreML (`MLModel`) — requires a `.mlmodelc` or `.mlpackage` file
- **Android** uses ONNX Runtime Mobile — requires a `.onnx` file

### Step 1 — Prepare your model

| Platform | Format                        | How to create                                         |
| -------- | ----------------------------- | ----------------------------------------------------- |
| iOS      | `.mlmodelc` (compiled CoreML) | `coremltools.convert()` from a LayoutLMv3 ONNX export |
| Android  | `.onnx`                       | Fine-tune and export with `transformers` + `optimum`  |

> **Note**: DataLift expects a **token-classification** fine-tuned model. Labels must include `O` plus B-/I- tags for fields like `INVOICE_NUMBER`, `DATE`, `VENDOR_NAME`, `GRAND_TOTAL`.

Download the base model weights as a starting point:

```sh
yarn model:layoutlmv3:download
```

### Step 2 — Bundle the model

**iOS**: Add the `.mlmodelc` (or `.mlpackage`) and `layoutlmv3_labels.txt` to your Xcode project, ensuring they are included in **Copy Bundle Resources**.

**Android**: Place the `.onnx` file in `android/app/src/main/assets/` (or `assets/models/`). DataLift extracts it to `filesDir` on first use.

### Step 3 — Configure and use

```typescript
import { DataLift } from "@kajeevan025/react-native-datalift";

// Call once at app startup (resolves and validates the model path)
const configured = await DataLift.configureLayoutLMv3({
  modelPath: "layoutlmv3_invoice.mlmodelc", // bare name resolved from bundle
  labelsPath: "layoutlmv3_labels.txt",
}).catch(() => null); // fails gracefully if model not bundled

// Check if model is ready
if (DataLift.isLayoutLMv3Configured()) {
  console.log("LayoutLMv3 ready — 3 stages active");
}

// extract() automatically runs LayoutLMv3 when configured
const result = await DataLift.extract({ image: uri });
```

### Compatibility check

```typescript
const compat = await DataLift.checkLayoutLMv3Compatibility({
  modelPath: "layoutlmv3_invoice.mlmodelc",
  labelsPath: "layoutlmv3_labels.txt",
});

console.log(compat.compatible); // true / false
console.log(compat.runtime); // "coreml-ios" | "onnx-android"
console.log(compat.checks); // { model_file, labels_file, label_map, inference }
```

### Custom LayoutLMv3 runner (advanced)

```typescript
import {
  DataLift,
  HuggingFaceProvider,
  registerAIProvider,
} from "@kajeevan025/react-native-datalift";
import type { LayoutLMv3OfflineRunner } from "@kajeevan025/react-native-datalift";

const runner: LayoutLMv3OfflineRunner = async (input) => {
  // Call your own CoreML / ONNX inference here
  return {
    confidence: 0.91,
    fields: { invoice_number: "INV-001", grand_total: 123.45 },
  };
};

registerAIProvider(
  new HuggingFaceProvider({ model: "layoutlmv3-custom", runner }),
);
```

## AI Enhancement (Generic — Optional)

AI runs **only when rule-based confidence falls below `aiConfidenceThreshold`** (default `0.65`). Completely optional and non-fatal — if AI fails, the rule-based result is returned unchanged.

```typescript
import {
  DataLift,
  HuggingFaceProvider,
} from "@kajeevan025/react-native-datalift";

DataLift.configure({
  aiProvider: new HuggingFaceProvider({ model: "my-model", runner }),
  aiConfidenceThreshold: 0.7,
});

const result = await DataLift.extract({ image: base64 });
```

---

## Global Configuration

Call once at app startup before any `extract()` calls:

```typescript
import { DataLift } from "@kajeevan025/react-native-datalift";

DataLift.configure({
  aiConfidenceThreshold: 0.7, // default 0.65
  language: "en",
  extractRawText: false,
});
```

---

## Additional APIs

```typescript
// Extract raw OCR text only
const text = await DataLift.extractText({ image: base64, language: "en" });

// Classify document type without full extraction
const { type, confidence } = await DataLift.classifyDocument({ image: base64 });
// → { type: "invoice", confidence: 0.94 }

// Check whether LayoutLMv3 is configured and ready
const ready = DataLift.isLayoutLMv3Configured();
```

---

## Confidence Score

Each `metadata.confidenceScore` (0–1) is a weighted composite of 5 factors:

| Factor                  | Weight | Description                                 |
| ----------------------- | ------ | ------------------------------------------- |
| OCR Quality             | 15 %   | OCR engine's raw confidence                 |
| Field Population        | 35 %   | Ratio of non-empty required fields          |
| Numeric Consistency     | 20 %   | Line-item totals reconcile with grand total |
| Document Type Certainty | 15 %   | Uniqueness of document-type signal          |
| Keyword Match           | 15 %   | Presence of expected document keywords      |

When LayoutLMv3 runs and fills gaps, confidence is **re-scored** and the higher of the two scores is kept.

---

## Building

```sh
yarn build           # CJS + ESM + type declarations
yarn build:cjs       # → lib/cjs/
yarn build:esm       # → lib/esm/
yarn build:types     # → lib/types/
```

---

## Testing

```sh
yarn test                 # run once
yarn test --watch         # watch mode
yarn test --coverage      # with coverage report
```

Coverage thresholds: **branches ≥ 70%**, **functions/lines/statements ≥ 80%**.

---

## Running the Example App

```sh
cd example
yarn
yarn ios       # iOS simulator
yarn android   # Android emulator
```

---

## Document Types

| Value              | Description                                  |
| ------------------ | -------------------------------------------- |
| `"invoice"`        | Standard supplier invoice                    |
| `"receipt"`        | Point-of-sale or purchase receipt            |
| `"purchase_order"` | Buyer's purchase order                       |
| `"work_order"`     | Maintenance / repair work order              |
| `"bill"`           | Utility or service bill                      |
| `"quote"`          | Price quotation                              |
| `"cmms"`           | Computerised maintenance management document |
| `"generic"`        | Unrecognised / fallback                      |

---

## 3-Stage Pipeline

```
DataLift.extract()
   │
   ├─ 1. OCREngine.run()              Native (Vision/MLKit) → Tesseract fallback
   ├─ 2. RuleBasedParser.parse()      Column-table / form / multi-line NLP
   ├─ 3. ConfidenceEngine.score()     5-factor composite scoring
   ├─ 4. LayoutLMv3 prediction?       On-device model fills gaps (if configured)
   └─ 5. AIEngine.enhance()?          Generic AI fallback (if conf < threshold)
```

Stages 4 and 5 are both **optional and non-fatal** — if they fail, the rule-based result is returned unchanged.

---

## Requirements

| Requirement     | Version |
| --------------- | ------- |
| React Native    | ≥ 0.70  |
| TypeScript      | ≥ 5.0   |
| iOS             | ≥ 13.0  |
| Android API     | ≥ 21    |
| Node.js (build) | ≥ 18    |

---

## License

MIT © DataLift Contributors
