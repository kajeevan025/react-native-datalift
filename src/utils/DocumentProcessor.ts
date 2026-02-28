/**
 * DataLift - Core Document Processor (v3)
 *
 * Handles OCR text extraction, document classification, and structured
 * data parsing using native modules (Apple Vision / Google ML Kit).
 * Enhanced line-item and customer extraction with math validation.
 * Compatible with React Native 0.70+ (both bridged and bridgeless mode)
 */

import { DataLift } from "../NativeDataLift";
import {
  DocumentScanResult,
  DocumentType,
  ImageProcessingOptions,
  PDFProcessingOptions,
  ImageQuality,
  DocumentMetadata,
  StructuredData,
  ClassificationResult,
  DataLiftError,
  EnhancedStructuredData,
  EnhancedLineItem,
  PartyInfo,
  Address,
} from "../types";
import {
  AddressParser,
  ContactInfoParser,
  PartNumberParser,
  CurrencyAmountParser,
  DateParser,
  TableDetector,
  TaxParser,
} from "./ExtractionPatterns";
import { RuleBasedParser } from "../parser/RuleBasedParser";
import { createLogger, DataLiftLogger } from "./logger";

export interface DocumentProcessorOptions {
  language?: string;
  confidenceThreshold?: number;
  enableDebug?: boolean;
}

/**
 * Main document processor class.
 * Orchestrates native OCR, classification, and structured data extraction.
 */
export class DocumentProcessor {
  private language: string;
  private confidenceThreshold: number;
  private enableDebug: boolean;
  private logger: DataLiftLogger;

  constructor(options?: DocumentProcessorOptions) {
    this.language = options?.language ?? "eng";
    this.confidenceThreshold = options?.confidenceThreshold ?? 0.7;
    this.enableDebug = options?.enableDebug ?? false;
    this.logger = createLogger(this.enableDebug);
  }

