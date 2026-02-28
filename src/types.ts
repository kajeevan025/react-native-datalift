/**
 * DataLift - React Native Document Scanner
 * TypeScript type definitions
 */

/**
 * Supported document types
 */
export enum DocumentType {
  RECEIPT = "receipt",
  INVOICE = "invoice",
  GENERIC = "generic",
  BILL = "bill",
  CONTRACT = "contract",
}

/**
 * Image quality levels
 */
export enum ImageQuality {
  LOW = "low",
  MEDIUM = "medium",
  HIGH = "high",
}

/**
 * Image orientation
 */
export enum ImageOrientation {
  NORMAL = 0,
  ROTATE_90 = 90,
  ROTATE_180 = 180,
  ROTATE_270 = 270,
}

/**
 * Document scanning result
 */
export interface DocumentScanResult {
  documentType: DocumentType | string;
  confidence: number;
  processingTime: number;
  rawText: string;
  structuredData: StructuredData;
  metadata: DocumentMetadata;
  error?: string;
}

/**
 * Enhanced structured data organized by sections
 */
export interface EnhancedStructuredData {
  // Document metadata section
  documentInfo?: {
    type?: string; // "invoice", "receipt", "bill", etc.
    number?: string;
    invoiceNumber?: string;
    poNumber?: string;
    quoteNumber?: string;
    issueDate?: string;
    dueDate?: string;
    transactionDate?: string;
    transactionTime?: string;
  };

  // Supplier/Merchant/Vendor section
  supplier?: PartyInfo;

  // Customer/Bill-To section
  customer?: PartyInfo;

  // Shipping section
  shipping?: ShippingInfo;

  // Line items with enhanced fields
  lineItems?: EnhancedLineItem[];

  // Financial summary section
  summary?: {
    currency?: string; // ISO 4217 currency code
    subtotal?: number;
    discount?: number;
    tip?: number;
    serviceCharge?: number;
    taxBreakdown?: TaxDetail[];
    totalTax?: number;
    shippingCost?: number;
    totalAmount?: number;
    amountPaid?: number;
    balanceDue?: number;
  };

  // Payment section
  payment?: PaymentInfo;

  // Generic sections (for non-financial documents)
  sections?: DocumentSection[];
  tables?: DocumentTable[];

  // Extracted contact information
  extractedEmails?: string[];
  extractedPhones?: string[];
  extractedURLs?: string[];

  [key: string]: unknown;
}

/**
 * Structured data extracted from document (backward compatibility)
 */
export interface StructuredData {
  // Common fields
  title?: string;
  currency?: string; // ISO 4217 currency code (USD, EUR, GBP, INR, etc.)

  // Receipt-specific
  merchantName?: string;
  merchantAddress?: string;
  transactionDate?: string;
  transactionTime?: string;
  items?: ReceiptItem[];
  subtotal?: number;
  tax?: number;
  totalAmount?: number;
  paymentMethod?: string;

  // Invoice-specific
  invoiceNumber?: string;
  issueDate?: string;
  dueDate?: string;
  issuer?: Party;
  customer?: Party;
  lineItems?: InvoiceItem[];
  amountPaid?: number;
  balanceDue?: number;

  // Generic document
  sections?: DocumentSection[];
  tables?: DocumentTable[];
  forms?: FormField[];
  extractedEmails?: string[];
  extractedPhones?: string[];
  extractedURLs?: string[];

  // New: Enhanced structured data
  enhanced?: EnhancedStructuredData;

  [key: string]: unknown;
}

/**
 * Address structure
 */
export interface Address {
  street?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  country?: string;
  fullAddress?: string;
}

/**
 * Party information (supplier/customer/vendor)
 */
export interface PartyInfo {
  name?: string;
  address?: Address;
  phone?: string;
  email?: string;
  website?: string;
  taxId?: string;
  businessRegistration?: string;
  accountNumber?: string;
}

