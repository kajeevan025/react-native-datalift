/**
 * UnifiedDraft07 schema utilities – unit tests
 */
import {
  UNIFIED_DOC_TYPES,
  validateUnifiedDraft07Payload,
  toIsoDate,
  toNumber,
  detectUnifiedDocType,
  normalizeUnifiedPayloadShape,
} from "../schema/UnifiedDraft07";

// ─── toNumber ────────────────────────────────────────────────────────────────

describe("toNumber", () => {
  it("passes through finite numbers", () => {
    expect(toNumber(42)).toBe(42);
    expect(toNumber(0)).toBe(0);
    expect(toNumber(-3.14)).toBe(-3.14);
  });

  it("rejects NaN and Infinity", () => {
    expect(toNumber(NaN)).toBeUndefined();
    expect(toNumber(Infinity)).toBeUndefined();
    expect(toNumber(-Infinity)).toBeUndefined();
  });

  it("parses numeric strings", () => {
    expect(toNumber("123.45")).toBe(123.45);
    expect(toNumber("$1,234.56")).toBe(1234.56);
    expect(toNumber("€99")).toBe(99);
  });

  it("returns undefined for non-parseable", () => {
    expect(toNumber("abc")).toBeUndefined();
    expect(toNumber("")).toBeUndefined();
    expect(toNumber(null)).toBeUndefined();
    expect(toNumber(undefined)).toBeUndefined();
    expect(toNumber({})).toBeUndefined();
  });
});

// ─── toIsoDate ───────────────────────────────────────────────────────────────

describe("toIsoDate", () => {
  it("returns YYYY-MM-DD as-is", () => {
    expect(toIsoDate("2024-01-15")).toBe("2024-01-15");
  });

  it("converts YYYY/MM/DD", () => {
    expect(toIsoDate("2024/03/20")).toBe("2024-03-20");
  });

  it("converts MM/DD/YYYY", () => {
    expect(toIsoDate("01/15/2024")).toBe("2024-01-15");
  });

  it("converts MM-DD-YYYY (dashes)", () => {
    expect(toIsoDate("12-25-2023")).toBe("2023-12-25");
  });

  it("handles 2-digit years", () => {
    expect(toIsoDate("01/15/24")).toBe("2024-01-15");
  });

  it("returns undefined for non-strings", () => {
    expect(toIsoDate(123)).toBeUndefined();
    expect(toIsoDate(null)).toBeUndefined();
    expect(toIsoDate(undefined)).toBeUndefined();
  });

  it("returns undefined for malformed dates", () => {
    expect(toIsoDate("not a date")).toBeUndefined();
    expect(toIsoDate("2024")).toBeUndefined();
  });
});

// ─── detectUnifiedDocType ────────────────────────────────────────────────────

describe("detectUnifiedDocType", () => {
  it("returns rawType when valid", () => {
    expect(detectUnifiedDocType("", "receipt")).toBe("receipt");
    expect(detectUnifiedDocType("", "credit_memo")).toBe("credit_memo");
  });

  it("ignores invalid rawType", () => {
    expect(detectUnifiedDocType("", "banana")).toBe("invoice");
  });

  it("detects credit_memo from text", () => {
    expect(detectUnifiedDocType("This is a Credit Memo")).toBe("credit_memo");
  });

  it("detects remittance from text", () => {
    expect(detectUnifiedDocType("Remittance advice")).toBe("remittance");
  });

  it("detects payment receipt from text", () => {
    expect(detectUnifiedDocType("Payment receipt #123")).toBe(
      "payment_receipt",
    );
  });

  it("detects POS receipt from text", () => {
    expect(detectUnifiedDocType("POS receipt from store")).toBe("pos_receipt");
  });

  it("detects cash_sale from text", () => {
    expect(detectUnifiedDocType("Cash Sale document")).toBe("cash_sale");
  });

  it("detects receipt from text", () => {
    expect(detectUnifiedDocType("Your receipt")).toBe("receipt");
  });

  it("defaults to invoice", () => {
    expect(detectUnifiedDocType("Hello World")).toBe("invoice");
  });
});

// ─── UNIFIED_DOC_TYPES ──────────────────────────────────────────────────────

describe("UNIFIED_DOC_TYPES", () => {
  it("contains all 7 document types", () => {
    expect(UNIFIED_DOC_TYPES.size).toBe(7);
    const expected = [
      "invoice",
      "receipt",
      "pos_receipt",
      "cash_sale",
      "payment_receipt",
      "remittance",
      "credit_memo",
    ];
    for (const t of expected) {
      expect(UNIFIED_DOC_TYPES.has(t)).toBe(true);
    }
  });
});

// ─── validateUnifiedDraft07Payload ───────────────────────────────────────────

describe("validateUnifiedDraft07Payload", () => {
  const validPayload = () => ({
    document_id: "doc-001",
    document_type: "invoice",
    images: [],
    header: { date_issued: "2024-01-15" },
    vendor: {},
    totals: {},
    currency: "USD",
  });

  it("passes for a valid payload", () => {
    const result = validateUnifiedDraft07Payload(validPayload());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("fails when document_id is missing", () => {
    const p = validPayload();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (p as Record<string, unknown>).document_id;
    const result = validateUnifiedDraft07Payload(p);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "document_id is required and must be string",
    );
  });

  it("fails when document_type is invalid", () => {
    const p = { ...validPayload(), document_type: "spreadsheet" };
    const result = validateUnifiedDraft07Payload(p);
    expect(result.valid).toBe(false);
  });

  it("fails when images is not an array", () => {
    const p = { ...validPayload(), images: "not-array" } as Record<
      string,
      unknown
    >;
    const result = validateUnifiedDraft07Payload(p);
    expect(result.valid).toBe(false);
  });

  it("fails for invalid header.date_issued format", () => {
    const p = {
      ...validPayload(),
      header: { date_issued: "2024/01/15" },
    };
    const result = validateUnifiedDraft07Payload(p);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("header.date_issued must be YYYY-MM-DD");
  });

  it("fails for invalid currency code", () => {
    const p = { ...validPayload(), currency: "dollars" };
    const result = validateUnifiedDraft07Payload(p);
    expect(result.valid).toBe(false);
  });

  it("validates missing sections as object errors", () => {
    const result = validateUnifiedDraft07Payload({
      document_id: "x",
      document_type: "invoice",
      images: [],
      currency: "USD",
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("header"))).toBe(true);
  });
});

// ─── normalizeUnifiedPayloadShape ────────────────────────────────────────────

describe("normalizeUnifiedPayloadShape", () => {
  it("fills missing defaults", () => {
    const result = normalizeUnifiedPayloadShape({});
    expect(result.document_id).toBeDefined();
    expect(result.document_type).toBe("invoice");
    expect(result.images).toEqual([]);
    expect(result.currency).toBe("USD");
    expect(typeof result.header).toBe("object");
    expect(typeof result.vendor).toBe("object");
    expect(typeof result.totals).toBe("object");
  });

  it("preserves existing values", () => {
    const result = normalizeUnifiedPayloadShape({
      document_id: "my-id",
      document_type: "receipt",
      currency: "EUR",
    });
    expect(result.document_id).toBe("my-id");
    expect(result.document_type).toBe("receipt");
    expect(result.currency).toBe("EUR");
  });

  it("normalizes header.date_issued via toIsoDate", () => {
    const result = normalizeUnifiedPayloadShape({
      header: { date_issued: "01/15/2024" },
    });
    const header = result.header as Record<string, unknown>;
    expect(header.date_issued).toBe("2024-01-15");
  });
});
