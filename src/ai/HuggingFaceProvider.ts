
/**
 * DataLift – Offline HuggingFace LayoutLMv3 provider
 *
 * This provider intentionally does NOT call any remote URL.
 * You must supply a local runner that performs on-device inference
 * using microsoft/layoutlmv3-base model assets.
 */

import type {
  AIEnhancementRequest,
  AIEnhancementResult,
  AIProvider,
} from "./AIProvider";
import { AIProviderError } from "./AIProvider";
import type { DataLiftResponse } from "../schema/DataLiftResponse";

export interface HuggingFaceProviderConfig {
  /** Local model identifier (for logging/metadata) */
  model?: string;
  /** Local model directory where layoutlmv3 files are stored */
  offlineModelDir?: string;
  /** Minimum confidence to accept an extracted entity */
  minEntityScore?: number;
  /** Required offline inference function (must not perform network I/O) */
  runner: LayoutLMv3OfflineRunner;
}

export interface LayoutLMv3Entity {
  label: string;
  text: string;
  score?: number;
  bbox?: [number, number, number, number];
}

export interface LayoutLMv3InferenceInput {
  rawText: string;
  documentType: string;
  partialResponse: DataLiftResponse;
  modelId: string;
  modelDir?: string;
}

export interface LayoutLMv3InferenceResult {
  entities?: LayoutLMv3Entity[];
  fields?: Record<string, string | number | null | undefined>;
  confidence?: number;
}

export type LayoutLMv3OfflineRunner = (
  input: LayoutLMv3InferenceInput,
) => Promise<LayoutLMv3InferenceResult>;

export class HuggingFaceProvider implements AIProvider {
  readonly name = "huggingface";
  private readonly config: Required<HuggingFaceProviderConfig>;

  constructor(config: HuggingFaceProviderConfig) {
    this.config = {
      model: config.model ?? "microsoft/layoutlmv3-base",
      offlineModelDir:
        config.offlineModelDir ?? "assets/models/layoutlmv3-base",
      minEntityScore: config.minEntityScore ?? 0.45,
      runner: config.runner,
    };
  }

  async isAvailable(): Promise<boolean> {
    return typeof this.config.runner === "function";
  }

  async enhance(request: AIEnhancementRequest): Promise<AIEnhancementResult> {
    let inference: LayoutLMv3InferenceResult;

    try {
      inference = await this.config.runner({
        rawText: request.rawText,
        documentType: request.documentType,
        partialResponse: request.partialResponse,
        modelId: this.config.model,
        modelDir: this.config.offlineModelDir,
      });
    } catch (err) {
      throw new AIProviderError(
        `Offline LayoutLMv3 runner failed: ${err instanceof Error ? err.message : String(err)}`,
        this.name,
        err,
      );
    }

    const parsed = this.mapInferenceToResponse(
      inference,
      request.partialResponse,
    );

    const merged = this.shallowMerge(request.partialResponse, parsed);
    const inferredConfidence =
      typeof inference.confidence === "number"
        ? inference.confidence
        : request.ruleBasedConfidence + 0.12;

    return {
      response: merged,
      confidence: Math.min(
        Math.max(inferredConfidence, request.ruleBasedConfidence),
        0.97,
      ),
      provider: this.name,
    };
  }

