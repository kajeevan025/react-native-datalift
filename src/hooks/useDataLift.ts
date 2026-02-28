/**
 * useDataLift Hook
 *
 * Custom React hook for programmatic document processing and OCR.
 * Provides methods to process images, extract text, classify documents,
 * and manage processing state.
 *
 * @example
 * ```tsx
 * const { processImage, loading, results } = useDataLift({
 *   language: 'eng',
 *   enableDebug: true,
 * });
 *
 * const result = await processImage(imageUri);
 * console.log('OCR Result:', result);
 * ```
 */

import { useState, useCallback, useMemo } from "react";
import { launchCamera, launchImageLibrary } from "react-native-image-picker";
import { DataLift } from "../NativeDataLift";
import { DataLiftSDK } from "../core/DataLift";
import { DocumentProcessor } from "../utils/DocumentProcessor";
import { DocumentScanResult, ImageQuality, DataLiftError } from "../types";

/**
 * Internal type for raw untyped native module JSON data.
 * We use `any` here intentionally — native modules return loosely-typed JSON
 * that is validated and mapped to strict `DataLiftResponse` types at the boundary.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RawRecord = Record<string, any>;

// ============================================================================
// TYPES
// ============================================================================

export interface UseDataLiftOptions {
  /** OCR language code (e.g., 'eng', 'spa', 'fra') */
  language?: string;
  /** Minimum confidence threshold for classification (0-1) */
  confidenceThreshold?: number;
  /** Enable debug logging */
  enableDebug?: boolean;
  /** Operation timeout in milliseconds */
  timeout?: number;
  /** Native model file path for plugin-owned LayoutLMv3 inference */
  layoutLMv3ModelPath?: string;
  /** Optional labels file path used by native inference */
  layoutLMv3LabelsPath?: string;
  /** Local model directory passed to the offline runner */
  layoutLMv3ModelDir?: string;
  /** Optional alias for local model path/name (same purpose as layoutLMv3ModelDir) */
  layoutLMv3Model?: string;
  /** If true, throw when LayoutLMv3 is not configured or fails */
  requireLayoutLMv3?: boolean;
}

export interface UseDataLiftResult {
  /** Process a single image and return OCR result */
  processImage: (
    uri: string,
    options?: ProcessImageOptions,
  ) => Promise<DocumentScanResult>;
  /** Process multiple images in parallel */
  processMultipleImages: (
    uris: string[],
    options?: ProcessImageOptions,
  ) => Promise<DocumentScanResult[]>;
  /** Classify a document without OCR */
  classifyDocument: (
    uri: string,
  ) => Promise<{ type: string; confidence: number }>;
  /** Extract text from image */
  extractText: (uri: string) => Promise<string>;
  /** Extract invoice-style JSON schema from image */
  extractInvoiceSchema: (
    imageInput: string | string[],
    fileNames?: string[],
  ) => Promise<RawRecord>;
  /** Launch camera and process image */
  captureAndProcess: (
    options?: CaptureOptions,
  ) => Promise<DocumentScanResult | null>;
  /** Pick from gallery and process */
  pickAndProcess: (options?: PickOptions) => Promise<DocumentScanResult[]>;
  /** Current processing state */
  loading: boolean;
  /** Progress percentage (0-100) */
  progress: number;
  /** Latest results */
  results: DocumentScanResult[];
  /** Any errors that occurred */
  error: Error | null;
  /** Clear results and errors */
  reset: () => void;
}

interface ProcessImageOptions {
  documentType?: string;
}

interface CaptureOptions {
  quality?: ImageQuality;
  documentType?: string;
}

interface PickOptions {
  multiple?: boolean;
  maxImages?: number;
  documentType?: string;
}

// ============================================================================
// HOOK IMPLEMENTATION
// ============================================================================

/**
 * Core hook for programmatic document processing.
 *
 * Use this hook when you want full control over the UI and just need
 * the processing logic. Returns methods to process images, extract text,
 * classify documents, and manage state.
 */
