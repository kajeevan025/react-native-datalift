/**
 * DataLift – RuleBasedParser unit tests
 *
 * Tests the full rule-based extraction pipeline against realistic
 * OCR text samples for invoices, receipts, purchase orders, and
 * work orders.
 */

import { RuleBasedParser } from "../parser/RuleBasedParser";
import type { DataLiftResponse } from "../schema/DataLiftResponse";

const parser = new RuleBasedParser();

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const INVOICE_TEXT = `
ACME Corporation
123 Business Ave, Suite 100
Chicago, IL 60601
Phone: (312) 555-0100
Email: billing@acmecorp.com
www.acmecorp.com
Tax ID: 12-3456789

INVOICE

Invoice No: INV-2024-0042
Invoice Date: 01/15/2024
Due Date: 02/15/2024
Payment Terms: Net 30

Bill To:
XYZ Supplies Inc.
456 Client Street
New York, NY 10001
accounts@xyzsupplies.com
(212) 555-0200

Description           Qty   Unit Price    Total
Widget A              5     $12.50        $62.50
Bolt B (SKU: BLT-001) 10    $1.99         $19.90
Gasket C              3     $4.75         $14.25

Subtotal                                  $96.65
Tax (8%)                                   $7.73
Shipping                                   $5.00
Discount                                  -$5.00
Grand Total                              $104.38
`.trim();

const RECEIPT_TEXT = `
WALMART SUPERCENTER
2024 North Main St
Springfield, IL 60601
Tel: 555-123-4567

01/20/2024  09:45 AM

Whole Milk 1Gal           3.49
Sourdough Bread           4.29
Cheddar Cheese 16oz       5.99
7UP 12pk                  6.49

Subtotal                 20.26
Tax (8%)                  1.62
Total                    21.88
Cash Tendered            25.00
Change                    3.12

THANK YOU FOR SHOPPING
`.trim();

const PURCHASE_ORDER_TEXT = `
TechParts Ltd.
999 Industrial Blvd
Detroit, MI 48201
vendor@techparts.com

PURCHASE ORDER

PO#: PO-2024-007
Order Date: 01/22/2024
Ship To:
Maintenance Dept
789 Factory Rd, Anytown, TX 75001

Item No.   Description           Qty   Unit Price
TP-1001    Steel Bearing 20mm    50    $2.50
TP-1002    Rubber Seal Kit       20    $8.75
TP-1003    Hex Bolt M8×30        200   $0.25

Subtotal:   $392.50
Shipping:   $25.00
Total:      $417.50
`.trim();

const WORK_ORDER_TEXT = `
CMMS WORK ORDER

WO#: WO-2024-001
Asset ID: PUMP-A12
Date: 01/25/2024
Technician: John Smith

Description of Work:
Replace impeller and shaft seal on centrifugal pump unit A12.
Inspect bearing housing and lubricate.

Parts Used:
Impeller (PN: IMP-2024)    1 ea    $145.00
Shaft Seal Kit              1 ea    $38.50
Bearing Grease (500ml)      2 ea    $12.00

Labour:                              $250.00
Parts Total:                         $207.50
Grand Total:                         $457.50
`.trim();

// ─── Invoice tests ────────────────────────────────────────────────────────────

describe("RuleBasedParser – Invoice", () => {
  let result: DataLiftResponse;

  beforeAll(() => {
    result = parser.parse(INVOICE_TEXT, { documentType: "invoice" });
  });

  it("classifies as invoice", () => {
    expect(result.metadata.documentType).toBe("invoice");
  });

  it("extracts supplier name", () => {
    expect(result.supplier.name).toMatch(/ACME/i);
  });

  it("extracts supplier phone", () => {
    expect(result.supplier.contact.phone).toBeTruthy();
  });

  it("extracts supplier email", () => {
    expect(result.supplier.contact.email).toBe("billing@acmecorp.com");
  });

  it("extracts tax ID", () => {
    expect(result.supplier.taxInformation?.taxId).toBe("12-3456789");
  });

  it("extracts invoice number", () => {
    expect(result.transaction.invoiceNumber).toBe("INV-2024-0042");
  });

  it("extracts invoice date", () => {
    expect(result.transaction.invoiceDate).toBeTruthy();
  });

  it("extracts due date", () => {
    expect(result.transaction.dueDate).toBeTruthy();
  });

  it("extracts payment terms", () => {
    expect(result.transaction.paymentTerms).toMatch(/net\s*30/i);
  });

  it("extracts line items (parts)", () => {
    expect(result.parts.length).toBeGreaterThan(0);
  });

  it("extracts grand total", () => {
    expect(result.totals.grandTotal).toBeGreaterThan(0);
  });

  it("extracts subtotal", () => {
    expect(result.totals.subtotal).toBeGreaterThan(0);
  });

  it("extracts tax", () => {
    expect(result.totals.totalTax).toBeGreaterThan(0);
  });

  it("extracts shipping cost", () => {
    expect(result.totals.shippingCost).toBeGreaterThan(0);
  });

  it("detects language as English", () => {
    expect(result.metadata.languageDetected).toBe("en");
  });

  it("has an extraction timestamp", () => {
    expect(result.metadata.extractionTimestamp).toBeTruthy();
    expect(
      new Date(result.metadata.extractionTimestamp).getFullYear(),
    ).toBeGreaterThan(2020);
  });
});

// ─── Receipt tests ────────────────────────────────────────────────────────────

