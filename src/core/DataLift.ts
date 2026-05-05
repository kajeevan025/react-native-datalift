/**
 * DataLift – Main extraction API
 *
 * Entry point for all document extraction operations.
 *
 * Usage:
 *   import { DataLift } from "react-native-datalift";
 *
 *   const result = await DataLift.extract({ image: base64String });
 *   console.log(result);
 *
 * Advanced usage:
 *   DataLift.configure({
 *     aiConfidenceThreshold: 0.7,
 *     aiProvider: new HuggingFaceProvider({ runner: myLayoutLMv3Runner }),
 *     ocrProvider: new TesseractOCR(),
 *   });
 */

import type {
  DataLiftExtractOptions,
  DataLiftResponse,
} from "../schema/DataLiftResponse";
import { createLogger } from "../utils/logger";
import { OCREngine, registerOCRProvider } from "../ocr/OCREngine";
import { AIEngine, registerAIProvider } from "../ai/AIEngine";
import type { OCRProvider } from "../ocr/OCRProvider";
import type { AIProvider } from "../ai/AIProvider";
import { RuleBasedParser } from "../parser/RuleBasedParser";
import { ConfidenceEngine } from "./confidence";
import {
  validateOptions,
  sanitiseResponse,
  DataLiftExtractError,
} from "./validator";

// ─── Global configuration ─────────────────────────────────────────────────────

interface DataLiftConfig {
  /** Default AI confidence threshold (default: 0.65) */
  defaultAIThreshold: number;
  /** Default OCR language (default: "en") */
  defaultLanguage: string;
  /** Whether to include raw OCR text in responses by default */
  defaultExtractRawText: boolean;
}

const _config: DataLiftConfig = {
  defaultAIThreshold: 0.65,
  defaultLanguage: "en",
  defaultExtractRawText: false,
};

export interface DataLiftConfigureOptions {
  aiConfidenceThreshold?: number;
  language?: string;
  extractRawText?: boolean;
  /** Register a custom OCR provider as the primary provider */
  ocrProvider?: OCRProvider;
  /** Register a custom AI provider */
  aiProvider?: AIProvider;
}

export interface DataLiftUnifiedExtractOptions {
  imageInput: string | string[];
  fileNames?: string[];
  language?: string;
}

// ─── DataLift namespace ───────────────────────────────────────────────────────

