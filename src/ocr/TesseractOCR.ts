/**
 * DataLift – Tesseract.js OCR Provider
 *
 * Fully offline, cross-platform OCR using Tesseract.js.
 * Works in Node.js, web browsers and Expo bare workflow with
 * react-native-tesseract-text.
 *
 * Usage note: Tesseract.js is a PEER dependency.
 * Add it to your project: `npm install tesseract.js`
 * or for React Native: `npm install @nozbe/react-native-tesseract-text`
 */

import type { OCROptions, OCRProvider, OCRResult } from "./OCRProvider";
import { OCRError } from "./OCRProvider";

// ─── Tesseract.js lazy type shim (avoids hard compile-time dependency) ───────

interface TesseractWorker {
  loadLanguage(lang: string): Promise<void>;
  initialize(lang: string): Promise<void>;
  recognize(
    image: string,
  ): Promise<{ data: { text: string; confidence: number } }>;
  terminate(): Promise<void>;
}

interface TesseractModule {
  createWorker(options?: Record<string, unknown>): Promise<TesseractWorker>;
}

function getTesseract(): TesseractModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require("tesseract.js") as TesseractModule;
  } catch {
    try {
      // React Native variant
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      return require("@nozbe/react-native-tesseract-text") as TesseractModule;
    } catch {
      return null;
    }
  }
}

// ─── Implementation ──────────────────────────────────────────────────────────

export class TesseractOCR implements OCRProvider {
  readonly name = "tesseract";
  // Per-language worker cache — avoids re-loading language data on every call
  private _worker: TesseractWorker | null = null;
  private _workerLang: string | null = null;

  async isAvailable(): Promise<boolean> {
    return getTesseract() !== null;
  }

  async extractText(options: OCROptions): Promise<OCRResult> {
    const Tesseract = getTesseract();
    if (!Tesseract) {
      throw new OCRError(
        "tesseract.js is not installed. Run: npm install tesseract.js",
        this.name,
      );
    }

    const lang = this.normaliseLang(options.language ?? "en");

    // Reuse the cached worker when the language is unchanged
    if (!this._worker || this._workerLang !== lang) {
      if (this._worker) {
        await this._worker.terminate().catch(() => undefined);
        this._worker = null;
        this._workerLang = null;
      }
      const w = await Tesseract.createWorker({ logger: () => undefined });
      await w.loadLanguage(lang);
      await w.initialize(lang);
      this._worker = w;
      this._workerLang = lang;
    }

    try {
      const {
        data: { text, confidence },
      } = await this._worker.recognize(options.imageData);

      const lines = text.split("\n").filter((l) => l.trim().length > 0);

      return {
        text: text.trim(),
        confidence: confidence / 100, // Tesseract returns 0–100
        lineCount: lines.length,
        provider: this.name,
      };
    } catch (err) {
      // Invalidate the cached worker on error so it's rebuilt on next call
      await this._worker.terminate().catch(() => undefined);
      this._worker = null;
      this._workerLang = null;
      throw new OCRError(
        `Tesseract recognition failed: ${err instanceof Error ? err.message : String(err)}`,
        this.name,
        err,
      );
    }
  }

  /** Convert BCP-47 "en" → Tesseract "eng" */
  private normaliseLang(lang: string): string {
    const map: Record<string, string> = {
      en: "eng",
      fr: "fra",
      de: "deu",
      es: "spa",
      pt: "por",
      it: "ita",
      nl: "nld",
      ja: "jpn",
      zh: "chi_sim",
      "zh-tw": "chi_tra",
      ko: "kor",
      ar: "ara",
      hi: "hin",
      ru: "rus",
      pl: "pol",
      sv: "swe",
      da: "dan",
      no: "nor",
      fi: "fin",
      tr: "tur",
      th: "tha",
      vi: "vie",
      uk: "ukr",
      cs: "ces",
      ro: "ron",
      hu: "hun",
      el: "ell",
      he: "heb",
    };
    const lower = lang.toLowerCase();
    const mapped = map[lower];
    if (!mapped && lower.length > 0) {
      console.warn(
        `[DataLift/TesseractOCR] Language code '${lang}' not in language map; ` +
          `passing raw to Tesseract. Ensure the language data file is available.`,
      );
    }
    return mapped ?? lower;
  }
}
