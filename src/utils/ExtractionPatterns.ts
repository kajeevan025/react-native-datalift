/**
 * DataLift - Extraction Pattern Utilities
 *
 * Advanced regex patterns and parsers for extracting structured information
 * from OCR text including addresses, contact info, part numbers, and more.
 */

import { Address, TaxDetail } from "../types";

export interface ExtractionResult<T> {
  value: T;
  confidence: number;
  source?: string;
}

/**
 * Address Parser - Extract structured addresses from text
 */
export class AddressParser {
  /**
   * Parse a multi-line address into structured components
   */
  static parse(text: string): ExtractionResult<Address> | null {
    // Common address patterns
    const zipCodePattern = /\b\d{5}(?:-\d{4})?\b/;
    const statePattern = /\b([A-Z]{2})\b/;
    const countryPattern = /\b(USA|United States|Canada|UK|United Kingdom)\b/i;

    const lines = text.split("\n").filter((l) => l.trim());
    const address: Address = {};
    let confidence = 0;

    // Find zip code
    for (let i = 0; i < lines.length; i++) {
      const zipMatch = lines[i].match(zipCodePattern);
      if (zipMatch) {
        address.zipCode = zipMatch[0];
        confidence += 0.3;

        // Extract city and state from same line (typical format: City, ST 12345)
        const cityStateMatch = lines[i].match(
          /([^,\d]+),\s*([A-Z]{2})\s+\d{5}/,
        );
        if (cityStateMatch) {
          address.city = cityStateMatch[1].trim();
          address.state = cityStateMatch[2];
          confidence += 0.3;
        } else {
          // Try to find state
          const stateMatch = lines[i].match(statePattern);
          if (stateMatch) {
            address.state = stateMatch[1];
            confidence += 0.1;
          }
        }

        // Street address is usually 1-2 lines before city/state/zip
        if (i > 0) {
          address.street = lines[i - 1].trim();
          if (i > 1 && lines[i - 1].length < 10) {
            // Might be multi-line street address
            address.street = lines[i - 2].trim() + " " + lines[i - 1].trim();
          }
          confidence += 0.2;
        }

        break;
      }
    }

    // Look for country
    const countryMatch = text.match(countryPattern);
    if (countryMatch) {
      address.country = countryMatch[1];
      confidence += 0.1;
    }

    // Build full address
    if (address.street || address.city || address.zipCode) {
      const parts = [
        address.street,
        address.city,
        address.state,
        address.zipCode,
        address.country,
      ].filter(Boolean);
      address.fullAddress = parts.join(", ");

      return {
        value: address,
        confidence: Math.min(confidence, 1.0),
        source: "AddressParser",
      };
    }

    return null;
  }

  /**
   * Extract all potential addresses from text
   */
  static extractAll(text: string): ExtractionResult<Address>[] {
    const results: ExtractionResult<Address>[] = [];

    // Split by common section dividers
    const sections = text.split(/(?:Bill To|Ship To|Address|From:|To:)/i);

    for (const section of sections) {
      const result = this.parse(section);
      if (result) {
        results.push(result);
      }
    }

    return results;
  }
}

/**
 * Contact Information Parser - Extract phone, email, website
 */
export class ContactInfoParser {
  /**
   * Extract phone numbers (various international formats).
   * Separators between digit groups are required to avoid false positives
   * from consecutive-digit strings such as card AIDs or serial numbers.
   */
  static parsePhones(text: string): string[] {
    const patterns = [
      // US with mandatory separator: (123) 456-7890 | 123-456-7890 | 123.456.7890
      /\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g,
      // International with + prefix and separators: +1-123-456-7890, +44 20 1234 5678
      /\+\d{1,3}[-.\s]\(?\d{1,4}\)?[-.\s]\d{1,4}[-.\s]\d{1,9}/g,
      // Toll-free with separator: 1-800-123-4567, 800-123-4567
      /1?[-.\s]?[8-9]00[-.\s]\d{3}[-.\s]\d{4}\b/g,
    ];

    const phones = new Set<string>();

    patterns.forEach((pattern) => {
      const matches = text.match(pattern);
      if (matches) {
        matches.forEach((match) => {
          // Clean up and validate
          const cleaned = match.trim().replace(/\s+/g, " ");
          if (cleaned.length >= 10) {
            phones.add(cleaned);
          }
        });
      }
    });

    return Array.from(phones);
  }