export const DataLiftSDK = {
  /**
   * Globally configure DataLift defaults and register providers.
   *
   * Call this once at app startup before any `extract()` calls.
   */
  configure(options: DataLiftConfigureOptions): void {
    if (options.aiConfidenceThreshold !== undefined) {
      _config.defaultAIThreshold = options.aiConfidenceThreshold;
    }
    if (options.language !== undefined) {
      _config.defaultLanguage = options.language;
    }
    if (options.extractRawText !== undefined) {
      _config.defaultExtractRawText = options.extractRawText;
    }
    if (options.ocrProvider) {
      registerOCRProvider(options.ocrProvider);
    }
    if (options.aiProvider) {
      registerAIProvider(options.aiProvider);
    }
  },

  /**
   * Extract structured data from a document image.
   *
   * @param options – extraction configuration including the image source
   * @returns       DataLiftResponse – fully typed, sanitised JSON
   *
   * @throws DataLiftExtractError on validation failure or unrecoverable errors
   */
  async extract(options: DataLiftExtractOptions): Promise<DataLiftResponse> {
    if (options.timeoutMs && options.timeoutMs > 0) {
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new DataLiftExtractError(
                `extract() timed out after ${options.timeoutMs}ms`,
                "TIMEOUT",
              ),
            ),
          options.timeoutMs,
        ),
      );
      return Promise.race([this._extractImpl(options), timeoutPromise]);
    }
    return this._extractImpl(options);
  },

  async _extractImpl(
    options: DataLiftExtractOptions,
  ): Promise<DataLiftResponse> {
    const startTime = Date.now();
    const debug = options.debug ?? false;
    const logger = createLogger(debug);

    // ── 1. Validate input ─────────────────────────────────────────────────────
    const validation = validateOptions(options);
    if (!validation.valid) {
      throw new DataLiftExtractError(
        `Invalid options: ${validation.errors.join("; ")}`,
        "INVALID_INPUT",
      );
    }

    logger.info("DataLift.extract() started");

    // ── 2. Resolve image data ─────────────────────────────────────────────────
    const imageData = this.resolveImageData(options);
    logger.debug(
      `Image resolved, type: ${typeof imageData === "string" ? "string/uri" : "blob"}`,
    );

    // ── 3. OCR extraction ────────────────────────────────────────────────────
    const language = options.language ?? _config.defaultLanguage;
    const ocrEngine = new OCREngine(logger, options.ocrProvider);
    let ocrResult: Awaited<ReturnType<OCREngine["run"]>>;

    try {
      ocrResult = await ocrEngine.run({
        imageData,
        language,
      });
    } catch (err) {
      throw new DataLiftExtractError(
        `OCR extraction failed: ${err instanceof Error ? err.message : String(err)}`,
        "OCR_FAILED",
        err,
      );
    }

    logger.info(
      `OCR complete – ${ocrResult.lineCount} lines, conf=${(ocrResult.confidence * 100).toFixed(1)}%`,
    );

    // ── 4. Rule-based parsing ────────────────────────────────────────────────
    const parser = new RuleBasedParser();
    let response: DataLiftResponse;

    try {
      response = parser.parse(ocrResult.text, {
        documentType: options.documentType,
        language,
      });
    } catch (err) {
      throw new DataLiftExtractError(
        `Parsing failed: ${err instanceof Error ? err.message : String(err)}`,
        "PARSE_FAILED",
        err,
      );
    }

    // Stamp OCR provider
    response.metadata.ocrProvider = ocrResult.provider;

    // ── 5. Confidence scoring ────────────────────────────────────────────────
    const confidenceEngine = new ConfidenceEngine();
    const breakdown = confidenceEngine.score(
      response,
      ocrResult.text,
      ocrResult.confidence,
      response.metadata.documentType,
    );
    response.metadata.confidenceScore = breakdown.overall;
    response.metadata.confidenceBreakdown = {
      ocr: breakdown.ocr,
      fields: breakdown.fields,
      numeric: breakdown.numeric,
      docType: breakdown.docType,
      keyword: breakdown.keyword,
    };
    if (response.metadata.fieldCount === undefined) {
      // fieldCount populated by RuleBasedParser; ensure it's always set
      response.metadata.fieldCount = 0;
    }

    logger.info(`Confidence: ${(breakdown.overall * 100).toFixed(1)}%`);
    logger.debug("Confidence breakdown:", breakdown);

    // ── 6. AI enhancement (optional) ────────────────────────────────────────
    const aiThreshold =
      options.aiConfidenceThreshold ?? _config.defaultAIThreshold;
    const currentConfidence =
      response.metadata.confidenceScore ?? breakdown.overall;

    if (currentConfidence < aiThreshold) {
      logger.info(
        `Confidence ${(currentConfidence * 100).toFixed(0)}% < threshold ${(aiThreshold * 100).toFixed(0)}% – triggering AI`,
      );

      const aiEngine = new AIEngine(logger, options.aiProvider);
      try {
        const aiResult = await aiEngine.enhance({
          rawText: ocrResult.text,
          partialResponse: response,
          documentType: response.metadata.documentType,
          ruleBasedConfidence: breakdown.overall,
        });

        if (aiResult) {
          response = aiResult.response;
          response.metadata.confidenceScore = aiResult.confidence;
          response.metadata.aiProviderUsed = aiResult.provider;
          logger.info(
            `AI enhancement applied – new confidence: ${(aiResult.confidence * 100).toFixed(1)}%`,
          );
        }
      } catch (err) {
        // AI failure is non-fatal; log it and continue with rule-based result
        logger.warn(
          `AI enhancement failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
        );
        response.metadata.warnings = [
          ...(response.metadata.warnings ?? []),
          "AI enhancement failed – using rule-based extraction only",
        ];
      }
    }

    // ── 7. Attach raw text if requested ────────────────────────────────────
    const includeRaw = options.extractRawText ?? _config.defaultExtractRawText;
    if (includeRaw) {
      response.rawText = ocrResult.text;
    }

    // ── 8. Capture timing ───────────────────────────────────────────────────
    response.metadata.processingTimeMs = Date.now() - startTime;
    logger.info(
      `DataLift.extract() finished in ${response.metadata.processingTimeMs}ms`,
    );

    // ── 9. Sanitise & return ────────────────────────────────────────────────
    return sanitiseResponse(response);
  },

  // ─── Helpers ────────────────────────────────────────────────────────────────

  /**
   * Extract text only without full structured parsing.
   * Useful for lightweight OCR tasks.
   */
  async extractText(options: {
    image?: string;
    imageInput?: DataLiftExtractOptions["imageInput"];
    language?: string;
    debug?: boolean;
    ocrProvider?: string;
  }): Promise<string> {
    const validation = validateOptions(options as DataLiftExtractOptions);
    if (!validation.valid) {
      throw new DataLiftExtractError(
        validation.errors.join("; "),
        "INVALID_INPUT",
      );
    }
    const imageData = this.resolveImageData(options as DataLiftExtractOptions);
    const logger = createLogger(options.debug ?? false);
    const ocrEngine = new OCREngine(logger, options.ocrProvider);
    const result = await ocrEngine.run({
      imageData,
      language: options.language ?? "en",
    });
    return result.text;
  },

  /**
   * Classify document type from image without full extraction.
   */
  async classifyDocument(options: {
    image?: string;
    imageInput?: DataLiftExtractOptions["imageInput"];
    debug?: boolean;
    ocrProvider?: string;
  }): Promise<{ type: string; confidence: number }> {
    const text = await this.extractText(options);
    const { classifyDocumentType } = await import("../parser/primitives");
    const type = classifyDocumentType(text);
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    const confidence = Math.min(wordCount / 100, 0.9);
    return { type, confidence };
  },

  resolveImageData(options: DataLiftExtractOptions): string {
    if (options.image) {
      return options.image;
    }
    if (options.imageInput) {
      const inp = options.imageInput;
      if (inp.type === "base64") return inp.data;
      if (inp.type === "uri") return inp.path;
      if (inp.type === "blob") {
        // Blob → base64 is async; callers should use base64 or uri directly
        throw new DataLiftExtractError(
          "Blob input requires converting to base64 first. Use imageInput.type='base64' instead.",
          "INVALID_INPUT",
        );
      }
    }
    throw new DataLiftExtractError(
      "No image data found in options",
      "INVALID_INPUT",
    );
  },
};
