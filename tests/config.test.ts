import { describe, expect, it } from "vitest";
import { DEFAULT_TYPE_MS, DEFAULT_WORD, parseConfig } from "../src/config";

describe("parseConfig", () => {
  it("uses defaults for empty options", () => {
    const config = parseConfig(undefined);
    expect(config).toEqual({
      enabled: true,
      mode: "window",
      word: DEFAULT_WORD,
      typeMs: DEFAULT_TYPE_MS,
      position: "bottom-right",
      freshSeconds: 20,
      idleSeconds: 25,
      shellPath: null,
    });
  });

  it("accepts the tray mode", () => {
    expect(parseConfig({ mode: "tray" }).mode).toBe("tray");
    expect(parseConfig({ mode: "nonsense" }).mode).toBe("window");
  });

  it("clamps numbers and rejects junk", () => {
    expect(parseConfig({ typeMs: 5 }).typeMs).toBe(40);
    expect(parseConfig({ typeMs: 99_999 }).typeMs).toBe(2000);
    expect(parseConfig({ typeMs: "fast" }).typeMs).toBe(DEFAULT_TYPE_MS);
    expect(parseConfig({ idleSeconds: 1 }).idleSeconds).toBe(5);
  });

  it("trims the word and falls back when it is empty", () => {
    expect(parseConfig({ word: "  hello  " }).word).toBe("hello");
    expect(parseConfig({ word: "   " }).word).toBe(DEFAULT_WORD);
    expect(parseConfig({ word: "x".repeat(80) }).word).toHaveLength(24);
  });

  it("honours the enabled and shellPath options", () => {
    expect(parseConfig({ enabled: false }).enabled).toBe(false);
    expect(parseConfig({ shellPath: " C:\\pwsh.exe " }).shellPath).toBe("C:\\pwsh.exe");
    expect(parseConfig({ shellPath: 42 }).shellPath).toBeNull();
  });
});
