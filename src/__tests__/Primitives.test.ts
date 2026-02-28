
/**
 * DataLift – Parser Primitives unit tests
 */

import {
  detectCurrency,
  detectLanguage,
  classifyDocumentType,
  extractDates,
  extractLabeledAmount,
  extractPhones,
  extractEmails,
  parseAddress,
  parseLineItem,
} from "../parser/primitives";

// ─── Currency detection ───────────────────────────────────────────────────────

describe("detectCurrency", () => {
  it("detects USD from $ symbol", () => {
    expect(detectCurrency("Total: $45.00").code).toBe("USD");
  });

  it("detects EUR from € symbol", () => {
    expect(detectCurrency("Total: €45.00").code).toBe("EUR");
  });

  it("detects GBP from £ symbol", () => {
    expect(detectCurrency("Amount: £100").code).toBe("GBP");
  });

  it("detects INR from ₹ symbol", () => {
    expect(detectCurrency("Rs. 500").code).toBe("INR");
  });

  it("defaults to USD when no currency symbol found", () => {
    expect(detectCurrency("Total: 45.00").code).toBe("USD");
  });
});

// ─── Language detection ───────────────────────────────────────────────────────

describe("detectLanguage", () => {
  it("detects English", () => {
    expect(
      detectLanguage("The invoice is for the goods and services provided"),
    ).toBe("en");
  });

  it("detects French", () => {
    expect(detectLanguage("Le montant total de la facture est")).toBe("fr");
  });

  it("detects German", () => {
    expect(
      detectLanguage("Die Rechnung ist für die erbrachten Leistungen"),
    ).toBe("de");
  });

  it("defaults to English for unknown text", () => {
    expect(detectLanguage("xyz abc 123")).toBe("en");
  });
});

// ─── Document type classification ────────────────────────────────────────────

describe("classifyDocumentType", () => {
  it("classifies invoice text", () => {
    expect(
      classifyDocumentType(
        "Invoice No: INV-001 Bill To: customer Amount Due: $100",
      ),
    ).toBe("invoice");
  });

  it("classifies receipt text", () => {
    expect(classifyDocumentType("Receipt Thank you Subtotal Cash Change")).toBe(
      "receipt",
    );
  });

  it("classifies purchase order text", () => {
    expect(classifyDocumentType("Purchase Order PO# Ship To Ordered By")).toBe(
      "purchase_order",
    );
  });

  it("classifies work order text", () => {
    expect(
      classifyDocumentType("Work Order WO# Technician Asset ID Fault"),
    ).toBe("work_order");
  });

  it("returns generic for unrecognised text", () => {
    expect(classifyDocumentType("hello world foo bar")).toBe("generic");
  });
});

// ─── Date extraction ──────────────────────────────────────────────────────────

describe("extractDates", () => {
  it("extracts invoice date", () => {
    const { invoiceDate } = extractDates("Invoice Date: 01/15/2024");
    expect(invoiceDate).toBeTruthy();
  });

  it("extracts due date", () => {
    const { dueDate } = extractDates("Due Date: 02/15/2024");
    expect(dueDate).toBeTruthy();
  });

  it("returns undefined when date not found", () => {
    const { invoiceDate } = extractDates("No dates here");
    expect(invoiceDate).toBeUndefined();
  });
});

// ─── Amount extraction ────────────────────────────────────────────────────────

describe("extractLabeledAmount", () => {
  it("extracts labeled USD amount", () => {
    expect(extractLabeledAmount("Total: $123.45", "total")).toBeCloseTo(123.45);
  });

  it("extracts amount without currency symbol", () => {
    expect(extractLabeledAmount("Subtotal: 99.99", "subtotal")).toBeCloseTo(
      99.99,
    );
  });

  it("extracts amount with comma separator", () => {
    expect(
      extractLabeledAmount("Grand Total: $1,234.00", "grand total"),
    ).toBeCloseTo(1234);
  });

  it("returns undefined when label not found", () => {
    expect(extractLabeledAmount("Nothing here", "total")).toBeUndefined();
  });
});

// ─── Phone extraction ─────────────────────────────────────────────────────────

describe("extractPhones", () => {
  it("extracts US phone number", () => {
    const phones = extractPhones("Call us at (312) 555-0100");
    expect(phones.length).toBeGreaterThan(0);
  });

  it("extracts multiple phone numbers", () => {
    const phones = extractPhones("Phone: 312-555-0100 Fax: 312-555-0200");
    expect(phones.length).toBeGreaterThanOrEqual(2);
  });

  it("returns empty array when no phones found", () => {
    const phones = extractPhones("No phone numbers here");
    expect(phones).toEqual([]);
  });
});

// ─── Email extraction ─────────────────────────────────────────────────────────

describe("extractEmails", () => {
  it("extracts single email", () => {
    const emails = extractEmails("Contact billing@acme.com for questions");
    expect(emails).toContain("billing@acme.com");
  });

  it("extracts multiple emails", () => {
    const emails = extractEmails("From: a@x.com To: b@y.com");
    expect(emails.length).toBe(2);
  });

  it("returns empty array when no emails found", () => {
    expect(extractEmails("No emails here")).toEqual([]);
  });
});

// ─── Address parsing ──────────────────────────────────────────────────────────

describe("parseAddress", () => {
  it("extracts city and state from standard format", () => {
    const addr = parseAddress("123 Main St\nChicago, IL 60601");
    expect(addr.city).toBe("Chicago");
    expect(addr.state).toBe("IL");
    expect(addr.postalCode).toBe("60601");
  });

  it("builds fullAddress", () => {
    const addr = parseAddress("456 Oak Ave\nBoston, MA 02101");
    expect(addr.fullAddress).toBeTruthy();
  });

  it("returns empty object for non-address text", () => {
    const addr = parseAddress("Random text with no address");
    expect(addr.fullAddress).toBeUndefined();
  });
});

// ─── Line item parsing ────────────────────────────────────────────────────────

describe("parseLineItem", () => {
  it("parses item with quantity and total", () => {
    const item = parseLineItem(
      "Widget A               3     $9.99     $29.97",
      1,
    );
    expect(item).not.toBeNull();
    expect((item as NonNullable<typeof item>).quantity).toBe(3);
    expect((item as NonNullable<typeof item>).totalAmount).toBeCloseTo(29.97);
  });

  it("parses item with single price", () => {
    const item = parseLineItem("Service Fee              $50.00", 1);
    expect(item).not.toBeNull();
    expect((item as NonNullable<typeof item>).totalAmount).toBeCloseTo(50);
  });

  it("returns null for summary/total lines", () => {
    expect(parseLineItem("Total:   $100.00", 1)).toBeNull();
    expect(parseLineItem("Subtotal $80.00", 1)).toBeNull();
    expect(parseLineItem("Tax       $8.00", 1)).toBeNull();
  });

  it("returns null for lines without amounts", () => {
    expect(parseLineItem("This is just a heading", 1)).toBeNull();
  });
});
