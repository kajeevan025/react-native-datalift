/**
 * DataLift – Rule-based parser foundation (v3)
 *
 * High-accuracy shared utilities for all document parsers.
 * Supports AU, US, UK, IN document formats.
 * Enhanced OCR normalization and line-item extraction accuracy.
 * No external dependencies – pure TypeScript.
 */

import type {
  DataLiftAddress,
  DataLiftPart,
  DataLiftSupplier,
  DataLiftBuyer,
  DataLiftTaxInformation,
  DataLiftDocumentType,
} from "../schema/DataLiftResponse";

// ─── OCR text normalization ───────────────────────────────────────────────────

/**
 * Normalise raw OCR text to improve extraction accuracy.
 * Fixes common OCR artefacts without altering semantic meaning.
 */
export function normaliseOCRText(raw: string): string {
  let t = raw;

  // 1. Replace common character mis-recognitions
  // 'l' or 'I' mistaken for '1' at the start of an amount (contextual – only after $)
  t = t.replace(/(\$\s*)[lI](\d)/g, "$11$2");
  // 'O' or 'o' mistaken for '0' inside numeric runs
  t = t.replace(/(\d)[Oo](\d)/g, "$10$2");
  // 'S' mistaken for '$'
  t = t.replace(/(?<=\s)S(\d{1,3}(?:,\d{3})*\.\d{2})\b/g, "\$$1");

  // 2. Normalise whitespace: collapse multiple spaces/tabs
  t = t.replace(/[ \t]{2,}/g, "  ");

  // 3. Fix OCR-inserted spaces within numbers ("1 234.56" → "1234.56")
  //    Only when the fragment looks like a monetary value.
  t = t.replace(/(?<=\d) (?=\d{3}(?:[.,]|\b))/g, "");

  // 4. Normalise dashes / hyphens – OCR may produce em-dash or en-dash
  t = t.replace(/[–—]/g, "-");

  // 5. Strip invisible / zero-width characters
  t = t.replace(/[\u200B-\u200D\uFEFF]/g, "");

  // 6. Trim trailing whitespace per line
  t = t.replace(/[ \t]+$/gm, "");

  return t;
}

// ─── Regex pattern library ────────────────────────────────────────────────────

