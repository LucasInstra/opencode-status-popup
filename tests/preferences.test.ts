import { describe, expect, it } from "vitest";
import { resolveIdleStatic, resolveMode, toggleIdleStatic, toggleMode } from "../src/preferences";

describe("resolveMode", () => {
  it("prefers the stored choice made with a command", () => {
    expect(resolveMode("tray", "window")).toBe("tray");
    expect(resolveMode("window", "tray")).toBe("window");
  });

  it("falls back to the configured mode when nothing was chosen", () => {
    expect(resolveMode(undefined, "tray")).toBe("tray");
    expect(resolveMode(undefined, "window")).toBe("window");
    expect(resolveMode("nonsense", "tray")).toBe("tray");
    expect(resolveMode(7, "window")).toBe("window");
  });
});

describe("toggleMode", () => {
  it("flips between the two renderers", () => {
    expect(toggleMode("window")).toBe("tray");
    expect(toggleMode("tray")).toBe("window");
  });
});

describe("resolveIdleStatic", () => {
  it("prefers the stored choice made with a command", () => {
    expect(resolveIdleStatic(true, false)).toBe(true);
    expect(resolveIdleStatic(false, true)).toBe(false);
  });

  it("falls back to the configured value when nothing valid was chosen", () => {
    expect(resolveIdleStatic(undefined, true)).toBe(true);
    expect(resolveIdleStatic(undefined, false)).toBe(false);
    expect(resolveIdleStatic("yes", false)).toBe(false);
    expect(resolveIdleStatic(1, true)).toBe(true);
  });
});

describe("toggleIdleStatic", () => {
  it("flips between static and blinking", () => {
    expect(toggleIdleStatic(false)).toBe(true);
    expect(toggleIdleStatic(true)).toBe(false);
  });
});
