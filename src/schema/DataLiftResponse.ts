
/**
 * DataLift – Canonical response schema
 *
 * This file defines the strongly-typed output contract for every
 * DataLift.extract() call regardless of document type, OCR engine,
 * or AI provider used.
 */

// ─── Address ────────────────────────────────────────────────────────────────

export interface DataLiftAddress {
  street?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  /** Concatenated human-readable form */
  fullAddress?: string;
}

// ─── Contact ────────────────────────────────────────────────────────────────

export interface DataLiftContact {
  phone?: string;
  email?: string;
  website?: string;
}

// ─── Tax Info ───────────────────────────────────────────────────────────────

export interface DataLiftTaxInformation {
  taxId?: string;
  gstNumber?: string;
  vatNumber?: string;
  ein?: string;
  /** Australian Business Number e.g. "51 824 753 556" */
  abnNumber?: string;
  /** Australian Company Number */
  acnNumber?: string;
}

// ─── Coordinates ────────────────────────────────────────────────────────────

export interface DataLiftCoordinates {
  latitude?: number;
  longitude?: number;
}

// ─── Supplier ───────────────────────────────────────────────────────────────

export interface DataLiftSupplier {
  name: string;
  address: DataLiftAddress;
  contact: DataLiftContact;
  taxInformation?: DataLiftTaxInformation;
  locationCoordinates?: DataLiftCoordinates;
}

// ─── Buyer ──────────────────────────────────────────────────────────────────

export interface DataLiftBuyer {
  name?: string;
  address?: Pick<DataLiftAddress, "fullAddress">;
  contact?: Pick<DataLiftContact, "phone" | "email">;
}

// ─── Transaction ────────────────────────────────────────────────────────────

export interface DataLiftTransaction {
  invoiceNumber?: string;
  purchaseOrderNumber?: string;
  quoteNumber?: string;
  invoiceDate?: string;
  dueDate?: string;
  transactionDate?: string;
  transactionTime?: string;
  paymentMode?: string;
  paymentTerms?: string;
  currency?: string;
}

// ─── Part / Line Item ───────────────────────────────────────────────────────

export interface DataLiftPart {
  itemName: string;
  description?: string;
  sku?: string;
  partNumber?: string;
  manufacturerPartNumber?: string;
  quantity: number;
  unit?: string;
  unitPrice?: number;
  discount?: number;
  taxPercentage?: number;
  taxAmount?: number;
  totalAmount: number;
}

// ─── Totals ─────────────────────────────────────────────────────────────────

export interface DataLiftTotals {
  subtotal?: number;
  totalTax?: number;
  shippingCost?: number;
  discount?: number;
  tip?: number;
  serviceCharge?: number;
  amountPaid?: number;
  balanceDue?: number;
  grandTotal: number;
}

// ─── Metadata ───────────────────────────────────────────────────────────────

export type DataLiftDocumentType =
  | "invoice"
  | "receipt"
  | "purchase_order"
  | "work_order"
  | "bill"
  | "statement"
  | "quote"
  | "cmms"
  | "supplier_document"
  | "contract"
  | "generic";

export interface DataLiftMetadata {
  documentType: DataLiftDocumentType | string;
  /** 0–1 overall extraction confidence */
  confidenceScore: number;
  extractionTimestamp: string;
  languageDetected: string;
  ocrProvider?: string;
  aiProviderUsed?: string;
  processingTimeMs?: number;
  pageCount?: number;
  warnings?: string[];
}

// ─── Root Response ───────────────────────────────────────────────────────────

export interface DataLiftResponse {
  metadata: DataLiftMetadata;
  supplier: DataLiftSupplier;
  buyer: DataLiftBuyer;
  transaction: DataLiftTransaction;
  parts: DataLiftPart[];
  totals: DataLiftTotals;
  /** Full OCR text (included only when extractRawText option is true) */
  rawText?: string;
}

// ─── Input options ───────────────────────────────────────────────────────────

export type ImageInput =
  | { type: "base64"; data: string; mimeType?: string }
  | { type: "uri"; path: string }
  | { type: "blob"; blob: Blob };

export interface DataLiftExtractOptions {
  /**
   * Image source. Provide `image` as a shorthand base64 string
   * OR the full `imageInput` discriminated union.
   */
  image?: string;
  imageInput?: ImageInput;

  /** Preferred document type (helps tune extraction) */
  documentType?: DataLiftDocumentType | string;

  /** OCR language hint (ISO 639-1, default: "en") */
  language?: string;

  /** 0–1 threshold – if rule-based confidence < this value, AI is invoked */
  aiConfidenceThreshold?: number;

  /** Include raw OCR text in the response */
  extractRawText?: boolean;

  /** Enable verbose logging */
  debug?: boolean;

  /** Custom OCR provider key (if multiple registered) */
  ocrProvider?: string;

  /** Custom AI provider key (if multiple registered) */
  aiProvider?: string;
}
