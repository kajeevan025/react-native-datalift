
/**
 * DataLift – AI Provider abstraction
 *
 * All AI providers must implement this interface.
 * The AI layer is entirely optional; it only runs when the rule-based
 * engine produces a confidence score below the configured threshold.
 */

import type { DataLiftResponse } from "../schema/DataLiftResponse";

// ─── Context passed to the AI provider ──────────────────────────────────────

export interface AIEnhancementRequest {
  /** Raw OCR text extracted from the image */
  rawText: string;
  /** Partial result already produced by the rule-based parser */
  partialResponse: DataLiftResponse;
  /** Detected document type hint */
  documentType: string;
  /** Confidence score produced by the rule-based engine (0–1) */
  ruleBasedConfidence: number;
}

export interface AIEnhancementResult {
  /** Enhanced, merged response */
  response: DataLiftResponse;
  /** Confidence score after AI enhancement (0–1) */
  confidence: number;
  /** Name of the provider that produced this result */
  provider: string;
}

// ─── Contract ────────────────────────────────────────────────────────────────

export interface AIProvider {
  /** Unique provider identifier */
  readonly name: string;

  /**
   * Enhance a partial DataLiftResponse using AI reasoning.
   * Must return a fully-merged response; never remove existing fields.
   */
  enhance(request: AIEnhancementRequest): Promise<AIEnhancementResult>;

  /** Return `true` if the provider can be used (e.g. API key configured) */
  isAvailable(): Promise<boolean>;
}

// ─── Error ───────────────────────────────────────────────────────────────────

export class AIProviderError extends Error {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly cause?: unknown,
  ) {
    super(`[AI:${provider}] ${message}`);
    this.name = "AIProviderError";
  }
}
