
/**
 * DataLift – ConfidenceEngine unit tests
 */

import { ConfidenceEngine } from "../core/confidence";
import type { DataLiftResponse } from "../schema/DataLiftResponse";

const engine = new ConfidenceEngine();

function makeResponse(overrides?: Partial<DataLiftResponse>): DataLiftResponse {
  const base: DataLiftResponse = {
    metadata: {
      documentType: "invoice",
      confidenceScore: 0,
      extractionTimestamp: new Date().toISOString(),
      languageDetected: "en",
    },
    supplier: {
      name: "ACME Corp",
      address: { fullAddress: "123 Main St, Chicago IL" },
      contact: { phone: "312-555-0100", email: "info@acme.com" },
    },
    buyer: { name: "XYZ Inc" },
    transaction: {
      invoiceNumber: "INV-001",
      invoiceDate: "2024-01-15",
      currency: "USD",
    },
    parts: [
      { itemName: "Widget", quantity: 2, unitPrice: 10, totalAmount: 20 },
    ],
    totals: { subtotal: 20, totalTax: 1.6, grandTotal: 21.6 },
  };

  return { ...base, ...overrides } as DataLiftResponse;
}

describe("ConfidenceEngine", () => {
  it("returns a number between 0 and 1", () => {
    const r = makeResponse();
    const { overall } = engine.score(r, "invoice acme 21.60", 0.9, "invoice");
    expect(overall).toBeGreaterThanOrEqual(0);
    expect(overall).toBeLessThanOrEqual(1);
  });

  it("gives higher score for well-populated response", () => {
    const rich = makeResponse();
    const sparse = makeResponse({
      supplier: { name: "", address: {}, contact: {} },
      parts: [],
      totals: { grandTotal: 0 },
    });
    const richScore = engine.score(
      rich,
      "invoice acme 21.60",
      0.9,
      "invoice",
    ).overall;
    const sparseScore = engine.score(sparse, "", 0, "invoice").overall;
    expect(richScore).toBeGreaterThan(sparseScore);
  });

  it("gives higher score when totals are numerically consistent", () => {
    const consistent = makeResponse({
      parts: [{ itemName: "A", quantity: 1, totalAmount: 100 }],
      totals: { subtotal: 100, totalTax: 8, grandTotal: 108 },
    });
    const inconsistent = makeResponse({
      parts: [{ itemName: "A", quantity: 1, totalAmount: 100 }],
      totals: { subtotal: 100, totalTax: 8, grandTotal: 999 }, // wrong grand total
    });
    const cs = engine.score(consistent, "invoice 108", 0.9, "invoice").numeric;
    const is = engine.score(
      inconsistent,
      "invoice 999",
      0.9,
      "invoice",
    ).numeric;
    expect(cs).toBeGreaterThan(is);
  });

  it("scores higher when keywords match document type", () => {
    const invoiceText = "invoice inv bill to due date amount due";
    const randomText = "some random unrelated text here";
    const ks1 = engine.score(
      makeResponse(),
      invoiceText,
      0.8,
      "invoice",
    ).keyword;
    const ks2 = engine.score(
      makeResponse(),
      randomText,
      0.8,
      "invoice",
    ).keyword;
    expect(ks1).toBeGreaterThan(ks2);
  });

  it("returns breakdown with all expected keys", () => {
    const breakdown = engine.score(makeResponse(), "invoice", 0.8, "invoice");
    expect(breakdown).toHaveProperty("overall");
    expect(breakdown).toHaveProperty("ocr");
    expect(breakdown).toHaveProperty("fields");
    expect(breakdown).toHaveProperty("numeric");
    expect(breakdown).toHaveProperty("docType");
    expect(breakdown).toHaveProperty("keyword");
  });
});
