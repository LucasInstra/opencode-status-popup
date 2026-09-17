import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { reapStalePresenceFiles } from "../src/presence";

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

const FRESH_MS = 20_000;

describe("reapStalePresenceFiles", () => {
  it("removes stale files and keeps fresh ones", () => {
    const stateDir = stateDirFor("stale");
    const now = Date.now();
    const stale = writePresence(stateDir, "stale.json", { updated: now - FRESH_MS * 2 });
    const fresh = writePresence(stateDir, "fresh.json", { updated: now - 1000 });

    const removed = reapStalePresenceFiles(stateDir, FRESH_MS, now);

    expect(removed).toEqual([stale]);
    expect(existsSync(stale)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
  });

  it("removes payloads that cannot be parsed or carry no updated", () => {
    const stateDir = stateDirFor("corrupt");
    const corrupt = join(stateDir, "state", "broken.json");
    const noTimestamp = writePresence(stateDir, "no-updated.json", { phase: "busy" });
    writeFileSync(corrupt, "{not json");

    const removed = reapStalePresenceFiles(stateDir, FRESH_MS);

    expect(removed.sort()).toEqual([corrupt, noTimestamp].sort());
    expect(existsSync(corrupt)).toBe(false);
    expect(existsSync(noTimestamp)).toBe(false);
  });

  it("removes orphaned temporary writes but keeps recent ones", () => {
    const stateDir = stateDirFor("tmp");
    const now = Date.now();
    const orphan = writeTemporary(stateDir, "orphan.json.tmp", now - FRESH_MS * 2);
    const recent = writeTemporary(stateDir, "recent.json.tmp", now - 500);

    const removed = reapStalePresenceFiles(stateDir, FRESH_MS, now);

    expect(removed).toEqual([orphan]);
    expect(existsSync(orphan)).toBe(false);
    expect(existsSync(recent)).toBe(true);
  });

  it("leaves unrelated files and a missing directory alone", () => {
    const stateDir = stateDirFor("other");
    const note = join(stateDir, "state", "note.txt");
    const hostInfo = join(stateDir, "host.json");
    writeFileSync(note, "keep me");
    writeFileSync(hostInfo, "{}");

    expect(reapStalePresenceFiles(stateDir, FRESH_MS)).toEqual([]);
    expect(existsSync(note)).toBe(true);
    expect(existsSync(hostInfo)).toBe(true);
    expect(reapStalePresenceFiles(join(stateDir, "missing"), FRESH_MS)).toEqual([]);
  });
});

function stateDirFor(label: string): string {
  const directory = mkdtempSync(join(tmpdir(), `popup-presence-${label}-`));
  mkdirSync(join(directory, "state"), { recursive: true });
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function writePresence(stateDir: string, name: string, payload: Record<string, unknown>): string {
  const file = join(stateDir, "state", name);
  writeFileSync(file, JSON.stringify(payload));
  return file;
}

function writeTemporary(stateDir: string, name: string, mtimeMs: number): string {
  const file = join(stateDir, "state", name);
  writeFileSync(file, "partial write");
  utimesSync(file, new Date(mtimeMs), new Date(mtimeMs));
  return file;
}
