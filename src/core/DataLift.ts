
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
 *     aiProvider: new OpenAIProvider({ apiKey: "sk-..." }),
 *     ocrProvider: new TesseractOCR(),
 *   });
 */

import type {
  DataLiftExtractOptions,
  DataLiftResponse,
} from "../schema/DataLiftResponse";
import {
  detectUnifiedDocType,
  normalizeUnifiedPayloadShape,
  toIsoDate,
  toNumber,
  validateUnifiedDraft07Payload,
} from "../schema/UnifiedDraft07";
import { DataLift as NativeDataLift } from "../NativeDataLift";
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
import { createLogger } from "../utils/logger";

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

export interface LayoutLMv3NativeConfig {
  modelPath: string;
  labelsPath?: string;
}

export interface LayoutLMv3CompatibilityResult {
  compatible: boolean;
  runtime?: string;
  model_path?: string;
  labels_path?: string;
  checks: {
    model_file: boolean;
    labels_file: boolean;
    label_map: boolean;
    inference: boolean;
  };
  warnings?: string[];
  error?: string;
}

export interface DataLiftUnifiedExtractOptions {
  imageInput: string | string[];
  fileNames?: string[];
  language?: string;
  layoutLMv3ModelPath?: string;
  layoutLMv3LabelsPath?: string;
  layoutLMv3ModelDir?: string;
  layoutLMv3Model?: string;
  requireLayoutLMv3?: boolean;
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

  async configureLayoutLMv3(
    options: LayoutLMv3NativeConfig,
  ): Promise<{ configured: boolean; model_path: string }> {
    return NativeDataLift.configureLayoutLMv3({
      model_path: options.modelPath,
      labels_path: options.labelsPath,
    });
  },

