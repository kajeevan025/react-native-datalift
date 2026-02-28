/**
 * OCREngine, OCRProvider, registry – unit tests
 */
import { OCRError } from "../ocr/OCRProvider";
import type { OCRProvider, OCRResult } from "../ocr/OCRProvider";
import {
  registerOCRProvider,
  getOCRProvider,
  OCREngine,
} from "../ocr/OCREngine";
import type { DataLiftLogger } from "../utils/logger";
import { silentLogger } from "../utils/logger";

// ─── helpers ──────────────────────────────────────────────────────────────────

function mockOCRProvider(
  name: string,
  overrides: Partial<OCRProvider> = {},
): OCRProvider {
  return {
    name,
    extractText: jest.fn().mockResolvedValue({
      text: "Mock OCR output",
      confidence: 0.9,
      lineCount: 3,
      provider: name,
    } satisfies OCRResult),
    isAvailable: jest.fn().mockResolvedValue(true),
    ...overrides,
  };
}

function spyLogger(): DataLiftLogger & {
  calls: Record<string, string[]>;
} {
  const calls: Record<string, string[]> = {
    debug: [],
    info: [],
    warn: [],
    error: [],
  };
  return {
    calls,
    debug(msg: string) {
      calls.debug.push(msg);
    },
    info(msg: string) {
      calls.info.push(msg);
    },
    warn(msg: string) {
      calls.warn.push(msg);
    },
    error(msg: string) {
      calls.error.push(msg);
    },
  };
}

// ─── OCRError ────────────────────────────────────────────────────────────────

describe("OCRError", () => {
  it("formats message with provider prefix", () => {
    const err = new OCRError("failed", "mlkit");
    expect(err.message).toBe("[mlkit] failed");
    expect(err.name).toBe("OCRError");
    expect(err.provider).toBe("mlkit");
  });

  it("stores optional cause", () => {
    const cause = new TypeError("bad input");
    const err = new OCRError("oops", "tesseract", cause);
    expect(err.cause).toBe(cause);
  });
});

// ─── Registry ────────────────────────────────────────────────────────────────

describe("OCR Registry", () => {
  it("retrieves built-in providers", () => {
    // OCREngine module pre-registers native-mlkit and tesseract
    const native = getOCRProvider("native-mlkit");
    expect(native).toBeDefined();
    expect(native!.name).toBe("native-mlkit");

    const tess = getOCRProvider("tesseract");
    expect(tess).toBeDefined();
    expect(tess!.name).toBe("tesseract");
  });

  it("registers and retrieves a custom provider", () => {
    const custom = mockOCRProvider("custom-ocr");
    registerOCRProvider(custom);
    expect(getOCRProvider("custom-ocr")).toBe(custom);
  });

  it("returns undefined for unknown provider", () => {
    expect(getOCRProvider("nothing")).toBeUndefined();
  });
});

// ─── OCREngine ───────────────────────────────────────────────────────────────

describe("OCREngine", () => {
  // Override built-in providers so tesseract doesn't actually spawn workers
  beforeEach(() => {
    registerOCRProvider(
      mockOCRProvider("native-mlkit", {
        isAvailable: jest.fn().mockResolvedValue(false),
      }),
    );
    registerOCRProvider(
      mockOCRProvider("tesseract", {
        isAvailable: jest.fn().mockResolvedValue(false),
      }),
    );
  });

  it("uses preferredProvider if available", async () => {
    const p = mockOCRProvider("my-ocr");
    registerOCRProvider(p);
    const engine = new OCREngine(silentLogger, "my-ocr");
    const result = await engine.run({ imageData: "base64data" });

    expect(result.text).toBe("Mock OCR output");
    expect(p.extractText).toHaveBeenCalled();
  });

  it("falls back when preferred provider is unavailable", async () => {
    const unavail = mockOCRProvider("unavail-ocr", {
      isAvailable: jest.fn().mockResolvedValue(false),
    });
    registerOCRProvider(unavail);
    // Re-register native-mlkit as available so fallback chain succeeds
    registerOCRProvider(mockOCRProvider("native-mlkit"));

    const logger = spyLogger();
    const engine = new OCREngine(logger, "unavail-ocr");
    const result = await engine.run({ imageData: "base64data" });

    expect(result.text).toBe("Mock OCR output");
  });

  it("falls back when preferred provider throws", async () => {
    const broken = mockOCRProvider("err-ocr", {
      extractText: jest.fn().mockRejectedValue(new OCRError("boom", "err-ocr")),
    });
    registerOCRProvider(broken);
    // Re-register native-mlkit as available so fallback chain succeeds
    registerOCRProvider(mockOCRProvider("native-mlkit"));

    const engine = new OCREngine(silentLogger, "err-ocr");
    const result = await engine.run({ imageData: "base64data" });

    expect(result.text).toBe("Mock OCR output");
  });

  it("throws last error when all providers fail", async () => {
    // Register a provider that is always unavailable
    const bad = mockOCRProvider("fail-only", {
      isAvailable: jest.fn().mockResolvedValue(false),
    });
    registerOCRProvider(bad);

    // Engine with only the failing provider in default order
    const engine = new OCREngine(silentLogger, "fail-only");
    await expect(engine.run({ imageData: "base64data" })).rejects.toThrow();
  });

  it("passes options through to provider", async () => {
    const p = mockOCRProvider("opts-ocr");
    registerOCRProvider(p);
    const engine = new OCREngine(silentLogger, "opts-ocr");
    await engine.run({ imageData: "base64data", language: "fra" });

    expect(p.extractText).toHaveBeenCalledWith(
      expect.objectContaining({ imageData: "base64data", language: "fra" }),
    );
  });
});
