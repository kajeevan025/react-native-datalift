/**
 * Native module interface for DataLift
 *
 * Supports both New Architecture (TurboModules) and Old Architecture (Bridge).
 * Compatible with React Native 0.70+, including RN 0.76 new architecture.
 *
 * IMPORTANT: This file does NOT throw at import time.
 * If the native module is not linked, a safe Proxy is returned that rejects
 * each method call with a descriptive error — preventing startup crashes.
 */
import { NativeModules, Platform } from "react-native";

const LINKING_ERROR =
  `The package 'react-native-datalift' doesn't seem to be linked.\n\n` +
  `Make sure:\n` +
  Platform.select({ ios: "• Run 'cd ios && pod install'\n", default: "" }) +
  "• Run a full clean build of your app\n" +
  "• The native module is properly linked\n" +
  "• Restart Metro bundler after linking";

// ─── Strongly-typed native interface ─────────────────────────────────────────

export interface DataLiftNativeInterface {
  classifyDocument(options: {
    uri: string;
    text?: string;
  }): Promise<{ type: string; confidence: number }>;

  extractTextNative(options: {
    uri: string;
    language?: string;
  }): Promise<{ text: string; lineCount: number; confidence?: number }>;

  extractPDFPages(options: {
    uri: string;
    pages?: number[];
  }): Promise<Array<{ uri: string }>>;

  extractInvoiceSchema(options: {
    uri?: string;
    uris?: string[];
    file_names?: string[];
    language?: string;
    model_path?: string;
    labels_path?: string;
    require_model_prediction?: boolean;
  }): Promise<Record<string, unknown>>;

  configureLayoutLMv3(options: {
    model_path: string;
    labels_path?: string;
  }): Promise<{ configured: boolean; model_path: string }>;

  predictLayoutLMv3(options: {
    raw_text: string;
    uris?: string[];
    language?: string;
    model_path?: string;
    labels_path?: string;
  }): Promise<{
    used: boolean;
    runtime: string;
    model_path?: string;
    confidence?: number;
    fields?: Record<string, unknown>;
    warnings?: string[];
  }>;

  checkLayoutLMv3Compatibility(options: {
    model_path?: string;
    labels_path?: string;
  }): Promise<{
    compatible: boolean;
    runtime?: string;
    model_path?: string;
    labels_path?: string;
    checks: {
      model_file: boolean;
      labels_file: boolean;
      label_map: boolean;
      inference: boolean;
    };
    warnings?: string[];
    error?: string;
  }>;
}

// ─── Safe module resolution (never throws at import time) ────────────────────

function resolveNativeModule(): DataLiftNativeInterface | null {
  // 1. New Architecture — TurboModuleRegistry (public API, RN 0.70+)
  try {
    const { TurboModuleRegistry } = require("react-native") as {
      TurboModuleRegistry: { get<T>(name: string): T | null } | undefined;
    };
    if (TurboModuleRegistry && typeof TurboModuleRegistry.get === "function") {
      const turbo =
        TurboModuleRegistry.get<DataLiftNativeInterface>("DataLift");
      if (turbo) return turbo;
    }
  } catch (_) {
    // Not available — fall through to old bridge
  }

  // 2. Old Architecture — Legacy NativeModules bridge
  if (NativeModules.DataLift) {
    return NativeModules.DataLift as DataLiftNativeInterface;
  }

  return null;
}

const _nativeModule = resolveNativeModule();

/**
 * DataLift native module accessor.
 *
 * When the native module is not linked, every method returns a rejected
 * Promise with an actionable message rather than crashing the app.
 */
export const DataLift: DataLiftNativeInterface =
  _nativeModule ??
  new Proxy({} as DataLiftNativeInterface, {
    get(_target, prop: string) {
      return () =>
        Promise.reject(
          new Error(
            `[DataLift] '${prop}' — native module not linked.\n${LINKING_ERROR}`,
          ),
        );
    },
  });

/** True when the native module is available and properly linked */
export const isDataLiftAvailable: boolean = _nativeModule !== null;
