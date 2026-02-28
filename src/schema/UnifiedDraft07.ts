
export const UNIFIED_DOC_TYPES = new Set([
  "invoice",
  "receipt",
  "pos_receipt",
  "cash_sale",
  "payment_receipt",
  "remittance",
  "credit_memo",
]);

const CURRENCY_RX = /^[A-Z]{3}$/;
const DATE_RX = /^\d{4}-\d{2}-\d{2}$/;

export interface UnifiedSchemaValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateUnifiedDraft07Payload(
  payload: Record<string, unknown>,
): UnifiedSchemaValidationResult {
  const errors: string[] = [];

  if (!payload.document_id || typeof payload.document_id !== "string") {
    errors.push("document_id is required and must be string");
  }

  if (
    !payload.document_type ||
    typeof payload.document_type !== "string" ||
    !UNIFIED_DOC_TYPES.has(payload.document_type)
  ) {
    errors.push("document_type is required and must be a valid enum value");
  }

  if (!Array.isArray(payload.images)) {
    errors.push("images is required and must be array");
  }

  if (!payload.header || typeof payload.header !== "object") {
    errors.push("header is required and must be object");
  }

  if (!payload.vendor || typeof payload.vendor !== "object") {
    errors.push("vendor is required and must be object");
  }

  if (!payload.totals || typeof payload.totals !== "object") {
    errors.push("totals is required and must be object");
  }

  if (
    payload.currency !== undefined &&
    (typeof payload.currency !== "string" ||
      !CURRENCY_RX.test(payload.currency))
  ) {
    errors.push("currency must be ISO 4217 uppercase code");
  }

  const header = payload.header as Record<string, unknown> | undefined;
  if (
    header?.date_issued !== undefined &&
    (typeof header.date_issued !== "string" ||
      !DATE_RX.test(header.date_issued))
  ) {
    errors.push("header.date_issued must be YYYY-MM-DD");
  }

  return { valid: errors.length === 0, errors };
}

export function toIsoDate(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const raw = value.trim();
  if (DATE_RX.test(raw)) return raw;
  const parts = raw.replace(/-/g, "/").split("/");
  if (parts.length !== 3) return undefined;
  if (parts[0].length === 4) {
    const yyyy = parts[0];
    const mm = String(parseInt(parts[1], 10) || 1).padStart(2, "0");
    const dd = String(parseInt(parts[2], 10) || 1).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }
  const mm = String(parseInt(parts[0], 10) || 1).padStart(2, "0");
  const dd = String(parseInt(parts[1], 10) || 1).padStart(2, "0");
  const yy = parts[2].length === 2 ? `20${parts[2]}` : parts[2];
  return `${yy}-${mm}-${dd}`;
}

export function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = parseFloat(value.replace(/[^0-9.-]/g, ""));
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}

export function detectUnifiedDocType(text: string, rawType?: unknown): string {
  if (typeof rawType === "string" && UNIFIED_DOC_TYPES.has(rawType)) {
    return rawType;
  }
  const lower = text.toLowerCase();
  if (lower.includes("credit memo")) return "credit_memo";
  if (lower.includes("remittance")) return "remittance";
  if (lower.includes("payment") && lower.includes("receipt")) {
    return "payment_receipt";
  }
  if (lower.includes("pos") && lower.includes("receipt")) return "pos_receipt";
  if (lower.includes("cash sale")) return "cash_sale";
  if (lower.includes("receipt")) return "receipt";
  return "invoice";
}

export function normalizeUnifiedPayloadShape(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const copy: Record<string, unknown> = {
    ...payload,
    header:
      payload.header && typeof payload.header === "object"
        ? { ...(payload.header as Record<string, unknown>) }
        : {},
    vendor:
      payload.vendor && typeof payload.vendor === "object"
        ? { ...(payload.vendor as Record<string, unknown>) }
        : {},
    totals:
      payload.totals && typeof payload.totals === "object"
        ? { ...(payload.totals as Record<string, unknown>) }
        : {},
  };

  const header = copy.header as Record<string, unknown>;
  if (header.date_issued) {
    const iso = toIsoDate(header.date_issued);
    if (iso) header.date_issued = iso;
  }

  if (!copy.document_id || typeof copy.document_id !== "string") {
    copy.document_id = `doc_${Date.now()}`;
  }

  if (
    !copy.document_type ||
    typeof copy.document_type !== "string" ||
    !UNIFIED_DOC_TYPES.has(copy.document_type)
  ) {
    copy.document_type = "invoice";
  }

  if (!Array.isArray(copy.images)) {
    copy.images = [];
  }

  if (typeof copy.currency !== "string" || !CURRENCY_RX.test(copy.currency)) {
    copy.currency = "USD";
  }

  return copy;
}
