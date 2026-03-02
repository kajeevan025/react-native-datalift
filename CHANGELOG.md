# Changelog

All notable changes to `react-native-datalift` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
