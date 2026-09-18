import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { consumeModeRequest, consumeRequest, readSharedMode, writeSharedMode } from "../src/sharedMode";

describe("shared mode file", () => {
  const dir = mkdtempSync(join(tmpdir(), "status-popup-mode-"));
  const file = join(dir, "mode.json");

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("round trips a mode", () => {
    writeSharedMode(file, "tray");
    expect(readSharedMode(file)).toBe("tray");
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ mode: "tray" });

    writeSharedMode(file, "window");
    expect(readSharedMode(file)).toBe("window");
  });

  it("removes the file on reset", () => {
    writeSharedMode(file, "tray");
    expect(existsSync(file)).toBe(true);
    writeSharedMode(file, undefined);
    expect(existsSync(file)).toBe(false);
    expect(readSharedMode(file)).toBeUndefined();
  });

  it("ignores garbage and missing files", () => {
    writeFileSync(file, "not json");
    expect(readSharedMode(file)).toBeUndefined();
    writeFileSync(file, '{"mode":"nonsense"}');
    expect(readSharedMode(file)).toBeUndefined();
    rmSync(file, { force: true });
    expect(readSharedMode(file)).toBeUndefined();
  });
});

describe("mode request", () => {
  const dir = mkdtempSync(join(tmpdir(), "status-popup-request-"));
  const file = join(dir, "mode.request");

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("consumes a valid request and reports its mode", () => {
    writeFileSync(file, '{"mode":"toggle"}');
    expect(consumeModeRequest(file)).toEqual({ mode: "toggle" });
    expect(existsSync(file)).toBe(false);
  });

  it("hands any payload to the caller, not only mode requests", () => {
    writeFileSync(file, '{"idleStatic":"toggle"}');
    expect(consumeRequest(file)).toEqual({ idleStatic: "toggle" });
    expect(existsSync(file)).toBe(false);
  });

  it("drops a malformed request instead of wedging on it", () => {
    writeFileSync(file, "{ not json");
    expect(consumeModeRequest(file)).toBeUndefined();
    expect(existsSync(file)).toBe(false);
  });

  it("leaves the file alone when it cannot be read", () => {
    const unreadable = join(dir, "a-directory");
    mkdirSync(unreadable, { recursive: true });
    // A failed read may be a transient lock; the watcher must see it again.
    expect(consumeModeRequest(unreadable)).toBeUndefined();
    expect(existsSync(unreadable)).toBe(true);
  });

  it("returns nothing when there is no request at all", () => {
    expect(consumeModeRequest(file)).toBeUndefined();
    expect(existsSync(file)).toBe(false);
  });
});