export const useDataLift = (
  options: UseDataLiftOptions = {},
): UseDataLiftResult => {
  const {
    language = "eng",
    confidenceThreshold = 0.7,
    enableDebug = false,
    timeout = 30000,
    layoutLMv3ModelPath,
    layoutLMv3LabelsPath,
    layoutLMv3ModelDir,
    layoutLMv3Model,
    requireLayoutLMv3 = true,
  } = options;

  // State management
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<DocumentScanResult[]>([]);
  const [error, setError] = useState<Error | null>(null);

  // Create processor instance (memoized)
  const processor = useMemo(
    () =>
      new DocumentProcessor({
        language,
        confidenceThreshold,
        enableDebug,
      }),
    [language, confidenceThreshold, enableDebug],
  );

  // ============================================================================
  // CORE PROCESSING METHODS
  // ============================================================================

  /**
   * Process a single image with OCR and classification
   */
  const processImage = useCallback(
    async (
      uri: string,
      processOptions?: ProcessImageOptions,
    ): Promise<DocumentScanResult> => {
      setLoading(true);
      setProgress(0);
      setError(null);

      try {
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new DataLiftError("Processing timeout exceeded", "TIMEOUT"),
              ),
            timeout,
          ),
        );

        setProgress(30);

        const result = (await Promise.race([
          processor.processImage({
            uri,
            documentType: processOptions?.documentType,
            confidence: confidenceThreshold,
          }),
          timeoutPromise,
        ])) as DocumentScanResult;

        setProgress(100);
        setResults((prev) => [...prev, result]);
        return result;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        throw error;
      } finally {
        setLoading(false);
        setProgress(0);
      }
    },
    [processor, confidenceThreshold, timeout],
  );

  /**
   * Process multiple images in parallel
   */
  const processMultipleImages = useCallback(
    async (
      uris: string[],
      processOptions?: ProcessImageOptions,
    ): Promise<DocumentScanResult[]> => {
      setLoading(true);
      setProgress(0);
      setError(null);

      try {
        const promises = uris.map((uri, index) =>
          processor
            .processImage({
              uri,
              documentType: processOptions?.documentType,
              confidence: confidenceThreshold,
            })
            .then((result) => {
              setProgress(((index + 1) / uris.length) * 100);
              return result;
            }),
        );

        const allResults = await Promise.all(promises);
        setResults((prev) => [...prev, ...allResults]);
        return allResults;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        throw error;
      } finally {
        setLoading(false);
        setProgress(0);
      }
    },
    [processor, confidenceThreshold],
  );

  /**
   * Classify document type without full OCR.
   * Calls the native module directly for fast classification.
   */
  const classifyDocument = useCallback(
    async (uri: string): Promise<{ type: string; confidence: number }> => {
      setLoading(true);
      setError(null);
      try {
        const result = await DataLift.classifyDocument({ uri });
        return { type: result.type, confidence: result.confidence };
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        throw error;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  /**
   * Extract raw OCR text from an image (no classification or structured data).
   */
  const extractText = useCallback(
    async (uri: string): Promise<string> => {
      setLoading(true);
      setError(null);
      try {
        const result = await DataLift.extractTextNative({ uri, language });
        return result.text || "";
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        throw error;
      } finally {
        setLoading(false);
      }
    },
    [language],
  );

  /**
   * Extract invoice schema JSON directly from the native plugin.
   */
  const extractInvoiceSchema = useCallback(
    async (
      imageInput: string | string[],
      fileNames?: string[],
    ): Promise<RawRecord> => {
      setLoading(true);
      setError(null);
      try {
        return await DataLiftSDK.extractUnifiedSchema({
          imageInput,
          fileNames,
          language,
          layoutLMv3ModelPath,
          layoutLMv3LabelsPath,
          layoutLMv3ModelDir,
          layoutLMv3Model,
          requireLayoutLMv3,
        });
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        throw error;
      } finally {
        setLoading(false);
      }
    },
    [
      language,
      layoutLMv3LabelsPath,
      layoutLMv3ModelPath,
      layoutLMv3Model,
      layoutLMv3ModelDir,
      requireLayoutLMv3,
    ],
  );

  // ============================================================================
  // CAMERA & GALLERY INTEGRATIONS
  // ============================================================================

  /**
   * Launch camera, capture image, and process it automatically
   */
  const captureAndProcess = useCallback(
    async (
      captureOptions?: CaptureOptions,
    ): Promise<DocumentScanResult | null> => {
      return new Promise((resolve) => {
        launchCamera(
          {
            mediaType: "photo",
            cameraType: "back",
            quality: captureOptions?.quality === ImageQuality.HIGH ? 1 : 0.7,
          },
          async (response) => {
            if (response.didCancel) {
              resolve(null);
              return;
            }
            if (response.errorCode) {
              const err = new DataLiftError(
                response.errorMessage || "Camera error",
                `CAMERA_${response.errorCode}`,
              );
              setError(err);
              resolve(null);
              return;
            }
            if (response.assets && response.assets.length > 0) {
              const imageUri = response.assets[0].uri;
              if (imageUri) {
                try {
                  const result = await processImage(imageUri, {
                    documentType: captureOptions?.documentType,
                  });
                  resolve(result);
                } catch (err) {
                  resolve(null);
                }
              }
            }
            resolve(null);
          },
        );
      });
    },
    [processImage],
  );

  /**
   * Pick images from gallery and process them
   */
  const pickAndProcess = useCallback(
    async (pickOptions?: PickOptions): Promise<DocumentScanResult[]> => {
      return new Promise((resolve) => {
        launchImageLibrary(
          {
            mediaType: "photo",
            selectionLimit: pickOptions?.multiple
              ? pickOptions.maxImages || 10
              : 1,
          },
          async (response) => {
            if (response.didCancel) {
              resolve([]);
              return;
            }
            if (response.errorCode) {
              const err = new DataLiftError(
                response.errorMessage || "Gallery error",
                `GALLERY_${response.errorCode}`,
              );
              setError(err);
              resolve([]);
              return;
            }
            if (response.assets && response.assets.length > 0) {
              try {
                const uris = response.assets
                  .map((asset) => asset.uri)
                  .filter((uri): uri is string => !!uri);
                const allResults = await processMultipleImages(uris, {
                  documentType: pickOptions?.documentType,
                });
                resolve(allResults);
              } catch (err) {
                resolve([]);
              }
            }
            resolve([]);
          },
        );
      });
    },
    [processMultipleImages],
  );

  /**
   * Reset all state (results, errors, progress)
   */
  const reset = useCallback(() => {
    setResults([]);
    setError(null);
    setProgress(0);
    setLoading(false);
  }, []);

  // ============================================================================
  // RETURN API
  // ============================================================================

  return {
    // Core methods
    processImage,
    processMultipleImages,
    classifyDocument,
    extractText,
    extractInvoiceSchema,

    // Convenience methods
    captureAndProcess,
    pickAndProcess,

    // State
    loading,
    progress,
    results,
    error,

    // Actions
    reset,
  };
};