  /**
   * Extract email addresses
   */
  static parseEmails(text: string): string[] {
    if (!text) return [];
    const pattern = /[\w.-]+@[\w.-]+\.\w{2,}/g;
    const matches = text.match(pattern);
    return matches ? Array.from(new Set(matches)) : [];
  }

  /**
   * Extract website URLs
   */
  static parseURLs(text: string): string[] {
    if (!text) return [];
    const patterns = [
      // Full URLs with protocol
      /https?:\/\/[^\s]+/g,
      // URLs without protocol: www.example.com
      /www\.[^\s]+\.[a-z]{2,}/gi,
    ];

    const urls = new Set<string>();

    patterns.forEach((pattern) => {
      const matches = text.match(pattern);
      if (matches) {
        matches.forEach((url) => urls.add(url.trim()));
      }
    });

    return Array.from(urls);
  }
}

/**
 * Part Number / SKU Parser - Extract product codes
 */
export class PartNumberParser {
  /**
   * Extract part numbers and SKUs from text
   */
  static parse(text: string): string[] {
    const patterns = [
      // Standard SKU: ABC-123, ABC123, ABC_123
      /\b[A-Z]{2,}[-_]?\d{3,}\b/g,
      // Manufacturer part number: 123-456-7890
      /\b\d{3}-\d{3}-\d{4}\b/g,
      // UPC/EAN: 12 or 13 digits
      /\b\d{12,13}\b/g,
      // Alphanumeric codes: A1B2C3, 1A2B3C
      /\b[A-Z0-9]{6,12}\b/g,
      // Part with prefix: PN:123456, SKU:ABC123, MPN:XYZ789
      /(?:PN|SKU|MPN|ITEM|PART)[:.\s]?\s*([A-Z0-9-_]+)/gi,
    ];

    const partNumbers = new Set<string>();

    patterns.forEach((pattern) => {
      const matches = text.match(pattern);
      if (matches) {
        matches.forEach((match) => {
          // Clean up prefix if present
          const cleaned = match
            .replace(/^(?:PN|SKU|MPN|ITEM|PART)[:.\s]?\s*/i, "")
            .trim();
          // Validate: should have mix of letters and numbers, or be long enough
          if (
            (cleaned.length >= 4 &&
              /\d/.test(cleaned) &&
              /[A-Z]/i.test(cleaned)) ||
            cleaned.length >= 8
          ) {
            partNumbers.add(cleaned);
          }
        });
      }
    });

    return Array.from(partNumbers);
  }

  /**
   * Extract part number from line item text
   */
  static parseFromLine(line: string): string | undefined {
    const patterns = [
      // At start: SKU:ABC123 or #ABC123
      /^(?:SKU|PN|MPN|ITEM|#)[:.\s]?\s*([A-Z0-9-_]+)/i,
      // In parentheses: (ABC-123)
      /\(([A-Z0-9-_]{4,})\)/,
      // Standalone code
      /\b([A-Z]{2,}\d{3,})\b/,
    ];

    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match) {
        return match[1] || match[0];
      }
    }

    return undefined;
  }
}

/**
 * Currency and Amount Parser - Extract monetary values
 */
export class CurrencyAmountParser {
  /**
   * Detect currency from text
   */
  static detectCurrency(text: string): { code: string; symbol: string } {
    const currencyPatterns = [
      { code: "USD", symbol: "$", regex: /\$|USD|US\$|dollar/i },
      { code: "EUR", symbol: "€", regex: /€|EUR|euro/i },
      { code: "GBP", symbol: "£", regex: /£|GBP|pound|sterling/i },
      { code: "INR", symbol: "₹", regex: /₹|INR|rupee|rs\.|rs /i },
      { code: "JPY", symbol: "¥", regex: /¥|JPY|yen/i },
      { code: "CNY", symbol: "¥", regex: /CNY|RMB|yuan/i },
      { code: "AUD", symbol: "A$", regex: /A\$|AUD|australian/i },
      { code: "CAD", symbol: "C$", regex: /C\$|CAD|canadian/i },
      { code: "CHF", symbol: "Fr", regex: /CHF|franc/i },
      { code: "SGD", symbol: "S$", regex: /S\$|SGD|singapore/i },
      { code: "HKD", symbol: "HK$", regex: /HK\$|HKD|hong kong/i },
    ];

    for (const curr of currencyPatterns) {
      if (curr.regex.test(text)) {
        return { code: curr.code, symbol: curr.symbol };
      }
    }

    return { code: "USD", symbol: "$" };
  }

