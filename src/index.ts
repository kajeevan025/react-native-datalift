/**
 * DataLift - React Native Document Scanner & Structured Extraction SDK
 *
 * Free, accurate document scanner with native OCR and AI classification.
 * Uses Apple Vision (iOS) and Google ML Kit (Android) for text recognition.
 *
 * @packageDocumentation
 */

// ─── Core extraction API ──────────────────────────────────────────────────────
export { DataLiftSDK as DataLift } from "./core/DataLift";
export type {
  DataLiftConfigureOptions,
  LayoutLMv3NativeConfig,
  LayoutLMv3CompatibilityResult,
} from "./core/DataLift";

// Schema / types
export type {
  DataLiftResponse,
  DataLiftMetadata,
  DataLiftSupplier,
  DataLiftBuyer,
  DataLiftTransaction,
  DataLiftTotals,
  DataLiftPart,
  DataLiftAddress,
  DataLiftContact,
  DataLiftTaxInformation,
  DataLiftCoordinates,
  DataLiftExtractOptions,
  DataLiftDocumentType,
  ImageInput,
} from "./schema/DataLiftResponse";

// OCR layer
export { OCREngine, registerOCRProvider, getOCRProvider } from "./ocr";
export { NativeMLKitOCR } from "./ocr";
export { TesseractOCR } from "./ocr";
export { OCRError } from "./ocr";
export type { OCRProvider, OCROptions, OCRResult } from "./ocr";

// AI layer
export { AIEngine, registerAIProvider, getAIProvider } from "./ai";
export { HuggingFaceProvider } from "./ai";
export { AIProviderError } from "./ai";
export type {
  AIProvider,
  AIEnhancementRequest,
  AIEnhancementResult,
  HuggingFaceProviderConfig,
  LayoutLMv3InferenceInput,
  LayoutLMv3InferenceResult,
  LayoutLMv3Entity,
  LayoutLMv3OfflineRunner,
} from "./ai";

// Parser layer
export { RuleBasedParser } from "./parser";
export type { RuleBasedParserOptions } from "./parser";

// Confidence scoring
export { ConfidenceEngine } from "./core";
export type { ConfidenceBreakdown } from "./core";

// Validation & errors
export {
  validateOptions,
  sanitiseResponse,
  DataLiftExtractError,
} from "./core";
export type { ValidationResult, DataLiftErrorCode } from "./core";

// Logger
export { createLogger, silentLogger } from "./utils/logger";
export type { DataLiftLogger, LogLevel } from "./utils/logger";

// Native module bridge
export {
  DataLift as DataLiftNative,
  isDataLiftAvailable,
} from "./NativeDataLift";
export type { DataLiftNativeInterface } from "./NativeDataLift";
