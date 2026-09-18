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
      errorHoldSeconds: 90,
      mark: false,
      trayIdleStatic: false,
      shellPath: null,
    });
  });

  it("accepts the error hold option, including zero", () => {
    expect(parseConfig({ errorHoldSeconds: 300 }).errorHoldSeconds).toBe(300);
    expect(parseConfig({ errorHoldSeconds: 0 }).errorHoldSeconds).toBe(0);
    expect(parseConfig({ errorHoldSeconds: -5 }).errorHoldSeconds).toBe(0);
    expect(parseConfig({ errorHoldSeconds: 99_999 }).errorHoldSeconds).toBe(3600);
    expect(parseConfig({ errorHoldSeconds: "no" }).errorHoldSeconds).toBe(90);
  });

  it("keeps the mark off the pill unless it is asked for", () => {
    expect(parseConfig(undefined).mark).toBe(false);
    expect(parseConfig({ mark: true }).mark).toBe(true);
    expect(parseConfig({ mark: false }).mark).toBe(false);
    expect(parseConfig({ mark: "no" }).mark).toBe(false);
  });

  it("keeps the tray idle blinking unless it is asked to be static", () => {
    expect(parseConfig(undefined).trayIdleStatic).toBe(false);
    expect(parseConfig({ trayIdleStatic: true }).trayIdleStatic).toBe(true);
    expect(parseConfig({ trayIdleStatic: false }).trayIdleStatic).toBe(false);
    expect(parseConfig({ trayIdleStatic: "yes" }).trayIdleStatic).toBe(false);
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
    expect(parseConfig({ idleSeconds: 99_999 }).idleSeconds).toBe(3600);
    expect(parseConfig({ freshSeconds: 1 }).freshSeconds).toBe(5);
    expect(parseConfig({ freshSeconds: 99_999 }).freshSeconds).toBe(600);
    expect(parseConfig({ freshSeconds: "20" }).freshSeconds).toBe(20);
  });

  it("keeps the requested corner and falls back to bottom-right", () => {
    expect(parseConfig({ position: "top-left" }).position).toBe("top-left");
    expect(parseConfig({ position: "top-right" }).position).toBe("top-right");
    expect(parseConfig({ position: "bottom-left" }).position).toBe("bottom-left");
    expect(parseConfig({ position: "middle" }).position).toBe("bottom-right");
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
