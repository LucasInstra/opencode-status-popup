import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDebugLog } from "../src/debug";

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  delete process.env.OPENCODE_STATUS_POPUP_DEBUG;
});

describe("createDebugLog", () => {
  it("is a no-op unless the debug variable is set", () => {
    const stateDir = stateDirFor("off");
    const log = createDebugLog(stateDir);

    log("hello");
    expect(existsSync(join(stateDir, "plugin.log"))).toBe(false);
  });

  it("appends one timestamped line per call when enabled", () => {
    process.env.OPENCODE_STATUS_POPUP_DEBUG = "1";
    const stateDir = stateDirFor("on");
    const log = createDebugLog(stateDir);

    log("first");
    log("second");

    const lines = readFileSync(join(stateDir, "plugin.log"), "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^\d{4}-\d{2}-\d{2}T\S+ first$/);
    expect(lines[1]).toMatch(/ second$/);
  });

  it("rotates once the file is past the cap, keeping one previous generation", () => {
    process.env.OPENCODE_STATUS_POPUP_DEBUG = "1";
    const stateDir = stateDirFor("cap");
    const file = join(stateDir, "plugin.log");
    const full = "x".repeat(512 * 1024 + 1);
    writeFileSync(file, full);

    createDebugLog(stateDir)("after rotate");

    expect(readFileSync(`${file}.1`, "utf8")).toBe(full);
    const lines = readFileSync(file, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/ after rotate$/);
  });

  it("replaces the previous generation on the next rotation", () => {
    process.env.OPENCODE_STATUS_POPUP_DEBUG = "1";
    const stateDir = stateDirFor("rotate-twice");
    const file = join(stateDir, "plugin.log");
    const log = createDebugLog(stateDir);

    log("first");
    appendFileSync(file, "y".repeat(512 * 1024 + 1));
    log("second");

    const previous = readFileSync(`${file}.1`, "utf8");
    expect(previous).toContain("first");
    expect(previous).not.toContain("second");
    expect(readFileSync(file, "utf8")).toContain("second");
  });
});

function stateDirFor(label: string): string {
  const directory = mkdtempSync(join(tmpdir(), `popup-debug-${label}-`));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}
