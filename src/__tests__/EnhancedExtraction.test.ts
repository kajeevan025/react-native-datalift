/**
 * Enhanced Extraction Tests
 * Tests for new extraction patterns and enhanced parsing
 */

import {
  AddressParser,
  ContactInfoParser,
  PartNumberParser,
  CurrencyAmountParser,
  DateParser,
  TableDetector,
  TaxParser,
} from "../utils/ExtractionPatterns";

describe("AddressParser", () => {
  test("should parse US address with zip code", () => {
    const text = `123 Main Street
City, CA 12345
United States`;
    const result = AddressParser.parse(text);
    expect(result).not.toBeNull();
    expect(result?.value.street).toBe("123 Main Street");
    expect(result?.value.city).toBe("City");
    expect(result?.value.state).toBe("CA");
    expect(result?.value.zipCode).toBe("12345");
    expect(result?.value.country).toBe("United States");
  });

  test("should parse address without country", () => {
    const text = `456 Oak Avenue
Springfield, IL 62701`;
    const result = AddressParser.parse(text);
    expect(result).not.toBeNull();
    expect(result?.value.zipCode).toBe("62701");
    expect(result?.value.state).toBe("IL");
  });

  test("should return null for text without address", () => {
    const text = "This is just regular text without an address";
    const result = AddressParser.parse(text);
    expect(result).toBeNull();
  });
});

describe("ContactInfoParser", () => {
  test("should parse US phone numbers", () => {
    const text = `Call us at (123) 456-7890 or 987-654-3210`;
    const phones = ContactInfoParser.parsePhones(text);
    expect(phones).toHaveLength(2);
    expect(phones).toContain("(123) 456-7890");
    expect(phones).toContain("987-654-3210");
  });

  test("should parse international phone numbers", () => {
    const text = `Contact: +1-800-555-1234 or +44 20 1234 5678`;
    const phones = ContactInfoParser.parsePhones(text);
    expect(phones.length).toBeGreaterThan(0);
  });

  test("should parse email addresses", () => {
    const text = `Email: support@example.com or sales@company.co.uk`;
    const emails = ContactInfoParser.parseEmails(text);
    expect(emails).toContain("support@example.com");
    expect(emails).toContain("sales@company.co.uk");
  });

  test("should parse URLs", () => {
    const text = `Visit us at https://example.com or www.company.com`;
    const urls = ContactInfoParser.parseURLs(text);
    expect(urls).toContain("https://example.com");
    expect(urls).toContain("www.company.com");
  });
});

describe("PartNumberParser", () => {
  test("should parse SKU codes", () => {
    const text = "Item: ABC-123 Quantity: 5";
    const partNumbers = PartNumberParser.parse(text);
    expect(partNumbers).toContain("ABC-123");
  });

  test("should parse part numbers from line", () => {
    const line = "SKU:XYZ789 Widget Product";
    const partNumber = PartNumberParser.parseFromLine(line);
    expect(partNumber).toBe("XYZ789");
  });

  test("should extract manufacturer part numbers", () => {
    const text = "MPN: 123-456-7890";
    const partNumbers = PartNumberParser.parse(text);
    expect(partNumbers.length).toBeGreaterThan(0);
  });

  test("should parse part number in parentheses", () => {
    const line = "Widget (ABC-123) - Blue";
    const partNumber = PartNumberParser.parseFromLine(line);
    expect(partNumber).toBe("ABC-123");
  });
});

