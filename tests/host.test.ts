import { describe, expect, it } from "vitest";
import { buildHostArgs, hostInfoMatches, type HostSettings } from "../src/host";

const settings: HostSettings = {
  mode: "window",
  word: "opencode",
  typeMs: 140,
  fresh: 20,
  idle: 25,
  mark: false,
  position: "top-left",
};

describe("host launch", () => {
  it("passes every setting to the host script, position included", () => {
    const args = buildHostArgs({ scriptPath: "C:\\host\\popup.ps1", stateDir: "C:\\state", settings });

    const valueOf = (flag: string): string | undefined => args[args.indexOf(flag) + 1];
    expect(valueOf("-Mode")).toBe("window");
    expect(valueOf("-StateDir")).toBe("C:\\state");
    expect(valueOf("-Word")).toBe("opencode");
    expect(valueOf("-TypeMs")).toBe("140");
    expect(valueOf("-FreshSeconds")).toBe("20");
    expect(valueOf("-IdleSeconds")).toBe("25");
    expect(valueOf("-Position")).toBe("top-left");
    expect(valueOf("-Mark")).toBe("0");
  });

  it("restarts when a rendered setting diverges, but not when only the position moves", () => {
    const info = {
      pid: 4242,
      updated: Date.now(),
      mode: "window",
      word: "opencode",
      typeMs: 140,
      fresh: 20,
      idle: 25,
      mark: false,
      position: "top-left",
    };

    expect(hostInfoMatches(info, settings)).toBe(true);
    // The corner is applied at first placement and on Reset position; a live
    // host keeps the position the user already has.
    const movedCorner = { ...info, position: "bottom-right" };
    expect(hostInfoMatches(movedCorner, settings)).toBe(true);
    expect(hostInfoMatches({ ...info, word: "hi" }, settings)).toBe(false);
  });
});
