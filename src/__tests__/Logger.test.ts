/**
 * Logger – unit tests
 */
import { createLogger, silentLogger } from "../utils/logger";

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("createLogger", () => {
  let consoleSpy: {
    log: jest.SpyInstance;
    info: jest.SpyInstance;
    warn: jest.SpyInstance;
    error: jest.SpyInstance;
  };

  beforeEach(() => {
    consoleSpy = {
      log: jest.spyOn(console, "log").mockImplementation(),
      info: jest.spyOn(console, "info").mockImplementation(),
      warn: jest.spyOn(console, "warn").mockImplementation(),
      error: jest.spyOn(console, "error").mockImplementation(),
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("with debug enabled", () => {
    it("logs debug messages", () => {
      const logger = createLogger(true);
      logger.debug("test debug");
      expect(consoleSpy.log).toHaveBeenCalledTimes(1);
      expect(consoleSpy.log.mock.calls[0][0]).toContain("[DataLift]");
      expect(consoleSpy.log.mock.calls[0][0]).toContain("[DEBUG]");
      expect(consoleSpy.log.mock.calls[0][0]).toContain("test debug");
    });

    it("logs info messages", () => {
      const logger = createLogger(true);
      logger.info("test info");
      expect(consoleSpy.info).toHaveBeenCalledTimes(1);
      expect(consoleSpy.info.mock.calls[0][0]).toContain("[INFO]");
    });
  });

  describe("with debug disabled (default)", () => {
    it("suppresses debug messages", () => {
      const logger = createLogger();
      logger.debug("should not appear");
      expect(consoleSpy.log).not.toHaveBeenCalled();
    });

    it("suppresses info messages", () => {
      const logger = createLogger(false);
      logger.info("should not appear");
      expect(consoleSpy.info).not.toHaveBeenCalled();
    });

    it("still logs warnings", () => {
      const logger = createLogger(false);
      logger.warn("important warning");
      expect(consoleSpy.warn).toHaveBeenCalledTimes(1);
    });

    it("still logs errors", () => {
      const logger = createLogger(false);
      logger.error("critical error");
      expect(consoleSpy.error).toHaveBeenCalledTimes(1);
    });
  });

  describe("output format", () => {
    it("includes [DataLift] prefix and level", () => {
      const logger = createLogger(true);
      logger.debug("hello");
      const output = consoleSpy.log.mock.calls[0][0] as string;
      expect(output).toMatch(/^\[DataLift\]\[DEBUG\]\[.+\] hello$/);
    });

    it("includes ISO timestamp", () => {
      const logger = createLogger(true);
      logger.debug("ts check");
      const output = consoleSpy.log.mock.calls[0][0] as string;
      // ISO format: YYYY-MM-DDTHH:MM:SS
      expect(output).toMatch(/\d{4}-\d{2}-\d{2}T/);
    });

    it("forwards extra args", () => {
      const logger = createLogger(true);
      const extra = { key: "value" };
      logger.debug("with extra", extra);
      expect(consoleSpy.log).toHaveBeenCalledWith(expect.any(String), extra);
    });
  });
});

describe("silentLogger", () => {
  it("is defined and has all methods", () => {
    expect(silentLogger).toBeDefined();
    expect(typeof silentLogger.debug).toBe("function");
    expect(typeof silentLogger.info).toBe("function");
    expect(typeof silentLogger.warn).toBe("function");
    expect(typeof silentLogger.error).toBe("function");
  });

  it("suppresses debug and info", () => {
    const spy = jest.spyOn(console, "log").mockImplementation();
    silentLogger.debug("no output");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