  private mapInferenceToResponse(
    inference: LayoutLMv3InferenceResult,
    partial: DataLiftResponse,
  ): Partial<DataLiftResponse> {
    const fields = inference.fields ?? {};
    const entities = (inference.entities ?? []).filter(
      (e) =>
        typeof e.text === "string" &&
        e.text.trim().length > 0 &&
        (e.score ?? 1) >= this.config.minEntityScore,
    );

    const byLabel = new Map<string, string>();
    for (const entity of entities) {
      const key = entity.label.toLowerCase();
      if (!byLabel.has(key)) {
        byLabel.set(key, entity.text.trim());
      }
    }

    const invoiceNo =
      this.readString(fields, ["invoice_number", "invoiceNo"]) ??
      byLabel.get("invoice_number") ??
      byLabel.get("invoice-no");

    const poNo =
      this.readString(fields, ["po_number", "purchase_order_number"]) ??
      byLabel.get("po_number") ??
      byLabel.get("po-number");

    const supplierName =
      this.readString(fields, ["vendor_name", "supplier_name"]) ??
      byLabel.get("vendor") ??
      byLabel.get("supplier_name");

    const buyerName =
      this.readString(fields, ["buyer_name", "customer_name"]) ??
      byLabel.get("buyer") ??
      byLabel.get("customer");

    const grandTotal =
      this.readNumber(fields, ["grand_total", "total_amount", "amount_due"]) ??
      this.numberFromText(byLabel.get("grand_total")) ??
      partial.totals.grandTotal;

    const subtotal =
      this.readNumber(fields, ["sub_total", "subtotal"]) ??
      this.numberFromText(byLabel.get("sub_total"));

    const totalTax =
      this.readNumber(fields, ["total_tax", "tax_total"]) ??
      this.numberFromText(byLabel.get("tax"));

    const amountPaid =
      this.readNumber(fields, ["amount_paid"]) ??
      this.numberFromText(byLabel.get("amount_paid"));

    const out: Partial<DataLiftResponse> = {
      transaction: {
        ...partial.transaction,
        invoiceNumber: invoiceNo ?? partial.transaction.invoiceNumber,
        purchaseOrderNumber: poNo ?? partial.transaction.purchaseOrderNumber,
      },
      supplier: {
        ...partial.supplier,
        name: supplierName ?? partial.supplier.name,
      },
      buyer: {
        ...partial.buyer,
        name: buyerName ?? partial.buyer.name,
      },
      totals: {
        ...partial.totals,
        subtotal: subtotal ?? partial.totals.subtotal,
        totalTax: totalTax ?? partial.totals.totalTax,
        amountPaid: amountPaid ?? partial.totals.amountPaid,
        grandTotal,
      },
      metadata: {
        ...partial.metadata,
        aiProviderUsed: `huggingface-offline:${this.config.model}`,
        warnings: [
          ...(partial.metadata.warnings ?? []),
          "Offline LayoutLMv3 enhancement applied",
        ],
      },
    };

    return out;
  }

  private readString(
    fields: Record<string, string | number | null | undefined>,
    keys: string[],
  ): string | undefined {
    for (const key of keys) {
      const value = fields[key];
      if (typeof value === "string" && value.trim().length > 0) {
        return value.trim();
      }
    }
    return undefined;
  }

  private readNumber(
    fields: Record<string, string | number | null | undefined>,
    keys: string[],
  ): number | undefined {
    for (const key of keys) {
      const value = fields[key];
      if (typeof value === "number" && !Number.isNaN(value)) {
        return value;
      }
      if (typeof value === "string") {
        const parsed = this.numberFromText(value);
        if (parsed !== undefined) return parsed;
      }
    }
    return undefined;
  }

  private numberFromText(text: string | undefined): number | undefined {
    if (!text) return undefined;
    const parsed = parseFloat(text.replace(/[^0-9.-]/g, ""));
    return Number.isNaN(parsed) ? undefined : parsed;
  }

  private shallowMerge(
    target: DataLiftResponse,
    src: Partial<DataLiftResponse>,
  ): DataLiftResponse {
    const result = JSON.parse(JSON.stringify(target)) as DataLiftResponse;
    const resultUnknown = result as unknown as Record<string, unknown>;
    for (const k of Object.keys(src) as Array<keyof DataLiftResponse>) {
      const sv = src[k];
      const tv = result[k];
      if (
        sv !== null &&
        sv !== undefined &&
        (tv === null || tv === undefined || tv === "")
      ) {
        resultUnknown[k] = sv;
      }
    }
    return result;
  }
}
