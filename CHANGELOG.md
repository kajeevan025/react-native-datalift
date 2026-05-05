# Changelog

All notable changes to `react-native-datalift` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.4.0] — 2026-04-12

### Fixed — Extraction accuracy (54 issues resolved across 7 files)

#### `src/parser/primitives.ts`

- **EU currency parsing** (`parseAmount`) — `"€1.234,56"` previously stripped all non-digit/period chars to `"1.23456"` (wrong). Now uses a last-separator heuristic: whichever of `,` or `.` appears last is the decimal. `"1.234,56"` → `1234.56`; `"1,234.56"` → `1234.56`; `"1,234"` (3 digits after comma, no period) → `1234` (thousands separator).
- **`extractLabeledAmount` EU amounts** — updated all three amount-capture sites to call `parseAmount()`. Widened same-line capture group to match both US and EU decimal formats.
- **`extractFirstAmount` EU format** — added explicit EU-format match tried before bare-decimal fallback.
- **`PATTERNS.PHONE` missing separator** — inter-group separator now zero-or-more so `+61(03)9009-1234` (no space after country code) extracts correctly.
- **`PATTERNS.ABN_BARE` compact format** — spaces optional so `51824753556` recognised alongside `51 824 753 556`.
- **`extractPhones` false positives** — non-international numbers now require ≥8 stripped digits; date-shaped strings filtered out.

#### `src/core/confidence.ts`

- **Numeric consistency — scale-adaptive tolerance** — absolute difference also checked: `delta < 1% OR absDiff < $0.10` → 1.0; `delta < 5% OR absDiff < $1.00` → 0.8. Prevents small invoices from being harshly penalised for rounding.
- **OCR density threshold** — lowered from 50 → 20 words (thermal/POS receipts are short).
- **OCR confidence clamping** — provider confidence clamped to `[0, 1]`.

#### `src/parser/RuleBasedParser.ts`

- **Description lookahead false consumption** — next line not consumed as a description if it contains 2+ consecutive digits, a currency symbol+digit, or a price decimal (`XX.XX`). Prevents item rows from being silently swallowed.
- **PO number — space-only delimiter** — new fallback catches `PO <value>` with space separator, but only when the value contains at least one digit (avoids capturing column-header word "Number").

#### `src/ocr/NativeMLKitOCR.ts`

- **Default confidence** — fallback when native layer omits confidence lowered from `0.75` → `0.5`.
- **Confidence clamping** — raw native confidence clamped to `[0, 1]`.
- **`lineCount` empty lines** — empty/whitespace-only lines filtered before counting.

### Fixed — Example app (`example/App.tsx`)

- **`autoDownloadLayoutLMv3`** — was hardcoded `false` (iOS never got the AI model). Now `Platform.OS !== "android"`: Android uses bundled ONNX, iOS downloads CoreML on first run.
- **Language detection** — removed hardcoded `language: "en"`; SDK now auto-detects from document content.
- **`debug` logging** — `debug: __DEV__` added to `configure()` and `extract()`.
- **Line items expand** — `slice(0, 8)` replaced with a "Show all N items" toggle button. Item descriptions shown on second line.
- **Delivery address** — `address` object now renders `fullAddress` string, not `[object Object]`.

### Added

- `scripts/sync-models.sh` — one-command model-artifact sync from `datalift-model-training/dist/models/`
- `INTEGRATION.md` — full integration guide: artifacts table, 39-label schema, pipeline diagram, Android/iOS model resolution

---

## [1.2.5] — 2026-03-02

### Fixed — Real-world parser accuracy (92/92 ground-truth tests)

- **`invHeaderRx` false capture** — `^(?:invoice|inv)[\s#]*` allowed the `inv` branch to match `INVOICE` and capture `OICE` as the invoice number; changed to `^invoice\s+(\d[\w\-/]{2,20})$` (full word, digit-start capture)
- **`bodyStartKeywords` matching company names** — bare `^total` was matching `Total Maintenance Solutions South, Inc.` → `headerEnd = 0` → blank `supplier.name`; replaced with `sub[\s\-]*total|grand\s*total` only
- **`extractFromColumnTable` wrong header selection** — `PO Number Term Description` row was chosen as the product-table header; added `strongHeaderIdx` (last header containing `qty` / `ordered` / `unit price` / `unit cost` / `shipped` indicators), falling back to the original weak header
- **Look-ahead absorbing date lines** — when `itemName` was a short UOM token (`EA`) the look-ahead grabbed the next line (`11/29/2023 ORDER NUMBER`) as the description; guarded with a decimal check (`lastCandidateNum !== Math.floor(lastCandidateNum)`) — product totals are decimals, date-line last tokens are integers
- **$100 K sanity guard** — `extractFromColumnTable` now skips any line item whose `total > 100 000`, preventing runaway values from misaligned columns
- **ORDER NUMBER multi-line fallback** — `extractTransaction` now reads the value on the following line when `ORDER NUMBER` appears alone, mapping it to `purchaseOrderNumber`
- **PREPAID payment terms** — added scan of the `Term Description` block for `PREPAID` and `NET-N` patterns; previously returned `undefined`
- **Payment-terminal & page-separator lines** — extended `NON_PRODUCT_LINE_RX` in `primitives.ts` with card-reader patterns (`mastercard`, `visa`, `appr code`, `tvr:`, `aid:`, `batch #`, `rrn:`) and page separators (`--- Page 2 ---`)

