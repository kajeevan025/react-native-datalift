
/**
 * DataLift – OCR Provider abstraction
 *
 * All OCR providers must implement this interface.
 * This enables seamless swapping between Tesseract.js, ML Kit,
 * or any third-party OCR service at runtime.
 */

export interface OCRResult {
  /** Extracted plain text */
  text: string;
  /** Estimated confidence (0–1) */
  confidence: number;
  /** Number of text lines recognised */
  lineCount: number;
  /** Name of the provider that produced this result */
  provider: string;
}

export interface OCROptions {
  /** Source image: base64 encoded string, file URI or blob */
  imageData: string;
  /** Image MIME type (default: "image/jpeg") */
  mimeType?: string;
  /** BCP-47 language hint (e.g. "en", "fr", "de") */
  language?: string;
}

/**
 * Every OCR provider must implement this contract.
 */
export interface OCRProvider {
  /** Unique provider identifier – used to look up by key */
  readonly name: string;

  /**
   * Extract text from the supplied image.
   *
   * Implementations must:
   * - Never throw unhandled exceptions – always wrap in OCRError
   * - Return `confidence: 0` when confidence is unknown
   */
  extractText(options: OCROptions): Promise<OCRResult>;

  /** Return `true` if the provider is available on the current platform */
  isAvailable(): Promise<boolean>;
}

/**
 * Typed error thrown by OCR providers.
 */
export class OCRError extends Error {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly cause?: unknown,
  ) {
    super(`[${provider}] ${message}`);
    this.name = "OCRError";
  }
}