describe("CurrencyAmountParser", () => {
  test("should detect USD currency", () => {
    const text = "Total: $123.45";
    const currency = CurrencyAmountParser.detectCurrency(text);
    expect(currency.code).toBe("USD");
    expect(currency.symbol).toBe("$");
  });

  test("should detect EUR currency", () => {
    const text = "Total: €99.99";
    const currency = CurrencyAmountParser.detectCurrency(text);
    expect(currency.code).toBe("EUR");
    expect(currency.symbol).toBe("€");
  });

  test("should parse amount with symbol before", () => {
    const text = "Total: $123.45";
    const amount = CurrencyAmountParser.parseAmount(text, "$");
    expect(amount).toBe(123.45);
  });

  test("should parse amount with symbol after", () => {
    const text = "Total: 99.99€";
    const amount = CurrencyAmountParser.parseAmount(text, "€");
    expect(amount).toBe(99.99);
  });

  test("should extract labeled amount", () => {
    const text = "Subtotal: $50.00\nTax: $5.00\nTotal: $55.00";
    const total = CurrencyAmountParser.extractLabeledAmount(text, "total", "$");
    expect(total).toBe(55.0);
  });
});

describe("DateParser", () => {
  test("should parse ISO dates", () => {
    const text = "Date: 2024-01-31";
    const dates = DateParser.parse(text);
    expect(dates).toContain("2024-01-31");
  });

  test("should parse US dates", () => {
    const text = "Transaction: 01/31/2024";
    const dates = DateParser.parse(text);
    expect(dates).toContain("01/31/2024");
  });

  test("should parse long format dates", () => {
    const text = "Invoice Date: January 31, 2024";
    const dates = DateParser.parse(text);
    expect(dates.length).toBeGreaterThan(0);
  });

  test("should extract typed dates", () => {
    const text = `Invoice Date: 01/15/2024
Due Date: 02/15/2024`;
    const dates = DateParser.extractTyped(text);
    expect(dates.issueDate).toBe("01/15/2024");
    expect(dates.dueDate).toBe("02/15/2024");
  });
});

describe("TableDetector", () => {
  test("should detect table with headers", () => {
    const lines = [
      "Receipt #12345",
      "ITEM  QTY  PRICE  TOTAL",
      "Widget  2  $10.00  $20.00",
      "Gadget  1  $15.00  $15.00",
      "Subtotal: $35.00",
    ];
    const tableInfo = TableDetector.detectTable(lines);
    expect(tableInfo.hasTable).toBe(true);
    expect(tableInfo.headerIndex).toBe(1);
    expect(tableInfo.startIndex).toBe(2);
  });

  test("should not detect table without headers", () => {
    const lines = ["This is just", "regular text", "without any table"];
    const tableInfo = TableDetector.detectTable(lines);
    expect(tableInfo.hasTable).toBe(false);
  });

  test("should extract line items from table", () => {
    const lines = [
      "ITEM  QTY  PRICE",
      "Widget  2  $10.00",
      "Gadget  1  $15.00",
      "Total: $25.00",
    ];
    const tableInfo = TableDetector.detectTable(lines);
    const items = TableDetector.extractLineItems(lines, tableInfo);
    expect(items.length).toBe(2);
  });
});

describe("TaxParser", () => {
  test("should parse sales tax", () => {
    const text = "Subtotal: $100.00\nSales Tax: $8.50\nTotal: $108.50";
    const taxes = TaxParser.parseTaxBreakdown(text, "$");
    expect(taxes.length).toBeGreaterThan(0);
    expect(taxes[0].type).toBe("Sales Tax");
    expect(taxes[0].amount).toBe(8.5);
  });

  test("should parse VAT", () => {
    const text = "Subtotal: €100.00\nVAT (20%): €20.00\nTotal: €120.00";
    const taxes = TaxParser.parseTaxBreakdown(text, "€");
    const vat = taxes.find((t) => t.type === "VAT");
    expect(vat).toBeDefined();
    expect(vat?.amount).toBe(20.0);
    expect(vat?.rate).toBe(20);
  });

  test("should parse multiple tax types", () => {
    const text = `
      Subtotal: $100.00
      Sales Tax: $5.00
      GST: $3.00
      Total: $108.00
    `;
    const taxes = TaxParser.parseTaxBreakdown(text, "$");
    expect(taxes.length).toBeGreaterThanOrEqual(2);
  });
});
