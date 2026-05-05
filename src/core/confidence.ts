/**
 * DataLift – Confidence Scoring Engine
 *
 * Computes a composite confidence score (0–1) for the structured
 * extraction result.
 *
 * Score factors:
 *  1. OCR quality / text density
 *  2. Field population ratio   – how many required fields are filled
 *  3. Numeric consistency      – do line item totals add up?
 *  4. Document type certainty
 *  5. Heuristic keyword match
 */

import type {
  DataLiftResponse,
  DataLiftPart,
} from "../schema/DataLiftResponse";

// ─── Weights ─────────────────────────────────────────────────────────────────

const WEIGHT_OCR = 0.15;
const WEIGHT_FIELDS = 0.35;
const WEIGHT_NUMERIC = 0.2;
const WEIGHT_DOC_TYPE = 0.15;
const WEIGHT_KEYWORD = 0.15;

// ─── Required fields by section ──────────────────────────────────────────────

const IMPORTANT_TRANSACTION_FIELDS: Array<
  keyof DataLiftResponse["transaction"]
> = ["invoiceNumber", "invoiceDate", "currency"];

// ─── Document-type keyword hints ─────────────────────────────────────────────

// Primary keywords (weight 2×) are placed first; secondary keywords (weight 1×) follow.
// Separator: all items up to and including the last item that contains common secondary
// terms; use split at primaryCount.
const PRIMARY_KEYWORD_COUNT: Record<string, number> = {
  invoice: 3, // "invoice", "inv", "bill to"
  receipt: 3, // "receipt", "thank you", "cash"
  purchase_order: 3,
  work_order: 3,
  bill: 3,
  quote: 3,
  cmms: 3,
};

const DOCUMENT_KEYWORDS: Record<string, string[]> = {
  invoice: [
    "invoice",
    "inv",
    "bill to",
    "due date",
    "amount due",
    "po number",
    "tax invoice",
  ],
  receipt: [
    "receipt",
    "thank you",
    "cash",
    "change",
    "subtotal",
    "purchase",
    "change due",
  ],
  purchase_order: [
    "purchase order",
    "p.o.",
    "po#",
    "ship to",
    "ordered by",
    "vendor",
  ],
  work_order: [
    "work order",
    "wo#",
    "technician",
    "labour",
    "asset",
    "job number",
  ],
  bill: [
    "bill",
    "account number",
    "billing period",
    "pay by",
    "statement",
    "meter",
  ],
  quote: [
    "quotation",
    "quote",
    "estimate",
    "valid until",
    "proposal",
    "expiry",
  ],
  cmms: [
    "cmms",
    "maintenance",
    "work request",
    "asset id",
    "breakdown",
    "failure",
  ],
};

// ─── Confidence Engine ────────────────────────────────────────────────────────

export interface ConfidenceBreakdown {
  overall: number;
  ocr: number;
  fields: number;
  numeric: number;
  docType: number;
  keyword: number;
}

export class ConfidenceEngine {
  /**
   * Calculate an overall confidence score for the extracted response.
   *
   * @param response    – extracted data
   * @param rawText     – original OCR text
   * @param ocrConf     – confidence reported by OCR provider (0–1)
   * @param documentType – detected document type
   */
  score(
    response: DataLiftResponse,
    rawText: string,
    ocrConf: number,
    documentType: string,
  ): ConfidenceBreakdown {
    const ocr = this.scoreOCR(rawText, ocrConf);
    const fields = this.scoreFieldPopulation(response);
    const numeric = this.scoreNumericConsistency(response);
    const docType = this.scoreDocumentType(response, documentType);
    const keyword = this.scoreKeywordMatch(rawText, documentType);

    const overall =
      ocr * WEIGHT_OCR +
      fields * WEIGHT_FIELDS +
      numeric * WEIGHT_NUMERIC +
      docType * WEIGHT_DOC_TYPE +
      keyword * WEIGHT_KEYWORD;

    if (overall < 0.1) {
      console.warn(
        `[DataLift] Suspiciously low confidence score (${overall.toFixed(3)}). ` +
          "OCR quality may be poor or document type may be unrecognised.",
      );
    }

    return {
      overall: parseFloat(overall.toFixed(4)),
      ocr: parseFloat(ocr.toFixed(4)),
      fields: parseFloat(fields.toFixed(4)),
      numeric: parseFloat(numeric.toFixed(4)),
      docType: parseFloat(docType.toFixed(4)),
      keyword: parseFloat(keyword.toFixed(4)),
    };
  }

