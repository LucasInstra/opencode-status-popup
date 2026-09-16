import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readSharedMode, writeSharedMode } from "../src/sharedMode";

describe("shared mode file", () => {
  const dir = mkdtempSync(join(tmpdir(), "status-popup-mode-"));
  const file = join(dir, "mode.json");

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
    rmSync(dir, { recursive: true, force: true });
  });
});