  /**
   * Process a single image file through the full pipeline:
   * 1. Native OCR text extraction
   * 2. Document classification
   * 3. Structured data parsing
   * 4. Metadata gathering
   */
  async processImage(
    options: ImageProcessingOptions,
  ): Promise<DocumentScanResult> {
    const startTime = Date.now();

    try {
      if (!options.uri) {
        throw new DataLiftError("Image URI is required", "INVALID_INPUT");
      }

      this.log("Processing image:", options.uri);

      // Step 1: Extract raw text using native OCR
      const rawText = await this.extractTextFromImage(options.uri);

      // Step 2: Classify document type
      const classification = await this.classifyDocument(
        options.uri,
        rawText,
        options.documentType,
      );

      // Step 3: Extract structured data based on type
      const structuredData = await this.extractStructuredData(
        classification.type,
        rawText,
        options.uri,
      );

      // Step 4: Gather metadata
      const metadata = this.gatherMetadata(rawText);

      const processingTime = Date.now() - startTime;

      this.log("Result:", {
        type: classification.type,
        confidence: classification.confidence,
        processingTime,
      });

      return {
        documentType: classification.type,
        confidence: classification.confidence,
        processingTime,
        rawText,
        structuredData,
        metadata,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown processing error";
      this.logger.error("Error processing image:", message);
      throw error instanceof DataLiftError
        ? error
        : new DataLiftError(message, "PROCESSING_ERROR");
    }
  }

  /**
   * Process a PDF file (extracts pages as images, then processes each).
   */
  async processPDF(
    options: PDFProcessingOptions,
  ): Promise<DocumentScanResult[]> {
    try {
      if (!options.uri) {
        throw new DataLiftError("PDF URI is required", "INVALID_INPUT");
      }

      this.log("Processing PDF:", options.uri);

      // Extract images from PDF pages via native module
      const pages = await DataLift.extractPDFPages({
        uri: options.uri,
        pages: options.pages ?? [0],
      });

      // Process each extracted page image
      const results: DocumentScanResult[] = [];
      for (const page of pages) {
        const result = await this.processImage({
          uri: page.uri,
          documentType: options.documentType,
        });
        results.push(result);
      }

      return results;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown PDF processing error";
      this.logger.error("Error processing PDF:", message);
      throw error instanceof DataLiftError
        ? error
        : new DataLiftError(message, "PDF_PROCESSING_ERROR");
    }
  }

  /**
   * Extract text from image using native OCR.
   * iOS: Apple Vision (VNRecognizeTextRequest)
   * Android: Google ML Kit Text Recognition
   */
  private async extractTextFromImage(imageUri: string): Promise<string> {
    try {
      const nativeResult = await DataLift.extractTextNative({
        uri: imageUri,
        language: this.language,
      });
      // Guard: native module may return null/undefined/non-string – always return a string
      const rawOCR = nativeResult?.text;
      return typeof rawOCR === "string" ? rawOCR : String(rawOCR ?? "");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Native OCR failed";
      this.logger.error("Native OCR error:", message);
      throw new DataLiftError(`OCR extraction failed: ${message}`, "OCR_ERROR");
    }
  }

  /**
   * Classify the document type using native classifier.
   * Falls back to text-heuristic classification if native fails.
   */
  private async classifyDocument(
    imageUri: string,
    text: string,
    preferredType?: DocumentType | string,
  ): Promise<ClassificationResult> {
    // If user specified a type, still run classification for accurate confidence
    try {
      const result = await DataLift.classifyDocument({
        uri: imageUri,
        text,
      });

      // If user prefers a specific type, use their preference but keep real confidence
      if (preferredType) {
        return {
          type: preferredType,
          confidence: result.confidence,
        };
      }

      if (result.confidence < this.confidenceThreshold) {
        // Native confidence is low — cross-check with text heuristics
        const heuristicResult = this.heuristicClassify(text);
        if (
          heuristicResult.confidence > result.confidence &&
          heuristicResult.type !== DocumentType.GENERIC
        ) {
          return heuristicResult;
        }
        return {
          type: DocumentType.GENERIC,
          confidence: result.confidence,
        };
      }

      return result;
    } catch (error) {
      this.logger.warn(
        "Native classification failed, using heuristic fallback",
      );
      const fallbackResult = this.heuristicClassify(text);
      // Use preferred type if provided, but keep calculated confidence
      if (preferredType) {
        return {
          type: preferredType,
          confidence: fallbackResult.confidence,
        };
      }
      return fallbackResult;
    }
  }

  /**
   * Text-heuristic based document classification.
   * Matches keywords to determine document type.
   */
  private heuristicClassify(text: string): ClassificationResult {
    // Guard: always operate on a string – native OCR may return null/undefined
    if (!text) return { type: DocumentType.GENERIC, confidence: 0.0 };

    const lowerText = text.toLowerCase();

    // Strong signal override: explicit document type keyword appearing on its own line
    // or embedded in standard phrases like "Invoice Number", "Invoice Date"
    const standaloneTypeMatch = text.match(
      /^\s*(INVOICE|RECEIPT|BILL|CONTRACT)\s*$/im,
    );
    if (standaloneTypeMatch) {
      const typeStr = standaloneTypeMatch[1].toLowerCase();
      const typeMap: Record<string, string> = {
        invoice: DocumentType.INVOICE,
        receipt: DocumentType.RECEIPT,
        bill: DocumentType.BILL,
        contract: DocumentType.CONTRACT,
      };
      if (typeMap[typeStr]) {
        return { type: typeMap[typeStr], confidence: 0.9 };
      }
    }

    // Also check for strong invoice signals in phrases (not standalone)
    if (
      /invoice\s*(?:number|no\.?|#|date)|einvoice|inv\s*[#:]/i.test(lowerText)
    ) {
      // Very strong invoice signal — boost confidence
      return { type: DocumentType.INVOICE, confidence: 0.88 };
    }

    const receiptKeywords = [
      "receipt",
      "total",
      "subtotal",
      "tax",
      "change",
      "cash",
      "credit card",
      "debit",
      "thank you",
      "purchase",
      "store",
    ];
    const invoiceKeywords = [
      "invoice",
      "inv",
      "bill to",
      "ship to",
      "due date",
      "payment terms",
      "amount due",
      "balance due",
      "po number",
    ];
    const billKeywords = [
      "bill",
      "account number",
      "statement",
      "billing period",
      "amount due",
      "pay by",
      "utility",
      "service charge",
    ];
    const contractKeywords = [
      "contract",
      "agreement",
      "terms and conditions",
      "whereas",
      "hereby",
      "parties",
      "effective date",
      "signature",
    ];

    const scores: Record<string, number> = {
      [DocumentType.RECEIPT]: 0,
      [DocumentType.INVOICE]: 0,
      [DocumentType.BILL]: 0,
      [DocumentType.CONTRACT]: 0,
    };

    receiptKeywords.forEach((kw) => {
      if (lowerText.includes(kw)) scores[DocumentType.RECEIPT]++;
    });
    invoiceKeywords.forEach((kw) => {
      if (lowerText.includes(kw)) scores[DocumentType.INVOICE]++;
    });
    billKeywords.forEach((kw) => {
      if (lowerText.includes(kw)) scores[DocumentType.BILL]++;
    });
    contractKeywords.forEach((kw) => {
      if (lowerText.includes(kw)) scores[DocumentType.CONTRACT]++;
    });

    const maxType = Object.entries(scores).reduce((a, b) =>
      a[1] >= b[1] ? a : b,
    );

    const totalKeywords = Object.values(scores).reduce((a, b) => a + b, 0);
    const confidence = totalKeywords > 0 ? maxType[1] / totalKeywords : 0;

    if (confidence < this.confidenceThreshold || maxType[1] === 0) {
      return { type: DocumentType.GENERIC, confidence: 0.5 };
    }

    return {
      type: maxType[0],
      confidence: Math.min(confidence + 0.3, 1.0),
    };
  }

  /**
   * Extract structured data based on the classified document type.
   * Always enriches result with RuleBasedParser for accurate supplier/transaction/totals.
   */
  private async extractStructuredData(
    documentType: string,
    text: string,
    _imageUri: string,
  ): Promise<StructuredData> {
    // Guard: always work with a string even if OCR returned null/undefined
    const safeText = text ?? "";
    const lines = safeText.split("\n").filter((line) => line.trim());

    let result: StructuredData;
    switch (documentType.toLowerCase()) {
      case DocumentType.RECEIPT:
        result = this.parseReceipt(lines, safeText);
        break;
      case DocumentType.INVOICE:
        result = this.parseInvoice(lines, safeText);
        break;
      case DocumentType.BILL:
        result = this.parseBill(lines, safeText);
        break;
      case DocumentType.CONTRACT:
        result = this.parseContract(lines, safeText);
        break;
      default:
        result = this.parseGenericDocument(lines, safeText);
        break;
    }

    // Always enrich with rule-based parser for accurate structured extraction
    this.enrichWithRuleBasedParser(result, safeText);
    return result;
  }

  /**
   * Runs RuleBasedParser over the raw text and merges the DataLiftResponse
   * into result.enhanced, providing supplier / transaction / lineItems / totals.
   */
  private enrichWithRuleBasedParser(
    result: StructuredData,
    rawText: string,
  ): void {
    try {
      const parsed = new RuleBasedParser().parse(rawText);
      if (!result.enhanced) result.enhanced = {};
      const e = result.enhanced as EnhancedStructuredData;

      // ── Supplier ──────────────────────────────────────────────────────────
      if (parsed.supplier?.name) {
        e.supplier = {
          name: parsed.supplier.name,
          address: parsed.supplier.address
            ? {
                street: parsed.supplier.address.street,
                city: parsed.supplier.address.city,
                state: parsed.supplier.address.state,
                zipCode: parsed.supplier.address.postalCode,
                country: parsed.supplier.address.country,
                fullAddress: parsed.supplier.address.fullAddress,
              }
            : undefined,
          phone: parsed.supplier.contact?.phone,
          email: parsed.supplier.contact?.email,
          website: parsed.supplier.contact?.website,
          taxId: parsed.supplier.taxInformation?.taxId,
        };
      }

      // ── Buyer / Customer ──────────────────────────────────────────────────
      if (
        parsed.buyer?.name ||
        parsed.buyer?.contact?.phone ||
        parsed.buyer?.address?.fullAddress
      ) {
        e.customer = {
          ...e.customer,
          name: parsed.buyer.name ?? e.customer?.name,
          phone: parsed.buyer.contact?.phone ?? e.customer?.phone,
          email: parsed.buyer.contact?.email ?? e.customer?.email,
          ...(parsed.buyer.address?.fullAddress && {
            address: {
              fullAddress: parsed.buyer.address.fullAddress,
            },
          }),
        };
      }

      // ── Document info ──────────────────────────────────────────────────────
      e.documentInfo = {
        ...e.documentInfo,
        ...(parsed.transaction?.invoiceNumber && {
          invoiceNumber: parsed.transaction.invoiceNumber,
        }),
        ...(parsed.transaction?.purchaseOrderNumber && {
          poNumber: parsed.transaction.purchaseOrderNumber,
        }),
        ...(parsed.transaction?.invoiceDate && {
          issueDate: parsed.transaction.invoiceDate,
        }),
        ...(parsed.transaction?.dueDate && {
          dueDate: parsed.transaction.dueDate,
        }),
        ...(parsed.transaction?.transactionDate && {
          transactionDate: parsed.transaction.transactionDate,
        }),
      };

      // ── Line items ────────────────────────────────────────────────────────
      if (parsed.parts?.length) {
        e.lineItems = parsed.parts.map((p) => ({
          name: p.itemName ?? "",
          description: p.description,
          sku: p.sku,
          partNumber: p.partNumber,
          quantity: p.quantity ?? 1,
          unit: p.unit,
          unitPrice: p.unitPrice ?? 0,
          taxRate: p.taxPercentage,
          totalPrice: p.totalAmount ?? 0,
        }));
      }

      // ── Financial summary ─────────────────────────────────────────────────
      e.summary = {
        ...e.summary,
        currency: parsed.transaction?.currency ?? e.summary?.currency,
        ...(parsed.totals?.subtotal !== undefined && {
          subtotal: parsed.totals.subtotal,
        }),
        ...(parsed.totals?.totalTax !== undefined && {
          totalTax: parsed.totals.totalTax,
        }),
        ...(parsed.totals?.shippingCost !== undefined && {
          shippingCost: parsed.totals.shippingCost,
        }),
        ...(parsed.totals?.discount !== undefined && {
          discount: parsed.totals.discount,
        }),
        ...(parsed.totals?.grandTotal !== undefined && {
          totalAmount: parsed.totals.grandTotal,
        }),
        ...(parsed.totals?.amountPaid !== undefined && {
          amountPaid: parsed.totals.amountPaid,
        }),
        ...(parsed.totals?.balanceDue !== undefined && {
          balanceDue: parsed.totals.balanceDue,
        }),
      };

      // ── Payment ───────────────────────────────────────────────────────────
      const cardMatch = rawText.match(
        /(?:mastercard|visa|amex|discover)[:\s]+[x*]+?(\d{4})/i,
      );
      e.payment = {
        ...e.payment,
        ...(parsed.transaction?.paymentMode && {
          method: parsed.transaction.paymentMode,
        }),
        ...(parsed.transaction?.paymentTerms && {
          terms: parsed.transaction.paymentTerms,
        }),
        ...(cardMatch && { cardLast4: cardMatch[1] }),
      };
    } catch {
      // Silently ignore — enrichment is best-effort
    }
  }

  /**
   * Parse receipt structured data from OCR text with enhanced multi-section extraction.
   */
  parseReceipt(lines: string[], fullText: string): StructuredData {
    const currency = CurrencyAmountParser.detectCurrency(fullText);

    // Create enhanced data structure
    const enhanced: EnhancedStructuredData = {
      documentInfo: {},
      supplier: {},
      customer: {},
      shipping: {},
      lineItems: [],
      summary: {
        currency: currency.code,
      },
      payment: {},
    };

    // Legacy structure for backward compatibility
    const legacy: StructuredData = {
      items: [],
      currency: currency.code,
    };

    // === SUPPLIER/MERCHANT SECTION ===
    const merchantInfo = this.extractMerchantInfo(lines, fullText);
    enhanced.supplier = merchantInfo;
    legacy.merchantName = merchantInfo.name;
    legacy.merchantAddress = merchantInfo.address?.fullAddress;

    // === DOCUMENT INFO SECTION ===
    const dates = DateParser.extractTyped(fullText);
    if (dates.transactionDate) {
      enhanced.documentInfo!.transactionDate = dates.transactionDate;
      legacy.transactionDate = dates.transactionDate;
    }

    // Extract transaction time
    const timeMatch = fullText.match(
      /(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)/i,
    );
    if (timeMatch) {
      enhanced.documentInfo!.transactionTime = timeMatch[1];
      legacy.transactionTime = timeMatch[1];
    }

    enhanced.documentInfo!.type = "receipt";

    // === LINE ITEMS SECTION ===
    const tableInfo = TableDetector.detectTable(lines);
    const extractedItems = this.extractEnhancedLineItems(
      lines,
      fullText,
      tableInfo,
      currency.symbol,
    );
    enhanced.lineItems = extractedItems;

    // Convert to legacy format
    legacy.items = extractedItems.map((item) => ({
      name: item.name,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      totalPrice: item.totalPrice,
      discount: item.discount,
    }));

    // === FINANCIAL SUMMARY SECTION ===
    const summary = this.extractFinancialSummary(fullText, currency.symbol);
    enhanced.summary = {
      ...enhanced.summary,
      ...summary,
    };

    legacy.subtotal = summary.subtotal;
    legacy.tax = summary.totalTax;
    legacy.totalAmount = summary.totalAmount;

    // === PAYMENT SECTION ===
    const paymentInfo = this.extractPaymentInfo(fullText);
    enhanced.payment = paymentInfo;
    legacy.paymentMethod = paymentInfo.method;

    // === SHIPPING SECTION (if present) ===
    const shippingInfo = this.extractShippingInfo(fullText, currency.symbol);
    if (shippingInfo && Object.keys(shippingInfo).length > 0) {
      enhanced.shipping = shippingInfo;
    }

    // === CONTACT EXTRACTION ===
    enhanced.extractedEmails = ContactInfoParser.parseEmails(fullText);
    enhanced.extractedPhones = ContactInfoParser.parsePhones(fullText);
    enhanced.extractedURLs = ContactInfoParser.parseURLs(fullText);

    // Attach enhanced data to legacy structure
    legacy.enhanced = enhanced;

    return legacy;
  }

  /**
   * Extract merchant/supplier information
   */
  private extractMerchantInfo(lines: string[], fullText: string): PartyInfo {
    const merchantInfo: PartyInfo = {};

    // Extract merchant name (usually first non-empty line or line with most caps)
    const firstLines = lines.slice(0, 5);
    const merchantLine = firstLines.find((line) => {
      const words = line.split(/\s+/);
      const capsWords = words.filter(
        (w) => w === w.toUpperCase() && w.length > 2,
      );
      return capsWords.length >= words.length * 0.6 || line.length > 10;
    });
    if (merchantLine) {
      merchantInfo.name = merchantLine.trim();
    }

    // Extract address from first 10 lines
    const headerSection = lines.slice(0, 10).join("\n");
    const addressResult = AddressParser.parse(headerSection);
    if (addressResult) {
      merchantInfo.address = addressResult.value;
    }

    // Extract phone
    const phones = ContactInfoParser.parsePhones(headerSection);
    if (phones.length > 0) {
      merchantInfo.phone = phones[0];
    }

    // Extract email
    const emails = ContactInfoParser.parseEmails(headerSection);
    if (emails.length > 0) {
      merchantInfo.email = emails[0];
    }

    // Extract website
    const urls = ContactInfoParser.parseURLs(headerSection);
    if (urls.length > 0) {
      merchantInfo.website = urls[0];
    }

    // Extract tax ID (various formats)
    const taxIdMatch = fullText.match(
      /(?:tax\s*id|tax\s*#|ein|vat\s*#?)[\s:]*([A-Z0-9-]+)/i,
    );
    if (taxIdMatch) {
      merchantInfo.taxId = taxIdMatch[1];
    }

    return merchantInfo;
  }

  /**
   * Extract enhanced line items with part numbers and detailed info
   */
  private extractEnhancedLineItems(
    lines: string[],
    _fullText: string,
    tableInfo: ReturnType<typeof TableDetector.detectTable>,
    currencySymbol: string,
  ): EnhancedLineItem[] {
    const items: EnhancedLineItem[] = [];
    let lineNumber = 1;

    const currencyPattern = `[${currencySymbol}\\$€£¥₹]`;
    const numberPattern = `([\\d,]+\\.\\d{2}|[\\d,]+)`;

    // If we detected a table, use structured extraction
    if (tableInfo.hasTable) {
      const tableItems = TableDetector.extractLineItems(lines, tableInfo);

      tableItems.forEach((tableItem) => {
        const item = this.parseLineItemFromColumns(
          tableItem.text,
          tableItem.columns,
          lineNumber++,
        );
        if (item) items.push(item);
      });
    } else {
      // Fallback to pattern-based extraction with multi-pattern support
      const itemPricePattern = new RegExp(
        `(.+?)\\s+(?:(\\d+)\\s*[x×*@]?\\s*)?${currencyPattern}?\\s*${numberPattern}\\s*$`,
        "i",
      );

      // Also match lines with multiple numeric columns separated by whitespace
      const multiNumPattern =
        /^(.+?)\s{2,}(\d+)\s{2,}[\$€£¥₹]?\s*([\d,]+\.?\d*)\s{2,}[\$€£¥₹]?\s*([\d,]+\.?\d*)$/;

      lines.forEach((line) => {
        // Skip totals and summary lines
        if (
          /^(total|subtotal|sub[\s-]?total|tax|gst|vat|hst|change|amount|due|balance|paid|payment|cash|credit|debit|tender|shipping|discount|tip|net\s+amount|gross)/i.test(
            line.trim(),
          )
        ) {
          return;
        }

        // Try multi-column pattern first (Desc  Qty  UnitPrice  Total)
        const multiMatch = line.match(multiNumPattern);
        if (multiMatch) {
          let mName = multiMatch[1].trim();
          const qty = parseInt(multiMatch[2], 10);
          const price1 = parseFloat((multiMatch[3] ?? "0").replace(/,/g, ""));
          const price2 = parseFloat((multiMatch[4] ?? "0").replace(/,/g, ""));

          if (price2 > 0 && mName.length > 1) {
            const partNumber = PartNumberParser.parseFromLine(line);
            mName = mName.replace(/^\d{1,3}[.)\s]+\s*/, "").trim();
            if (partNumber) mName = mName.replace(partNumber, "").trim();

            // Verify math: qty × price1 ≈ price2
            const err = Math.abs(qty * price1 - price2) / Math.max(price2, 1);
            const unitPrice =
              err < 0.05
                ? price1
                : parseFloat((price2 / (qty || 1)).toFixed(2));

            if (mName.length > 0) {
              items.push({
                lineNumber: lineNumber++,
                partNumber,
                name: mName,
                quantity: qty || 1,
                unitPrice,
                totalPrice: price2,
              });
              return;
            }
          }
        }

        const match = line.match(itemPricePattern);
        if (match && match[1]) {
          let name = match[1].trim();
          const quantity = match[2] ? parseInt(match[2], 10) : 1;
          const price = parseFloat((match[3] ?? "0").replace(/,/g, ""));

          // Additional validation
          if (price > 0 && price < 100000 && name.length > 1) {
            // Extract part number from line
            const partNumber = PartNumberParser.parseFromLine(line);

            // Clean up name
            name = name.replace(/^[\d\s.]+/, "").trim();
            if (partNumber) {
              name = name.replace(partNumber, "").trim();
            }

            if (name.length > 0) {
              const unitPrice = quantity > 1 ? price / quantity : price;
              items.push({
                lineNumber: lineNumber++,
                partNumber,
                name,
                quantity,
                unitPrice: parseFloat(unitPrice.toFixed(2)),
                totalPrice: price,
              });
            }
          }
        }
      });
    }

    return items;
  }

  /**
   * Parse line item from table columns.
   * Uses mathematical validation (qty × unitPrice ≈ total) for accuracy.
   */
  private parseLineItemFromColumns(
    lineText: string,
    columns: string[],
    lineNumber: number,
  ): EnhancedLineItem | null {
    if (columns.length === 0) return null;

    const item: EnhancedLineItem = {
      lineNumber,
      name: columns[0] ?? "",
      quantity: 1,
      unitPrice: 0,
      totalPrice: 0,
    };

    // Try to extract part number
    item.partNumber = PartNumberParser.parseFromLine(lineText);
    // Strip leading row number from name
    item.name = item.name.replace(/^\d{1,3}[.)\s]+\s*/, "").trim();

    // Collect all numeric values from remaining columns
    const numValues: number[] = [];
    for (let i = 1; i < columns.length; i++) {
      const col = columns[i];
      if (col == null) continue;
      const numValue = parseFloat(col.replace(/[^0-9.]/g, ""));
      if (!isNaN(numValue) && numValue > 0) numValues.push(numValue);
    }

    if (numValues.length >= 3) {
      // Math validation: try to find qty × price ≈ total
      const total = numValues[numValues.length - 1];
      let matched = false;
      for (let qi = 0; qi < numValues.length - 1 && !matched; qi++) {
        for (let pi = qi + 1; pi < numValues.length - 1 && !matched; pi++) {
          const err =
            Math.abs(numValues[qi] * numValues[pi] - total) /
            Math.max(total, 1);
          if (err < 0.05) {
            item.quantity = Math.floor(numValues[qi]);
            item.unitPrice = numValues[pi];
            item.totalPrice = total;
            matched = true;
          }
        }
      }
      if (!matched) {
        item.quantity =
          Number.isInteger(numValues[0]) && numValues[0] < 10000
            ? Math.floor(numValues[0])
            : 1;
        item.unitPrice = numValues[numValues.length - 2];
        item.totalPrice = total;
      }
    } else if (numValues.length === 2) {
      const [a, b] = numValues;
      if (Number.isInteger(a) && a < 10000 && a > 0) {
        item.quantity = Math.floor(a);
        item.totalPrice = b;
        item.unitPrice = parseFloat((b / a).toFixed(2));
      } else {
        item.unitPrice = a;
        item.totalPrice = b;
      }
    } else if (numValues.length === 1) {
      item.totalPrice = numValues[0];
    }

    // Calculate missing price values
    if (item.unitPrice === 0 && item.totalPrice > 0) {
      item.unitPrice =
        item.quantity > 0
          ? parseFloat((item.totalPrice / item.quantity).toFixed(2))
          : item.totalPrice;
    } else if (item.totalPrice === 0 && item.unitPrice > 0) {
      item.totalPrice = item.unitPrice * item.quantity;
    }

    return item.totalPrice > 0 ? item : null;
  }

  /**
   * Extract financial summary (subtotal, tax, total, etc.)
   */
  private extractFinancialSummary(
    text: string,
    currencySymbol: string,
  ): {
    subtotal?: number;
    discount?: number;
    tip?: number;
    serviceCharge?: number;
    taxBreakdown?: Array<{ type: string; rate?: number; amount: number }>;
    totalTax?: number;
    shippingCost?: number;
    totalAmount?: number;
  } {
    const summary: Record<string, unknown> = {};

    // Extract subtotal
    summary.subtotal = CurrencyAmountParser.extractLabeledAmount(
      text,
      "subtotal|sub[\\s-]?total",
      currencySymbol,
    );

    // Extract discount
    summary.discount = CurrencyAmountParser.extractLabeledAmount(
      text,
      "discount|savings",
      currencySymbol,
    );

    // Extract tip/gratuity
    summary.tip = CurrencyAmountParser.extractLabeledAmount(
      text,
      "tip|gratuity",
      currencySymbol,
    );

    // Extract service charge
    summary.serviceCharge = CurrencyAmountParser.extractLabeledAmount(
      text,
      "service\\s+charge|service\\s+fee",
      currencySymbol,
    );

    // Extract tax breakdown
    summary.taxBreakdown = TaxParser.parseTaxBreakdown(text, currencySymbol);
    if ((summary.taxBreakdown as Array<{ amount: number }>).length > 0) {
      summary.totalTax = (
        summary.taxBreakdown as Array<{ amount: number }>
      ).reduce((sum: number, tax: { amount: number }) => sum + tax.amount, 0);
    } else {
      // Fallback to single tax extraction
      summary.totalTax = CurrencyAmountParser.extractLabeledAmount(
        text,
        "tax|gst|vat|hst",
        currencySymbol,
      );
    }

    // Extract shipping cost
    summary.shippingCost = CurrencyAmountParser.extractLabeledAmount(
      text,
      "shipping|delivery|freight",
      currencySymbol,
    );

    // Extract total amount
    summary.totalAmount = CurrencyAmountParser.extractLabeledAmount(
      text,
      "total|amount\\s+due|balance|grand\\s+total",
      currencySymbol,
    );

    return summary;
  }

  /**
   * Extract payment information
   */
  private extractPaymentInfo(text: string): {
    method?: string;
    terms?: string;
    transactionId?: string;
    cardLast4?: string;
  } {
    const payment: Record<string, unknown> = {};

    // Extract payment method
    const methodMatch = text.match(
      /(?:paid|payment|method|card|tender)[\s:]*(.+?)(?:\n|$)/i,
    );
    if (methodMatch) {
      payment.method = methodMatch[1].trim().substring(0, 30);
    }

    // Extract card last 4 digits
    const cardMatch = text.match(/(?:card|xxxx|ending\s+in)[\s:#]*(\d{4})/i);
    if (cardMatch) {
      payment.cardLast4 = cardMatch[1];
    }

    // Extract transaction ID
    const transactionMatch = text.match(
      /(?:transaction|trans|ref|reference)[\s:#]*([A-Z0-9-]+)/i,
    );
    if (transactionMatch) {
      payment.transactionId = transactionMatch[1];
    }

    // Extract payment terms
    const termsMatch = text.match(
      /(?:terms|payment\s+terms)[\s:]*(.+?)(?:\n|$)/i,
    );
    if (termsMatch) {
      payment.terms = termsMatch[1].trim().substring(0, 50);
    }

    return payment;
  }

  /**
   * Extract shipping information
   */
  private extractShippingInfo(
    text: string,
    currencySymbol: string,
  ): {
    method?: string;
    carrier?: string;
    trackingNumber?: string;
    cost?: number;
  } {
    const shipping: Record<string, unknown> = {};

    // Extract shipping method
    const methodMatch = text.match(
      /(?:shipping\s+method|ship\s+via|delivery\s+method)[\s:]*(.+?)(?:\n|$)/i,
    );
    if (methodMatch) {
      shipping.method = methodMatch[1].trim().substring(0, 30);
    }

    // Extract carrier
    const carrierMatch = text.match(
      /(?:carrier|shipped\s+via)[\s:]*(.+?)(?:\n|$)/i,
    );
    if (carrierMatch) {
      shipping.carrier = carrierMatch[1].trim().substring(0, 30);
    }

    // Extract tracking number
    const trackingMatch = text.match(
      /(?:tracking|track|tracking\s+#?)[\s:#]*([A-Z0-9]+)/i,
    );
    if (trackingMatch && trackingMatch[1].length >= 8) {
      shipping.trackingNumber = trackingMatch[1];
    }

    // Extract shipping cost
    shipping.cost = CurrencyAmountParser.extractLabeledAmount(
      text,
      "shipping|delivery|freight",
      currencySymbol,
    );

    return shipping;
  }

  /**
   * Parse invoice structured data from OCR text with enhanced multi-section extraction.
   */
  parseInvoice(lines: string[], fullText: string): StructuredData {
    const currency = CurrencyAmountParser.detectCurrency(fullText);

    // Create enhanced data structure
    const enhanced: EnhancedStructuredData = {
      documentInfo: {},
      supplier: {},
      customer: {},
      shipping: {},
      lineItems: [],
      summary: {
        currency: currency.code,
      },
      payment: {},
    };

    // Legacy structure for backward compatibility
    const legacy: StructuredData = {
      lineItems: [],
      currency: currency.code,
    };

    // === DOCUMENT INFO SECTION ===
    enhanced.documentInfo!.type = "invoice";

    // Extract invoice number — require a qualifier (no/number/#/:) to avoid
    // capturing the standalone "INVOICE" document-type heading.
    const invoiceMatch = fullText.match(
      /(?:invoice\s*(?:no\.?|#|number)|inv\s*[#:]|einvoice\s*[#:])[\s:#]*([A-Z0-9][\w\-/]{1,30})/i,
    );
    if (invoiceMatch) {
      enhanced.documentInfo!.invoiceNumber = invoiceMatch[1].trim();
      legacy.invoiceNumber = invoiceMatch[1].trim();
    } else {
      // Multi-line fallback: label on one line, value on the next
      const invLines = fullText.split("\n");
      for (let i = 0; i < invLines.length - 1; i++) {
        if (
          /^\s*(?:invoice\s*(?:no\.?|#|number)|einvoice\s*[#:]?)\s*:?\s*$/i.test(
            invLines[i],
          )
        ) {
          for (let j = i + 1; j < Math.min(i + 3, invLines.length); j++) {
            const val = invLines[j].trim();
            if (val && /^[A-Z0-9][\w\-/]{1,30}$/i.test(val)) {
              enhanced.documentInfo!.invoiceNumber = val;
              legacy.invoiceNumber = val;
              break;
            }
          }
          break;
        }
      }
    }

    // Extract PO number — require "PO#", "P.O.#", or "Purchase Order" followed
    // by a qualifier so "PO Number" captures the NEXT token, not the word "Number".
    const poMatch = fullText.match(
      /(?:p\.?o\.?\s*[#:]+|purchase\s+order\s*(?:no\.?|#|number)\s*[#:]*)\s*:?\s*([A-Z0-9][\w\-/]{1,30})/i,
    );
    if (poMatch) {
      enhanced.documentInfo!.poNumber = poMatch[1].trim();
    }

    // Extract quote number
    const quoteMatch = fullText.match(
      /(?:quote|quotation|quote\s*#)[\s:#]*([A-Z0-9][\w-]*)/i,
    );
    if (quoteMatch) {
      enhanced.documentInfo!.quoteNumber = quoteMatch[1].trim();
    }

    // Extract dates
    const dates = DateParser.extractTyped(fullText);
    if (dates.issueDate) {
      enhanced.documentInfo!.issueDate = dates.issueDate;
      legacy.issueDate = dates.issueDate;
    }
    if (dates.dueDate) {
      enhanced.documentInfo!.dueDate = dates.dueDate;
      legacy.dueDate = dates.dueDate;
    }

    // === SUPPLIER/ISSUER SECTION ===
    const supplierInfo = this.extractInvoiceParty(fullText, lines, [
      "from",
      "seller",
      "vendor",
      "supplier",
      "issued by",
    ]);
    enhanced.supplier = supplierInfo;
    legacy.issuer = this.convertPartyInfoToLegacy(supplierInfo);

    // === CUSTOMER/BILL-TO SECTION ===
    const customerInfo = this.extractInvoiceParty(fullText, lines, [
      "bill to",
      "billed to",
      "customer",
      "buyer",
      "sold to",
    ]);
    enhanced.customer = customerInfo;
    legacy.customer = this.convertPartyInfoToLegacy(customerInfo);

    // === SHIPPING SECTION ===
    const shippingSection = this.extractShippingSection(
      fullText,
      lines,
      currency.symbol,
    );
    if (shippingSection && Object.keys(shippingSection).length > 0) {
      enhanced.shipping = shippingSection;
    }

    // === LINE ITEMS SECTION ===
    const tableInfo = TableDetector.detectTable(lines);
    const extractedItems = this.extractInvoiceLineItems(
      lines,
      fullText,
      tableInfo,
      currency.symbol,
    );
    enhanced.lineItems = extractedItems;

    // Convert to legacy format
    legacy.lineItems = extractedItems.map((item) => ({
      description:
        item.name + (item.description ? ` - ${item.description}` : ""),
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      amount: item.totalPrice,
      taxRate: item.taxRate,
    }));

    // === FINANCIAL SUMMARY SECTION ===
    const summary = this.extractInvoiceFinancialSummary(
      fullText,
      currency.symbol,
    );
    enhanced.summary = {
      ...enhanced.summary,
      ...summary,
    };

    legacy.totalAmount = summary.totalAmount;
    legacy.amountPaid = summary.amountPaid;
    legacy.balanceDue = summary.balanceDue;

    // === PAYMENT SECTION ===
    const paymentInfo = this.extractInvoicePaymentInfo(fullText);
    enhanced.payment = paymentInfo;

    // === CONTACT EXTRACTION ===
    enhanced.extractedEmails = ContactInfoParser.parseEmails(fullText);
    enhanced.extractedPhones = ContactInfoParser.parsePhones(fullText);
    enhanced.extractedURLs = ContactInfoParser.parseURLs(fullText);

    // Attach enhanced data to legacy structure
    legacy.enhanced = enhanced;

    return legacy;
  }

  /**
   * Extract party information for invoices (supplier or customer)
   * Enhanced with inline label support and broader keyword matching.
   */
  private extractInvoiceParty(
    fullText: string,
    lines: string[],
    keywords: string[],
  ): PartyInfo {
    const party: PartyInfo = {};

    // Find section by keywords
    let sectionStart = -1;
    let sectionEnd = -1;
    let inlineName: string | undefined;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lower = line.toLowerCase();

      // Check for inline label: "Bill To: Company Name" on same line
      for (const kw of keywords) {
        const inlineRx = new RegExp(
          `${kw.replace(/\s+/g, "\\s*")}\\s*[:.]+\\s*(.+)`,
          "i",
        );
        const inlineMatch = line.match(inlineRx);
        if (inlineMatch?.[1] && inlineMatch[1].trim().length > 2) {
          inlineName = inlineMatch[1].trim();
          sectionStart = i + 1;
          sectionEnd = Math.min(i + 10, lines.length);
          break;
        }
      }
      if (inlineName) break;

      // Check for standalone label keyword
      if (keywords.some((kw) => lower.includes(kw))) {
        sectionStart = i + 1;
        sectionEnd = Math.min(i + 10, lines.length);
        break;
      }
    }

    if (sectionStart === -1) {
      // If no section found, try to find in full text
      const phones = ContactInfoParser.parsePhones(fullText);
      const emails = ContactInfoParser.parseEmails(fullText);
      if (phones.length > 0) party.phone = phones[0];
      if (emails.length > 0) party.email = emails[0];
      return party;
    }

    const sectionLines = lines.slice(sectionStart, sectionEnd);
    const sectionText = sectionLines.join("\n");

    // Extract name: inline name takes priority, then first meaningful line
    if (inlineName) {
      party.name = inlineName;
    } else {
      // Skip lines that are labels, pure numbers, emails, URLs
      const labelRx =
        /^(?:bill\s*to|billed\s*to|customer|buyer|sold\s*to|ship\s*to|deliver\s*to|client|purchaser|from|seller|vendor|supplier|issued\s*by|attn|attention)\s*[:.]*\s*$/i;
      const firstLine = sectionLines.find((l) => {
        const t = l.trim();
        if (t.length < 2 || t.length > 100) return false;
        if (labelRx.test(t)) return false;
        if (/^[\d\s\-().+$€£₹¥,]+$/.test(t)) return false;
        if (/^[\w.+-]+@[\w.-]+$/.test(t)) return false;
        if (/^https?:\/\//.test(t) || /^www\./.test(t)) return false;
        return true;
      });
      if (firstLine) {
        party.name = firstLine.trim();
      }
    }

    // Extract address
    const addressResult = AddressParser.parse(sectionText);
    if (addressResult) {
      party.address = addressResult.value;
    }

    // Extract contact info
    const phones = ContactInfoParser.parsePhones(sectionText);
    if (phones.length > 0) {
      party.phone = phones[0];
    }

    const emails = ContactInfoParser.parseEmails(sectionText);
    if (emails.length > 0) {
      party.email = emails[0];
    }

    const urls = ContactInfoParser.parseURLs(sectionText);
    if (urls.length > 0) {
      party.website = urls[0];
    }

    // Extract tax ID
    const taxIdMatch = sectionText.match(
      /(?:tax\s*id|tax\s*#|ein|vat\s*#?|gst\s*#?|abn)[\s:]*([A-Z0-9-]+)/i,
    );
    if (taxIdMatch) {
      party.taxId = taxIdMatch[1];
    }

    // Extract account number
    const accountMatch = sectionText.match(
      /(?:account|acct|account\s*#)[\s:#]*([A-Z0-9-]+)/i,
    );
    if (accountMatch) {
      party.accountNumber = accountMatch[1];
    }

    return party;
  }

  /**
   * Extract shipping section for invoices
   */
  private extractShippingSection(
    fullText: string,
    lines: string[],
    currencySymbol: string,
  ): {
    method?: string;
    carrier?: string;
    trackingNumber?: string;
    cost?: number;
    shipToAddress?: Address;
  } {
    const shipping: Record<string, unknown> = {};

    // Extract shipping cost
    shipping.cost = CurrencyAmountParser.extractLabeledAmount(
      fullText,
      "shipping|delivery|freight",
      currencySymbol,
    );

    // Extract shipping method
    const methodMatch = fullText.match(
      /(?:shipping\s+method|ship\s+via|delivery\s+method)[\s:]*(.+?)(?:\n|$)/i,
    );
    if (methodMatch) {
      shipping.method = methodMatch[1].trim().substring(0, 30);
    }

    // Extract carrier — must contain at least 2 letters (not a bare number)
    const carrierMatch = fullText.match(
      /(?:carrier|shipped\s+via)[\s:]*(.+?)(?:\n|$)/i,
    );
    if (carrierMatch && /[A-Za-z]{2,}/.test(carrierMatch[1])) {
      shipping.carrier = carrierMatch[1].trim().substring(0, 30);
    }

    // Extract tracking number
    const trackingMatch = fullText.match(
      /(?:tracking|track|tracking\s+#?)[\s:#]*([A-Z0-9]+)/i,
    );
    if (trackingMatch && trackingMatch[1].length >= 8) {
      shipping.trackingNumber = trackingMatch[1];
    }

    // Extract ship-to address
    let shipToStart = -1;
    for (let i = 0; i < lines.length; i++) {
      if (/ship\s+to/i.test(lines[i])) {
        shipToStart = i + 1;
        break;
      }
    }

    if (shipToStart > 0) {
      const shipSection = lines.slice(shipToStart, shipToStart + 6).join("\n");
      const addressResult = AddressParser.parse(shipSection);
      if (addressResult) {
        shipping.shipToAddress = addressResult.value;
      }
    }

    return shipping;
  }

  /**
   * Extract invoice line items with enhanced fields
   */
  private extractInvoiceLineItems(
    lines: string[],
    fullText: string,
    tableInfo: ReturnType<typeof TableDetector.detectTable>,
    currencySymbol: string,
  ): EnhancedLineItem[] {
    const items: EnhancedLineItem[] = [];
    let lineNumber = 1;

    // If we detected a table, use structured extraction
    if (tableInfo.hasTable) {
      const tableItems = TableDetector.extractLineItems(lines, tableInfo);

      tableItems.forEach((tableItem) => {
        const item = this.parseInvoiceLineFromColumns(
          tableItem.text,
          tableItem.columns,
          lineNumber++,
        );
        if (item) items.push(item);
      });
    } else {
      // Fallback to pattern-based extraction with enhanced number handling
      const currencyPattern = `[${currencySymbol}\\$€£¥₹]`;
      const numberPattern = `([\\d,]+\\.\\d{2}|[\\d,]+)`;

      // Pattern 1: match lines with qty and at least one price
      const itemRegex = new RegExp(
        `(.+?)\\s+(\\d+)\\s+${currencyPattern}?\\s*${numberPattern}`,
        "g",
      );

      // Pattern 2: match lines with multi-spaced columns (Desc  Qty  Price  Total)
      const multiColRegex =
        /^(.+?)\s{2,}(\d+)\s{2,}[\$€£¥₹]?\s*([\d,]+\.?\d*)\s{2,}[\$€£¥₹]?\s*([\d,]+\.?\d*)$/gm;

      let match;
      // Try multi-column extraction first
      while ((match = multiColRegex.exec(fullText)) !== null) {
        let description = match[1].trim();
        const partNumber = PartNumberParser.parseFromLine(description);
        if (partNumber) {
          description = description.replace(partNumber, "").trim();
        }
        description = description.replace(/^\d{1,3}[.)\s]+\s*/, "").trim();

        const quantity = parseInt(match[2], 10);
        const price1 = parseFloat((match[3] ?? "0").replace(/,/g, ""));
        const price2 = parseFloat((match[4] ?? "0").replace(/,/g, ""));

        // Use math validation
        const err = Math.abs(quantity * price1 - price2) / Math.max(price2, 1);
        const unitPrice =
          err < 0.05
            ? price1
            : parseFloat((price2 / (quantity || 1)).toFixed(2));

        if (description.length > 0 && price2 > 0) {
          items.push({
            lineNumber: lineNumber++,
            partNumber,
            name: description,
            quantity: quantity || 1,
            unitPrice,
            totalPrice: price2,
          });
        }
      }

      // If multi-column didn't find anything, fall back to simpler pattern
      if (items.length === 0) {
        while ((match = itemRegex.exec(fullText)) !== null) {
          const partNumber = PartNumberParser.parseFromLine(match[1]);
          let description = match[1].trim();
          if (partNumber) {
            description = description.replace(partNumber, "").trim();
          }
          description = description.replace(/^\d{1,3}[.)\s]+\s*/, "").trim();

          const quantity = parseInt(match[2], 10);
          const unitPrice = parseFloat((match[3] ?? "0").replace(/,/g, ""));

          if (description.length > 0 && unitPrice > 0) {
            items.push({
              lineNumber: lineNumber++,
              partNumber,
              name: description,
              quantity,
              unitPrice,
              totalPrice: unitPrice * quantity,
            });
          }
        }
      }
    }

    return items;
  }

  /**
   * Parse invoice line item from table columns.
   * Uses mathematical validation (qty × unitPrice ≈ total) for accuracy.
   */
  private parseInvoiceLineFromColumns(
    lineText: string,
    columns: string[],
    lineNumber: number,
  ): EnhancedLineItem | null {
    if (columns.length === 0) return null;

    const item: EnhancedLineItem = {
      lineNumber,
      name: "",
      quantity: 1,
      unitPrice: 0,
      totalPrice: 0,
    };

    // Try to extract part number from first column or line text
    item.partNumber = PartNumberParser.parseFromLine(lineText);

    // First column is typically description
    item.name = columns[0] ?? "";
    if (item.partNumber) {
      item.name = item.name.replace(item.partNumber, "").trim();
    }
    // Strip leading row number
    item.name = item.name.replace(/^\d{1,3}[.)\s]+\s*/, "").trim();

    // Collect all numeric values from remaining columns
    const numValues: {
      value: number;
      colIdx: number;
      hasCurrency: boolean;
      hasPct: boolean;
    }[] = [];
    for (let i = 1; i < columns.length; i++) {
      const col = columns[i];
      if (col == null) continue;
      const numValue = parseFloat(col.replace(/[^0-9.]/g, ""));
      if (!isNaN(numValue) && numValue > 0) {
        numValues.push({
          value: numValue,
          colIdx: i,
          hasCurrency: /[\$€£₹¥]/.test(col),
          hasPct: col.includes("%"),
        });
      }
    }

    // Extract tax rate from percentage column
    const pctCol = numValues.find((n) => n.hasPct);
    if (pctCol) {
      item.taxRate = pctCol.value;
    }

    // Filter out percentage token for qty/price disambiguation
    const priceNums = numValues.filter((n) => !n.hasPct).map((n) => n.value);

    if (priceNums.length >= 3) {
      // Try math validation: find qty × price ≈ total
      const total = priceNums[priceNums.length - 1];
      let matched = false;
      for (let qi = 0; qi < priceNums.length - 1 && !matched; qi++) {
        for (let pi = qi + 1; pi < priceNums.length - 1 && !matched; pi++) {
          const err1 =
            Math.abs(priceNums[qi] * priceNums[pi] - total) /
            Math.max(total, 1);
          if (err1 < 0.05) {
            item.quantity = Math.floor(priceNums[qi]);
            item.unitPrice = priceNums[pi];
            item.totalPrice = total;
            matched = true;
          }
          const err2 =
            Math.abs(priceNums[pi] * priceNums[qi] - total) /
            Math.max(total, 1);
          if (!matched && err2 < 0.05) {
            item.quantity = Math.floor(priceNums[pi]);
            item.unitPrice = priceNums[qi];
            item.totalPrice = total;
            matched = true;
          }
        }
      }
      if (!matched) {
        // Positional fallback: first=qty, second=unitPrice, last=total
        item.quantity =
          Number.isInteger(priceNums[0]) && priceNums[0] < 10000
            ? Math.floor(priceNums[0])
            : 1;
        item.unitPrice = priceNums[priceNums.length - 2];
        item.totalPrice = total;
      }
    } else if (priceNums.length === 2) {
      const [a, b] = priceNums;
      // Check if a is qty and b is total
      if (Number.isInteger(a) && a < 10000 && a > 0) {
        item.quantity = Math.floor(a);
        item.totalPrice = b;
        item.unitPrice = parseFloat((b / a).toFixed(2));
      } else {
        item.unitPrice = a;
        item.totalPrice = b;
      }
    } else if (priceNums.length === 1) {
      item.totalPrice = priceNums[0];
    }

    // Calculate missing values
    if (item.totalPrice === 0 && item.unitPrice > 0) {
      item.totalPrice = item.unitPrice * item.quantity;
    } else if (item.unitPrice === 0 && item.totalPrice > 0) {
      item.unitPrice =
        item.quantity > 0
          ? parseFloat((item.totalPrice / item.quantity).toFixed(2))
          : item.totalPrice;
    }

    return item.name.length > 0 && item.totalPrice > 0 ? item : null;
  }

  /**
   * Extract invoice financial summary
   */
  private extractInvoiceFinancialSummary(
    text: string,
    currencySymbol: string,
  ): {
    subtotal?: number;
    discount?: number;
    taxBreakdown?: Array<{ type: string; rate?: number; amount: number }>;
    totalTax?: number;
    shippingCost?: number;
    totalAmount?: number;
    amountPaid?: number;
    balanceDue?: number;
  } {
    const summary: Record<string, unknown> = {};

    // Extract subtotal
    summary.subtotal = CurrencyAmountParser.extractLabeledAmount(
      text,
      "subtotal|sub[\\s-]?total",
      currencySymbol,
    );

    // Extract discount
    summary.discount = CurrencyAmountParser.extractLabeledAmount(
      text,
      "discount|savings",
      currencySymbol,
    );

    // Extract tax breakdown
    summary.taxBreakdown = TaxParser.parseTaxBreakdown(text, currencySymbol);
    if ((summary.taxBreakdown as Array<{ amount: number }>).length > 0) {
      summary.totalTax = (
        summary.taxBreakdown as Array<{ amount: number }>
      ).reduce((sum: number, tax: { amount: number }) => sum + tax.amount, 0);
    } else {
      summary.totalTax = CurrencyAmountParser.extractLabeledAmount(
        text,
        "tax|gst|vat|hst",
        currencySymbol,
      );
    }

    // Extract shipping cost
    summary.shippingCost = CurrencyAmountParser.extractLabeledAmount(
      text,
      "shipping|delivery|freight",
      currencySymbol,
    );

    // Extract total amount — try specific patterns first, then generic "total"
    // with negative lookbehind to avoid matching "subtotal".
    summary.totalAmount =
      CurrencyAmountParser.extractLabeledAmount(
        text,
        "grand\\s+total|total\\s+amount\\s+due|total\\s+due",
        currencySymbol,
      ) ??
      CurrencyAmountParser.extractLabeledAmount(
        text,
        "amount\\s+due|balance\\s+due",
        currencySymbol,
      ) ??
      CurrencyAmountParser.extractLabeledAmount(
        text,
        "(?<!sub)total",
        currencySymbol,
      );

    // Extract amount paid
    summary.amountPaid = CurrencyAmountParser.extractLabeledAmount(
      text,
      "amount\\s+paid|paid|payment\\s+received",
      currencySymbol,
    );

    // Extract balance due
    summary.balanceDue = CurrencyAmountParser.extractLabeledAmount(
      text,
      "balance\\s+due|outstanding|amount\\s+owing",
      currencySymbol,
    );

    return summary;
  }

  /**
   * Extract invoice payment information
   */
  private extractInvoicePaymentInfo(text: string): {
    method?: string;
    terms?: string;
    dueDate?: string;
    bankDetails?: string;
    lateFee?: number;
  } {
    const payment: Record<string, unknown> = {};

    // Extract payment method
    const methodMatch = text.match(
      /(?:payment\s+method|pay\s+via)[\s:]*(.+?)(?:\n|$)/i,
    );
    if (methodMatch) {
      payment.method = methodMatch[1].trim().substring(0, 30);
    }

    // Extract payment terms — prefer labeled "payment terms:" first, then common patterns.
    // Avoid capturing boilerplate like "Terms, Conditions, & Use of Products".
    const termsMatch = text.match(
      /(?:payment\s+terms)\s*[:\-]\s*(.+?)(?:\n|$)/i,
    );
    if (termsMatch && termsMatch[1].trim().length < 40) {
      payment.terms = termsMatch[1].trim().substring(0, 50);
    } else {
      // Check for common terms patterns (standalone phrases)
      const commonTerms = text.match(
        /\b(net\s+\d+\S*|due\s+on\s+receipt|cod|upon\s+completion|\d+\s+days?)\b/i,
      );
      if (commonTerms) {
        payment.terms = commonTerms[1];
      }
    }

    // Extract due date
    const dueDateMatch = text.match(
      /(?:due\s+date|payment\s+due)[\s:]*(\d{1,2}[-/]\d{1,2}[-/]\d{2,4}|\d{4}[-/]\d{2}[-/]\d{2})/i,
    );
    if (dueDateMatch) {
      payment.dueDate = dueDateMatch[1];
    }

    // Extract bank details
    const bankMatch = text.match(
      /(?:bank|account|routing|iban|swift)[\s:]*([A-Z0-9\s-]+)/i,
    );
    if (bankMatch) {
      payment.bankDetails = bankMatch[1].trim().substring(0, 50);
    }

    // Extract late fee
    const lateFeeMatch = text.match(/(?:late\s+fee|penalty)[\s:]*\$?([\d.]+)/i);
    if (lateFeeMatch) {
      payment.lateFee = parseFloat(lateFeeMatch[1]);
    }

    return payment;
  }

  /**
   * Convert PartyInfo to legacy Party format
   */
  private convertPartyInfoToLegacy(partyInfo: PartyInfo): {
    name: string;
    address?: string;
    email?: string;
    phone?: string;
    taxId?: string;
  } {
    return {
      name: partyInfo.name || "",
      address: partyInfo.address?.fullAddress,
      email: partyInfo.email,
      phone: partyInfo.phone,
      taxId: partyInfo.taxId,
    };
  }

  /**
   * Parse bill structured data from OCR text.
   */
  parseBill(_lines: string[], fullText: string): StructuredData {
    const result: StructuredData = {
      totalAmount: 0,
    };

    // Extract account number
    const accountMatch = fullText.match(
      /(?:account|acct|a\/c)[\s:#]*([A-Z0-9][\w-]*)/i,
    );
    if (accountMatch) {
      result.title = `Account: ${accountMatch[1].trim()}`;
    }

    // Extract dates
    const datePattern = /(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})/g;
    const dates = fullText.match(datePattern) || [];
    if (dates[0]) result.issueDate = dates[0];
    if (dates[1]) result.dueDate = dates[1];

    // Extract amount due
    const amountMatch = fullText.match(
      /(?:amount\s*due|total|pay|balance)[\s:]*\$?([\d,]+\.?\d*)/i,
    );
    const amountGroup = amountMatch?.[1];
    if (amountGroup) {
      result.totalAmount = parseFloat(amountGroup.replace(/,/g, ""));
    }

    return result;
  }

  /**
   * Parse contract structured data from OCR text.
   */
  parseContract(lines: string[], fullText: string): StructuredData {
    const result: StructuredData = {
      sections: [],
    };

    // Extract contract title
    const titleMatch = fullText.match(/^(.+?)[\n]/);
    if (titleMatch) {
      result.title = titleMatch[1].trim();
    }

    // Extract dates
    const datePattern = /(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})/g;
    const dates = fullText.match(datePattern) || [];
    if (dates[0]) result.issueDate = dates[0];

    // Build sections from headings/paragraphs
    let currentSection: {
      heading: string;
      content: string;
      level: number;
    } | null = null;
    lines.forEach((line) => {
      // Detect headings (all caps or short lines followed by content)
      if (line.length < 60 && line === line.toUpperCase() && line.length > 3) {
        if (currentSection) {
          result.sections?.push(currentSection);
        }
        currentSection = { heading: line.trim(), content: "", level: 1 };
      } else if (currentSection) {
        currentSection.content += line + "\n";
      }
    });
    if (currentSection) {
      result.sections?.push(currentSection);
    }

    return result;
  }

  /**
   * Parse generic document (extract emails, phones, URLs, sections).
   * If invoice/receipt/bill signals are detected in the text, delegates to the
   * appropriate specialised parser so the output is always as structured as possible.
   */
  parseGenericDocument(lines: string[], text: string): StructuredData {
    const safeText = text ?? "";
    // Delegate to a specialised parser when strong document-type signals exist
    const heuristicResult = this.heuristicClassify(safeText);
    if (
      heuristicResult.type !== DocumentType.GENERIC &&
      heuristicResult.confidence >= 0.7
    ) {
      switch (heuristicResult.type) {
        case DocumentType.INVOICE:
          return this.parseInvoice(lines, safeText);
        case DocumentType.RECEIPT:
          return this.parseReceipt(lines, safeText);
        case DocumentType.BILL:
          return this.parseBill(lines, safeText);
        case DocumentType.CONTRACT:
          return this.parseContract(lines, safeText);
      }
    }

    const result: StructuredData = {
      sections: [],
      extractedEmails: [],
      extractedPhones: [],
      extractedURLs: [],
    };

    // Extract emails
    result.extractedEmails = ContactInfoParser.parseEmails(safeText);

    // Use validated phone parser (requires separators – avoids digit-run false positives)
    result.extractedPhones = ContactInfoParser.parsePhones(safeText);

    // Extract URLs
    result.extractedURLs = ContactInfoParser.parseURLs(safeText);

    // Build sections by grouping lines into logical blocks instead of one entry per line
    let currentBlock: string[] = [];
    lines
      .filter((l) => l.trim().length > 0)
      .forEach((line) => {
        // All-caps short line → section heading; flush current block first
        if (
          line.trim().length <= 60 &&
          line.trim() === line.trim().toUpperCase() &&
          line.trim().length > 3
        ) {
          if (currentBlock.length > 0) {
            result.sections!.push({
              heading: "",
              content: currentBlock.join(" "),
              level: 2,
            });
            currentBlock = [];
          }
          result.sections!.push({
            heading: line.trim(),
            content: line.trim(),
            level: 1,
          });
        } else {
          currentBlock.push(line.trim());
          // Flush block every 4 lines to keep sections compact
          if (currentBlock.length >= 4) {
            result.sections!.push({
              heading: "",
              content: currentBlock.join(" "),
              level: 2,
            });
            currentBlock = [];
          }
        }
      });
    if (currentBlock.length > 0) {
      result.sections!.push({
        heading: "",
        content: currentBlock.join(" "),
        level: 2,
      });
    }

    return result;
  }

  /**
   * Gather metadata about the processed document.
   */
  private gatherMetadata(text: string): DocumentMetadata {
    const lines = (text ?? "").split("\n");

    return {
      pageCount: 1,
      imageQuality: ImageQuality.MEDIUM,
      textLines: lines.filter((l) => l.trim().length > 0).length,
      detectedLanguages: [this.language],
    };
  }

  /**
   * Debug logging helper.
   */
  private log(...args: unknown[]) {
    if (this.enableDebug) {
      this.logger.debug("debug", ...args);
    }
  }
}