  // ─── Component scorers ────────────────────────────────────────────────────

  private scoreOCR(text: string, providerConf: number): number {
    const words = text.split(/\s+/).filter(Boolean);
    // ≥20 words → full density score (receipts are short; 50 was too strict)
    const densityScore = Math.min(words.length / 20, 1.0);
    // Clamp providerConf to [0, 1] in case upstream OCR returns out-of-range values
    const clampedConf = Math.max(0, Math.min(1, providerConf));
    return clampedConf * 0.6 + densityScore * 0.4;
  }

  private scoreFieldPopulation(response: DataLiftResponse): number {
    let filled = 0;
    let total = 0;

    // Supplier name
    total++;
    if (response.supplier?.name) filled++;

    // Required transaction fields
    for (const f of IMPORTANT_TRANSACTION_FIELDS) {
      total++;
      if (response.transaction?.[f]) filled++;
    }

    // Grand total
    total++;
    if (response.totals?.grandTotal > 0) filled++;

    // Parts
    total++;
    if (response.parts?.length > 0) filled++;

    // Optional bonus
    if (response.supplier?.contact?.email) filled += 0.5;
    if (response.supplier?.contact?.phone) filled += 0.5;
    if (response.buyer?.name) filled += 0.5;
    total += 1.5;

    return total > 0 ? Math.min(filled / total, 1.0) : 0;
  }

  private scoreNumericConsistency(response: DataLiftResponse): number {
    const totals = response.totals;
    const parts = response.parts;

    // Service invoices (no line items) with a grand total are valid — score 0.8 neutral
    if (!parts || parts.length === 0) {
      if (totals?.grandTotal && totals.grandTotal > 0) return 0.8;
      return 0.5;
    }

    if (!totals) return 0.5;

    // Check: sum of part totals ≈ subtotal
    const partSum = parts.reduce(
      (s: number, p: DataLiftPart) => s + (p.totalAmount ?? 0),
      0,
    );
    const subtotal = totals.subtotal ?? partSum;

    if (subtotal === 0 && totals.grandTotal === 0) return 0.4;

    // Reconstructed grand total
    const taxAndFees =
      (totals.totalTax ?? 0) +
      (totals.shippingCost ?? 0) +
      (totals.tip ?? 0) +
      (totals.serviceCharge ?? 0) -
      (totals.discount ?? 0);

    const reconstructed = subtotal + taxAndFees;
    const grandTotal = totals.grandTotal;

    if (grandTotal === 0) return 0.5;

    const absDiff = Math.abs(reconstructed - grandTotal);
    const delta = absDiff / grandTotal;

    // Accept within 1% OR within $0.10 absolute (handles rounding on small invoices)
    if (delta < 0.01 || absDiff < 0.1) return 1.0;
    // Accept within 5% OR within $1.00 absolute (handles minor OCR digit errors)
    if (delta < 0.05 || absDiff < 1.0) return 0.8;
    if (delta < 0.15) return 0.6; // within 15%
    return 0.3;
  }

  private scoreDocumentType(
    response: DataLiftResponse,
    documentType: string,
  ): number {
    const claimed = (
      response.metadata?.documentType ?? documentType
    ).toLowerCase();
    const detected = documentType.toLowerCase();

    // "generic" means we have no strong signal — always return 0.5 regardless
    // of whether claimed === detected (two unknowns don’t confirm each other)
    if (detected === "generic" || claimed === "generic") {
      return 0.5;
    }

    if (claimed === detected) return 1.0;

    // Partial match
    if (claimed.includes(detected) || detected.includes(claimed)) return 0.7;

    return 0.3;
  }

  private scoreKeywordMatch(text: string, documentType: string): number {
    const lower = text.toLowerCase();
    const keywords = DOCUMENT_KEYWORDS[documentType.toLowerCase()] ?? [];

    if (keywords.length === 0) return 0.5;

    const primaryCount = PRIMARY_KEYWORD_COUNT[documentType.toLowerCase()] ?? 0;
    let weightedMatched = 0;
    let weightedTotal = 0;

    keywords.forEach((kw, idx) => {
      const weight = idx < primaryCount ? 2 : 1;
      weightedTotal += weight;
      if (lower.includes(kw)) weightedMatched += weight;
    });

    return weightedTotal > 0 ? weightedMatched / weightedTotal : 0;
  }
}
