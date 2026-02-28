# Changelog

All notable changes to `react-native-datalift` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