### Added

- **`RealWorldAccuracy` test suite** (`src/__tests__/RealWorldAccuracy.test.ts`) — 92 ground-truth assertions across 5 real invoice / receipt documents (HSC tabular parts invoice, TMS Cash Sale, NAPA Auto, Lowe's, generic retail); all 92 pass

### Changed — Example app

- `ResultTile` in `example/App.tsx` now renders every field in the current schema:
  - **Supplier**: phone, email, full address
  - **Buyer / Bill-To**: new conditional section (was never shown)
  - **Transaction**: PO #, invoice date, due date, payment terms, payment mode
  - **Totals**: full breakdown — subtotal → tax → shipping → discount → amount paid → balance due → grand total (was grand total only)
  - **Line items**: up to 5 shown (was 3); each row includes SKU and currency
  - **Confidence breakdown**: per-factor percentages (ocr / fields / numeric / docType / keywords)
  - **Currency badge** added to the result-card header row

---

## [1.2.4] — 2026-03-02

### Added

- **LayoutLMv3 auto-discovery & auto-download** — the model is now found and activated automatically
  - `ModelManager` utility (`src/utils/ModelManager.ts`) manages the full on-device model lifecycle:
    checks local storage → downloads from GitHub Releases if missing → auto-configures the native engine
  - `DataLiftSDK.prepareModel({ autoDownload: true, onProgress })` — new public API to warm-up the model at launch
  - `DataLift.configure({ autoDownloadLayoutLMv3: true })` — global flag; fires a background download on first `extract()` and uses the model on every subsequent call
  - `ModelManager`, `ModelPaths`, `ModelDownloadProgress`, `EnsureModelOptions` all exported from the package root
  - `scripts/prepare-model.sh` — script to convert HuggingFace LayoutLMv3 → CoreML (iOS) + int8 ONNX (Android) and package for GitHub Releases
- **Native model storage helpers**
  - iOS `getModelStorageDir()` — returns `Library/Application Support/DataLift/models/layoutlmv3/`, creates it if absent
  - iOS `downloadModelFile({ url, destination })` — streaming `URLSession.downloadTask`, no in-memory buffering
  - Android `getModelStorageDir()` — returns `<filesDir>/DataLift/models/layoutlmv3/`
  - Android `downloadModelFile({ url, destination })` — streaming `HttpURLConnection` with 128 KB buffer
- **Richer JSON schema** (all new fields optional, zero breaking changes)
  - `DataLiftPaymentDetails` — `method`, `reference`, `cardType`, `cardLast4`, `bankBsb`, `bankAccount`, `receiptNumber`
  - `DataLiftDeliveryDetails` — `address`, `date`, `trackingNumber`, `carrier`, `shippingMethod`
  - `DataLiftResponse.paymentDetails`, `.deliveryDetails`, `.notes`
  - `DataLiftPart.unit`, `.listPrice`
  - `DataLiftTotals.currency`
  - `DataLiftTransaction.referenceNumber`, `.workOrderNumber`
  - `DataLiftMetadata.confidenceBreakdown` (`ocr`, `fields`, `numeric`, `docType`, `keyword`), `.fieldCount`
- **Improved extraction accuracy**
  - `extractPaymentDetails()` — detects payment method, card brand/last4, BSB, bank account, receipt/auth codes
  - `extractDeliveryDetails()` — detects ship-to address, dispatch date, tracking number, carrier, shipping method
  - `extractNotes()` — captures labeled note/remark/instruction blocks
  - `parseLineItem()` now extracts unit of measure (ea, pcs, kg, m, hr, box, …) with normalisation
  - `RuleBasedParser` extracts `referenceNumber`, `workOrderNumber` from transaction; emits `currency` on totals; computes `fieldCount`
  - `UOM` pattern added to `PATTERNS` for unit-of-measure regex reuse

### Changed

- `DataLift.configure()` now accepts `autoDownloadLayoutLMv3`, `layoutLMv3ModelUrl`, `onModelDownloadProgress`
- `extract()` step 5.5 now includes auto-discovery and background download before the existing LayoutLMv3 prediction block
- `NativeDataLift` interface extended with `getModelStorageDir()` and `downloadModelFile()` methods

## [1.2.3] — 2026-03-02

### Changed

- **Package renamed to `@kajeevan025/react-native-datalift`** — scoped under the GitHub owner so the package appears in the repository's **Packages** tab on GitHub
  - Install: `yarn add @kajeevan025/react-native-datalift`
  - `publishConfig` in `package.json` now points to `https://npm.pkg.github.com` by default; use `yarn publish:npm` to push to the public npm registry
- `keywords` cleaned — removed stale `"openai"` entry (OpenAI provider was removed in 1.2.1), added `"layoutlmv3"`
- Minor whitespace normalisation in `src/core/DataLift.ts` (formatter-only, no logic change)

### Added

- **GitHub Actions CI** (`.github/workflows/ci.yml`) — runs typecheck, tests with coverage, and build on every push/PR against `main`, across Node 18 and 20
- **GitHub Actions Publish** (`.github/workflows/publish.yml`) — on every `v*.*.*` tag push, automatically publishes to both npm (`NPM_TOKEN` secret) and GitHub Packages (`GITHUB_TOKEN`; no secret needed)

### Documentation

- README install command updated: `yarn add @kajeevan025/react-native-datalift`
- All code-block imports updated to use the scoped package name
- npm badge URLs updated to point to `@kajeevan025/react-native-datalift`

---

## [1.2.2] — 2026-03-10

### Fixed — Parser quality

- **Number regex hardening** — replaced `\d{1,3}(?:,\d{3})*` with `(?:\d{1,3}(?:,\d{3})+|\d{1,9})` so 5-digit values (ZIP codes, policy numbers) are no longer split into fake quantity/price pairs
- **Non-product line filter** — added `NON_PRODUCT_LINE_RX` + `isNonProductLine()` guard in `primitives.ts`; filters out address blocks, phone numbers, email lines, and header/footer text before line-item extraction
- **Scan-all-lines fallback tightened** — now requires at least one price-like decimal (e.g. `12.34`) before yielding a candidate line item; prevents addresses/policies from leaking into `parts[]`

### Fixed — LayoutLMv3 model path resolution

- **iOS `DataLiftModule.swift`** — `filePathFromUri` returns `String?` (was non-optional); bare filename → `nil` instead of being passed as a path; `resolveBundlePath` now tries `.mlmodelc` then `.mlpackage` in the main bundle before falling back to the raw name; `configureLayoutLMv3` emits actionable error messages with placement instructions
- **Android `DataLiftModule.kt`** — `filePathFromUri` returns `String?` (was non-optional); bare filename → `null`; `resolveBundlePath` copies the asset from APK `assets/` to `filesDir` on first use so ONNX Runtime can open it; improved error messages
- **`DataLift.ts`** — `_layoutLMv3Config` now tracks a `configured: boolean`; `extract()` step 4 (LayoutLMv3) is skipped unless `configured === true` (or a verified absolute path is passed); `isLayoutLMv3Configured()` exported for runtime checks

### Changed — Example app

- `App.tsx` tracks `modelConfigured` state; passes `layoutLMv3ModelPath` to `extract()` only when the model was successfully configured

### Removed — Example app

- Dangling `process-dataset` and `test:extraction` scripts from `example/package.json` (referenced deleted files `TestDataSetProcessor.ts` and `DocumentProcessor.test.ts`)
- `ts-node` devDependency from `example/package.json` (not needed after script removal)

### Documentation

- README fully rewritten: removed stale OpenAI, `useDataLift`, `DocumentScanner` sections; corrected `DataLiftExtractOptions` fields (`aiConfidenceThreshold`, new `layoutLMv3*` fields); corrected `DataLiftResponse` schema (`metadata.confidenceScore`, `metadata.warnings`, `metadata.aiProviderUsed`); added LayoutLMv3 model bundling guide (iOS `.mlmodelc`, Android `assets/`); updated architecture diagram to include step 4 (LayoutLMv3)

---

## [1.2.1] — 2026-03-02

### Changed

- **Package size reduced ~60 %** — unpacked 1.3 MB → 514 KB (packed 109 KB, 42 JS files)
  - Removed duplicate `.d.ts` files from CJS build (types served from `lib/types/` only)
  - Disabled source-map (`.js.map`) and declaration-map (`.d.ts.map`) emission
  - Added `.npmignore` safety-net rules for map files and `src/`
- Added `sideEffects` field in `package.json` to enable bundler tree-shaking
- Logger `warn()` and `error()` now respect the `enabled` flag — no more console noise in production when debug is off
- OCR built-in providers (`NativeMLKitOCR`, `TesseractOCR`) are lazily instantiated on first use instead of at module load time — improves startup and tree-shaking

### Removed

- **`OpenAIProvider`** — dead code for on-device LayoutLMv3 use case; removed provider, test, and all exports
- **Legacy pipeline (47 % of source):**
  - `DocumentProcessor.ts` (1,998 lines) — duplicated `RuleBasedParser` logic
  - `ExtractionPatterns.ts` (589 lines) — only consumed by `DocumentProcessor`
  - `types.ts` (380 lines) — legacy type system superseded by `DataLiftResponse` schema
  - `useDataLift` hook (474 lines) — wrapper around core `DataLift.extract()`, consumers now call the SDK directly
  - `DataLiftScanner` component + `styles.ts` (521 lines) — legacy UI component with tightly-coupled camera/gallery flow
  - Related test files (`DocumentProcessor.test.ts`, `EnhancedExtraction.test.ts`)
- `react-native-image-picker` lazy-require from `useDataLift` / `DataLiftScanner` (files deleted)
- Internal component `styles` no longer exported from the public API surface
- Example app rewritten to use core `DataLift.extract()` + `DataLift.extractUnifiedSchema()` APIs directly

### Fixed

- **Shared regex state bug** — removed the global (`g`) flag from `PATTERNS` constants in `primitives.ts`; multi-match callers now create local copies via `matchAll()`, preventing intermittent extraction misses caused by shared `lastIndex`
- `OpenAIProvider.isAvailable()` no longer rejects valid API keys that don't start with `sk-` (removed with provider)

## [1.2.0] — 2026-02-28

### Added

- **New test suites** for AIEngine, OCREngine, OpenAIProvider, HuggingFaceProvider, UnifiedDraft07, and Logger — bringing total to 186 passing tests
- `CHANGELOG.md` (this file)
- Stricter TypeScript config: `noUnusedLocals` and `noUnusedParameters` enabled

### Changed

- `react-native-image-picker` moved from `dependencies` to `peerDependencies` (optional) — consumers who only use `DataLift.extract()` no longer need it installed
- `prepare` script replaced with `prepublishOnly` — prevents build running on consumer `yarn add`
- Minimum Node.js engine bumped to `>=18.0.0`
- Added `clean` script (`rm -rf lib/`)
- Raw `console.*` calls in `DocumentProcessor` replaced with pluggable `Logger` utility
- Duplicate `toNumber()`, `toIsoDate()`, `detectDocType()` implementations consolidated — canonical home is `schema/UnifiedDraft07`
- Removed ~350 lines of dead code from `useDataLift.ts` (unused mapper functions)
- Removed unused imports and variables across `AIEngine`, `confidence`, `primitives`, `RuleBasedParser`, `DocumentProcessor`, `ExtractionPatterns`

### Fixed

- Android `minSdkVersion` documented as 21 (matching `build.gradle`) — was incorrectly listed as 23 in README

### Removed

- Stale `lib/` root-level build artefacts (12 files + 3 subdirectories)
- Duplicate `DataLift.podspec` (only `react-native-datalift.podspec` remains)
- `DataSet/` folder (sample images and JSON schemas — not part of the SDK)
- `example/output/` and `example/App.tsx.backup`
- 127+ Copilot attribution comments from source files

## [1.1.0] — 2025-12-01

### Added

- Unified Draft-07 JSON Schema validation (`schema/UnifiedDraft07`)
- HuggingFace offline LayoutLMv3 AI provider
- `useDataLift` React hook for programmatic document processing
- `DocumentScanner` / `DataLiftScanner` React component
- 5-factor composite confidence scoring (`core/confidence`)
- Pluggable OCR engine registry with fallback chain
- Pluggable AI engine registry (OpenAI, HuggingFace)
- Dual CJS + ESM build output

### Changed

- Extraction pipeline upgraded from basic regex to hybrid rule-based NLP
- PHONE regex hardened (prevents cross-newline matches)
- ZIP+4 codes filtered from phone extraction
- Invoice/PO number patterns improved
- Payment terms and carrier validation tightened
- Line item parsing overhauled with column-based table detection

## [1.0.0] — 2025-06-01

### Added

- Initial release
- Native OCR via Apple Vision (iOS) and ML Kit (Android)
- Tesseract.js offline fallback
- Basic rule-based text extraction
- React Native Old + New Architecture support (TurboModules)
- TypeScript types for all public APIs
