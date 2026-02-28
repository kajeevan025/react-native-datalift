
/**
 * DataLift – Lightweight, zero-dependency logger
 *
 * Respects the `debug` flag passed in options and never throws.
 * Works in both React Native and Node environments.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface DataLiftLogger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

const PREFIX = "[DataLift]";

function timestamp(): string {
  try {
    return new Date().toISOString();
  } catch {
    return "";
  }
}

/**
 * Create a logger instance.
 *
 * @param enabled – when false (default) only warnings/errors are printed.
 */
export function createLogger(enabled: boolean = false): DataLiftLogger {
  function fmt(level: LogLevel, message: string): string {
    return `${PREFIX}[${level.toUpperCase()}][${timestamp()}] ${message}`;
  }

  return {
    debug(message: string, ...args: unknown[]): void {
      if (!enabled) return;
      // eslint-disable-next-line no-console
      console.log(fmt("debug", message), ...args);
    },
    info(message: string, ...args: unknown[]): void {
      if (!enabled) return;
      // eslint-disable-next-line no-console
      console.info(fmt("info", message), ...args);
    },
    warn(message: string, ...args: unknown[]): void {
      // eslint-disable-next-line no-console
      console.warn(fmt("warn", message), ...args);
    },
    error(message: string, ...args: unknown[]): void {
      // eslint-disable-next-line no-console
      console.error(fmt("error", message), ...args);
    },
  };
}

/** Shared no-op logger (used when debug is off) */
export const silentLogger: DataLiftLogger = createLogger(false);
