# react-native-datalift

> Production-ready, cross-platform TypeScript SDK for intelligent document scanning and structured data extraction in React Native applications.

**DataLift** accepts images (Base64 or file URI), runs a unified **up-to-5-stage pipeline** — native OCR → rule-based NLP parser → confidence scoring → optional auto-downloaded LayoutLMv3 on-device AI → optional generic AI fallback — and returns a richly-typed [`DataLiftResponse`](#dataliftresponse-schema) object from a single `await DataLift.extract(...)` call.

[![npm version](https://img.shields.io/npm/v/@kajeevan025/react-native-datalift)](https://www.npmjs.com/package/@kajeevan025/react-native-datalift)
[![license](https://img.shields.io/npm/l/@kajeevan025/react-native-datalift)](LICENSE)

## Features

- **Up-to-5-stage pipeline** — Native OCR → Rule-based NLP parser → Confidence scoring → LayoutLMv3 AI → Generic AI fallback
- **Offline-first** — Apple Vision (iOS) and Google ML Kit (Android) with Tesseract.js fallback
- **Smart parser** — Column-table, vertical-form, and multi-line block detection with address/phone/policy-text filtering
- **LayoutLMv3 auto-download** — Model is discovered or downloaded automatically from GitHub Releases; CoreML (iOS) and ONNX Runtime (Android); no manual bundling required
- **Richer JSON output** — Payment details (method, card, bank), delivery details (address, tracking, carrier), notes, per-line-item `unit`, `listPrice`, currency code, `referenceNumber`, `workOrderNumber`
- **Confidence breakdown** — Per-factor scoring (`ocrQuality`, `fieldPopulation`, `numericConsistency`, `docTypeCertainty`, `keywordMatch`) alongside the composite score
- **Strongly typed** — Full TypeScript strict mode, no `any`
- **Multi-document** — Invoices, receipts, purchase orders, work orders, bills, quotes, CMMS documents
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

// Optional: pre-warm LayoutLMv3 model at startup
DataLift.configure({
  autoDownloadLayoutLMv3: true,
  onModelDownloadProgress: (p) =>
    console.log(`Model: ${Math.round(p.progressPercent)}%`),
});
await DataLift.prepareModel(); // auto-discovers or downloads model in background

// Basic extraction — OCR + rule-based parser + auto LayoutLMv3
const result = await DataLift.extract({
  image: "file:///path/to/document.jpg",
});

console.log(result.supplier.name);                    // "ACME Corp"
console.log(result.transaction.invoiceNumber);         // "INV-2024-0042"
console.log(result.transaction.referenceNumber);       // "REF-7890"
console.log(result.totals.grandTotal);                 // 1234.56
console.log(result.totals.currency);                   // "USD"
console.log(result.metadata.confidenceScore);          // 0.87
console.log(result.metadata.fieldCount);               // 24
console.log(result.paymentDetails?.method);            // "Credit Card"
console.log(result.deliveryDetails?.trackingNumber);   // "1Z999AA10123456784"
console.log(result.notes);                             // "Handle with care"
console.log(result.parts[0]?.unit);                    // "EA"
console.log(result.parts.length);                      // 5  (line items)
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
  /** Progress callback for auto-download (fires only when download is triggered) */
  onModelDownloadProgress?: (progress: ModelDownloadProgress) => void;
}
```

---

## `DataLiftResponse` Schema

```typescript
interface DataLiftResponse {
  metadata: {
    documentType: DataLiftDocumentType; // "invoice" | "receipt" | ...
    confidenceScore: number;            // 0–1 composite score
    confidenceBreakdown?: {             // NEW in v1.2.4 — per-factor scores
      ocrQuality: number;
      fieldPopulation: number;
      numericConsistency: number;
      docTypeCertainty: number;
      keywordMatch: number;
    };
    fieldCount?: number;                // NEW in v1.2.4 — non-empty fields extracted
    ocrProvider: string;                // which OCR engine was used
    aiProviderUsed?: string;            // which AI provider ran (if any)
    layoutLMv3Used?: boolean;           // true when LayoutLMv3 ran and improved results
    processingTimeMs: number;
    warnings: string[];                 // non-fatal issues from any stage
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
    address: { /* same shape as supplier.address */ };
    contact: { /* same shape as supplier.contact */ };
  };

  transaction: {
    invoiceNumber: string;
    purchaseOrderNumber: string;
    invoiceDate: string;        // ISO-8601 date
    dueDate: string;            // ISO-8601 date
    transactionTime: string;    // ISO-8601 time
    paymentTerms: string;       // e.g. "Net 30"
    currency: string;           // ISO-4217 e.g. "USD"
    paymentMethod: string;
    referenceNumber: string;    // NEW in v1.2.4
    workOrderNumber: string;    // NEW in v1.2.4
  };

  parts: Array<{
    lineNumber: number;
    partNumber: string;
    description: string;
    quantity: number;
    unit: string;               // NEW in v1.2.4 — e.g. "EA", "KG", "L", "HR"
    unitPrice: number;
    listPrice?: number;         // NEW in v1.2.4 — original list price before discount
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
    currency: string;           // NEW in v1.2.4 — ISO-4217 currency code
    amountDue: number;
    amountPaid: number;
    balanceDue: number;
  };

  // NEW in v1.2.4 ────────────────────────────────────────────────────
  paymentDetails?: {
    method: string;             // "Credit Card" | "EFT" | "Cash" | ...
    reference: string;          // transaction/payment reference
    cardType?: string;          // "Visa" | "Mastercard" | ...
    cardLast4?: string;         // last 4 digits
    bankBsb?: string;           // BSB (AU) or routing number
    bankAccount?: string;       // masked account number
    receiptNumber?: string;
  };

  deliveryDetails?: {
    address?: string;           // delivery address raw string
    date?: string;              // ISO-8601 delivery / ship date
    trackingNumber?: string;
    carrier?: string;           // "Australia Post" | "FedEx" | ...
    shippingMethod?: string;    // "Express" | "Standard" | ...
  };

  notes?: string;               // General freeform notes/instructions from document

  rawText?: string;             // Present when extractRawText: true
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

## LayoutLMv3 On-Device AI (Auto-download — v1.2.4+)

LayoutLMv3 is an optional **stage 4** that fills in fields the rule-based parser missed. It runs entirely on-device — no network inference request. Starting in **v1.2.4**, the model is **automatically discovered or downloaded** from GitHub Releases — no manual bundling steps.

- **iOS** uses CoreML (`MLModel`) — `.mlpackage.zip` bundle
- **Android** uses ONNX Runtime Mobile — `.onnx` file

### Zero-config auto-download

```typescript
import { DataLift } from "@kajeevan025/react-native-datalift";

DataLift.configure({
  autoDownloadLayoutLMv3: true,               // enable background download
  layoutLMv3ModelUrl: undefined,              // optional override URL
  onModelDownloadProgress: (p) =>
    console.log(`Downloading model: ${Math.round(p.progressPercent)}%`),
});

// Pre-warm at startup (recommended — download happens once, cached permanently)
await DataLift.prepareModel();

// extract() will automatically use LayoutLMv3 when ready
const result = await DataLift.extract({ image: uri });
```

`prepareModel()` will:
1. Check if a previously-downloaded model exists in app storage
2. If not, download the appropriate model for the platform from GitHub Releases
3. Configure the native LayoutLMv3 engine silently in the background

### Manual path configuration (advanced)

If you have your own fine-tuned model file already bundled or stored locally:

```typescript
// Call once at app startup (resolves and validates the model path)
const configured = await DataLift.configureLayoutLMv3({
  modelPath: "layoutlmv3_invoice.mlmodelc", // bare name resolved from bundle
  labelsPath: "layoutlmv3_labels.txt",
}).catch(() => null); // fails gracefully if model not bundled

// Check if model is ready
if (DataLift.isLayoutLMv3Configured()) {
  console.log("LayoutLMv3 ready — 4 stages active");
}
```

### Compatibility check

```typescript
const compat = await DataLift.checkLayoutLMv3Compatibility({
  modelPath: "layoutlmv3_invoice.mlmodelc",
  labelsPath: "layoutlmv3_labels.txt",
});

console.log(compat.compatible); // true / false
console.log(compat.runtime);    // "coreml-ios" | "onnx-android"
console.log(compat.checks);     // { model_file, labels_file, label_map, inference }
```

### Prepare your own model (optional)

Use the included helper script to convert a HuggingFace LayoutLMv3 checkpoint to CoreML (iOS) and int8 ONNX (Android):

```sh
bash scripts/prepare-model.sh microsoft/layoutlmv3-base ./output-models
```

The script exports `labels.json` and `vocab.json` alongside the model files. Upload them as a GitHub Release to use with `layoutLMv3ModelUrl`.

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
  aiConfidenceThreshold: 0.7,          // default 0.65
  language: "en",
  extractRawText: false,

  // v1.2.4 — LayoutLMv3 auto-download
  autoDownloadLayoutLMv3: true,         // download model automatically when needed
  layoutLMv3ModelUrl: undefined,        // optional: override the GitHub Releases URL
  onModelDownloadProgress: (p) => {
    // p: { totalBytes, downloadedBytes, progressPercent, modelFile }
    console.log(`${p.modelFile}: ${Math.round(p.progressPercent)}%`);
  },
});
```

---

## Additional APIs

```typescript
// Pre-warm LayoutLMv3 — auto-discovers existing model or downloads from GitHub Releases
// Returns the model paths once ready; rejects if download is disabled and no model found
await DataLift.prepareModel();

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

## Extraction Pipeline

```
DataLift.extract()
   │
   ├─ 1. OCREngine.run()              Native (Vision/MLKit) → Tesseract fallback
   ├─ 2. RuleBasedParser.parse()      Column-table / form / multi-line NLP
   │                                   ↳ payment details, delivery details, notes,
   │                                     unit-of-measure, reference numbers
   ├─ 3. ConfidenceEngine.score()     5-factor composite + per-factor breakdown
   ├─ 4. LayoutLMv3 prediction?       Auto-downloaded on-device model fills gaps
   │                                   ↳ auto-discovers cached file → downloads if
   │                                     autoDownloadLayoutLMv3=true (background)
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
