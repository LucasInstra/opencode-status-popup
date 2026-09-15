import { describe, expect, it } from "vitest";
import { MAX_SILENCE_MS, SessionActivity } from "../src/status";

function started(sessionID: string) {
  return { type: "session.execution.started", data: { sessionID } };
}

function idle(sessionID: string) {
  return { type: "session.idle", data: { sessionID } };
}

describe("SessionActivity", () => {
  it("starts idle", () => {
    const activity = new SessionActivity();
    expect(activity.snapshot()).toEqual({ phase: "idle", busy: 0, retry: 0 });
  });

  it("goes busy on execution start and idle again on session.idle", () => {
    const activity = new SessionActivity();
    expect(activity.apply(started("ses_1"))?.phase).toBe("busy");
    expect(activity.snapshot()).toEqual({ phase: "busy", busy: 1, retry: 0 });
    expect(activity.apply(idle("ses_1"))?.phase).toBe("idle");
    expect(activity.snapshot().busy).toBe(0);
  });

  it("counts concurrent sessions", () => {
    const activity = new SessionActivity();
    activity.apply(started("ses_1"));
    activity.apply(started("ses_2"));
    expect(activity.snapshot()).toEqual({ phase: "busy", busy: 2, retry: 0 });
    activity.apply(idle("ses_1"));
    expect(activity.snapshot()).toEqual({ phase: "busy", busy: 1, retry: 0 });
  });

  it("tracks session.status transitions", () => {
    const activity = new SessionActivity();
    expect(activity.apply({ type: "session.status", data: { sessionID: "ses_1", status: { type: "busy" } } })?.phase).toBe(
      "busy",
    );
    expect(
      activity.apply({ type: "session.status", data: { sessionID: "ses_1", status: { type: "retry" } } })?.phase,
    ).toBe("retry");
    expect(
      activity.apply({ type: "session.status", data: { sessionID: "ses_1", status: { type: "idle" } } })?.phase,
    ).toBe("idle");
  });

  it("marks the whole snapshot as retry when one session retries", () => {
    const activity = new SessionActivity();
    activity.apply(started("ses_1"));
    activity.apply({ type: "session.retry.scheduled", data: { sessionID: "ses_2" } });
    expect(activity.snapshot()).toEqual({ phase: "retry", busy: 2, retry: 1 });
  });

  it("keeps streaming a busy session and clears on execution.succeeded", () => {
    const activity = new SessionActivity();
    activity.apply(started("ses_1"));
    activity.apply({ type: "session.text.delta", data: { sessionID: "ses_1" } });
    expect(activity.snapshot().busy).toBe(1);
    expect(activity.apply({ type: "session.execution.succeeded", data: { sessionID: "ses_1" } })?.phase).toBe("idle");
  });

  it("ignores events without a session id and unrelated types", () => {
    const activity = new SessionActivity();
    expect(activity.apply({ type: "session.text.delta", data: {} })).toBeUndefined();
    expect(activity.apply({ type: "config.updated", data: { sessionID: "ses_1" } })).toBeUndefined();
    expect(activity.snapshot().busy).toBe(0);
  });

  it("does not report a change when the snapshot is identical", () => {
    const activity = new SessionActivity();
    activity.apply(started("ses_1"));
    expect(activity.apply({ type: "session.text.delta", data: { sessionID: "ses_1" } })).toEqual({
      phase: "busy",
      busy: 1,
      retry: 0,
    });
    const same = activity.apply({ type: "session.tool.progress", data: { sessionID: "ses_1" } });
    expect(same).toEqual({ phase: "busy", busy: 1, retry: 0 });
  });

  it("drops sessions that went silent for too long", () => {
    const activity = new SessionActivity();
    const now = 1_000_000;
    activity.apply(started("ses_1"), now);
    expect(activity.snapshot(now + MAX_SILENCE_MS + 1).busy).toBe(0);
  });
});
