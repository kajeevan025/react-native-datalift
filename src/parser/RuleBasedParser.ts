/**
 * DataLift – Rule-based extraction engine (v3)
 *
 * Camera/Image → ML Kit OCR → rawText → normaliseOCR → RuleBasedParser → DataLiftResponse
 *
 * Pipeline:
 *   1. Normalise OCR text (fix artefacts)
 *   2. Segment document (header / body / footer)
 *   3. Extract supplier (name, address, contact, tax numbers)
 *   4. Extract buyer (bill-to section, with inline-label support)
 *   5. Extract transaction metadata (invoice #, PO #, dates, payment mode)
 *   6. Parse line items (column-aware table detection with math validation)
 *   7. Extract totals (labeled amounts from footer)
 */

import type {
  DataLiftResponse,
  DataLiftBuyer,
  DataLiftTransaction,
  DataLiftTotals,
  DataLiftPart,
  DataLiftMetadata,
  DataLiftDocumentType,
} from "../schema/DataLiftResponse";

import {
  normaliseOCRText,
  detectCurrency,
  detectLanguage,
  classifyDocumentType,
  extractDates,
  extractLabeledAmount,
  parseLineItem,
  buildSupplier,
  buildBuyer,
  extractTaxInformation,
  PATTERNS,
} from "./primitives";

export interface RuleBasedParserOptions {
  documentType?: DataLiftDocumentType | string;
  language?: string;
}

// Corporate-suffix pattern used in supplier name detection
const CORP_SUFFIX_RX =
  /\b(pty\.?\s*ltd|inc\.?|llc\.?|ltd\.?|co\.?|corp\.?|company|group|services|solutions|enterprises?|holdings?|industries|gmbh|bv|sa)\b/i;

const SKIP_HEADER_WORDS =
  /^(invoice|tax\s+invoice|receipt|bill|quote|statement|date|no\.?|number|page|purchase\s+order|delivery|packing|from|to)\b/i;

// ─── Main parser ──────────────────────────────────────────────────────────────

export class RuleBasedParser {
  parse(
    rawText: string,
    options: RuleBasedParserOptions = {},
  ): DataLiftResponse {
    // ── Step 0: Normalise OCR text ───────────────────────────────────────
    const normText = normaliseOCRText(rawText);
    const lines = normText
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const docType = (options.documentType ??
      classifyDocumentType(normText)) as DataLiftDocumentType;
    const language = options.language ?? detectLanguage(normText);
    const currency = detectCurrency(normText);

    const { headerLines, bodyLines, footerLines } = this.segmentDocument(lines);
    const headerText = headerLines.join("\n");
    const footerText = footerLines.join("\n");

    // ── Supplier ─────────────────────────────────────────────────────────────
    const supplierName = this.extractSupplierName(headerLines);
    const supplier = buildSupplier(supplierName, headerText);
    // Merge any tax info found in full text
    const fullTaxInfo = extractTaxInformation(normText);
    if (fullTaxInfo) {
      supplier.taxInformation = { ...supplier.taxInformation, ...fullTaxInfo };
    }

    // ── Buyer ────────────────────────────────────────────────────────────────
    const buyer = this.extractBuyer(normText, lines);

    // ── Transaction ──────────────────────────────────────────────────────────
    const transaction = this.extractTransaction(normText, currency.code);

    // ── Parts ────────────────────────────────────────────────────────────────
    const parts = this.extractParts(bodyLines, lines);

    // ── Totals ───────────────────────────────────────────────────────────────
    const totals = this.extractTotals(normText, footerText, parts);

    // ── Metadata ─────────────────────────────────────────────────────────────
    const metadata: DataLiftMetadata = {
      documentType: docType,
      confidenceScore: 0,
      extractionTimestamp: new Date().toISOString(),
      languageDetected: language,
      ocrProvider: "pending",
      processingTimeMs: 0,
    };

    return { metadata, supplier, buyer, transaction, parts, totals };
  }

  // ─── Segmentation ─────────────────────────────────────────────────────────

