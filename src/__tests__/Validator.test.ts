
/**
 * DataLift – Validator unit tests
 */

import { validateOptions, sanitiseResponse } from "../core/validator";
import type {
  DataLiftExtractOptions,
  DataLiftResponse,
} from "../schema/DataLiftResponse";

describe("validateOptions", () => {
  it("passes when image is a base64 string", () => {
    const opts: DataLiftExtractOptions = {
      image: "data:image/jpeg;base64,abc123",
    };
    const { valid } = validateOptions(opts);
    expect(valid).toBe(true);
  });

  it("passes when imageInput.type is uri", () => {
    const opts: DataLiftExtractOptions = {
      imageInput: { type: "uri", path: "/sdcard/scan.jpg" },
    };
    const { valid } = validateOptions(opts);
    expect(valid).toBe(true);
  });

  it("fails when neither image nor imageInput is provided", () => {
    const opts: DataLiftExtractOptions = {};
    const { valid, errors } = validateOptions(opts);
    expect(valid).toBe(false);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("fails when imageInput.type is base64 but data is missing", () => {
    const opts: DataLiftExtractOptions = {
      imageInput: { type: "base64", data: "" },
    };
    const { valid } = validateOptions(opts);
    expect(valid).toBe(false);
  });

  it("fails when aiConfidenceThreshold is out of range", () => {
    const opts: DataLiftExtractOptions = {
      image: "abc",
      aiConfidenceThreshold: 1.5,
    };
    const { valid, errors } = validateOptions(opts);
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes("aiConfidenceThreshold"))).toBe(true);
  });

  it("accepts valid aiConfidenceThreshold", () => {
    const opts: DataLiftExtractOptions = {
      image: "abc",
      aiConfidenceThreshold: 0.7,
    };
    const { valid } = validateOptions(opts);
    expect(valid).toBe(true);
  });
});

describe("sanitiseResponse", () => {
  const minimal: Partial<DataLiftResponse> = {
    metadata: {
      documentType: "invoice",
      confidenceScore: 0.9,
      extractionTimestamp: "2024-01-01T00:00:00Z",
      languageDetected: "en",
    },
    supplier: { name: "ACME", address: {}, contact: {} },
    buyer: {},
    transaction: {},
    parts: [],
    totals: { grandTotal: 100 },
  };

  it("returns a valid response for minimal input", () => {
    const r = sanitiseResponse(minimal as DataLiftResponse);
    expect(r.metadata.documentType).toBe("invoice");
    expect(r.totals.grandTotal).toBe(100);
    expect(r.supplier.name).toBe("ACME");
  });

  it("defaults grandTotal to 0 when missing", () => {
    const r = sanitiseResponse({
      ...minimal,
      totals: {},
    } as DataLiftResponse);
    expect(r.totals.grandTotal).toBe(0);
  });

  it("defaults documentType to generic when missing", () => {
    const r = sanitiseResponse({
      ...minimal,
      metadata: undefined,
    } as unknown as DataLiftResponse);
    expect(r.metadata.documentType).toBe("generic");
  });

  it("returns empty parts array when parts is undefined", () => {
    const r = sanitiseResponse({
      ...minimal,
      parts: undefined,
    } as unknown as DataLiftResponse);
    expect(Array.isArray(r.parts)).toBe(true);
    expect(r.parts.length).toBe(0);
  });
});
