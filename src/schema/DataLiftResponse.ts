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

// ─── Payment Details ────────────────────────────────────────────────────────

export interface DataLiftPaymentDetails {
  /** Payment method: "Cash" | "Credit Card" | "EFTPOS" | "Bank Transfer" | "Cheque" | etc. */
  method?: string;
  /** Payment reference or authorisation number */
  reference?: string;
  /** Card brand: "Visa" | "Mastercard" | "Amex" | "EFTPOS" */
  cardType?: string;
  /** Last 4 digits as printed on receipt */
  cardLast4?: string;
  /** AU bank BSB (e.g. "062-000") */
  bankBsb?: string;
  /** Masked bank account number */
  bankAccount?: string;
  /** Terminal or gateway payment receipt/authorisation number */
  receiptNumber?: string;
}

// ─── Delivery Details ────────────────────────────────────────────────────────

export interface DataLiftDeliveryDetails {
  /** Delivery / ship-to address */
  address?: DataLiftAddress;
  /** ISO-8601 estimated or confirmed delivery date */
  date?: string;
  /** Carrier tracking / consignment number */
  trackingNumber?: string;
  /** Carrier name (e.g. "AusPost", "FedEx", "DHL") */
  carrier?: string;
  /** Shipping method (e.g. "Express", "Standard", "Overnight") */
  shippingMethod?: string;
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
  /** Generic document reference number (e.g. job ref, delivery ref) */
  referenceNumber?: string;
  /** Work order number (for work_order / cmms documents) */
  workOrderNumber?: string;
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
  /** Unit of measure: "ea" | "pcs" | "kg" | "m" | "hr" | "box" | etc. */
  unit?: string;
  unitPrice?: number;
  /** Original list/catalogue price before discount */
  listPrice?: number;
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
  /** ISO-4217 currency code for all totals (e.g. "AUD", "USD") */
  currency?: string;
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
  /** Per-factor confidence breakdown */
  confidenceBreakdown?: {
    ocr: number;
    fields: number;
    numeric: number;
    docType: number;
    keyword: number;
  };
  /** Total count of non-empty extracted fields */
  fieldCount?: number;
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
  /** Payment method, card info, and authorisation reference */
  paymentDetails?: DataLiftPaymentDetails;
  /** Delivery / ship-to details extracted from the document */
  deliveryDetails?: DataLiftDeliveryDetails;
  /** Notes, remarks, or special instructions found in the document */
  notes?: string;
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
   * Image source. Provide `image` as a shorthand base64 string/URI
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

  // ─── LayoutLMv3 on-device model (optional) ────────────────────────────

  /**
   * Path to LayoutLMv3 ONNX/CoreML model file.
   * Can be an absolute path, file:// URI, or bare filename (resolved from app bundle).
   * When set, the model runs after rule-based parsing to enhance extraction.
   */
  layoutLMv3ModelPath?: string;

  /**
   * Path to LayoutLMv3 labels file (JSON or line-per-label format).
   * Required when `layoutLMv3ModelPath` is set.
   */
  layoutLMv3LabelsPath?: string;

  /**
   * If true, require LayoutLMv3 prediction to succeed (throws on failure).
   * If false (default), LayoutLMv3 failure is non-fatal.
   */
  requireLayoutLMv3?: boolean;
}
