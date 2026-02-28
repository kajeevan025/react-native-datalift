/**
 * DataLift – AI Engine
 *
 * Manages the AI provider registry and invokes the correct provider
 * when the rule-based confidence score is below the threshold.
 */

import type { DataLiftLogger } from "../utils/logger";
import type {
  AIEnhancementRequest,
  AIEnhancementResult,
  AIProvider,
} from "./AIProvider";

// ─── Registry ────────────────────────────────────────────────────────────────

const _registry = new Map<string, AIProvider>();

export function registerAIProvider(provider: AIProvider): void {
  _registry.set(provider.name, provider);
}

export function getAIProvider(name: string): AIProvider | undefined {
  return _registry.get(name);
}

// ─── Engine ──────────────────────────────────────────────────────────────────

export class AIEngine {
  private readonly logger: DataLiftLogger;
  private readonly preferredProvider: string | undefined;

  constructor(logger: DataLiftLogger, preferredProvider?: string) {
    this.logger = logger;
    this.preferredProvider = preferredProvider;
  }

  /**
   * Invoke AI enhancement.
   * Returns `null` when no provider is configured/available.
   */
  async enhance(
    request: AIEnhancementRequest,
  ): Promise<AIEnhancementResult | null> {
    const providerKey = this.preferredProvider ?? this.findFirstAvailable();

    if (!providerKey) {
      this.logger.debug("No AI provider available – skipping AI enhancement");
      return null;
    }

    const provider = _registry.get(providerKey);
    if (!provider) {
      this.logger.warn(`AI provider '${providerKey}' not registered`);
      return null;
    }

    try {
      const available = await provider.isAvailable();
      if (!available) {
        this.logger.warn(`AI provider '${providerKey}' reported unavailable`);
        return null;
      }

      this.logger.info(`Running AI enhancement with provider: ${providerKey}`);
      const result = await provider.enhance(request);
      this.logger.debug(
        `AI enhancement complete – new confidence: ${(result.confidence * 100).toFixed(0)}%`,
      );
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`AI provider '${providerKey}' failed: ${msg}`);
      // AI failure is non-fatal – return null so caller uses rule-based result
      return null;
    }
  }

  private findFirstAvailable(): string | undefined {
    // Return the first registered provider (insertion order)
    const keys = Array.from(_registry.keys());
    return keys.length > 0 ? keys[0] : undefined;
  }
}
