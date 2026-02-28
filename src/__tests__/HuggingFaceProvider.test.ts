/**
 * HuggingFaceProvider – unit tests (mocked offline runner)
 */
import { HuggingFaceProvider } from "../ai/HuggingFaceProvider";
import type { LayoutLMv3OfflineRunner } from "../ai/HuggingFaceProvider";
import type { AIEnhancementRequest } from "../ai/AIProvider";
import { AIProviderError } from "../ai/AIProvider";

// ─── helpers ──────────────────────────────────────────────────────────────────

function dummyRequest(
  overrides: Partial<AIEnhancementRequest> = {},
): AIEnhancementRequest {
  return {
    rawText: "Invoice #12345\nVendor: TestCorp\nTotal: $500.00",
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
    ruleBasedConfidence: 0.5,
    ...overrides,
  };
}

function mockRunner(
  overrides: Partial<{
    entities: Array<{
      entity_group: string;
      word: string;
      score: number;
    }>;
    confidence: number;
  }> = {},
): LayoutLMv3OfflineRunner {
  return jest.fn().mockResolvedValue({
    entities: overrides.entities ?? [
      { entity_group: "INVOICE_NUMBER", word: "12345", score: 0.92 },
      { entity_group: "VENDOR_NAME", word: "TestCorp", score: 0.88 },
      { entity_group: "TOTAL", word: "500.00", score: 0.95 },
    ],
    confidence: overrides.confidence ?? 0.85,
    raw_output: {},
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("HuggingFaceProvider", () => {
  it("has name 'huggingface'", () => {
    const p = new HuggingFaceProvider({ runner: mockRunner() });
    expect(p.name).toBe("huggingface");
  });

  describe("isAvailable", () => {
    it("returns true when runner is provided", async () => {
      const p = new HuggingFaceProvider({ runner: mockRunner() });
      expect(await p.isAvailable()).toBe(true);
    });

    it("returns false when runner is not a function", async () => {
      const p = new HuggingFaceProvider(
        {} as { runner: LayoutLMv3OfflineRunner },
      );
      expect(await p.isAvailable()).toBe(false);
    });
  });

  describe("enhance", () => {
    it("returns enhanced result with mapped entities", async () => {
      const runner = mockRunner();
      const p = new HuggingFaceProvider({ runner });
      const result = await p.enhance(dummyRequest());

      expect(result.provider).toBe("huggingface");
      expect(result.confidence).toBeGreaterThanOrEqual(0.5);
      expect(result.response).toBeDefined();
      expect(runner).toHaveBeenCalled();
    });

    it("filters entities below minEntityScore", async () => {
      const runner = mockRunner({
        entities: [
          { entity_group: "INVOICE_NUMBER", word: "12345", score: 0.1 },
          { entity_group: "VENDOR_NAME", word: "TestCorp", score: 0.9 },
        ],
      });
      const p = new HuggingFaceProvider({
        runner,
        minEntityScore: 0.45,
      });
      const result = await p.enhance(dummyRequest());

      // Should only use the high-score entity
      expect(result.response).toBeDefined();
    });

    it("uses ruleBasedConfidence when inference has no confidence", async () => {
      const runner = mockRunner({ confidence: 0 });
      const p = new HuggingFaceProvider({ runner });
      const result = await p.enhance(
        dummyRequest({ ruleBasedConfidence: 0.7 }),
      );

      // Should take max of ruleBasedConfidence and 0
      expect(result.confidence).toBeGreaterThanOrEqual(0.7);
    });

    it("throws AIProviderError when runner fails", async () => {
      const failRunner = jest
        .fn()
        .mockRejectedValue(new Error("model load failed"));
      const p = new HuggingFaceProvider({ runner: failRunner });
      await expect(p.enhance(dummyRequest())).rejects.toThrow(AIProviderError);
    });

    it("passes rawText and documentType to runner", async () => {
      const runner = mockRunner();
      const p = new HuggingFaceProvider({ runner });
      await p.enhance(dummyRequest());

      const call = (runner as jest.Mock).mock.calls[0][0];
      expect(call).toHaveProperty("rawText");
      expect(call).toHaveProperty("documentType");
    });
  });
});
