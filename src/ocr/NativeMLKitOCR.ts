
/**
 * DataLift – Native ML Kit / Apple Vision OCR Provider
 *
 * Bridges to the existing DataLift native module which uses:
 *   iOS  → Apple Vision (VNRecognizeTextRequest)
 *   Android → Google ML Kit Text Recognition
 *
 * This is the primary OCR provider for React Native builds.
 * No extra dependencies required.
 */

import type { OCROptions, OCRProvider, OCRResult } from "./OCRProvider";
import { OCRError } from "./OCRProvider";

// ─── Lazy native module resolution (safe – never throws at import time) ──────

function getNativeModule(): {
  extractTextNative(opts: { uri: string; language?: string }): Promise<{
    text: string;
    lineCount: number;
    confidence?: number;
  }>;
} | null {
  try {
    // New Architecture (TurboModules)
    const { TurboModuleRegistry } = require("react-native");
    if (TurboModuleRegistry?.get) {
      const m = TurboModuleRegistry.get("DataLift");
      if (m) return m;
    }
  } catch {
    // fall through
  }

  try {
    const { NativeModules } = require("react-native");
    if (NativeModules?.DataLift) return NativeModules.DataLift;
  } catch {
    // fall through
  }

  return null;
}

// ─── Implementation ──────────────────────────────────────────────────────────

export class NativeMLKitOCR implements OCRProvider {
  readonly name = "native-mlkit";

  async isAvailable(): Promise<boolean> {
    return getNativeModule() !== null;
  }

  async extractText(options: OCROptions): Promise<OCRResult> {
    const native = getNativeModule();
    if (!native) {
      throw new OCRError(
        "Native module is not linked. Run `pod install` on iOS or clean build on Android.",
        this.name,
      );
    }

    // The native module expects a file URI, not base64
    // If caller provided base64 we save it to a temp file via the native module helpers.
    // For now we forward imageData assuming it is a URI; base64 path is handled by OCREngine.
    try {
      const result = await native.extractTextNative({
        uri: options.imageData,
        language: options.language ?? "en",
      });

      return {
        text: result.text ?? "",
        confidence: result.confidence ?? 0.85,
        lineCount: result.lineCount ?? result.text?.split("\n").length ?? 0,
        provider: this.name,
      };
    } catch (err) {
      throw new OCRError(
        `Text extraction failed: ${err instanceof Error ? err.message : String(err)}`,
        this.name,
        err,
      );
    }
  }
}
