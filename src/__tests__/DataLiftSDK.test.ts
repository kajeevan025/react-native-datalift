
/**
 * DataLift – DataLiftSDK integration tests
 *
 * These tests use a mocked OCR provider to test the full SDK pipeline
 * without requiring a real device or network.
 */

import { DataLiftSDK as DataLift } from "../core/DataLift";
import { registerOCRProvider } from "../ocr/OCREngine";
import type { OCRProvider, OCROptions, OCRResult } from "../ocr/OCRProvider";

// ─── Mock OCR provider ────────────────────────────────────────────────────────

const INVOICE_OCR_TEXT = `
ACME Corporation
123 Business Ave, Chicago, IL 60601
billing@acmecorp.com
Tel: (312) 555-0100

INVOICE
Invoice No: INV-2024-TEST
Invoice Date: 01/15/2024
Due Date: 02/15/2024

Bill To:
XYZ Inc
456 Client St, New York, NY 10001

Description     Qty   Unit Price   Total
Widget A         2     $25.00       $50.00
Bolt Set         5     $5.00        $25.00

Subtotal                             $75.00
Tax (8%)                              $6.00
Grand Total                          $81.00
`.trim();

class MockOCRProvider implements OCRProvider {
  readonly name = "mock-ocr";
  private textToReturn: string;

  constructor(text: string) {
    this.textToReturn = text;
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async extractText(_options: OCROptions): Promise<OCRResult> {
    return {
      text: this.textToReturn,
      confidence: 0.95,
      lineCount: this.textToReturn.split("\n").length,
      provider: this.name,
    };
  }
}

// Register before tests
beforeAll(() => {
  registerOCRProvider(new MockOCRProvider(INVOICE_OCR_TEXT));
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("DataLiftSDK.extract()", () => {
  it("throws DataLiftExtractError when no image provided", async () => {
    await expect(DataLift.extract({})).rejects.toMatchObject({
      name: "DataLiftExtractError",
      code: "INVALID_INPUT",
    });
  });

  it("returns a DataLiftResponse with correct shape", async () => {
    const result = await DataLift.extract({
      image: "test-image-data",
      ocrProvider: "mock-ocr",
    });

    expect(result).toHaveProperty("metadata");
    expect(result).toHaveProperty("supplier");
    expect(result).toHaveProperty("buyer");
    expect(result).toHaveProperty("transaction");
    expect(result).toHaveProperty("parts");
    expect(result).toHaveProperty("totals");
  });

  it("extracts the supplier name", async () => {
    const result = await DataLift.extract({
      image: "test",
      ocrProvider: "mock-ocr",
    });
    expect(result.supplier.name).toBeTruthy();
  });

  it("extracts transaction invoice number", async () => {
    const result = await DataLift.extract({
      image: "test",
      ocrProvider: "mock-ocr",
    });
    expect(result.transaction.invoiceNumber).toMatch(/INV-2024-TEST/);
  });

  it("extracts grand total", async () => {
    const result = await DataLift.extract({
      image: "test",
      ocrProvider: "mock-ocr",
    });
    expect(result.totals.grandTotal).toBeGreaterThan(0);
  });

  it("includes confidenceScore between 0 and 1", async () => {
    const result = await DataLift.extract({
      image: "test",
      ocrProvider: "mock-ocr",
    });
    expect(result.metadata.confidenceScore).toBeGreaterThanOrEqual(0);
    expect(result.metadata.confidenceScore).toBeLessThanOrEqual(1);
  });

  it("includes extraction timestamp", async () => {
    const result = await DataLift.extract({
      image: "test",
      ocrProvider: "mock-ocr",
    });
    expect(result.metadata.extractionTimestamp).toBeTruthy();
    expect(new Date(result.metadata.extractionTimestamp)).toBeInstanceOf(Date);
  });

  it("includes processingTimeMs", async () => {
    const result = await DataLift.extract({
      image: "test",
      ocrProvider: "mock-ocr",
    });
    expect(typeof result.metadata.processingTimeMs).toBe("number");
    expect(result.metadata.processingTimeMs).toBeGreaterThanOrEqual(0);
  });

  it("does NOT include rawText by default", async () => {
    const result = await DataLift.extract({
      image: "test",
      ocrProvider: "mock-ocr",
    });
    expect(result.rawText).toBeUndefined();
  });

  it("includes rawText when extractRawText is true", async () => {
    const result = await DataLift.extract({
      image: "test",
      ocrProvider: "mock-ocr",
      extractRawText: true,
    });
    expect(typeof result.rawText).toBe("string");
    expect((result.rawText as string).length).toBeGreaterThan(0);
  });

  it("ocrProvider name is stamped in metadata", async () => {
    const result = await DataLift.extract({
      image: "test",
      ocrProvider: "mock-ocr",
    });
    expect(result.metadata.ocrProvider).toBe("mock-ocr");
  });

  it("parts array is always an array", async () => {
    const result = await DataLift.extract({
      image: "test",
      ocrProvider: "mock-ocr",
    });
    expect(Array.isArray(result.parts)).toBe(true);
  });
});

describe("DataLiftSDK.extractText()", () => {
  it("returns raw OCR text string", async () => {
    const text = await DataLift.extractText({
      image: "test",
      ocrProvider: "mock-ocr",
    });
    expect(typeof text).toBe("string");
    expect(text.length).toBeGreaterThan(0);
  });
});

describe("DataLiftSDK.configure()", () => {
  it("updates default AI threshold without throwing", () => {
    expect(() =>
      DataLift.configure({ aiConfidenceThreshold: 0.8 }),
    ).not.toThrow();
  });
});
