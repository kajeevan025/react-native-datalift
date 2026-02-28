
/**
 * DataLift – OpenAI AI Enhancement Provider
 *
 * Optional provider that uses GPT-3.5 / GPT-4 to fill in fields
 * that the rule-based engine could not confidently extract.
 *
 * Configuration:
 *   new OpenAIProvider({ apiKey: "sk-...", model: "gpt-4o-mini" })
 *
 * The provider makes a single structured completion call, asking GPT
 * to return a JSON object that maps to the missing DataLift fields.
 */

import type {
  AIEnhancementRequest,
  AIEnhancementResult,
  AIProvider,
} from "./AIProvider";
import { AIProviderError } from "./AIProvider";
import type { DataLiftResponse } from "../schema/DataLiftResponse";

// ─── Config ──────────────────────────────────────────────────────────────────

export interface OpenAIProviderConfig {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
}

// ─── System prompt template ──────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a document-data extraction specialist.
Given raw OCR text from a business document and a partially-filled JSON structure,
complete the missing fields with high accuracy.

Rules:
- Only return valid JSON. No extra prose.
- Do NOT remove or change existing non-null/non-empty values.
- Map monetary strings to numbers (e.g. "$1,234.56" → 1234.56).
- If a field cannot be determined from the text return null.
- Dates must be in ISO-8601 format (YYYY-MM-DD).
- The JSON must conform exactly to the provided schema.`;

// ─── Implementation ──────────────────────────────────────────────────────────

export class OpenAIProvider implements AIProvider {
  readonly name = "openai";
  private readonly config: Required<OpenAIProviderConfig>;

  constructor(config: OpenAIProviderConfig) {
    this.config = {
      model: "gpt-4o-mini",
      baseUrl: "https://api.openai.com/v1",
      timeoutMs: 30_000,
      ...config,
    };
  }

  async isAvailable(): Promise<boolean> {
    return (
      typeof this.config.apiKey === "string" &&
      this.config.apiKey.startsWith("sk-")
    );
  }

  async enhance(request: AIEnhancementRequest): Promise<AIEnhancementResult> {
    const userPrompt = this.buildPrompt(request);

    let responseText: string;
    try {
      responseText = await this.callAPI(userPrompt);
    } catch (err) {
      throw new AIProviderError(
        `API call failed: ${err instanceof Error ? err.message : String(err)}`,
        this.name,
        err,
      );
    }

    let parsed: Partial<DataLiftResponse>;
    try {
      // Strip markdown code fences if present
      const clean = responseText
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```\s*$/, "")
        .trim();
      parsed = JSON.parse(clean) as Partial<DataLiftResponse>;
    } catch (err) {
      throw new AIProviderError(
        "Failed to parse AI response as JSON",
        this.name,
        err,
      );
    }

    const merged = this.deepMerge(request.partialResponse, parsed);
    return {
      response: merged,
      confidence: Math.min(request.ruleBasedConfidence + 0.2, 0.98),
      provider: this.name,
    };
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private buildPrompt(req: AIEnhancementRequest): string {
    return [
      `Document type: ${req.documentType}`,
      `Current confidence: ${(req.ruleBasedConfidence * 100).toFixed(0)}%`,
      ``,
      `=== RAW OCR TEXT ===`,
      req.rawText.slice(0, 6000), // token guard
      ``,
      `=== PARTIALLY EXTRACTED DATA ===`,
      JSON.stringify(req.partialResponse, null, 2).slice(0, 3000),
      ``,
      `=== TASK ===`,
      `Complete the missing fields and return the full JSON object.`,
    ].join("\n");
  }

  private async callAPI(userPrompt: string): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userPrompt },
          ],
          temperature: 0,
          response_format: { type: "json_object" },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(`HTTP ${response.status}: ${body}`);
      }

      const data = (await response.json()) as {
        choices: Array<{ message: { content: string } }>;
      };
      return data.choices[0]?.message?.content ?? "{}";
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Deep-merge: src values only fill in when target value is null/undefined/"".
   */
  private deepMerge(
    target: DataLiftResponse,
    src: Partial<DataLiftResponse>,
  ): DataLiftResponse {
    const result = JSON.parse(JSON.stringify(target)) as DataLiftResponse;

    for (const key of Object.keys(src) as Array<keyof DataLiftResponse>) {
      const srcVal = src[key];
      const tgtVal = result[key];

      if (srcVal === null || srcVal === undefined) continue;

      const resultUnknown = result as unknown as Record<string, unknown>;
      if (
        typeof srcVal === "object" &&
        !Array.isArray(srcVal) &&
        typeof tgtVal === "object" &&
        tgtVal !== null
      ) {
        // Recursively merge nested objects
        resultUnknown[key] = this.mergeObjects(
          tgtVal as Record<string, unknown>,
          srcVal as Record<string, unknown>,
        );
      } else if (Array.isArray(srcVal) && Array.isArray(tgtVal)) {
        // Prefer the longer array (more extracted items)
        resultUnknown[key] = srcVal.length > tgtVal.length ? srcVal : tgtVal;
      } else if (tgtVal === null || tgtVal === undefined || tgtVal === "") {
        resultUnknown[key] = srcVal;
      }
    }

    return result;
  }

  private mergeObjects(
    target: Record<string, unknown>,
    src: Record<string, unknown>,
  ): Record<string, unknown> {
    const result = { ...target };
    for (const k of Object.keys(src)) {
      if (result[k] === null || result[k] === undefined || result[k] === "") {
        result[k] = src[k];
      }
    }
    return result;
  }
}