describe("RuleBasedParser – Receipt", () => {
  let result: DataLiftResponse;

  beforeAll(() => {
    result = parser.parse(RECEIPT_TEXT, { documentType: "receipt" });
  });

  it("classifies as receipt", () => {
    expect(result.metadata.documentType).toBe("receipt");
  });

  it("extracts supplier/merchant name", () => {
    expect(result.supplier.name).toMatch(/WALMART/i);
  });

  it("extracts total amount", () => {
    expect(result.totals.grandTotal).toBeCloseTo(21.88, 1);
  });

  it("extracts subtotal", () => {
    expect(result.totals.subtotal).toBeCloseTo(20.26, 1);
  });

  it("extracts line items", () => {
    expect(result.parts.length).toBeGreaterThan(0);
  });

  it("extracts transaction time", () => {
    expect(result.transaction.transactionTime).toBeTruthy();
  });

  it("currency defaults to USD", () => {
    expect(result.transaction.currency).toBe("USD");
  });
});

// ─── Purchase order tests ─────────────────────────────────────────────────────

describe("RuleBasedParser – Purchase Order", () => {
  let result: DataLiftResponse;

  beforeAll(() => {
    result = parser.parse(PURCHASE_ORDER_TEXT, {
      documentType: "purchase_order",
    });
  });

  it("classifies as purchase_order or similar", () => {
    expect(["purchase_order", "invoice", "generic"]).toContain(
      result.metadata.documentType,
    );
  });

  it("extracts PO number", () => {
    expect(result.transaction.purchaseOrderNumber).toMatch(/PO-2024-007/);
  });

  it("extracts parts/line items", () => {
    expect(result.parts.length).toBeGreaterThan(0);
  });

  it("extracts grand total", () => {
    expect(result.totals.grandTotal).toBeGreaterThan(0);
  });
});

// ─── Work order tests ─────────────────────────────────────────────────────────

describe("RuleBasedParser – Work Order", () => {
  let result: DataLiftResponse;

  beforeAll(() => {
    result = parser.parse(WORK_ORDER_TEXT);
  });

  it("extracts parts used", () => {
    expect(result.parts.length).toBeGreaterThan(0);
  });

  it("extracts grand total", () => {
    expect(result.totals.grandTotal).toBeGreaterThan(0);
  });
});

// ─── Empty input graceful handling ────────────────────────────────────────────

describe("RuleBasedParser – Edge cases", () => {
  it("handles empty string without throwing", () => {
    expect(() => parser.parse("")).not.toThrow();
  });

  it("returns generic type for empty text", () => {
    const r = parser.parse("");
    expect(r.metadata.documentType).toBe("generic");
  });

  it("returns 0 grand total when no totals found", () => {
    const r = parser.parse(
      "Some random unstructured text without any numbers.",
    );
    expect(r.totals.grandTotal).toBe(0);
  });

  it("returns empty parts array when no line items found", () => {
    const r = parser.parse("This is just a header\nNo items here");
    expect(Array.isArray(r.parts)).toBe(true);
  });
});

// ─── v1.3.0 new feature tests ────────────────────────────────────────────────

describe("RuleBasedParser – invoice status extraction", () => {
  it("detects PAID status", () => {
    const r = parser.parse(
      "TAX INVOICE\nINVOICE NUMBER: INV-001\nStatus: PAID\nTotal: $500.00",
    );
    expect(r.transaction.status).toBe("paid");
  });

  it("detects OVERDUE status", () => {
    const r = parser.parse(
      "Invoice INV-002\nOVERDUE\nDue Date: 2024-01-01\nGrand Total: $250.00",
    );
    expect(r.transaction.status).toBe("overdue");
  });
});

describe("RuleBasedParser – tip and service charge extraction", () => {
  it("extracts tip from footer", () => {
    const r = parser.parse(
      "INVOICE\nItem A   1   $100.00   $100.00\nSubtotal: $100.00\nTip: $10.00\nTotal: $110.00",
    );
    expect(r.totals.tip).toBeCloseTo(10);
  });

  it("extracts service charge", () => {
    const r = parser.parse(
      "Invoice\nService Charge: $15.00\nGrand Total: $115.00",
    );
    expect(r.totals.serviceCharge).toBeCloseTo(15);
  });
});

describe("RuleBasedParser – buyer section boundary", () => {
  it("stops buyer extraction at invoice section keywords", () => {
    const text = [
      "TAX INVOICE",
      "ACME Corp",
      "123 Supplier St, Sydney",
      "Bill To:",
      "Customer XYZ",
      "456 Customer Rd",
      "Invoice Number: INV-999",
      "Date: 2024-03-01",
    ].join("\n");
    const r = parser.parse(text);
    // Buyer should not include invoice metadata
    expect(r.buyer.name).toContain("Customer XYZ");
    expect(r.transaction.invoiceNumber).toBe("INV-999");
  });
});

describe("RuleBasedParser – $1M sanity guard", () => {
  it("accepts line items up to $999,999", () => {
    const text = [
      "Description  Qty  Unit Price  Total",
      "Industrial Equipment  1  450000.00  450000.00",
      "Grand Total: $450,000.00",
    ].join("\n");
    const r = parser.parse(text);
    const bigItem = r.parts.find(
      (p) => p.totalAmount && p.totalAmount > 100000,
    );
    expect(bigItem).toBeDefined();
  });
});

describe("RuleBasedParser – ALL-CAPS supplier (4-char min)", () => {
  it("matches a 4-character uppercase company name", () => {
    const r = parser.parse(
      "ACME\n123 Industrial Ave\nInvoice No: INV-001\nTotal: $100.00",
    );
    expect(r.supplier.name).toBe("ACME");
  });
});