/**
 * Shipping information
 */
export interface ShippingInfo {
  method?: string;
  carrier?: string;
  trackingNumber?: string;
  estimatedDelivery?: string;
  cost?: number;
  shipToAddress?: Address;
}

/**
 * Payment information
 */
export interface PaymentInfo {
  method?: string;
  terms?: string;
  dueDate?: string;
  transactionId?: string;
  cardLast4?: string;
  bankDetails?: string;
  lateFee?: number;
}

/**
 * Tax detail breakdown
 */
export interface TaxDetail {
  type: string; // "Sales Tax", "VAT", "GST", etc.
  rate?: number;
  amount: number;
}

/**
 * Enhanced line item with part numbers and additional details
 */
export interface EnhancedLineItem {
  lineNumber?: number;
  partNumber?: string;
  sku?: string;
  manufacturerPartNumber?: string;
  name: string;
  description?: string;
  quantity: number;
  unit?: string; // "pcs", "kg", "lbs", "ea", etc.
  unitPrice: number;
  discount?: number;
  taxRate?: number;
  totalPrice: number;
  category?: string;
}

/**
 * Receipt line item (backward compatibility)
 */
export interface ReceiptItem {
  name: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  discount?: number;
}

/**
 * Invoice party (issuer or customer)
 */
export interface Party {
  name: string;
  address?: string;
  email?: string;
  phone?: string;
  taxId?: string;
}

/**
 * Invoice line item
 */
export interface InvoiceItem {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  taxRate?: number;
}

/**
 * Document section
 */
export interface DocumentSection {
  heading: string;
  content: string;
  level: number;
}

/**
 * Document table
 */
export interface DocumentTable {
  headers: string[];
  rows: string[][];
}

/**
 * Form field
 */
export interface FormField {
  fieldName: string;
  fieldValue: string;
  fieldType: "text" | "checkbox" | "radio" | "date" | "email" | "phone";
}

/**
 * Document metadata
 */
export interface DocumentMetadata {
  pageCount: number;
  imageQuality: ImageQuality;
  textLines: number;
  detectedLanguages: string[];
  processingPipeline?: string[];
  warnings?: string[];
}

/**
 * Image processing options
 */
export interface ImageProcessingOptions {
  uri: string;
  documentType?: DocumentType | string;
  confidence?: number;
  language?: string;
  orientation?: ImageOrientation;
  enhance?: boolean;
}

/**
 * PDF processing options
 */
export interface PDFProcessingOptions {
  uri: string;
  pages?: number[];
  documentType?: DocumentType | string;
  quality?: ImageQuality;
}

/**
 * Classification confidence result
 */
export interface ClassificationResult {
  type: DocumentType | string;
  confidence: number;
  alternatives?: {
    type: string;
    confidence: number;
  }[];
}

/**
 * Camera capture options
 */
export interface CameraCaptureOptions {
  onCapture: (imageUri: string) => void;
  onError?: (error: Error) => void;
  documentDetection?: boolean;
  flashMode?: "off" | "on" | "auto";
  quality?: number;
  aspectRatio?: "square" | "16:9" | "4:3";
}

/**
 * DataLift Scanner component props
 */
export interface DataLiftScannerProps {
  onResult: (result: DocumentScanResult) => void;
  onError?: (error: Error) => void;
  docTypes?: (DocumentType | string)[];
  quality?: ImageQuality;
  enableDebug?: boolean;
  language?: string;
  maxRetries?: number;
  timeout?: number;
}

/**
 * Alias for backward compatibility
 */
export type DocumentScannerProps = DataLiftScannerProps;

/**
 * DataLift error with code
 */
export class DataLiftError extends Error {
  code: string;
  details?: unknown;

  constructor(message: string, code: string, details?: unknown) {
    super(message);
    this.name = "DataLiftError";
    this.code = code;
    this.details = details;
  }
}
