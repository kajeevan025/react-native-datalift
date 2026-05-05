/**
 * DataLift – Input & output validation layer
 *
 * Validates options before processing and sanitises the response
 * before returning it to the caller.
 */

import type {
  DataLiftExtractOptions,
  DataLiftResponse,
} from "../schema/DataLiftResponse";

// ─── Input validation ─────────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateOptions(
  options: DataLiftExtractOptions,
): ValidationResult {
  const errors: string[] = [];

  // Must have one image source
  const hasImage = !!options.image;
  const hasImageInput = !!options.imageInput;

  if (!hasImage && !hasImageInput) {
    errors.push(
      "You must provide either `image` (base64 string) or `imageInput` (ImageInput object).",
    );
  }

  if (hasImage && typeof options.image !== "string") {
    errors.push("`image` must be a base64 string.");
  }

  if (hasImageInput && options.imageInput) {
    const inp = options.imageInput;
    if (inp.type === "base64" && !inp.data) {
      errors.push("`imageInput.data` is required for type 'base64'.");
    }
    if (inp.type === "uri" && !inp.path) {
      errors.push("`imageInput.path` is required for type 'uri'.");
    }
    if (
      inp.type === "blob" &&
      (inp.blob === null ||
        inp.blob === undefined ||
        typeof inp.blob !== "object")
    ) {
      errors.push("`imageInput.blob` must be a Blob instance for type 'blob'.");
    }
  }

  if (
    options.aiConfidenceThreshold !== undefined &&
    (options.aiConfidenceThreshold < 0 || options.aiConfidenceThreshold > 1)
  ) {
    errors.push("`aiConfidenceThreshold` must be between 0 and 1.");
  }

  return { valid: errors.length === 0, errors };
}

// ─── Response sanitisation ────────────────────────────────────────────────────

/**
 * Ensure all required fields have sensible defaults and no `undefined`
 * values reach the caller (JSON serialization safety).
 */
export function sanitiseResponse(response: DataLiftResponse): DataLiftResponse {
  return {
    metadata: {
      documentType: response.metadata?.documentType ?? "generic",
      confidenceScore: response.metadata?.confidenceScore ?? 0,
      // confidenceBreakdown is now required — always provide zero defaults
      confidenceBreakdown: {
        ocr: response.metadata?.confidenceBreakdown?.ocr ?? 0,
        fields: response.metadata?.confidenceBreakdown?.fields ?? 0,
        numeric: response.metadata?.confidenceBreakdown?.numeric ?? 0,
        docType: response.metadata?.confidenceBreakdown?.docType ?? 0,
        keyword: response.metadata?.confidenceBreakdown?.keyword ?? 0,
      },
      extractionTimestamp:
        response.metadata?.extractionTimestamp ?? new Date().toISOString(),
      languageDetected: response.metadata?.languageDetected ?? "en",
      fieldCount: response.metadata?.fieldCount,
      ocrProvider: response.metadata?.ocrProvider,
      aiProviderUsed: response.metadata?.aiProviderUsed,
      processingTimeMs: response.metadata?.processingTimeMs,
      pageCount: response.metadata?.pageCount,
      warnings: response.metadata?.warnings,
    },
    supplier: {
      name: response.supplier?.name ?? "",
      address: {
        street: response.supplier?.address?.street,
        city: response.supplier?.address?.city,
        state: response.supplier?.address?.state,
        postalCode: response.supplier?.address?.postalCode,
        country: response.supplier?.address?.country,
        fullAddress: response.supplier?.address?.fullAddress,
      },
      contact: {
        phone: response.supplier?.contact?.phone,
        email: response.supplier?.contact?.email,
        website: response.supplier?.contact?.website,
      },
      taxInformation: response.supplier?.taxInformation,
      locationCoordinates: response.supplier?.locationCoordinates,
    },
    buyer: {
      name: response.buyer?.name,
      address: response.buyer?.address,
      contact: response.buyer?.contact,
    },
    transaction: {
      invoiceNumber: response.transaction?.invoiceNumber,
      purchaseOrderNumber: response.transaction?.purchaseOrderNumber,
      quoteNumber: response.transaction?.quoteNumber,
      referenceNumber: response.transaction?.referenceNumber,
      workOrderNumber: response.transaction?.workOrderNumber,
      invoiceDate: response.transaction?.invoiceDate,
      dueDate: response.transaction?.dueDate,
      transactionDate: response.transaction?.transactionDate,
      transactionTime: response.transaction?.transactionTime,
      paymentMode: response.transaction?.paymentMode,
      paymentTerms: response.transaction?.paymentTerms,
      currency: response.transaction?.currency ?? "USD",
      status: response.transaction?.status,
    },
    parts: (response.parts ?? []).map((p) => ({
      itemName: p.itemName ?? "",
      description: p.description,
      sku: p.sku,
      partNumber: p.partNumber,
      manufacturerPartNumber: p.manufacturerPartNumber,
      quantity: p.quantity ?? 1,
      unit: p.unit,
      unitPrice: p.unitPrice,
      listPrice: p.listPrice,
      discount: p.discount,
      taxPercentage: p.taxPercentage,
      taxAmount: p.taxAmount,
      totalAmount: p.totalAmount ?? 0,
      hsn: p.hsn,
    })),
    totals: {
      subtotal: response.totals?.subtotal,
      totalTax: response.totals?.totalTax,
      shippingCost: response.totals?.shippingCost,
      discount: response.totals?.discount,
      tip: response.totals?.tip,
      serviceCharge: response.totals?.serviceCharge,
      amountPaid: response.totals?.amountPaid,
      balanceDue: response.totals?.balanceDue,
      grandTotal: response.totals?.grandTotal ?? 0,
    },
    paymentDetails: response.paymentDetails
      ? {
          method: response.paymentDetails.method,
          reference: response.paymentDetails.reference,
          cardType: response.paymentDetails.cardType,
          cardLast4: response.paymentDetails.cardLast4,
          bankBsb: response.paymentDetails.bankBsb,
          bankAccount: response.paymentDetails.bankAccount,
          receiptNumber: response.paymentDetails.receiptNumber,
          iban: response.paymentDetails.iban,
          swiftCode: response.paymentDetails.swiftCode,
        }
      : undefined,
    deliveryDetails: response.deliveryDetails
      ? {
          address: response.deliveryDetails.address,
          date: response.deliveryDetails.date,
          trackingNumber: response.deliveryDetails.trackingNumber,
          carrier: response.deliveryDetails.carrier,
          shippingMethod: response.deliveryDetails.shippingMethod,
        }
      : undefined,
    notes: response.notes,
    rawText: response.rawText,
  };
}

// ─── Typed DataLift error ─────────────────────────────────────────────────────

export type DataLiftErrorCode =
  | "INVALID_INPUT"
  | "OCR_FAILED"
  | "PARSE_FAILED"
  | "AI_FAILED"
  | "TIMEOUT"
  | "UNKNOWN";

export class DataLiftExtractError extends Error {
  constructor(
    message: string,
    public readonly code: DataLiftErrorCode,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "DataLiftExtractError";
  }
}
