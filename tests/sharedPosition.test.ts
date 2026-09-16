import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { readSharedPosition, writeSharedPosition } from "../src/sharedPosition";

describe("shared position file", () => {
  const dir = mkdtempSync(join(tmpdir(), "status-popup-position-"));
  const file = join(dir, "position.json");

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("round trips every corner", () => {
    for (const position of ["bottom-right", "bottom-left", "top-right", "top-left"] as const) {
      writeSharedPosition(file, position);
      expect(readSharedPosition(file)).toBe(position);
    }
    expect(existsSync(`${file}.tmp`)).toBe(false);
  });

  it("ignores garbage and missing files", () => {
    writeFileSync(file, "not json");
    expect(readSharedPosition(file)).toBeUndefined();
    writeFileSync(file, '{"position":"middle"}');
    expect(readSharedPosition(file)).toBeUndefined();
    rmSync(file, { force: true });
    expect(readSharedPosition(file)).toBeUndefined();
  });
});