  private segmentDocument(lines: string[]): {
    headerLines: string[];
    bodyLines: string[];
    footerLines: string[];
  } {
    const total = lines.length;

    // Header: up to and including the first blank-area or key labels
    // We scan for the first occurrence of token that signals body start
    const bodyStartKeywords =
      /^(?:description|item|qty|quantity|part\s*(?:no|#)|sku|unit\s*price|amount|total|bill\s*to|ship\s*to|customer|product|service|particular|rate|no\.?\s|sr\.?\s*no)/i;
    let headerEnd = Math.min(8, total);
    for (let i = 0; i < Math.min(25, total); i++) {
      if (bodyStartKeywords.test(lines[i])) {
        headerEnd = i;
        break;
      }
    }

    // Also detect table header rows that contain multiple column keywords
    const tableHeaderKws = [
      "description",
      "item",
      "qty",
      "quantity",
      "unit price",
      "price",
      "amount",
      "total",
      "tax",
      "sku",
      "product",
      "rate",
      "particular",
    ];
    if (headerEnd === Math.min(8, total)) {
      for (let i = 0; i < Math.min(25, total); i++) {
        const lower = lines[i].toLowerCase();
        const hits = tableHeaderKws.filter((kw) => lower.includes(kw)).length;
        if (hits >= 2) {
          headerEnd = i;
          break;
        }
      }
    }

    // Footer: from first totals-type line near the end
    const footerKeywords =
      /^(?:sub\s*total|subtotal|total|tax|gst|vat|shipping|delivery|discount|balance|amount\s+due|net\s+amount|gross\s+amount|grand\s+total)/i;
    let footerStart = Math.max(Math.floor(total * 0.75), total - 15);
    for (let i = headerEnd; i < total; i++) {
      if (footerKeywords.test(lines[i]) && i > total * 0.35) {
        footerStart = i;
        break;
      }
    }

    return {
      headerLines: lines.slice(0, headerEnd),
      bodyLines: lines.slice(headerEnd, footerStart),
      footerLines: lines.slice(footerStart),
    };
  }

  // ─── Supplier name ────────────────────────────────────────────────────────

  private extractSupplierName(headerLines: string[]): string | undefined {
    if (headerLines.length === 0) return undefined;

    const candidates = headerLines.slice(0, 8);

    // Priority 1: ALL-CAPS company name (most reliable for supplier identification)
    for (const line of candidates) {
      if (line.length < 3 || line.length > 60) continue;
      if (SKIP_HEADER_WORDS.test(line)) continue;
      if (/^[A-Z][A-Z\s&.,'-]{4,}$/.test(line)) return line.trim();
    }

    // Priority 2: Lines with corporate suffixes (Pty Ltd, Inc, LLC…)
    // Prefer shorter lines to avoid capturing taglines like
    // "Company X is a division of Company Y"
    let bestCorpLine: string | undefined;
    for (const line of candidates) {
      if (line.length < 3) continue;
      if (SKIP_HEADER_WORDS.test(line)) continue;
      if (CORP_SUFFIX_RX.test(line)) {
        if (!bestCorpLine || line.length < bestCorpLine.length) {
          bestCorpLine = line.trim();
        }
      }
    }
    if (bestCorpLine) return bestCorpLine;

    // Priority 3: First meaningful non-label line
    return candidates.find(
      (l) => l.length > 3 && l.length <= 60 && !SKIP_HEADER_WORDS.test(l),
    );
  }

  // ─── Buyer ────────────────────────────────────────────────────────────────

  private extractBuyer(_fullText: string, lines: string[]): DataLiftBuyer {
    // Skip patterns that contain "customer" but aren't buyer section labels
    const skipLineRx =
      /customer\s+signature|agree\s+to\s+pay|card\s+issuer|all\s+goods\s+returned|napa\s+cash/i;

    // Section keywords that signal the start of a buyer/customer block
    const sectionKeywords =
      /^(?:bill\s*to|billed\s*to|buyer|customer(?:\s*(?:name|details?|info(?:rmation)?))?|sold\s*to|ship\s*to|deliver\s*to|client|purchaser|account\s*holder)\s*[:.]*\s*$/i;

    // Inline label: "Bill To: Company Name" on the same line
    const inlineLabelRx =
      /^(?:bill\s*to|billed\s*to|buyer|customer(?:\s*name)?|sold\s*to|ship\s*to|deliver\s*to|client|purchaser|account\s*holder)\s*[:.]?\s+(.+)/i;

    let sectionStart = -1;
    let inlineName: string | undefined;

    for (let i = 0; i < lines.length; i++) {
      // Skip false-positive lines
      if (skipLineRx.test(lines[i])) continue;

      // Check for inline label first (e.g. "Bill To: ACME Corp")
      const inlineMatch = lines[i].match(inlineLabelRx);
      if (inlineMatch?.[1] && inlineMatch[1].trim().length > 2) {
        // But filter the captured text for false positives too
        if (!skipLineRx.test(inlineMatch[1])) {
          inlineName = inlineMatch[1].trim();
          sectionStart = i + 1;
          break;
        }
      }
      // Check for standalone label (next line is the name)
      if (sectionKeywords.test(lines[i])) {
        sectionStart = i + 1;
        break;
      }
    }

    // Also look for "Attention: <name>" as a customer indicator
    if (sectionStart < 0) {
      for (let i = 0; i < lines.length; i++) {
        const attnMatch = lines[i].match(/^(?:attn|attention)\s*[:.]+\s*(.+)/i);
        if (attnMatch?.[1] && attnMatch[1].trim().length > 2) {
          // Attention: is typically a standalone indicator; don't grab the
          // following lines as an address block (they're often transaction metadata).
          return { name: attnMatch[1].trim() };
        }
      }
    }

    if (sectionStart >= 0) {
      const block = lines.slice(sectionStart, sectionStart + 8).join("\n");
      const buyer = buildBuyer(block);
      // Always prefer the inline name over whatever buildBuyer extracted
      if (inlineName) {
        buyer.name = inlineName;
      }
      return buyer;
    }

    return {};
  }

  // ─── Transaction ──────────────────────────────────────────────────────────

  private extractTransaction(
    fullText: string,
    currencyCode: string,
  ): DataLiftTransaction {
    const tx: DataLiftTransaction = { currency: currencyCode };

    // Invoice number: INV-2025-00842, INV #001, Invoice No. 12345
    // Require a delimiter (no/number/#/:) after "invoice" to avoid matching standalone "INVOICE" title.
    // Use [^\S\n] instead of \s for separators to prevent matching across line boundaries.
    const invRx =
      /(?:invoice[^\S\n]*(?:no\.?|#|number)[^\S\n]*:?|tax[^\S\n]+invoice[^\S\n]*(?:no\.?|#)[^\S\n]*:?|inv[^\S\n]*[#:]|einvoice[^\S\n]*[#:])[^\S\n]*([A-Z0-9][\w\-/]{1,30})/i;
    const invM = fullText.match(invRx);
    if (invM) {
      tx.invoiceNumber = invM[1].trim();
    } else {
      // Multi-line fallback: "Invoice Number" on one line, value on the next
      const invLines = fullText.split("\n");
      for (let i = 0; i < invLines.length - 1; i++) {
        if (
          /^\s*(?:invoice\s*(?:no\.?|#|number)|einvoice\s*[#:]?)\s*:?\s*$/i.test(
            invLines[i],
          )
        ) {
          // Next non-empty line is the value
          for (let j = i + 1; j < Math.min(i + 3, invLines.length); j++) {
            const val = invLines[j].trim();
            if (val && /^[A-Z0-9][\w\-/]{1,30}$/i.test(val)) {
              tx.invoiceNumber = val;
              break;
            }
          }
          if (tx.invoiceNumber) break;
        }
      }
    }

    // PO number: PO-BR-4421, P.O. #4421, PO#: PO-2024-007
    // Match PO# / P.O.# first (more specific), then "Purchase Order No/Number/# : VALUE"
    // Use [^\S\n] to prevent cross-line matching that would capture the word "Number" etc.
    const poRx =
      /(?:p\.?o\.?[^\S\n]*[#:]+|purchase[^\S\n]*order[^\S\n]*(?:no\.?|#|number)[^\S\n]*[#:]*)[^\S\n]*:?[^\S\n]*([A-Z0-9][\w\-/]{1,30})/i;
    const poM = fullText.match(poRx);
    if (poM) {
      tx.purchaseOrderNumber = poM[1].trim();
    } else {
      // Multi-line fallback: "PO#" or "Purchase Order Number" on one line, value on next
      const poLines = fullText.split("\n");
      for (let i = 0; i < poLines.length - 1; i++) {
        if (
          /^\s*(?:p\.?o\.?\s*[#:]?|purchase\s*order\s*(?:no\.?|#|number)?)\s*:?\s*$/i.test(
            poLines[i],
          )
        ) {
          for (let j = i + 1; j < Math.min(i + 3, poLines.length); j++) {
            const val = poLines[j].trim();
            if (val && /^[A-Z0-9][\w\-/]{1,30}$/i.test(val)) {
              tx.purchaseOrderNumber = val;
              break;
            }
          }
          if (tx.purchaseOrderNumber) break;
        }
      }
    }

    // Quote number
    const quoteM = fullText.match(
      /(?:quote|quotation|estimate)\s*[#:]\s*([A-Z0-9][\w\-/]{1,20})/i,
    );
    if (quoteM) tx.quoteNumber = quoteM[1].trim();

    // Dates
    const dates = extractDates(fullText);
    tx.invoiceDate = dates.invoiceDate;
    tx.dueDate = dates.dueDate;
    tx.transactionDate = dates.transactionDate;

    // Payment mode: Bank Transfer, Credit Card, EFTPOS, Cash, EFT...
    // Avoid matching "Payment Terms" — the last alternation uses negative lookahead.
    const payRx =
      /(?:payment\s*(?:method|mode|via|by)|paid\s*(?:via|by)|payment(?!\s*terms?))\s*[:\-]?\s*([A-Za-z][A-Za-z\s\/]{2,30})/i;
    const payM = fullText.match(payRx);
    if (payM?.[1]) tx.paymentMode = payM[1].trim().replace(/\s+/g, " ");

    // Payment terms: Net 30, Net 14, COD
    const termsM = fullText.match(
      /(?:terms?|payment\s*terms?)\s*[:\-]?\s*(net\s*\d+|cod|eft|prepaid|due\s*on\s*receipt)/i,
    );
    if (termsM) tx.paymentTerms = termsM[1].trim();

    // Transaction time
    const timeM = fullText.match(
      /\b(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)\b/i,
    );
    if (timeM) tx.transactionTime = timeM[1];

    return tx;
  }

  // ─── Parts / Line items ───────────────────────────────────────────────────

  private extractParts(
    bodyLines: string[],
    allLines: string[],
  ): DataLiftPart[] {
    // 1. Try column-aligned table extraction (most accurate)
    const tableItems = this.extractFromColumnTable(bodyLines);
    if (tableItems.length > 0) return tableItems;

    // 2. Try vertical-form extraction (labels on own lines: Part Number, Description, Price, Total)
    //    Run before multi-line heuristic to avoid POS lines being mis-parsed as items.
    const verticalItems = this.extractVerticalFormItems(allLines);
    if (verticalItems.length > 0) return verticalItems;

    // 3. Try multi-line item blocks (item name + description on next line)
    const multiItems = this.extractMultiLineItems(bodyLines);
    if (multiItems.length > 0) return multiItems;

    // 4. Fallback: single-line heuristic on body lines
    const items: DataLiftPart[] = [];
    bodyLines.forEach((line, idx) => {
      const item = parseLineItem(line, idx + 1);
      if (item) items.push(item);
    });
    if (items.length > 0) return items;

    // 5. Last resort: scan ALL lines (handles receipts where items are in the
    //    "header" zone because there is no table-header row to trigger body detection)
    const allItems: DataLiftPart[] = [];
    allLines.forEach((line, idx) => {
      const item = parseLineItem(line, idx + 1);
      if (item) allItems.push(item);
    });
    return allItems;
  }

  /**
   * Column-aware table extraction (v2).
   * Detects a header row, then for each data row:
   *   1. Splits text vs. numeric segments
   *   2. Uses qty × unitPrice ≈ total math validation to disambiguate numbers
   *   3. Falls back to positional heuristics when math doesn't match
   */
  private extractFromColumnTable(lines: string[]): DataLiftPart[] {
    const headerKws = [
      "description",
      "item",
      "qty",
      "quantity",
      "unit price",
      "unit cost",
      "price",
      "amount",
      "total",
      "tax",
      "sku",
      "product",
      "service",
      "particular",
      "rate",
      "no.",
    ];
    let headerIdx = -1;

    for (let i = 0; i < lines.length; i++) {
      const lower = lines[i].toLowerCase();
      const hits = headerKws.filter((kw) => lower.includes(kw)).length;
      if (hits >= 2) {
        headerIdx = i;
        break;
      }
    }
    if (headerIdx < 0) return [];

    const items: DataLiftPart[] = [];
    const footerRx =
      /^(sub\s*total|subtotal|total|grand\s*total|gst|tax|vat|shipping|discount|balance|net\s+amount|gross|amount\s+due)/i;

    for (let i = headerIdx + 1; i < lines.length; i++) {
      const line = lines[i];
      if (footerRx.test(line.trim())) break;
      if (line.trim().length < 4) continue;

      // ── Extract all numbers with positions ──────────────────────────────
      interface NumInfo {
        value: number;
        index: number;
        raw: string;
        isPct: boolean;
      }
      const nums: NumInfo[] = [];
      const numRx = /([\$€£₹¥]?\s*)(\d{1,3}(?:,\d{3})*(?:\.\d{1,4})?)\s*(%)?/g;
      let m: RegExpExecArray | null;
      while ((m = numRx.exec(line)) !== null) {
        const amountText = m[2] ?? "";
        const v = parseFloat(amountText.replace(/,/g, ""));
        if (!isNaN(v) && v > 0) {
          nums.push({
            value: v,
            index: m.index,
            raw: m[0],
            isPct: m[3] === "%",
          });
        }
      }
      if (nums.length === 0) continue;

      // ── Extract tax percentage ──────────────────────────────────────────
      const taxPct = this.inferTaxPct(line);
      const candidateNums = nums
        .filter((n) => !n.isPct && n.value !== taxPct)
        .map((n) => n.value);
      if (candidateNums.length === 0) continue;

      // ── Extract item name: text segment before first numeric block ──────
      // Split line by 2+ spaces and take first segment that contains alphabetic text.
      // Pure-numeric segments (e.g. part numbers like "70885") are captured as partNumber instead.
      const segments = line.split(/\s{2,}/);
      let itemName = "";
      let partNumber: string | undefined;
      for (const seg of segments) {
        const trimSeg = seg.trim();
        if (!trimSeg) continue;
        // Check if segment has alphabetic content (a valid item name/description)
        if (/[A-Za-z]{2,}/.test(trimSeg)) {
          if (!itemName) {
            itemName = trimSeg;
          }
        } else if (
          !partNumber &&
          /^[\dA-Z][\w\-/.]{2,}$/.test(trimSeg) &&
          /\d/.test(trimSeg)
        ) {
          // Pure-numeric or code-like segment → part number
          partNumber = trimSeg;
        }
      }
      if (itemName.length < 2) {
        // Fallback: strip trailing numbers
        itemName = line
          .replace(/\s{2,}[\d$€£,.%]+.*$/, "")
          .trim()
          .slice(0, 80);
      }
      // Strip leading row/line number
      itemName = itemName.replace(/^\d{1,3}[.)\s]+\s*/, "").trim();
      // Item names MUST have at least 2 alpha characters to be valid
      if (itemName.length < 2 || !/[A-Za-z]{2,}/.test(itemName)) continue;

      // ── Disambiguate: quantity, unitPrice, taxAmount, totalAmount ────────
      const total = candidateNums[candidateNums.length - 1];
      const rest = candidateNums.slice(0, -1);

      let quantity = 1;
      let unitPrice: number | undefined;
      let taxAmount: number | undefined;

      if (rest.length >= 2) {
        // Try math validation: find pair where qty × price ≈ total (within 5%)
        let bestMatch: { qi: number; pi: number; err: number } | null = null;
        for (let qi = 0; qi < rest.length; qi++) {
          for (let pi = 0; pi < rest.length; pi++) {
            if (qi === pi) continue;
            const product = rest[qi] * rest[pi];
            const err = Math.abs(product - total) / Math.max(total, 1);
            if (err < 0.05 && (!bestMatch || err < bestMatch.err)) {
              bestMatch = { qi, pi, err };
            }
          }
        }
        if (bestMatch) {
          quantity = rest[bestMatch.qi];
          unitPrice = rest[bestMatch.pi];
          // Remaining numbers could be tax
          const remaining = rest.filter(
            (_, idx) => idx !== bestMatch!.qi && idx !== bestMatch!.pi,
          );
          if (remaining.length === 1) taxAmount = remaining[0];
        } else {
          // Positional fallback
          const qtyCandidate = rest.find(
            (n) => Number.isInteger(n) && n < 10000,
          );
          if (qtyCandidate !== undefined) {
            quantity = qtyCandidate;
            for (let k = rest.length - 1; k >= 0; k--) {
              if (rest[k] !== quantity) {
                unitPrice = rest[k];
                break;
              }
            }
          } else {
            unitPrice = rest[rest.length - 1];
          }
        }
      } else if (rest.length === 1) {
        const n = rest[0];
        if (Number.isInteger(n) && n < 10000 && n > 0) {
          const inferredPrice = total / n;
          if (inferredPrice >= 0.01 && Number.isFinite(inferredPrice)) {
            quantity = n;
            unitPrice = parseFloat(inferredPrice.toFixed(4));
          } else {
            unitPrice = n;
          }
        } else {
          unitPrice = n;
        }
      }

      // Compute missing unitPrice from total/qty
      if (unitPrice === undefined && quantity > 0 && total > 0) {
        unitPrice = parseFloat((total / quantity).toFixed(4));
      }

      // Compute tax amount from percentage if available
      if (
        taxAmount === undefined &&
        taxPct !== undefined &&
        unitPrice !== undefined
      ) {
        taxAmount = parseFloat(
          (quantity * unitPrice * (taxPct / 100)).toFixed(4),
        );
      }

      // ── Look ahead for description line ─────────────────────────────────
      let description: string | undefined;
      if (i + 1 < lines.length) {
        const nextLine = lines[i + 1].trim();
        if (
          nextLine.length > 3 &&
          !/\d{2,}/.test(nextLine) &&
          !footerRx.test(nextLine) &&
          /[A-Za-z]{2,}/.test(nextLine)
        ) {
          description = nextLine;
          i++; // consume the description line
        }
      }

      // ── Extract SKU / Part Number ───────────────────────────────────────
      const skuM =
        itemName.match(PATTERNS.SKU_LABELED) ??
        itemName.match(PATTERNS.SKU_BARE);
      const sku = skuM ? skuM[1] : undefined;
      // Use earlier-extracted partNumber from column segmentation, or SKU
      const finalPartNumber = partNumber ?? sku;

      items.push({
        itemName: sku
          ? itemName.replace(skuM![0], "").trim() || itemName
          : itemName,
        description,
        sku,
        partNumber: finalPartNumber,
        quantity: isNaN(quantity) ? 1 : quantity,
        unitPrice:
          unitPrice !== undefined
            ? parseFloat(unitPrice.toFixed(4))
            : undefined,
        taxPercentage: taxPct,
        taxAmount,
        totalAmount: parseFloat(total.toFixed(4)),
      });
    }

    return items;
  }

  /**
   * Multi-line item extraction.
   * Pattern:
   *   Line 1: Item name with numbers (qty, price, totals)
   *   Line 2: Description (no leading numbers)
   *   Line 3: (optional) extra detail, e.g. SKU
   */
  private extractMultiLineItems(lines: string[]): DataLiftPart[] {
    const items: DataLiftPart[] = [];
    const footerRx =
      /^(sub\s*total|subtotal|total|gst|tax|vat|shipping|discount|balance)/i;
    const descOnlyRx = /^[A-Za-z][^$€£\d]*$/;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (footerRx.test(line.trim())) break;

      const item = parseLineItem(line, i + 1);
      if (!item) continue;

      // Check if next line is a description
      if (i + 1 < lines.length) {
        const next = lines[i + 1].trim();
        if (next.length > 3 && descOnlyRx.test(next) && !footerRx.test(next)) {
          item.description = next;
          i++;
        }
        // Check for SKU on following line
        if (i + 1 < lines.length) {
          const skuLine = lines[i + 1].trim();
          const skuM = skuLine.match(PATTERNS.SKU_LABELED);
          if (skuM) {
            item.sku = skuM[1];
            i++;
          }
        }
      }

      items.push(item);
    }
    return items;
  }

  /**
   * Vertical-form extraction for POS / thermal-receipt style invoices.
   *
   * Detects documents where line-item data is laid out vertically with
   * one label per line followed by its value on the next line(s):
   *   Part Number
   *   90-27-3325
   *   Description
   *   Alternator - Remfd - H/D Truck
   *   Price
   *   482.36
   *   Net
   *   287.99
   *   ...
   */
  private extractVerticalFormItems(allLines: string[]): DataLiftPart[] {
    // Labels we recognise as vertical form fields
    const labelMap: Record<string, string> = {
      "part number": "partNumber",
      "part no": "partNumber",
      "part#": "partNumber",
      "item no": "partNumber",
      "item number": "partNumber",
      description: "description",
      "line description": "description",
      "item description": "description",
      quantity: "quantity",
      qty: "quantity",
      net: "unitPrice",
      "unit price": "unitPrice",
      "unit cost": "unitPrice",
      price: "listPrice",
      total: "total",
      "line total": "total",
      amount: "total",
      "core deposit": "coreDeposit",
    };

    // Scan for vertical label patterns: a line that is purely a label keyword
    // followed by a line that is a value
    const collected: Record<string, string> = {};
    let foundLabels = 0;

    for (let i = 0; i < allLines.length; i++) {
      const trimmed = allLines[i]
        .trim()
        .toLowerCase()
        .replace(/[:.]+$/, "")
        .trim();
      const field = labelMap[trimmed];
      if (field) {
        // Numeric fields must have digit-containing values
        const numericFields = new Set([
          "quantity",
          "unitPrice",
          "listPrice",
          "total",
          "coreDeposit",
        ]);
        // Look ahead for the value
        for (let j = i + 1; j < Math.min(i + 3, allLines.length); j++) {
          const val = allLines[j].trim();
          if (!val) continue;
          // Value should not be another label
          const valLower = val
            .toLowerCase()
            .replace(/[:.]+$/, "")
            .trim();
          if (labelMap[valLower]) break;
          // Value should not be a totals label
          if (/^(?:sub\s*total|subtotal|total|tax|gst|vat|shipping)/i.test(val))
            break;
          // Numeric fields require at least one digit
          if (numericFields.has(field) && !/\d/.test(val)) break;
          // Only record the FIRST occurrence of each field (prevents
          // totals-section "Total" from overwriting line-item "Total")
          if (!collected[field]) {
            collected[field] = val;
            foundLabels++;
          }
          break;
        }
      }
    }

    // Also look for "Qty: N" inline patterns
    for (const line of allLines) {
      const qtyInline = line.match(/\bqty\s*[:.]?\s*(\d+)\b/i);
      if (qtyInline && !collected.quantity) {
        collected.quantity = qtyInline[1];
        foundLabels++;
      }
    }

    // If description wasn't found via label→value pairing (e.g., consecutive
    // labels with no value between them), scan for the first substantive text
    // line in the labels region.
    if (!collected.description && collected.partNumber) {
      const startIdx = allLines.findIndex((l) =>
        /^(?:part\s*number|description)/i.test(l.trim()),
      );
      if (startIdx >= 0) {
        for (let i = startIdx + 1; i < allLines.length; i++) {
          const trimmed = allLines[i].trim();
          if (!trimmed || trimmed.length < 5) continue;
          const lower = trimmed
            .toLowerCase()
            .replace(/[:.]+$/, "")
            .trim();
          if (labelMap[lower]) continue;
          if (
            /^(?:sub\s*total|subtotal|total|tax|gst|vat|invoice|customer|employee|sales|salesman|attention|terms|delivery|tender|paid)/i.test(
              trimmed,
            )
          )
            break;
          // Must have alphabetic content and not be a pure number/part code
          if (/[A-Za-z]{3,}/.test(trimmed) && !/^[\d\-./#]+$/.test(trimmed)) {
            // Skip if it's the part number we already collected
            if (trimmed === collected.partNumber) continue;
            collected.description = trimmed;
            break;
          }
        }
      }
    }

    // We need at least a description or partNumber plus one price to construct an item
    if (foundLabels < 2 || (!collected.description && !collected.partNumber)) {
      return [];
    }

    // Parse amounts
    const parseAmt = (s: string | undefined): number | undefined => {
      if (!s) return undefined;
      const n = parseFloat(s.replace(/[^0-9.]/g, ""));
      return isNaN(n) ? undefined : n;
    };

    const unitPrice =
      parseAmt(collected.unitPrice) ?? parseAmt(collected.listPrice);
    const total = parseAmt(collected.total) ?? unitPrice;
    const quantity = parseAmt(collected.quantity) ?? 1;

    if (!total && !unitPrice) return [];

    const item: DataLiftPart = {
      itemName: collected.description ?? collected.partNumber ?? "",
      partNumber: collected.partNumber,
      quantity,
      unitPrice:
        unitPrice ??
        (total ? parseFloat((total / quantity).toFixed(4)) : undefined),
      totalAmount:
        total ??
        (unitPrice ? parseFloat((unitPrice * quantity).toFixed(4)) : 0),
    };

    // If there's a core deposit, add it as a separate line item.
    // In POS formats, "Core Deposit" label is followed by a quantity (e.g. "1.00"),
    // and the actual amount appears after the item Total value (e.g. 61.73).
    const items: DataLiftPart[] = [item];
    let coreDeposit = parseAmt(collected.coreDeposit);
    if (coreDeposit !== undefined && coreDeposit <= 2 && collected.total) {
      // Likely captured a quantity, not the price — look after the Total value
      const totalVal = collected.total;
      const totalIdx = allLines.findIndex((l) => l.trim() === totalVal);
      if (totalIdx >= 0) {
        for (
          let k = totalIdx + 1;
          k < Math.min(totalIdx + 4, allLines.length);
          k++
        ) {
          const amtM = allLines[k].trim().match(/^\$?\s*([\d,]+\.\d{1,4})\s*$/);
          if (amtM) {
            const amt = parseFloat(amtM[1].replace(/,/g, ""));
            if (amt > 2) {
              coreDeposit = amt;
              break;
            }
          }
        }
      }
    }
    if (coreDeposit && coreDeposit > 0) {
      items.push({
        itemName: "Core Deposit",
        quantity: 1,
        unitPrice: coreDeposit,
        totalAmount: coreDeposit,
      });
    }

    return items;
  }

  private inferTaxPct(line: string): number | undefined {
    const m = line.match(PATTERNS.TAX_PERCENT);
    return m ? parseFloat(m[1]) : undefined;
  }

  // ─── Totals ───────────────────────────────────────────────────────────────

  private extractTotals(
    fullText: string,
    footerText: string,
    parts: DataLiftPart[],
  ): DataLiftTotals {
    // Prefer footer for totals — it's more specific.
    const search = (footerText.length > 10 ? footerText + "\n" : "") + fullText;
    // Footer-only search for ambiguous labels like "total"
    const footerSearch = footerText.length > 10 ? footerText : fullText;

    const subtotal =
      extractLabeledAmount(search, "sub\\s*total|subtotal") ??
      (parts.length > 0
        ? parseFloat(
            parts.reduce((s, p) => s + (p.totalAmount ?? 0), 0).toFixed(2),
          )
        : undefined);

    // Tax: try POS-style TAXTABLE/PCT patterns first (most specific),
    // then explicit "tax total", then labelled "tax/gst/vat"
    let totalTax: number | undefined;

    // POS-style tax: "5 PCT 6.0000%" then standalone amounts on next lines
    const taxLines = fullText.split("\n");
    for (let i = 0; i < taxLines.length; i++) {
      if (
        /\bpct\b.*%/i.test(taxLines[i]) ||
        /\btaxtable\b/i.test(taxLines[i])
      ) {
        // Scan ahead for two standalone amounts (subtotal then tax)
        const amounts: number[] = [];
        for (let j = i + 1; j < Math.min(i + 5, taxLines.length); j++) {
          const amtM = taxLines[j].trim().match(/^\$?\s*([\d,]+\.\d{1,4})\s*$/);
          if (amtM) amounts.push(parseFloat(amtM[1].replace(/,/g, "")));
        }
        // The smaller of two consecutive amounts is likely the tax
        if (amounts.length >= 2) {
          totalTax = Math.min(amounts[0], amounts[1]);
        }
        break;
      }
    }

    // If POS detection didn't find tax, try labeled extraction
    if (totalTax === undefined) {
      totalTax =
        extractLabeledAmount(
          search,
          "total\\s+(?:gst|tax|vat)|(?:gst|tax|vat)\\s+total|total\\s+tax",
        ) ?? extractLabeledAmount(search, "(?:gst|tax|vat)");
    }

    const shippingCost = extractLabeledAmount(
      search,
      "shipping|delivery|freight|carriage",
    );

    const discount = extractLabeledAmount(search, "discount|savings|rebate");

    // Grand total: try specific patterns first, then "Amount :" (POS),
    // then "total" in footer only (avoids line-item "Total" earlier).
    // Fall back to subtotal if available, or undefined.
    const grandTotal =
      extractLabeledAmount(
        search,
        "grand\\s+total|total\\s+amount\\s+due|total\\s+due",
      ) ??
      extractLabeledAmount(search, "amount\\s+due|balance\\s+due") ??
      extractLabeledAmount(search, "amount\\s*:") ??
      extractLabeledAmount(footerSearch, "\\btotal\\b") ??
      subtotal ??
      0;

    const amountPaid = extractLabeledAmount(
      search,
      "amount\\s+paid|cash\\s+tendered|tendered",
    );
    const balanceDue = extractLabeledAmount(
      search,
      "balance\\s+due|change\\s+due",
    );

    return {
      subtotal,
      totalTax,
      shippingCost,
      discount,
      grandTotal,
      amountPaid,
      balanceDue,
    };
  }
}
