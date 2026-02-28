/**
 * OpenAIProvider – unit tests (mocked fetch)
 */
import { OpenAIProvider } from "../ai/OpenAIProvider";
import type { AIEnhancementRequest } from "../ai/AIProvider";
import { AIProviderError } from "../ai/AIProvider";

// ─── helpers ──────────────────────────────────────────────────────────────────

function dummyRequest(
  overrides: Partial<AIEnhancementRequest> = {},
): AIEnhancementRequest {
  return {
    rawText: "Invoice #12345\nTotal: $500.00",
    partialResponse: {
      supplier: { name: "Acme", address: {}, contact: {} },
      buyer: { name: "" },
      transaction: { currency: "USD", invoiceNumber: "" },
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

const validKey = "sk-testkey1234";

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("OpenAIProvider", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("has name 'openai'", () => {
    const p = new OpenAIProvider({ apiKey: validKey });
    expect(p.name).toBe("openai");
  });

  describe("isAvailable", () => {
    it("returns true for valid sk- key", async () => {
      const p = new OpenAIProvider({ apiKey: validKey });
      expect(await p.isAvailable()).toBe(true);
    });

    it("returns false for invalid key", async () => {
      const p = new OpenAIProvider({ apiKey: "bad-key" });
      expect(await p.isAvailable()).toBe(false);
    });

    it("returns false for empty key", async () => {
      const p = new OpenAIProvider({ apiKey: "" });
      expect(await p.isAvailable()).toBe(false);
    });
  });

  describe("enhance", () => {
    it("returns enhanced result on success", async () => {
      const responseBody = JSON.stringify({
        transaction: { invoiceNumber: "12345" },
        totals: { grandTotal: 500 },
      });

      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({
          choices: [
            {
              message: {
                content: responseBody,
              },
            },
          ],
        }),
      });

      const p = new OpenAIProvider({ apiKey: validKey });
      const result = await p.enhance(dummyRequest());

      expect(result.provider).toBe("openai");
      expect(result.confidence).toBeGreaterThan(0.5);
      expect(result.response).toBeDefined();
    });

    it("strips markdown code fences from response", async () => {
      const json = JSON.stringify({ totals: { grandTotal: 100 } });
      const wrapped = "```json\n" + json + "\n```";

      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({
          choices: [{ message: { content: wrapped } }],
        }),
      });

      const p = new OpenAIProvider({ apiKey: validKey });
      const result = await p.enhance(dummyRequest());
      expect(result.response).toBeDefined();
    });

    it("throws AIProviderError on non-ok response", async () => {
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
        text: jest.fn().mockResolvedValue("rate limited"),
      });

      const p = new OpenAIProvider({ apiKey: validKey });
      await expect(p.enhance(dummyRequest())).rejects.toThrow(AIProviderError);
    });

    it("throws AIProviderError on network error", async () => {
      globalThis.fetch = jest
        .fn()
        .mockRejectedValue(new TypeError("Failed to fetch"));

      const p = new OpenAIProvider({ apiKey: validKey });
      await expect(p.enhance(dummyRequest())).rejects.toThrow(AIProviderError);
    });

    it("uses custom model and baseUrl", async () => {
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({
          choices: [{ message: { content: "{}" } }],
        }),
      });

      const p = new OpenAIProvider({
        apiKey: validKey,
        model: "gpt-4",
        baseUrl: "https://custom.api.com/v1",
      });
      await p.enhance(dummyRequest());

      const fetchCall = (globalThis.fetch as jest.Mock).mock.calls[0];
      expect(fetchCall[0]).toContain("custom.api.com");
      const body = JSON.parse(fetchCall[1].body);
      expect(body.model).toBe("gpt-4");
    });
  });
});
