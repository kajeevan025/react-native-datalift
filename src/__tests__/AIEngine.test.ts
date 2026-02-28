/**
 * AIEngine, AIProvider, registry – unit tests
 */
import { registerAIProvider, getAIProvider, AIEngine } from "../ai/AIEngine";
import type {
  AIProvider,
  AIEnhancementRequest,
  AIEnhancementResult,
} from "../ai/AIProvider";
import { AIProviderError } from "../ai/AIProvider";
import type { DataLiftLogger } from "../utils/logger";
import { silentLogger } from "../utils/logger";

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Minimal mock provider */
function mockProvider(
  name: string,
  overrides: Partial<AIProvider> = {},
): AIProvider {
  return {
    name,
    enhance: jest.fn().mockResolvedValue({
      response: {
        metadata: {
          documentType: "invoice",
          confidenceScore: 0.9,
          extractionTimestamp: new Date().toISOString(),
          languageDetected: "en",
        },
        supplier: { name: "Test", address: {}, contact: {} },
        buyer: { name: "" },
        transaction: { currency: "USD" },
        parts: [],
        totals: { grandTotal: 0 },
      },
      confidence: 0.9,
      provider: name,
    } satisfies AIEnhancementResult),
    isAvailable: jest.fn().mockResolvedValue(true),
    ...overrides,
  };
}

function dummyRequest(): AIEnhancementRequest {
  return {
    rawText: "Invoice #123",
    partialResponse: {
      supplier: { name: "", address: {}, contact: {} },
      buyer: { name: "" },
      transaction: { currency: "USD" },
      parts: [],
      totals: { grandTotal: 0 },
      metadata: {
        documentType: "invoice",
        languageDetected: "en",
        confidenceScore: 0.5,
        extractionTimestamp: new Date().toISOString(),
      },
    },
    documentType: "invoice",
    ruleBasedConfidence: 0.6,
  };
}

/** Spy logger that records calls */
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

// ─── Registry tests ──────────────────────────────────────────────────────────

describe("AI Registry", () => {
  afterEach(() => {
    // Clean up: the real _registry is module-level, so overwrite with known
    // providers to avoid cross-test contamination.  Since there's no
    // public "clear" function we re-register known test names.
  });

  it("registers and retrieves a provider", () => {
    const p = mockProvider("test-ai");
    registerAIProvider(p);
    expect(getAIProvider("test-ai")).toBe(p);
  });

  it("returns undefined for unknown provider", () => {
    expect(getAIProvider("no-such-provider")).toBeUndefined();
  });
});

// ─── AIProviderError tests ───────────────────────────────────────────────────

describe("AIProviderError", () => {
  it("formats message with provider prefix", () => {
    const err = new AIProviderError("boom", "openai");
    expect(err.message).toBe("[AI:openai] boom");
    expect(err.name).toBe("AIProviderError");
    expect(err.provider).toBe("openai");
  });

  it("stores optional cause", () => {
    const cause = new Error("root cause");
    const err = new AIProviderError("fail", "hf", cause);
    expect(err.cause).toBe(cause);
  });
});

// ─── AIEngine tests ──────────────────────────────────────────────────────────

describe("AIEngine", () => {
  it("returns null when no provider is registered", async () => {
    const engine = new AIEngine(silentLogger, "non-existent");
    const result = await engine.enhance(dummyRequest());
    expect(result).toBeNull();
  });

  it("uses preferredProvider when registered", async () => {
    const p = mockProvider("preferred");
    registerAIProvider(p);
    const logger = spyLogger();
    const engine = new AIEngine(logger, "preferred");
    const result = await engine.enhance(dummyRequest());

    expect(result).not.toBeNull();
    expect(result!.provider).toBe("preferred");
    expect(p.isAvailable).toHaveBeenCalled();
    expect(p.enhance).toHaveBeenCalled();
  });

  it("falls back to first registered when no preferred", async () => {
    const p = mockProvider("fallback-ai");
    registerAIProvider(p);
    const engine = new AIEngine(silentLogger);
    const result = await engine.enhance(dummyRequest());

    expect(result).not.toBeNull();
  });

  it("returns null when provider reports unavailable", async () => {
    const p = mockProvider("unavail", {
      isAvailable: jest.fn().mockResolvedValue(false),
    });
    registerAIProvider(p);
    const logger = spyLogger();
    const engine = new AIEngine(logger, "unavail");
    const result = await engine.enhance(dummyRequest());

    expect(result).toBeNull();
    expect(logger.calls.warn.length).toBeGreaterThan(0);
  });

  it("returns null and logs when provider throws", async () => {
    const p = mockProvider("broken", {
      enhance: jest.fn().mockRejectedValue(new Error("network error")),
    });
    registerAIProvider(p);
    const logger = spyLogger();
    const engine = new AIEngine(logger, "broken");
    const result = await engine.enhance(dummyRequest());

    expect(result).toBeNull();
    expect(logger.calls.warn.some((m) => m.includes("failed"))).toBe(true);
  });
});