  /**
   * Extract amount with flexible currency symbol placement
   */
  static parseAmount(
    text: string,
    currencySymbol: string = "$",
  ): number | null {
    if (!text || !currencySymbol) return null;
    // Create flexible pattern: symbol before or after, with optional spaces
    const escapedSymbol = currencySymbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const patterns = [
      // Symbol before: $123.45
      new RegExp(`${escapedSymbol}\\s*([\\d,]+\\.?\\d*)`, "i"),
      // Symbol after: 123.45$
      new RegExp(`([\\d,]+\\.?\\d*)\\s*${escapedSymbol}`, "i"),
      // No symbol, just number
      /\b([\d,]+\.\d{2})\b/,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      const numGroup = match?.[1];
      if (numGroup) {
        const numStr = numGroup.replace(/,/g, "");
        const num = parseFloat(numStr);
        if (!isNaN(num) && num > 0) {
          return num;
        }
      }
    }

    return null;
  }

  /**
   * Extract labeled amounts (e.g., "Total: $123.45")
   */
  static extractLabeledAmount(
    text: string,
    label: string,
    currencySymbol: string = "$",
  ): number | null {
    if (!text || !currencySymbol) return null;
    const escapedSymbol = currencySymbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Use \b word boundary so "total" does not match inside "Subtotal"
    const pattern = new RegExp(
      `\\b${label}[\\s:]*${escapedSymbol}?\\s*([\\d,]+\\.?\\d*)`,
      "i",
    );
    const match = text.match(pattern);
    const numGroup = match?.[1];
    if (numGroup) {
      const num = parseFloat(numGroup.replace(/,/g, ""));
      if (!isNaN(num)) return num;
    }
    return null;
  }
}

/**
 * Date Parser - Support multiple date formats
 */
export class DateParser {
  /**
   * Parse date from text with multiple format support
   */
  static parse(text: string): string[] {
    const patterns = [
      // ISO: 2024-01-31, 2024/01/31
      /\b\d{4}[-/]\d{2}[-/]\d{2}\b/g,
      // US: 01/31/2024, 1/31/24
      /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g,
      // European: 31.01.2024, 31-01-2024
      /\b\d{1,2}[.-]\d{1,2}[.-]\d{4}\b/g,
      // Long format: January 31, 2024
      /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+\d{4}\b/gi,
      // Short: Jan 31 2024
      /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\s+\d{4}\b/gi,
    ];

    const dates = new Set<string>();

    patterns.forEach((pattern) => {
      const matches = text.match(pattern);
      if (matches) {
        matches.forEach((date) => dates.add(date.trim()));
      }
    });

    return Array.from(dates);
  }

  /**
   * Extract specific date types (issue, due, transaction)
   */
  static extractTyped(text: string): {
    issueDate?: string;
    dueDate?: string;
    transactionDate?: string;
  } {
    const result: {
      issueDate?: string;
      dueDate?: string;
      transactionDate?: string;
    } = {};

    // Issue/Invoice date
    const issueDateMatch = text.match(
      /(?:invoice\s+date|issue\s+date|date|dated)[\s:]*(\d{1,2}[-/]\d{1,2}[-/]\d{2,4}|\d{4}[-/]\d{2}[-/]\d{2})/i,
    );
    if (issueDateMatch) result.issueDate = issueDateMatch[1];

    // Due date
    const dueDateMatch = text.match(
      /(?:due\s+date|payment\s+due|pay\s+by)[\s:]*(\d{1,2}[-/]\d{1,2}[-/]\d{2,4}|\d{4}[-/]\d{2}[-/]\d{2})/i,
    );
    if (dueDateMatch) result.dueDate = dueDateMatch[1];

    // Transaction date (for receipts)
    const transactionMatch = text.match(
      /(?:transaction|sale|purchase)[\s:]*(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})/i,
    );
    if (transactionMatch) result.transactionDate = transactionMatch[1];

    return result;
  }
}

/**
 * Table Detector - Identify tabular data and column headers
 */
