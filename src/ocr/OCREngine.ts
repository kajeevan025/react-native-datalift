
/**
 * DataLift – OCR Engine
 *
 * Orchestrates multiple OCR providers with fallback chain logic.
 * Default precedence: NativeMLKit → Tesseract
 *
 * Providers can be overridden via DataLift.registerOCRProvider().
 */

import type { DataLiftLogger } from "../utils/logger";
import type { OCROptions, OCRProvider, OCRResult } from "./OCRProvider";
import { OCRError } from "./OCRProvider";
import { NativeMLKitOCR } from "./NativeMLKitOCR";
import { TesseractOCR } from "./TesseractOCR";

// ─── Registry ────────────────────────────────────────────────────────────────

const _registry = new Map<string, OCRProvider>();

// Register built-in providers
_registry.set("native-mlkit", new NativeMLKitOCR());
_registry.set("tesseract", new TesseractOCR());

/** Default provider resolution order */
const DEFAULT_PROVIDER_ORDER = ["native-mlkit", "tesseract"];

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Register a custom OCR provider.
 * It will be placed at the front of the fallback chain.
 */
export function registerOCRProvider(provider: OCRProvider): void {
  _registry.set(provider.name, provider);
}

/**
 * Retrieve a registered provider by name.
 */
export function getOCRProvider(name: string): OCRProvider | undefined {
  return _registry.get(name);
}

// ─── Engine ──────────────────────────────────────────────────────────────────

export class OCREngine {
  private readonly logger: DataLiftLogger;
  private readonly preferredProvider: string | undefined;

  constructor(logger: DataLiftLogger, preferredProvider?: string) {
    this.logger = logger;
    this.preferredProvider = preferredProvider;
  }

  /**
   * Run OCR using the best available provider.
   * Falls back to the next provider if the preferred one is unavailable.
   */
  async run(options: OCROptions): Promise<OCRResult> {
    const order = this.buildProviderOrder();

    let lastError: Error = new OCRError(
      "No OCR provider available",
      "OCREngine",
    );

    for (const key of order) {
      const provider = _registry.get(key);
      if (!provider) continue;

      try {
        const available = await provider.isAvailable();
        if (!available) {
          this.logger.debug(
            `OCR provider '${key}' is not available – skipping`,
          );
          continue;
        }

        this.logger.info(`Running OCR with provider: ${key}`);
        const result = await provider.extractText(options);
        this.logger.debug(
          `OCR result (${key}): ${result.lineCount} lines, confidence=${result.confidence.toFixed(2)}`,
        );
        return result;
      } catch (err) {
        this.logger.warn(
          `OCR provider '${key}' failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    }

    throw lastError;
  }

  private buildProviderOrder(): string[] {
    if (this.preferredProvider) {
      const rest = DEFAULT_PROVIDER_ORDER.filter(
        (k) => k !== this.preferredProvider,
      );
      return [this.preferredProvider, ...rest];
    }
    return DEFAULT_PROVIDER_ORDER;
  }
}