export const PATTERNS = {
  // International phone: handles +61 3 9000 1234, (03) 9000-1234, +1 800 555 0100
  // Use [ \t] instead of \s to prevent matching across newlines (e.g. zip\narea-code)
  PHONE:
    /(?:\+\d{1,3}[ \t\-.]?)(?:\(?\d{1,4}\)?[ \t\-.]){1,4}\d{2,6}|(?:\(?\d{2,4}\)?[ \t\-.]?\d{3,4}[ \t\-.]?\d{3,4})/g,

  // Emails
  EMAIL: /[\w.+\-]+@[\w\-]+\.[\w.]{2,}/gi,

  // URLs
  URL: /https?:\/\/[^\s]+|www\.[^\s]+/gi,

  // ISO date YYYY-MM-DD
  DATE_ISO: /\b(\d{4}[-/]\d{2}[-/]\d{2})\b/g,

  // DD/MM/YYYY or DD-MM-YYYY (common AU/EU format)
  DATE_DMY: /\b(\d{1,2}[-/.]\d{1,2}[-/.]\d{4})\b/g,

  // MM/DD/YYYY (US)
  DATE_MDY: /\b(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})\b/g,

  // Long date: 18 February 2025, Feb 18 2025, February 18, 2025
  DATE_LONG:
    /\b(\d{1,2})\s+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{4})\b/gi,
  DATE_LONG_REV:
    /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2}),?\s+(\d{4})\b/gi,

  // Monetary amounts
  AMOUNT:
    /(?:[\$€£₹¥]|AUD|USD|EUR|GBP|INR)?\s*(\d{1,3}(?:[,\s]\d{3})*(?:\.\d{1,4})?)/,
  AMOUNT_BARE: /\b(\d{1,3}(?:,\d{3})*\.\d{2})\b/g,

  // Australian Business Number: 51 824 753 556 or 51824753556
  ABN: /\bABN[\s:#.]*(\d{2}\s?\d{3}\s?\d{3}\s?\d{3})\b/i,
  ABN_BARE: /\b(\d{2}\s\d{3}\s\d{3}\s\d{3})\b/g,

  // Australian Company Number
  ACN: /\bACN[\s:#.]*(\d{3}\s?\d{3}\s?\d{3})\b/i,

  // GST number (AU format or generic label)
  GST_AU: /\bGST[\s#:.-]*(?:No\.?|Number)?[\s:#.]*([A-Z0-9\-]+)/i,

  // EIN / Tax ID (US): 12-3456789
  EIN: /\b(?:EIN|Tax\s*ID|Federal\s*Tax)[\s:#.]*(\d{2}-\d{7})\b/i,

  // VAT (EU): GB123456789, DE123456789
  VAT: /\b(?:VAT|VAT\s*No\.?)[\s:#.]*([A-Z]{2}[\s]?\d{7,12})\b/i,

  // GSTIN (Indian): 22ABCDE1234F1Z5
  GSTIN:
    /\b(?:GSTIN|GST\s*No\.?)[\s:#.]*([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1})\b/i,

  // SKU / Part number – label-prefixed
  SKU_LABELED:
    /(?:SKU|Part\s*(?:No|#)|Item\s*(?:No|#)|PN|Catalog\s*(?:No|#))[\s:.]*([A-Z0-9][A-Z0-9\-_.]{2,})/i,
  // SKU – standalone code pattern (e.g. STL-ANG-50505)
  SKU_BARE: /\b([A-Z]{2,6}-[A-Z0-9]{2,}-[A-Z0-9]{2,})\b/,

  // Tax percentage on a line item: 10%, GST 10
  TAX_PERCENT: /\b(\d{1,3}(?:\.\d{1,2})?)\s*(?:%|percent|pct)\b/i,
};

// ─── Currency detection ───────────────────────────────────────────────────────

interface CurrencyInfo {
  code: string;
  symbol: string;
}

const CURRENCY_MAP: Array<{ regex: RegExp; code: string; symbol: string }> = [
  { regex: /A\$|AUD|australian\s+dollar/i, code: "AUD", symbol: "A$" },
  { regex: /\$|USD|US\$|US\s+dollar/i, code: "USD", symbol: "$" },
  { regex: /€|EUR|euro/i, code: "EUR", symbol: "€" },
  { regex: /£|GBP|sterling/i, code: "GBP", symbol: "£" },
  { regex: /₹|INR|Rs\./i, code: "INR", symbol: "₹" },
  { regex: /¥|JPY|yen/i, code: "JPY", symbol: "¥" },
  { regex: /NZD|NZ\$/i, code: "NZD", symbol: "NZ$" },
  { regex: /CAD|C\$/i, code: "CAD", symbol: "C$" },
  { regex: /SGD|S\$/i, code: "SGD", symbol: "S$" },
  { regex: /AED|dirham/i, code: "AED", symbol: "AED" },
];

export function detectCurrency(text: string): CurrencyInfo {
  for (const entry of CURRENCY_MAP) {
    if (entry.regex.test(text))
      return { code: entry.code, symbol: entry.symbol };
  }
  return { code: "USD", symbol: "$" };
}

// ─── Amount extraction ────────────────────────────────────────────────────────

/** Parse a raw string like "$1,234.56" or "1 234.56" to a float */
export function parseAmount(raw: string | undefined | null): number {
  if (raw == null) return 0;
  const cleaned = String(raw).replace(/[^0-9.]/g, "");
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

/** Extract a labeled amount, e.g. "Subtotal: $1,234.56" → 1234.56 */
export function extractLabeledAmount(
  text: string,
  labelPattern: string,
): number | undefined {
  // Wrap label in (?:...) so | alternation inside labelPattern doesn't break capture groups.
  // Also skip optional parenthesized content like (8%) between label and amount.

  // 1. Same-line match: "Subtotal  $349.72" or "Tax (8%)  $7.73"
  // The integer alternative [\d,]{2,} uses a negative lookahead to avoid
  // matching the day portion of dates like "12/07/2023".
  const sameLineRx = new RegExp(
    `(?:${labelPattern})(?:\\s*\\([^)]*\\))?[\\s\\-:]*[A-Z$€£₹¥]*\\s*([\\d,]+\\.\\d+|[\\d,]{2,}(?![/\\-]))`,
    "i",
  );
  const slM = text.match(sameLineRx);
  if (slM?.[1]) {
    const n = parseFloat(slM[1].replace(/,/g, ""));
    if (!isNaN(n) && n >= 0) return n;
  }

  // 2. Multi-line match: label on its own line, value on following 1-4 lines.
  //    Common in POS / thermal-printer OCR where every field is one line.
  const labelRx = new RegExp(`(?:${labelPattern})`, "gi");
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!labelRx.test(lines[i])) continue;
    // Check if the label line already has a number after the label
    const afterLabel = lines[i].replace(labelRx, "");
    const inlineNum = afterLabel.match(/[\$€£₹¥]?\s*([\d,]+\.\d{1,4})/);
    if (inlineNum?.[1]) {
      const n = parseFloat(inlineNum[1].replace(/,/g, ""));
      if (!isNaN(n) && n > 0) return n;
    }
    // Look ahead up to 4 lines for a standalone monetary amount
    for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
      const trimJ = lines[j].trim();
      // Stop scanning if we hit another known label (word-boundary
      // check prevents "TAXTABLE" from matching the "tax" stop word).
      if (
        /^(?:sub\s*total|subtotal|total|tax|amount|discount|shipping|net|gross|balance|paid|tender|grand)\b/i.test(
          trimJ,
        )
      )
        break;
      // Match a standalone amount (optionally with currency symbol)
      const amtM = trimJ.match(/^[\$€£₹¥]?\s*([\d,]+\.\d{1,4})\s*$/);
      if (amtM?.[1]) {
        const n = parseFloat(amtM[1].replace(/,/g, ""));
        if (!isNaN(n) && n > 0) return n;
      }
    }
    // Reset lastIndex for global regex
    labelRx.lastIndex = 0;
  }

  return undefined;
}

export function extractFirstAmount(text: string): number | undefined {
  const m = text.match(/[^\d]*([\d,]+\.\d{1,4})/);
  const amountText = m?.[1];
  if (amountText) {
    const n = parseFloat(amountText.replace(/,/g, ""));
    if (!isNaN(n) && n > 0) return n;
  }
  return undefined;
}

// ─── Date extraction ──────────────────────────────────────────────────────────

/** Normalise various date strings to ISO YYYY-MM-DD where possible */
function normaliseDateString(raw: string): string {
  // Already ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  // DD/MM/YYYY or DD-MM-YYYY → YYYY-MM-DD
  const dmy = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (dmy) {
    return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  }

  // MM/DD/YYYY heuristic (if first number > 12, treat as day-first)
  const mdy = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (mdy && parseInt(mdy[1]) > 12) {
    return `${mdy[3]}-${mdy[1].padStart(2, "0")}-${mdy[2].padStart(2, "0")}`;
  }

  return raw;
}

export function extractFirstDate(text: string): string | undefined {
  const iso = text.match(PATTERNS.DATE_ISO);
  if (iso) return normaliseDateString(iso[0]);
  const dmy = text.match(PATTERNS.DATE_DMY);
  if (dmy) return normaliseDateString(dmy[0]);
  const long = text.match(PATTERNS.DATE_LONG);
  if (long) return long[0];
  return undefined;
}

export function extractDates(text: string): {
  invoiceDate?: string;
  dueDate?: string;
  transactionDate?: string;
} {
  const result: {
    invoiceDate?: string;
    dueDate?: string;
    transactionDate?: string;
  } = {};

  const td = (m: RegExpMatchArray | null) =>
    m?.[1] ? normaliseDateString(m[1]) : undefined;

  const invDateRx =
    /(?:invoice\s*date|date\s*of\s*invoice|date\s*issued|issued|date)\s*[:\-]?\s*(\d{1,4}[-/. ]\d{1,2}[-/. ]\d{2,4})/i;
  result.invoiceDate = td(text.match(invDateRx));

  const dueDateRx =
    /(?:due\s*date|payment\s*due|pay\s*by|payable\s*(?:by|on)|due\s*on)\s*[:\-]?\s*(\d{1,4}[-/. ]\d{1,2}[-/. ]\d{2,4})/i;
  result.dueDate = td(text.match(dueDateRx));

  const txDateRx =
    /(?:transaction|sale|purchase|order)\s*date\s*[:\-]?\s*(\d{1,4}[-/. ]\d{1,2}[-/. ]\d{2,4})/i;
  result.transactionDate = td(text.match(txDateRx));

  if (!result.invoiceDate) {
    const isoMatch = text.match(PATTERNS.DATE_ISO);
    if (isoMatch?.[0]) result.invoiceDate = normaliseDateString(isoMatch[0]);
  }

  return result;
}

// ─── Phone / Email / URL ──────────────────────────────────────────────────────

export function extractPhones(text: string): string[] {
  const found = text.match(PATTERNS.PHONE) ?? [];
  return Array.from(
    new Set(
      found
        .map((p) => p.trim())
        .filter((p) => p.replace(/\D/g, "").length >= 7)
        // Reject US ZIP+4 codes (e.g. 29651-1500) that look like phone numbers
        .filter((p) => !/^\d{5}-\d{4}$/.test(p)),
    ),
  );
}

export function extractEmails(text: string): string[] {
  const found = text.match(PATTERNS.EMAIL) ?? [];
  return Array.from(new Set(found.map((e) => e.toLowerCase())));
}

export function extractURLs(text: string): string[] {
  const found = text.match(PATTERNS.URL) ?? [];
  return Array.from(new Set(found.map((u) => u.trim())));
}

// ─── Address parser ───────────────────────────────────────────────────────────

const AU_STATES = /\b(NSW|VIC|QLD|SA|WA|TAS|ACT|NT)\b/;
const AU_SUBURB_STATE_PC =
  /([A-Za-z][A-Za-z\s]{1,30})\s+(NSW|VIC|QLD|SA|WA|TAS|ACT|NT)\s+(\d{4})/;

const COUNTRY_CODES: Record<string, string> = {
  australia: "AU",
  // Removed bare "au" — too many false positives (e.g. "auto", "audit", "authority")
  "united states": "US",
  usa: "US",
  "u.s.a": "US",
  "united kingdom": "GB",
  uk: "GB",
  india: "IN",
  canada: "CA",
  "new zealand": "NZ",
  nz: "NZ",
  germany: "DE",
  france: "FR",
  singapore: "SG",
};

export function parseAddress(block: string): DataLiftAddress {
  const addr: DataLiftAddress = {};
  const lines = block
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  // Australian suburb STATE postcode pattern
  const auMatch = block.match(AU_SUBURB_STATE_PC);
  if (auMatch) {
    addr.city = auMatch[1].trim();
    addr.state = auMatch[2];
    addr.postalCode = auMatch[3];
    addr.country = "AU";
  }

  // Country detection
  if (!addr.country) {
    const lower = block.toLowerCase();
    for (const [name, code] of Object.entries(COUNTRY_CODES)) {
      if (lower.includes(name)) {
        addr.country = code;
        break;
      }
    }
  }

  // US ZIP + city,state  — also overrides a false-positive AU country if we find US pattern
  if (!addr.postalCode) {
    const zipMatch = block.match(/\b(\d{5}(?:-\d{4})?)\b/);
    if (zipMatch) addr.postalCode = zipMatch[1];
    const csz = block.match(/([A-Za-z ]{2,30}),\s*([A-Z]{2})\s+\d{5}/);
    if (csz) {
      addr.city = csz[1].trim();
      addr.state = csz[2];
      // Two-letter US state + 5-digit ZIP → US, even if country was set to AU by false positive
      if (addr.country === "AU" && !AU_STATES.test(addr.state)) {
        addr.country = "US";
      }
      if (!addr.country) addr.country = "US";
    }
  }

  // Street: first line containing a number followed by a word
  for (const line of lines) {
    if (/^\d{1,5}\s+\w/.test(line) && line.length > 5) {
      addr.street = line;
      break;
    }
  }

  // Build fullAddress — only when we detected at least one real address component
  const parts = [
    addr.street,
    addr.city && addr.state
      ? `${addr.city} ${addr.state}`
      : (addr.city ?? addr.state),
    addr.postalCode,
    addr.country,
  ].filter(Boolean);
  if (parts.length > 0) addr.fullAddress = parts.join(", ");

  return addr;
}

// ─── Tax information extraction ───────────────────────────────────────────────

export function extractTaxInformation(
  text: string,
): DataLiftTaxInformation | undefined {
  const ti: DataLiftTaxInformation = {};

  // ABN
  const abnLabeled = text.match(PATTERNS.ABN);
  if (abnLabeled?.[1])
    ti.abnNumber = `ABN: ${abnLabeled[1].replace(/\s+/g, " ").trim()}`;

  // ACN
  const acnMatch = text.match(PATTERNS.ACN);
  if (acnMatch?.[1]) ti.acnNumber = acnMatch[1].replace(/\s+/g, " ").trim();

  // GST (AU)
  const gstMatch = text.match(PATTERNS.GST_AU);
  if (gstMatch) ti.gstNumber = gstMatch[1].trim();

  // EIN (US)
  const einMatch = text.match(PATTERNS.EIN);
  if (einMatch) ti.taxId = einMatch[1];

  // VAT (EU)
  const vatMatch = text.match(PATTERNS.VAT);
  if (vatMatch?.[1]) ti.vatNumber = vatMatch[1].replace(/\s/g, "");

  // GSTIN (India)
  const gstinMatch = text.match(PATTERNS.GSTIN);
  if (gstinMatch) ti.gstNumber = gstinMatch[1];

  return Object.keys(ti).length > 0 ? ti : undefined;
}

// ─── Supplier builder ─────────────────────────────────────────────────────────

export function buildSupplier(
  nameHint: string | undefined,
  headerBlock: string,
): DataLiftSupplier {
  const phones = extractPhones(headerBlock);
  const emails = extractEmails(headerBlock);
  const urls = extractURLs(headerBlock);
  const address = parseAddress(headerBlock);
  const taxInfo = extractTaxInformation(headerBlock);

  // Prefer formatted phone numbers (with parens, dashes, dots, spaces)
  // over plain digit strings that may be store numbers or account IDs.
  // Also reject strings that look like dates or document IDs (8+ consecutive digits).
  const isPhoneLike = (p: string): boolean => {
    const digits = p.replace(/\D/g, "");
    if (digits.length < 7 || digits.length > 15) return false;
    // Reject if the ORIGINAL string has 8+ consecutive digits (date/doc ID like 20231120).
    // Check against original `p` — not the stripped version — so that formatted
    // phones like "954-845-1040" (max 3 consecutive digits) still pass.
    if (/\d{8,}/.test(p)) return false;
    return true;
  };
  const formattedPhone = phones.find(
    (p) =>
      /[()\-. ]/.test(p) && p.replace(/\D/g, "").length >= 10 && isPhoneLike(p),
  );
  // Fall back to first phone that passes basic validation
  const fallbackPhone = phones.find((p) => isPhoneLike(p));

  return {
    name: nameHint ?? "",
    address,
    contact: {
      phone: formattedPhone ?? fallbackPhone,
      email: emails[0],
      website: urls[0],
    },
    taxInformation: taxInfo,
  };
}

// ─── Buyer builder ────────────────────────────────────────────────────────────

export function buildBuyer(block: string): DataLiftBuyer {
  const lines = block
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const phones = extractPhones(block);
  const emails = extractEmails(block);
  const address = parseAddress(block);

  // Patterns that are section labels, not buyer names
  const skipRx =
    /^(bill\s*to|billed\s*to|customer|buyer|sold\s*to|ship\s*to|deliver\s*to|attn|attention|client|account\s*(?:name|holder)|purchaser|customer\s*(?:name|details?|info(?:rmation)?))\s*[:.]?\s*$/i;

  // Inline-label pattern: "Customer Name: John Smith" or "Bill To: Acme Inc"
  const inlineLabelRx =
    /^(?:bill\s*to|billed\s*to|customer(?:\s*name)?|buyer|sold\s*to|ship\s*to|deliver\s*to|attn|attention|client|account\s*(?:name|holder)|purchaser)\s*[:.]\s*(.+)/i;

  let name: string | undefined;

  // 1. Check for inline label on first line(s)
  for (const line of lines) {
    const inlineMatch = line.match(inlineLabelRx);
    if (inlineMatch?.[1] && inlineMatch[1].trim().length > 2) {
      name = inlineMatch[1].trim();
      break;
    }
  }

  // 2. Fallback: first meaningful line that is not a label, phone, email, or pure number
  if (!name) {
    name = lines.find((l) => {
      if (skipRx.test(l)) return false;
      if (l.length <= 2) return false;
      // Skip lines that are purely numeric/amount or phone-like
      if (/^[\d\s\-().+$€£₹¥,]+$/.test(l)) return false;
      // Skip lines that look like an email or URL
      if (/^[\w.+-]+@[\w.-]+$/.test(l)) return false;
      if (/^https?:\/\//.test(l) || /^www\./.test(l)) return false;
      return true;
    });
  }

  // 3. Clean Attn:/Attention: prefix from the name
  if (name) {
    name = name.replace(/^(?:attn|attention)[:.]\s*/i, "").trim();
  }

  return {
    name,
    address: { fullAddress: address.fullAddress ?? lines.join(", ") },
    contact: {
      phone: phones[0],
      email: emails[0],
    },
  };
}

// ─── Line item parser ─────────────────────────────────────────────────────────

/** Lines that are summary rows — never line items */
const SUMMARY_LINE_RX =
  /^(?:sub\s*total|subtotal|total|tax|gst|vat|hst|pst|shipping|delivery|freight|discount|rebate|balance|amount\s+due|amount\s+paid|total\s+amount|change\s+due|rounding|tip|gratuity|net\s+amount|gross|payment|paid|tendered|change|due|owing)\b/i;

/** Lines that are table headers */
const HEADER_LINE_RX =
  /(?:description|item\s*name|item|qty|quantity|unit\s*price|unit\s*cost|price|amount|total|tax|sku|product|service|particular|uom|unit\s*of\s*measure|rate|no\.?)\b/i;

/**
 * Parse a single line item from a text line.
 * Handles patterns like:
 *   "Steel Angle Bar 50x50x5mm   20   45.00   10%   90.00   990.00"
 *   "Hex Bolt M12 x 75mm          200  0.85  10   17.00  187.00"
 *   "Service Fee                                  $50.00"
 *   "1  Widget A  5  12.50  62.50"
 * Uses mathematical validation (qty × unitPrice ≈ total) to disambiguate numbers.
 */
export function parseLineItem(
  line: string,
  _lineNum: number,
  defaultTaxPct?: number,
): DataLiftPart | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length < 4) return null;
  if (SUMMARY_LINE_RX.test(trimmed)) return null;
  if (HEADER_LINE_RX.test(trimmed) && !/\d/.test(trimmed)) return null;

  // ── Extract all numeric tokens with their positions ────────────────────
  interface NumToken {
    value: number;
    index: number;
    raw: string;
    isPct: boolean;
  }
  const numTokens: NumToken[] = [];
  const numPattern = /([\$€£₹¥]\s*)?(\d{1,3}(?:,\d{3})*(?:\.\d{1,4})?)\s*(%)?/g;
  let m: RegExpExecArray | null;
  while ((m = numPattern.exec(trimmed)) !== null) {
    const amountText = m[2] ?? "";
    const v = parseFloat(amountText.replace(/,/g, ""));
    if (!isNaN(v) && v > 0) {
      numTokens.push({
        value: v,
        index: m.index,
        raw: m[0],
        isPct: m[3] === "%",
      });
    }
  }

  if (numTokens.length === 0) return null;

  // ── Extract tax percentage ─────────────────────────────────────────────
  let taxPercentage: number | undefined;
  const pctToken = numTokens.find((t) => t.isPct);
  if (pctToken) {
    taxPercentage = pctToken.value;
  } else {
    const taxPctMatch = trimmed.match(PATTERNS.TAX_PERCENT);
    if (taxPctMatch) taxPercentage = parseFloat(taxPctMatch[1]);
  }

  // ── Extract SKU ────────────────────────────────────────────────────────
  let sku: string | undefined;
  const skuLabeled = trimmed.match(PATTERNS.SKU_LABELED);
  const skuBare = trimmed.match(PATTERNS.SKU_BARE);
  if (skuLabeled) sku = skuLabeled[1];
  else if (skuBare) sku = skuBare[1];

  // ── Filter out percentage and SKU-embedded numbers ─────────────────────
  const candidateNums = numTokens
    .filter((t) => !t.isPct && t.value !== taxPercentage)
    .map((t) => t.value);

  if (candidateNums.length === 0) return null;

  // ── Total: last (rightmost) number ─────────────────────────────────────
  const totalAmount = candidateNums[candidateNums.length - 1];
  if (totalAmount <= 0 || totalAmount > 9_999_999) return null;

  // ── Extract item name (text portion) ───────────────────────────────────
  // Strategy: split line by 2+ spaces, first segment that has alphabetic chars is the name
  const segments = trimmed.split(/\s{2,}/);
  let itemName = "";
  for (const seg of segments) {
    if (/[A-Za-z]{2,}/.test(seg)) {
      itemName = seg.trim();
      break;
    }
  }
  // Fallback: strip trailing numeric cluster
  if (itemName.length < 2) {
    itemName = trimmed
      .replace(
        /[\s]*(?:[\$€£₹¥]?\s*\d[\d,.\s%×xX@*]*)(?:\s+(?:[\$€£₹¥]?\s*\d[\d,.\s%×xX@*]*))*\s*$/,
        "",
      )
      .trim();
  }
  // Remove embedded SKU from name display
  if (sku && itemName.includes(sku)) {
    const escapedSku = sku.replace(/[-_.]/g, "\\$&");
    itemName = itemName
      .replace(
        new RegExp(`(?:SKU|Part\\s*(?:No|#))\\s*[:.]?\\s*${escapedSku}`, "i"),
        "",
      )
      .trim();
    // If only SKU matched directly (not label-prefixed), strip it too
    if (itemName.includes(sku)) {
      itemName = itemName.replace(sku, "").trim();
    }
    if (!itemName)
      itemName = trimmed.split(/\s{2,}/)[0] ?? trimmed.slice(0, 40);
  }
  // Strip leading line/row number like "1  " or "01. "
  itemName = itemName.replace(/^\d{1,3}[.)\s]+\s*/, "").trim();
  if (itemName.length < 2)
    itemName = trimmed.split(/\s{2,}/)[0] ?? trimmed.slice(0, 40);

  // ── Disambiguate quantity, unitPrice, taxAmount using math ─────────────
  let quantity = 1;
  let unitPrice: number | undefined;
  let taxAmount: number | undefined;

  const nums = candidateNums.slice(0, -1); // everything except total

  if (nums.length >= 2) {
    // Try every (i, j) pair where nums[i]=qty, nums[j]=unitPrice
    // and look for qty × unitPrice ≈ totalAmount (within 5% tolerance)
    let bestMatch: { qi: number; pi: number; err: number } | null = null;
    for (let qi = 0; qi < nums.length; qi++) {
      for (let pi = 0; pi < nums.length; pi++) {
        if (qi === pi) continue;
        const q = nums[qi];
        const p = nums[pi];
        const product = q * p;
        const err = Math.abs(product - totalAmount) / Math.max(totalAmount, 1);
        if (err < 0.05 && (!bestMatch || err < bestMatch.err)) {
          bestMatch = { qi, pi, err };
        }
      }
    }
    if (bestMatch) {
      quantity = nums[bestMatch.qi];
      unitPrice = nums[bestMatch.pi];
      // Remaining numbers could be tax amount
      const remaining = nums.filter(
        (_, i) => i !== bestMatch!.qi && i !== bestMatch!.pi,
      );
      if (remaining.length === 1) taxAmount = remaining[0];
    } else {
      // No math match — use positional heuristic
      // First small integer is qty, next decimal-looking number is unitPrice
      const qtyCandidate = nums.find(
        (n) => Number.isInteger(n) && n < 10000 && n !== taxPercentage,
      );
      if (qtyCandidate !== undefined) {
        quantity = qtyCandidate;
        // The number just before total that isn't qty is unit price
        for (let i = nums.length - 1; i >= 0; i--) {
          if (nums[i] !== quantity && nums[i] !== taxPercentage) {
            unitPrice = nums[i];
            break;
          }
        }
      } else {
        // All non-integer: unitPrice is the one before total
        unitPrice = nums[nums.length - 1];
      }
    }
  } else if (nums.length === 1) {
    // Single number before total: could be qty or unitPrice
    const n = nums[0];
    if (Number.isInteger(n) && n < 10000 && n > 0) {
      // Check if it works as quantity: total / n should be a clean price
      const inferredPrice = totalAmount / n;
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

  // Fallback: compute unitPrice from total/qty if still missing
  if (unitPrice === undefined && quantity > 0 && totalAmount > 0) {
    unitPrice = parseFloat((totalAmount / quantity).toFixed(4));
  }

  // ── Tax amount computation ─────────────────────────────────────────────
  if (
    taxAmount === undefined &&
    taxPercentage !== undefined &&
    unitPrice !== undefined
  ) {
    taxAmount = parseFloat(
      (quantity * unitPrice * (taxPercentage / 100)).toFixed(4),
    );
  }
  if (
    taxAmount === undefined &&
    defaultTaxPct !== undefined &&
    unitPrice !== undefined
  ) {
    taxPercentage = defaultTaxPct;
    taxAmount = parseFloat(
      (quantity * unitPrice * (defaultTaxPct / 100)).toFixed(4),
    );
  }

  return {
    itemName,
    sku,
    quantity: isNaN(quantity) ? 1 : quantity,
    unitPrice:
      unitPrice !== undefined ? parseFloat(unitPrice.toFixed(4)) : undefined,
    taxPercentage,
    taxAmount,
    totalAmount: parseFloat(totalAmount.toFixed(4)),
  };
}

// ─── Document type classifier ─────────────────────────────────────────────────

export function classifyDocumentType(text: string): DataLiftDocumentType {
  const lower = text.toLowerCase();
  const scores: Record<DataLiftDocumentType, number> = {
    invoice: 0,
    receipt: 0,
    purchase_order: 0,
    work_order: 0,
    bill: 0,
    statement: 0,
    quote: 0,
    cmms: 0,
    supplier_document: 0,
    contract: 0,
    generic: 0,
  };

  const check = (type: DataLiftDocumentType, kws: string[]) =>
    kws.forEach((kw) => {
      if (lower.includes(kw)) scores[type]++;
    });

  check("invoice", [
    "invoice",
    "inv #",
    "inv no",
    "bill to",
    "amount due",
    "tax invoice",
  ]);
  check("receipt", [
    "receipt",
    "thank you for your purchase",
    "cash",
    "change due",
    "transaction",
  ]);
  check("purchase_order", [
    "purchase order",
    "p.o.",
    "po#",
    "po number",
    "ship to",
    "ordered by",
  ]);
  check("work_order", [
    "work order",
    "wo#",
    "technician",
    "labour",
    "asset id",
    "fault",
  ]);
  check("bill", [
    "bill",
    "billing period",
    "account no",
    "utility",
    "electricity",
    "gas",
  ]);
  check("statement", [
    "statement",
    "opening balance",
    "closing balance",
    "transactions",
  ]);
  check("quote", ["quotation", "quote", "estimate", "valid until", "quoted"]);
  check("cmms", [
    "cmms",
    "maintenance",
    "work request",
    "preventive maintenance",
  ]);
  check("supplier_document", [
    "vendor",
    "supplier",
    "packing list",
    "delivery note",
    "delivery docket",
  ]);
  check("contract", ["contract", "agreement", "whereas", "parties", "signed"]);

  const best = (
    Object.entries(scores) as Array<[DataLiftDocumentType, number]>
  ).reduce((a, b) => (b[1] > a[1] ? b : a));
  return best[1] > 0 ? best[0] : "generic";
}

// ─── Language detector ────────────────────────────────────────────────────────

export function detectLanguage(text: string): string {
  const s = text.slice(0, 800).toLowerCase();
  // English — expanded to cover business-document vocabulary (avoiding cross-language words like total/date/description)
  if (
    /\b(the|and|for|with|from|this|that|are|have|not|invoice|receipt|payment|shipping|price|quantity|amount|order|discount|street|phone|terms)\b/.test(
      s,
    )
  )
    return "en";
  if (/\b(le|la|les|de|du|un|une|avec|pour|pas)\b/.test(s)) return "fr";
  if (/\b(der|die|das|und|für|mit|nicht|ein|eine)\b/.test(s)) return "de";
  if (/\b(el|la|los|de|del|un|una|con|para|que)\b/.test(s)) return "es";
  if (/\b(il|lo|la|e|di|del|un|una|con|per)\b/.test(s)) return "it";
  return "en";
}
