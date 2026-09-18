import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { readSharedIdleStatic, writeSharedIdleStatic } from "../src/sharedIdleStatic";

describe("shared tray idle file", () => {
  const dir = mkdtempSync(join(tmpdir(), "status-popup-idle-"));
  const file = join(dir, "idle-static.json");

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("round trips both values", () => {
    writeSharedIdleStatic(file, true);
    expect(readSharedIdleStatic(file)).toBe(true);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ trayIdleStatic: true });

    writeSharedIdleStatic(file, false);
    expect(readSharedIdleStatic(file)).toBe(false);
  });

  it("removes the file on reset", () => {
    writeSharedIdleStatic(file, true);
    expect(existsSync(file)).toBe(true);
    writeSharedIdleStatic(file, undefined);
    expect(existsSync(file)).toBe(false);
    expect(readSharedIdleStatic(file)).toBeUndefined();
  });

  it("ignores garbage, wrong types and missing files", () => {
    writeFileSync(file, "not json");
    expect(readSharedIdleStatic(file)).toBeUndefined();
    writeFileSync(file, '{"trayIdleStatic":"yes"}');
    expect(readSharedIdleStatic(file)).toBeUndefined();
    rmSync(file, { force: true });
    expect(readSharedIdleStatic(file)).toBeUndefined();
  });
});
