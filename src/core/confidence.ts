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

const DOCUMENT_KEYWORDS: Record<string, string[]> = {
  invoice: ["invoice", "inv", "bill to", "due date", "amount due", "po number"],
  receipt: ["receipt", "thank you", "cash", "change", "subtotal", "purchase"],
  purchase_order: ["purchase order", "p.o.", "po#", "ship to", "ordered by"],
  work_order: ["work order", "wo#", "technician", "labour", "asset"],
  bill: ["bill", "account number", "billing period", "pay by", "statement"],
  quote: ["quotation", "quote", "estimate", "valid until", "proposal"],
  cmms: ["cmms", "maintenance", "work request", "asset id", "breakdown"],
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
    const densityScore = Math.min(words.length / 50, 1.0); // ≥50 words → full score
    return providerConf * 0.6 + densityScore * 0.4;
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

    if (!totals || !parts || parts.length === 0) return 0.5; // neutral

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

    const delta = Math.abs(reconstructed - grandTotal) / grandTotal;

    if (delta < 0.01) return 1.0; // within 1%
    if (delta < 0.05) return 0.8; // within 5%
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

    if (claimed === detected) return 1.0;

    // Partial match
    if (claimed.includes(detected) || detected.includes(claimed)) return 0.7;

    return 0.3;
  }

  private scoreKeywordMatch(text: string, documentType: string): number {
    const lower = text.toLowerCase();
    const keywords = DOCUMENT_KEYWORDS[documentType.toLowerCase()] ?? [];

    if (keywords.length === 0) return 0.5;

    const matched = keywords.filter((kw) => lower.includes(kw)).length;
    return matched / keywords.length;
  }
}
