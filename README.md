# react-native-datalift

> Production-ready, cross-platform TypeScript SDK for intelligent document scanning and data extraction in React Native applications.

**DATALIFT** accepts images (Base64, file URI, or `Blob`), extracts text via OCR, processes documents with a hybrid rule-based NLP engine and optional AI enhancement, and returns a richly-typed [`DataLiftResponse`](#datalliftresponse-schema) object — from a single `await DataLift.extract(...)` call.

## Features

- **Offline-first** — Native OCR (Apple Vision / ML Kit) with Tesseract.js fallback
- **Pluggable AI** — Optional OpenAI or offline HuggingFace LayoutLMv3 enhancement for low-confidence results
- **Strongly typed** — Full TypeScript types with no `any`, strict mode
- **Multi-document support** — invoices, receipts, purchase orders, work orders, bills, quotes, CMMS documents
- **Confidence scoring** — 5-factor composite confidence score per extraction
- **React Native compatible** — iOS + Android, Old & New Architecture (TurboModules)
- **ESM + CJS** — Dual build, works with Metro bundler and Node.js

---

## Installation

```sh
yarn add react-native-datalift
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
import { DataLift } from "react-native-datalift";

const result = await DataLift.extract({
  image: base64String, // Base64 encoded image
  documentType: "invoice", // Optional hint — auto-detected if omitted
  extractRawText: true, // Include raw OCR text in response
});

console.log(result.supplier.name); // "ACME Corp"
console.log(result.transaction.invoiceNumber); // "INV-2024-0042"
console.log(result.totals.grandTotal); // 1234.56
console.log(result.metadata.confidence); // 0.91
```

---

## Input Formats

```typescript
// 1. Base64 string (with or without data URI prefix)
await DataLift.extract({ image: "data:image/jpeg;base64,/9j/4AAQ..." });
await DataLift.extract({ image: "/9j/4AAQSkZJRgAB..." });

// 2. File URI
await DataLift.extract({ image: "file:///path/to/scanned-doc.jpg" });

// 3. Blob (web / Expo environments)
await DataLift.extract({ image: blob });
```

---

## `DataLift.extract()` Options

```typescript
interface DataLiftExtractOptions {
  /** Image to extract data from — Base64, file URI, or Blob */
  image: string | Blob;

  /** Hint for document type — improves extraction accuracy */
  documentType?:
    | "invoice"
    | "receipt"
    | "purchase_order"
    | "work_order"
    | "bill"
    | "quote"
    | "cmms"
    | "generic";

  /** Named OCR provider to use — e.g. "native-mlkit" | "tesseract" */
  ocrProvider?: string;

  /** BCP-47 language code hint for OCR — e.g. "en", "fr", "de" */
  language?: string;

  /** AI provider to use for enhancement — e.g. "openai" | "huggingface" */
  aiProvider?: string;

  /** Confidence threshold (0–1) below which AI enhancement is triggered */
  aiThreshold?: number; // Default: 0.75

  /** Include raw OCR text in response.rawText */
  extractRawText?: boolean;

  /** Log verbose debug output to the console */
  debug?: boolean;
}
```

---

## `DataLiftResponse` Schema

```typescript
interface DataLiftResponse {
  metadata: {
    documentType: DataLiftDocumentType; // "invoice" | "receipt" | ...
    confidence: number; // 0–1 composite score
    ocrProvider: string; // which OCR engine was used
    aiEnhanced: boolean; // was AI called?
    languageDetected: string; // BCP-47 code e.g. "en"
    extractionTimestamp: string; // ISO-8601
    pageCount: number;
    processingTimeMs: number;
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

| Priority | Provider                     | ID               | Requires                |
| -------- | ---------------------------- | ---------------- | ----------------------- |
| 1        | Native ML Kit / Apple Vision | `"native-mlkit"` | Native module           |
| 2        | Tesseract.js (offline)       | `"tesseract"`    | `tesseract.js` peer dep |

### Force a specific provider

```typescript
await DataLift.extract({ image: base64, ocrProvider: "tesseract" });
```

### Register a custom OCR provider

```typescript
import { OCREngine } from "react-native-datalift";
import type { OCRProvider, OCROptions, OCRResult } from "react-native-datalift";

const myProvider: OCRProvider = {
  name: "my-custom-ocr",
  async extractText(options: OCROptions): Promise<OCRResult> {
    const text = await myOCRService.process(options.imageData);
    return { text, confidence: 0.9, provider: "my-custom-ocr" };
  },
  async isAvailable(): Promise<boolean> {
    return myOCRService.isReady();
  },
};

OCREngine.registerProvider(myProvider);

await DataLift.extract({ image: base64, ocrProvider: "my-custom-ocr" });
```

### Install Tesseract.js (optional)

```sh
yarn add tesseract.js
```

---

## AI Enhancement

AI runs **only when rule-based confidence falls below `aiThreshold`** (default `0.75`). Completely optional and non-fatal — if AI fails, the rule-based result is returned unchanged.

### OpenAI

```typescript
DataLift.configure({
  openai: {
    apiKey: "sk-...",
    model: "gpt-4o-mini", // Default
    timeoutMs: 15000,
  },
  aiThreshold: 0.7,
});

const result = await DataLift.extract({ image: base64, aiProvider: "openai" });
```

### HuggingFace (Offline LayoutLMv3)

`react-native-datalift` supports `microsoft/layoutlmv3-base` in offline mode.
No network request is made by the HuggingFace provider.

Download model assets into the plugin:

```sh
yarn model:layoutlmv3:download
```

```typescript
import {
  DataLift,
  HuggingFaceProvider,
  registerAIProvider,
  type LayoutLMv3OfflineRunner,
} from "react-native-datalift";

const layoutlmv3Runner: LayoutLMv3OfflineRunner = async (input) => {
  // Call your on-device native runner here (CoreML / ONNX Runtime Mobile)
  // using local model files at input.modelDir.
  // Must return entities/fields from local inference only.
  return {
    confidence: 0.91,
    fields: {
      invoice_number: "2927935",
      grand_total: 31.23,
    },
  };
};

registerAIProvider(
  new HuggingFaceProvider({
    model: "microsoft/layoutlmv3-base",
    offlineModelDir: "assets/models/layoutlmv3-base",
    runner: layoutlmv3Runner,
  }),
);

DataLift.configure({
  aiProvider: new HuggingFaceProvider({
    model: "microsoft/layoutlmv3-base",
    offlineModelDir: "assets/models/layoutlmv3-base",
    runner: layoutlmv3Runner,
  }),
  aiConfidenceThreshold: 0.7,
});

const result = await DataLift.extract({
  image: base64,
  aiProvider: "huggingface",
});
```

### Native-first LayoutLMv3 (plugin-owned prediction)

`extractInvoiceSchema()` is now fully native model-owned. iOS and Android run `predictLayoutLMv3` internally and return final JSON directly from native extraction.

```typescript
import { DataLift, useDataLift } from "react-native-datalift";

await DataLift.configureLayoutLMv3({
  modelPath: "file:///.../layoutlmv3/model.onnx",
  labelsPath: "file:///.../layoutlmv3/labels.json",
});

const hook = useDataLift({
  language: "eng",
  layoutLMv3ModelPath: "file:///.../layoutlmv3/model.onnx",
  layoutLMv3LabelsPath: "file:///.../layoutlmv3/labels.json",
  requireLayoutLMv3: true,
});

const schema = await hook.extractInvoiceSchema(imageUri);
console.log(schema.audit?.model);
```

When `requireLayoutLMv3` is `true`, extraction fails if native model predictions are missing.

---

## `DataLift.configure()`

Call once at app startup:

```typescript
import { DataLift } from "react-native-datalift";

DataLift.configure({
  aiConfidenceThreshold: 0.7,
  language: "en",
  extractRawText: true,
});
```

---

## Additional APIs

```typescript
// Extract raw text only
const text = await DataLift.extractText({
  image: base64,
  ocrProvider: "native-mlkit",
  language: "en",
});

// Classify document type only
const { type, confidence } = await DataLift.classifyDocument({ image: base64 });
// { type: "invoice", confidence: 0.94 }
```

---

## React Hook

```typescript
import { useDataLift } from 'react-native-datalift';

function ScanScreen() {
  const { result, isProcessing, error, processDocument } = useDataLift();

  const handleCapture = async (imageUri: string) => {
    await processDocument({ image: imageUri });
  };

  if (isProcessing) return <ActivityIndicator />;
  if (error) return <Text>Error: {error.message}</Text>;
  if (result) return <Text>Total: {result.totals.grandTotal}</Text>;
}
```

---

## DocumentScanner Component

```tsx
import { DocumentScanner } from "react-native-datalift";

<DocumentScanner
  onDocumentScanned={(result) => console.log(result)}
  onError={(err) => console.error(err)}
  documentType="invoice"
  enableAI={false}
  style={{ flex: 1 }}
/>;
```

---

## Confidence Score

Each `metadata.confidence` (0–1) is a weighted composite of 5 factors:

| Factor                  | Weight | Description                             |
| ----------------------- | ------ | --------------------------------------- |
| OCR Quality             | 15%    | OCR engine's raw confidence             |
| Field Population        | 35%    | Ratio of non-empty required fields      |
| Numeric Consistency     | 20%    | Parts totals reconcile with grand total |
| Document Type Certainty | 15%    | Uniqueness of classification signal     |
| Keyword Match           | 15%    | Presence of expected document keywords  |

---

## Building

```sh
yarn typecheck       # type-check only (no emit)

yarn build           # all three targets
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
yarn react-native run-ios       # iOS
yarn react-native run-android   # Android
```

---

## Publishing to npm

```sh
yarn build
yarn publish --access public
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

## Architecture

```
DataLift.extract()
   │
   ├── validateOptions()         ← input validation
   ├── resolveImageData()        ← base64 / URI / Blob normalisation
   ├── OCREngine.extractText()   ← native → tesseract fallback chain
   ├── RuleBasedParser.parse()   ← NLP extraction
   ├── ConfidenceEngine.score()  ← 5-factor scoring
   ├── AIEngine.enhance()?       ← OpenAI / HuggingFace (if conf < threshold)
   └── sanitiseResponse()        ← type safety + field normalisation
```

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

MIT © DATALIFT Contributors