export class TableDetector {
  /**
   * Detect if text contains tabular line items
   */
  static detectTable(lines: string[]): {
    hasTable: boolean;
    headerIndex: number;
    startIndex: number;
    endIndex: number;
    columns: string[];
  } {
    let headerIndex = -1;
    let startIndex = -1;
    let endIndex = -1;
    const columns: string[] = [];

    // Common column headers for receipts/invoices
    const headerKeywords = [
      "item",
      "description",
      "qty",
      "quantity",
      "price",
      "amount",
      "total",
      "sku",
      "part",
      "unit",
    ];

    // Find header row
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].toLowerCase();
      let matchCount = 0;

      headerKeywords.forEach((keyword) => {
        if (line.includes(keyword)) matchCount++;
      });

      // If line contains 2+ header keywords, likely a table header
      if (matchCount >= 2) {
        headerIndex = i;
        startIndex = i + 1;

        // Extract column names
        const parts = lines[i]
          .split(/\s{2,}|\t/)
          .filter((p) => p.trim().length > 0);
        columns.push(...parts);
        break;
      }
    }

    // Find table end (look for total/summary lines)
    if (startIndex > 0) {
      for (let i = startIndex; i < lines.length; i++) {
        const line = lines[i].toLowerCase();
        if (
          /^(subtotal|total|tax|amount\s+due|balance|grand\s+total)/i.test(
            line.trim(),
          )
        ) {
          endIndex = i;
          break;
        }
      }
      if (endIndex === -1) endIndex = lines.length;
    }

    return {
      hasTable: headerIndex >= 0,
      headerIndex,
      startIndex,
      endIndex,
      columns,
    };
  }

  /**
   * Extract line items from table section
   */
  static extractLineItems(
    lines: string[],
    tableInfo: ReturnType<typeof TableDetector.detectTable>,
  ): Array<{ text: string; columns: string[] }> {
    if (!tableInfo.hasTable) return [];

    const items: Array<{ text: string; columns: string[] }> = [];

    for (let i = tableInfo.startIndex; i < tableInfo.endIndex; i++) {
      const line = lines[i].trim();
      if (line.length === 0) continue;

      // Split by multiple spaces or tabs
      const columns = line
        .split(/\s{2,}|\t/)
        .filter((c) => c.trim().length > 0);

      if (columns.length > 0) {
        items.push({ text: line, columns });
      }
    }

    return items;
  }
}

/**
 * Tax Breakdown Parser - Extract multiple tax types
 */
export class TaxParser {
  /**
   * Parse tax breakdown from text
   */
  static parseTaxBreakdown(
    text: string,
    _currencySymbol: string = "$",
  ): TaxDetail[] {
    const taxes: TaxDetail[] = [];

    // Each pattern includes optional parenthesized content (e.g. "(20%)") so it
    // can skip percentage annotations between the label and the amount value.
    const taxPatterns = [
      {
        type: "Sales Tax",
        regex:
          /(?:sales\s+tax|tax)(?:\s*\([^)]*\))?[\s:]*([€£¥₹$]?\s*[\d,]+\.?\d*)/i,
      },
      {
        type: "VAT",
        regex:
          /(?:vat|value\s+added\s+tax)(?:\s*\([^)]*\))?[\s:]*([€£¥₹$]?\s*[\d,]+\.?\d*)/i,
      },
      {
        type: "GST",
        regex:
          /(?:gst|goods\s+and\s+services\s+tax)(?:\s*\([^)]*\))?[\s:]*([€£¥₹$]?\s*[\d,]+\.?\d*)/i,
      },
      {
        type: "HST",
        regex:
          /(?:hst|harmonized\s+sales\s+tax)(?:\s*\([^)]*\))?[\s:]*([€£¥₹$]?\s*[\d,]+\.?\d*)/i,
      },
    ];

    taxPatterns.forEach(({ type, regex }) => {
      const match = text.match(regex);
      const amountGroup = match?.[1];
      if (amountGroup) {
        const amount = parseFloat(amountGroup.replace(/[^0-9.]/g, ""));
        if (!isNaN(amount) && amount > 0) {
          // Try to extract rate
          const rateMatch = text.match(
            new RegExp(`${type}[\\s:]*\\(?([\\d.]+)%\\)?`, "i"),
          );
          const rate = rateMatch ? parseFloat(rateMatch[1]) : undefined;

          taxes.push({ type, amount, rate });
        }
      }
    });

    return taxes;
  }
}
