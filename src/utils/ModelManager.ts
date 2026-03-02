/**
 * DataLift – ModelManager
 *
 * Handles the full lifecycle of the on-device LayoutLMv3 model:
 *   1. Checks if the model is already present in app storage or bundle
 *   2. Auto-downloads from GitHub Releases when requested
 *   3. Returns resolved { modelPath, labelsPath } ready for configureLayoutLMv3()
 *
 * The model files are hosted as release assets on:
 *   https://github.com/kajeevan025/react-native-datalift/releases
 *
 * iOS  uses a CoreML compiled model  (.mlpackage)
 * Android uses a quantized ONNX model (.onnx)
 */

import { Platform } from "react-native";
import { DataLift as NativeDataLift } from "../NativeDataLift";

// ─── Model release metadata ───────────────────────────────────────────────────

/** The model asset release tag on GitHub Releases. Update this when re-exporting the model. */
export const MODEL_ASSET_TAG = "models-v1";

const RELEASE_BASE = `https://github.com/kajeevan025/react-native-datalift/releases/download/${MODEL_ASSET_TAG}`;

/**
 * Default remote URLs for each platform.
 * The iOS model is a CoreML `.mlpackage` compiled for token classification.
 * The Android model is an int8-quantized ONNX model.
 */
export const MODEL_URLS = {
  ios: {
    model: `${RELEASE_BASE}/layoutlmv3-base-doc-coreml.mlpackage.zip`,
    labels: `${RELEASE_BASE}/labels.json`,
    vocab: `${RELEASE_BASE}/vocab.json`,
  },
  android: {
    model: `${RELEASE_BASE}/layoutlmv3-base-doc-android.onnx`,
    labels: `${RELEASE_BASE}/labels.json`,
    vocab: `${RELEASE_BASE}/vocab.json`,
  },
} as const;

/** Local filenames inside the storage directory */
const MODEL_FILE_NAMES = {
  ios: {
    model: "layoutlmv3-base-doc-coreml.mlpackage",
    labels: "labels.json",
    vocab: "vocab.json",
  },
  android: {
    model: "layoutlmv3-base-doc-android.onnx",
    labels: "labels.json",
    vocab: "vocab.json",
  },
} as const;

// ─── Public types ─────────────────────────────────────────────────────────────

export interface ModelPaths {
  /** Absolute path to the model file (CoreML .mlpackage on iOS, .onnx on Android) */
  modelPath: string;
  /** Absolute path to the labels.json file */
  labelsPath?: string;
  /** How the model was found – "bundle" (shipped in app), "storage" (already downloaded), "downloaded" (just fetched) */
  source: "bundle" | "storage" | "downloaded";
}

export interface ModelDownloadProgress {
  /** Which file is currently downloading */
  fileName: string;
  /** Bytes received so far */
  bytesReceived: number;
  /** Total file size in bytes (−1 if unknown) */
  totalBytes: number;
  /** Fraction complete, 0–1 */
  progress: number;
}

export type ModelDownloadProgressCallback = (p: ModelDownloadProgress) => void;

export interface EnsureModelOptions {
  /**
   * When true, files are automatically downloaded to local storage
   * if they are not already present.
   * @default false
   */
  autoDownload?: boolean;

  /**
   * Optional progress callback. Called multiple times during download.
   */
  onProgress?: ModelDownloadProgressCallback;

  /**
   * Override the remote URLs used for downloading.
   * Useful for air-gapped environments or private model servers.
   */
  modelUrls?: Partial<{
    model: string;
    labels: string;
    vocab: string;
  }>;
}

// ─── ModelManager ─────────────────────────────────────────────────────────────

export class ModelManager {
  private _storageDir: string | null = null;

  /**
   * Returns (and caches) the platform storage directory for model files.
   * The directory is created by the native layer if it does not exist.
   */
  async getStorageDir(): Promise<string> {
    if (this._storageDir) return this._storageDir;
    const result = await NativeDataLift.getModelStorageDir();
    this._storageDir = result.path;
    return this._storageDir;
  }

  /**
   * Scans the platform storage directory for already-downloaded model files.
   * Returns `null` when no model is found there.
   */
  async getStoredModelPaths(): Promise<ModelPaths | null> {
    try {
      const dir = await this.getStorageDir();
      const platform = Platform.OS === "ios" ? "ios" : "android";
      const names = MODEL_FILE_NAMES[platform];

      const modelPath = `${dir}/${names.model}`;
      const labelsPath = `${dir}/${names.labels}`;

      // Probe via a lightweight checkLayoutLMv3Compatibility call
      const probe = await NativeDataLift.checkLayoutLMv3Compatibility({
        model_path: modelPath,
        labels_path: labelsPath,
      });

      if (!probe.checks.model_file) return null;

      return {
        modelPath: probe.model_path ?? modelPath,
        labelsPath: probe.checks.labels_file
          ? (probe.labels_path ?? labelsPath)
          : undefined,
        source: "storage",
      };
    } catch {
      return null;
    }
  }

  /**
   * Downloads all required model files to the platform storage directory.
   *
   * Files downloaded (in order):
   *   1. labels.json (tiny – needed for class decoding)
   *   2. vocab.json  (small – needed for tokeniser)
   *   3. model file  (large – CoreML / ONNX)
   *
   * @throws when the native download fails (network error, disk full, etc.)
   */
  async downloadModel(
    onProgress?: ModelDownloadProgressCallback,
    customUrls?: EnsureModelOptions["modelUrls"],
  ): Promise<ModelPaths> {
    const dir = await this.getStorageDir();
    const platform = Platform.OS === "ios" ? "ios" : "android";
    const urls = { ...MODEL_URLS[platform], ...customUrls };
    const names = MODEL_FILE_NAMES[platform];

    const download = async (
      url: string,
      fileName: string,
      isBig = false,
    ): Promise<string> => {
      const destination = `${dir}/${fileName}`;

      if (onProgress) {
        onProgress({
          fileName,
          bytesReceived: 0,
          totalBytes: isBig ? -1 : 0,
          progress: 0,
        });
      }

      const result = await NativeDataLift.downloadModelFile({
        url,
        destination,
      });

      if (onProgress) {
        onProgress({
          fileName,
          bytesReceived: result.bytes,
          totalBytes: result.bytes,
          progress: 1,
        });
      }

      return result.path;
    };

    // Order: labels → vocab → model (so small files arrive first; model last)
    const labelsPath = await download(urls.labels, names.labels);
    await download(urls.vocab, names.vocab);
    const modelPath = await download(urls.model, names.model, true);

    return { modelPath, labelsPath, source: "downloaded" };
  }

  /**
   * High-level entry point.
   *
   * 1. Returns already-stored paths if the model is present.
   * 2. If not present and `autoDownload` is true, downloads the model.
   * 3. Otherwise returns `null` (model unavailable – caller should skip LayoutLMv3).
   */
  async ensureModel(
    options: EnsureModelOptions = {},
  ): Promise<ModelPaths | null> {
    // Already in storage?
    const stored = await this.getStoredModelPaths();
    if (stored) return stored;

    if (!options.autoDownload) return null;

    return this.downloadModel(options.onProgress, options.modelUrls);
  }
}

/** Singleton instance — reused across calls to avoid repeated directory probes. */
export const defaultModelManager = new ModelManager();