  async checkLayoutLMv3Compatibility(
    options: LayoutLMv3NativeConfig,
  ): Promise<LayoutLMv3CompatibilityResult> {
    return NativeDataLift.checkLayoutLMv3Compatibility({
      model_path: options.modelPath,
      labels_path: options.labelsPath,
    });
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

    logger.info(`Confidence: ${(breakdown.overall * 100).toFixed(1)}%`);
    logger.debug("Confidence breakdown:", breakdown);

    // ── 6. AI enhancement (optional) ────────────────────────────────────────
    const aiThreshold =
      options.aiConfidenceThreshold ?? _config.defaultAIThreshold;

    if (breakdown.overall < aiThreshold) {
      logger.info(
        `Confidence ${(breakdown.overall * 100).toFixed(0)}% < threshold ${(aiThreshold * 100).toFixed(0)}% – triggering AI`,
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

  async extractUnifiedSchema(
    options: DataLiftUnifiedExtractOptions,
  ): Promise<Record<string, unknown>> {
    const uris = Array.isArray(options.imageInput)
      ? options.imageInput
      : [options.imageInput];
    if (uris.length === 0) {
      throw new DataLiftExtractError("No image URI provided", "INVALID_INPUT");
    }

    const language = options.language ?? _config.defaultLanguage;
    const resolvedLayoutModel =
      options.layoutLMv3ModelPath ??
      options.layoutLMv3ModelDir ??
      options.layoutLMv3Model ??
      "microsoft/layoutlmv3-base";
    const resolvedLayoutLabels = options.layoutLMv3LabelsPath;

    const native = await NativeDataLift.extractInvoiceSchema(
      Array.isArray(options.imageInput)
        ? {
            uris: options.imageInput,
            file_names: options.fileNames,
            language,
            model_path: resolvedLayoutModel,
            labels_path: resolvedLayoutLabels,
            require_model_prediction: options.requireLayoutLMv3 ?? true,
          }
        : {
            uri: options.imageInput,
            file_names: options.fileNames,
            language,
            model_path: resolvedLayoutModel,
            labels_path: resolvedLayoutLabels,
            require_model_prediction: options.requireLayoutLMv3 ?? true,
          },
    );

    const normalized = normalizeUnifiedPayloadShape(
      (native ?? {}) as Record<string, unknown>,
    );

    const audit =
      normalized.audit && typeof normalized.audit === "object"
        ? (normalized.audit as Record<string, unknown>)
        : {};
    audit.confidence =
      audit.confidence && typeof audit.confidence === "object"
        ? (audit.confidence as Record<string, unknown>)
        : {};
    audit.warnings = Array.isArray(audit.warnings)
      ? [...(audit.warnings as string[])]
      : [];
    const existingModel =
      audit.model && typeof audit.model === "object"
        ? (audit.model as Record<string, unknown>)
        : {};
    const nativeUsed = existingModel.layoutlmv3_used;
    audit.model = {
      ...existingModel,
      layoutlmv3_used: nativeUsed === true,
      layoutlmv3_source: "native",
      layoutlmv3_model: resolvedLayoutModel,
      ...(resolvedLayoutLabels
        ? { layoutlmv3_labels: resolvedLayoutLabels }
        : {}),
      layoutlmv3_required: options.requireLayoutLMv3 ?? true,
    };
    normalized.audit = audit;

    const validation = validateUnifiedDraft07Payload(normalized);
    if (!validation.valid) {
      throw new DataLiftExtractError(
        `Unified Draft-07 validation failed: ${validation.errors.join("; ")}`,
        "PARSE_FAILED",
      );
    }

    return normalized;
  },

  // ─── Private helpers ──────────────────────────────────────────────────────

  applyLayoutFields(
    raw: Record<string, unknown>,
    fields: Record<string, unknown>,
  ): Record<string, unknown> {
    const next: Record<string, unknown> = {
      ...raw,
      header:
        raw.header && typeof raw.header === "object"
          ? { ...(raw.header as Record<string, unknown>) }
          : {},
      vendor:
        raw.vendor && typeof raw.vendor === "object"
          ? { ...(raw.vendor as Record<string, unknown>) }
          : {},
      buyer:
        raw.buyer && typeof raw.buyer === "object"
          ? { ...(raw.buyer as Record<string, unknown>) }
          : {},
      totals:
        raw.totals && typeof raw.totals === "object"
          ? { ...(raw.totals as Record<string, unknown>) }
          : {},
      payment:
        raw.payment && typeof raw.payment === "object"
          ? { ...(raw.payment as Record<string, unknown>) }
          : {},
      remittance:
        raw.remittance && typeof raw.remittance === "object"
          ? { ...(raw.remittance as Record<string, unknown>) }
          : {},
    };

    const header = next.header as Record<string, unknown>;
    const vendor = next.vendor as Record<string, unknown>;
    const buyer = next.buyer as Record<string, unknown>;
    const totals = next.totals as Record<string, unknown>;
    const payment = next.payment as Record<string, unknown>;
    const remittance = next.remittance as Record<string, unknown>;

    const mapText = (key: string): string | undefined => {
      const value = fields[key];
      if (typeof value === "string" && value.trim().length > 0) return value;
      if (typeof value === "number" && Number.isFinite(value)) {
        return String(value);
      }
      return undefined;
    };

    const invoiceNo = mapText("invoice_number");
    if (invoiceNo && !header.invoice_number) header.invoice_number = invoiceNo;

    const orderNo = mapText("order_number");
    if (orderNo && !header.order_number) header.order_number = orderNo;

    const poNo = mapText("po_number");
    if (poNo && !header.po_number) header.po_number = poNo;

    const dateIssued = mapText("date_issued");
    if (dateIssued && !header.date_issued) {
      header.date_issued = toIsoDate(dateIssued) ?? dateIssued;
    }

    const vendorName = mapText("vendor_name");
    if (vendorName && !vendor.name) vendor.name = vendorName;

    const buyerName = mapText("buyer_name");
    if (buyerName && !buyer.name) buyer.name = buyerName;

    const totalKeys = [
      ["sub_total", "sub_total"],
      ["total_tax", "total_tax"],
      ["grand_total", "grand_total"],
      ["amount_paid", "amount_paid"],
      ["amount_due", "amount_due"],
    ] as const;
    for (const [from, to] of totalKeys) {
      const num = toNumber(fields[from]);
      if (num !== undefined && totals[to] === undefined) {
        totals[to] = num;
      }
    }

    const paymentMethod = mapText("payment_method");
    if (paymentMethod && !payment.payment_method) {
      payment.payment_method = paymentMethod;
    }

    const masked = mapText("masked_account");
    if (masked && !payment.masked_account) payment.masked_account = masked;

    const aid = mapText("aid");
    if (aid && !payment.aid) payment.aid = aid;

    const cryptogram = mapText("cryptogram");
    if (cryptogram && !payment.cryptogram) payment.cryptogram = cryptogram;

    const remitName = mapText("remit_to_name");
    if (remitName && !remittance.remit_to_name) {
      remittance.remit_to_name = remitName;
    }

    if (
      Array.isArray(fields.remit_to_address_lines) &&
      !Array.isArray(remittance.remit_to_address_lines)
    ) {
      remittance.remit_to_address_lines = fields.remit_to_address_lines;
    }

    return next;
  },

  normalizeUnifiedPayload(
    raw: Record<string, unknown>,
    options: {
      rawText: string;
      uris: string[];
      fileNames?: string[];
      language: string;
    },
  ): Record<string, unknown> {
    const text = options.rawText;
    const lower = text.toLowerCase();
    const docType = detectUnifiedDocType(text, raw.document_type);
    const currency =
      typeof raw.currency === "string" && /^[A-Z]{3}$/.test(raw.currency)
        ? raw.currency
        : lower.includes("eur") || text.includes("€")
          ? "EUR"
          : lower.includes("gbp") || text.includes("£")
            ? "GBP"
            : lower.includes("inr") || text.includes("₹")
              ? "INR"
              : "USD";

    const images = options.uris.map((uri, index) => ({
      image_id: `img_${String(index + 1).padStart(3, "0")}`,
      file_name:
        options.fileNames?.[index] ??
        uri.split("/").pop() ??
        `page_${index + 1}.jpg`,
      page_index: index,
    }));

    const headerRaw =
      raw.header && typeof raw.header === "object"
        ? (raw.header as Record<string, unknown>)
        : {};
    const vendorRaw =
      raw.vendor && typeof raw.vendor === "object"
        ? (raw.vendor as Record<string, unknown>)
        : {};
    const totalsRaw =
      raw.totals && typeof raw.totals === "object"
        ? (raw.totals as Record<string, unknown>)
        : {};

    const normalized: Record<string, unknown> = {
      document_id:
        typeof raw.document_id === "string" && raw.document_id.length > 0
          ? raw.document_id
          : `${docType}_${Date.now()}`,
      document_type: docType,
      locale:
        typeof raw.locale === "string" && raw.locale.length > 0
          ? raw.locale
          : `${options.language}-US`,
      currency,
      images,
      header: {
        ...(headerRaw.invoice_number
          ? { invoice_number: headerRaw.invoice_number }
          : {}),
        ...(headerRaw.receipt_number
          ? { receipt_number: headerRaw.receipt_number }
          : {}),
        ...(headerRaw.po_number ? { po_number: headerRaw.po_number } : {}),
        ...(headerRaw.order_number
          ? { order_number: headerRaw.order_number }
          : {}),
        ...(headerRaw.date_issued
          ? {
              date_issued:
                toIsoDate(headerRaw.date_issued) ?? headerRaw.date_issued,
            }
          : {}),
        ...(headerRaw.time_issued
          ? { time_issued: headerRaw.time_issued }
          : {}),
        page: images.length,
        total_pages: images.length,
      },
      vendor: {
        ...(vendorRaw.name ? { name: vendorRaw.name } : {}),
        ...(vendorRaw.branch ? { branch: vendorRaw.branch } : {}),
        ...(vendorRaw.tax_id ? { tax_id: vendorRaw.tax_id } : {}),
        ...(Array.isArray(vendorRaw.address_lines)
          ? { address_lines: vendorRaw.address_lines }
          : {}),
        ...(vendorRaw.phone ? { phone: vendorRaw.phone } : {}),
        ...(vendorRaw.email ? { email: vendorRaw.email } : {}),
      },
      totals: {
        ...(toNumber(totalsRaw.sub_total) !== undefined
          ? { sub_total: toNumber(totalsRaw.sub_total) }
          : {}),
        ...(toNumber(totalsRaw.total_tax) !== undefined
          ? { total_tax: toNumber(totalsRaw.total_tax) }
          : {}),
        ...(toNumber(totalsRaw.grand_total) !== undefined
          ? { grand_total: toNumber(totalsRaw.grand_total) }
          : {}),
        ...(toNumber(totalsRaw.amount_paid) !== undefined
          ? { amount_paid: toNumber(totalsRaw.amount_paid) }
          : {}),
        ...(toNumber(totalsRaw.amount_due) !== undefined
          ? { amount_due: toNumber(totalsRaw.amount_due) }
          : {}),
      },
      metadata: {
        ...(raw.metadata && typeof raw.metadata === "object"
          ? (raw.metadata as Record<string, unknown>)
          : {}),
        raw_text: text,
      },
      audit: {
        ocr_engine:
          raw.audit && typeof raw.audit === "object"
            ? ((raw.audit as Record<string, unknown>).ocr_engine ??
              "native-ocr")
            : "native-ocr",
        extraction_timestamp:
          raw.audit && typeof raw.audit === "object"
            ? ((raw.audit as Record<string, unknown>).extraction_timestamp ??
              new Date().toISOString())
            : new Date().toISOString(),
        confidence:
          raw.audit && typeof raw.audit === "object"
            ? ((raw.audit as Record<string, unknown>).confidence ?? {})
            : {},
        warnings:
          raw.audit && typeof raw.audit === "object"
            ? ((raw.audit as Record<string, unknown>).warnings ?? [])
            : [],
      },
    };

    return normalizeUnifiedPayloadShape(normalized);
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
