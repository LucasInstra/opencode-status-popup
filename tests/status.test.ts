import { describe, expect, it } from "vitest";
import { MAX_PERMISSION_MS, MAX_SILENCE_MS, SessionActivity } from "../src/status";

function started(sessionID: string) {
  return { type: "session.execution.started", data: { sessionID } };
}

function idle(sessionID: string) {
  return { type: "session.idle", data: { sessionID } };
}

function asked(id: string, action: string, resources: string[] = []) {
  return { type: "permission.asked", data: { id, sessionID: "ses_1", action, resources } };
}

function idleSnapshot() {
  return { phase: "idle", busy: 0, retry: 0, errors: 0, permissions: 0, detail: "" };
}

describe("SessionActivity", () => {
  it("starts idle", () => {
    expect(new SessionActivity().snapshot()).toEqual(idleSnapshot());
  });

  it("goes busy on execution start and idle again on session.idle", () => {
    const activity = new SessionActivity();
    expect(activity.apply(started("ses_1"))?.phase).toBe("busy");
    expect(activity.snapshot().busy).toBe(1);
    expect(activity.apply(idle("ses_1"))?.phase).toBe("idle");
    expect(activity.snapshot().busy).toBe(0);
  });

  it("counts concurrent sessions", () => {
    const activity = new SessionActivity();
    activity.apply(started("ses_1"));
    activity.apply(started("ses_2"));
    expect(activity.snapshot().busy).toBe(2);
    activity.apply(idle("ses_1"));
    expect(activity.snapshot().busy).toBe(1);
  });

  it("tracks session.status transitions", () => {
    const activity = new SessionActivity();
    const status = (type: string) => ({ type: "session.status", data: { sessionID: "ses_1", status: { type } } });
    expect(activity.apply(status("busy"))?.phase).toBe("busy");
    expect(activity.apply(status("retry"))?.phase).toBe("retry");
    expect(activity.apply(status("idle"))?.phase).toBe("idle");
  });

  it("reports retry when one of several sessions retries", () => {
    const activity = new SessionActivity();
    activity.apply(started("ses_1"));
    activity.apply({ type: "session.retry.scheduled", data: { sessionID: "ses_2" } });
    expect(activity.snapshot()).toMatchObject({ phase: "retry", busy: 2, retry: 1 });
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

  it("drops sessions that went silent for too long", () => {
    const activity = new SessionActivity();
    const now = 1_000_000;
    activity.apply(started("ses_1"), now);
    expect(activity.snapshot(now + MAX_SILENCE_MS + 1).busy).toBe(0);
  });

  describe("failures", () => {
    it("turns red with a detail and stops counting the session as busy", () => {
      const activity = new SessionActivity();
      activity.apply(started("ses_1"));
      const snapshot = activity.apply({
        type: "session.execution.failed",
        data: { sessionID: "ses_1", error: { type: "provider.invalid-request", message: "boom", status: 429 } },
      });
      expect(snapshot).toMatchObject({ phase: "error", busy: 0, errors: 1, detail: "429 provider.invalid-request" });
    });

    it("falls back to the message when the error has no type", () => {
      const activity = new SessionActivity();
      const snapshot = activity.apply({
        type: "session.execution.failed",
        data: { sessionID: "ses_1", error: { message: "connection reset by peer" } },
      });
      expect(snapshot?.detail).toBe("connection reset by peer");
    });

    it("clears the error when the session works again", () => {
      const activity = new SessionActivity();
      activity.apply({ type: "session.execution.failed", data: { sessionID: "ses_1", error: { type: "boom" } } });
      expect(activity.snapshot().phase).toBe("error");
      expect(activity.apply(started("ses_1"))?.phase).toBe("busy");
      expect(activity.snapshot().errors).toBe(0);
    });

    it("keeps the error for errorHoldMs and drops it after that", () => {
      const activity = new SessionActivity({ errorHoldMs: 5000 });
      const now = 1_000_000;
      activity.apply({ type: "session.execution.failed", data: { sessionID: "ses_1", error: { type: "boom" } } }, now);
      expect(activity.snapshot(now + 4999).phase).toBe("error");
      expect(activity.snapshot(now + 5001).phase).toBe("idle");
    });

    it("keeps the error forever when errorHoldMs is zero", () => {
      const activity = new SessionActivity({ errorHoldMs: 0 });
      const now = 1_000_000;
      activity.apply({ type: "session.execution.failed", data: { sessionID: "ses_1", error: { type: "boom" } } }, now);
      expect(activity.snapshot(now + 86_400_000).phase).toBe("error");
    });

    it("does not go red for interrupted or failed tool calls", () => {
      const activity = new SessionActivity();
      activity.apply({ type: "session.execution.interrupted", data: { sessionID: "ses_1" } });
      activity.apply({ type: "session.tool.failed", data: { sessionID: "ses_2" } });
      expect(activity.snapshot().phase).toBe("busy");
      expect(activity.snapshot().errors).toBe(0);
    });
  });

  describe("permissions", () => {
    it("asks for attention and names the action", () => {
      const activity = new SessionActivity();
      activity.apply(started("ses_1"));
      const snapshot = activity.apply(asked("per_1", "bash", ["git push origin main"]));
      expect(snapshot).toMatchObject({ phase: "permission", permissions: 1, detail: "bash git push origin main" });
    });

    it("has priority over a busy session and over an error", () => {
      const activity = new SessionActivity();
      activity.apply(started("ses_1"));
      activity.apply({ type: "session.execution.failed", data: { sessionID: "ses_2", error: { type: "boom" } } });
      expect(activity.snapshot().phase).toBe("error");
      activity.apply(asked("per_1", "edit"));
      expect(activity.snapshot().phase).toBe("permission");
    });

    it("goes back to the previous phase when the permission is replied", () => {
      const activity = new SessionActivity();
      activity.apply(started("ses_1"));
      activity.apply(asked("per_1", "bash"));
      expect(activity.snapshot().phase).toBe("permission");
      const snapshot = activity.apply({ type: "permission.replied", data: { sessionID: "ses_1", requestID: "per_1", reply: "once" } });
      expect(snapshot?.phase).toBe("busy");
      expect(activity.snapshot().permissions).toBe(0);
    });

    it("does not clear a pending permission for an unknown request id", () => {
      const activity = new SessionActivity();
      activity.apply(asked("per_1", "bash"));
      expect(activity.snapshot().permissions).toBe(1);
      activity.apply({ type: "permission.replied", data: { sessionID: "ses_1", requestID: "per_nope", reply: "once" } });
      expect(activity.snapshot().permissions).toBe(1);
      expect(activity.snapshot().phase).toBe("permission");
    });

    it("expires a permission nobody answered", () => {
      const activity = new SessionActivity();
      const now = 1_000_000;
      activity.apply(asked("per_1", "bash"), now);
      expect(activity.snapshot(now + MAX_PERMISSION_MS - 1).phase).toBe("permission");
      expect(activity.snapshot(now + MAX_PERMISSION_MS + 1).phase).toBe("idle");
    });
  });

  describe("forms", () => {
    // The V2 prompt mechanism: a question is a form with fields, and the
    // settle events carry the form id at the top level.
    function formCreated(id: string, title = "Question", fieldTitle = "Which renderer?") {
      return {
        type: "form.created",
        data: {
          form: {
            id,
            sessionID: "ses_1",
            title,
            fields: [{ key: "choice", title: fieldTitle, type: "string", options: [] }],
          },
        },
      };
    }

    it("asks for attention and names the question", () => {
      const activity = new SessionActivity();
      activity.apply(started("ses_1"));
      const snapshot = activity.apply(formCreated("frm_1", "Popup", "Put the popup in the tray?"));
      expect(snapshot).toMatchObject({
        phase: "permission",
        permissions: 1,
        detail: "Put the popup in the tray?",
      });
    });

    it("falls back to the form title when the field has none", () => {
      const activity = new SessionActivity();
      const snapshot = activity.apply({
        type: "form.created",
        data: {
          form: { id: "frm_1", sessionID: "ses_1", title: "Answer me", fields: [{ key: "choice", type: "string" }] },
        },
      });
      expect(snapshot).toMatchObject({ phase: "permission", permissions: 1, detail: "Answer me" });
    });

    it("has priority over a busy session and over an error", () => {
      const activity = new SessionActivity();
      activity.apply(started("ses_1"));
      activity.apply({ type: "session.execution.failed", data: { sessionID: "ses_2", error: { type: "boom" } } });
      expect(activity.snapshot().phase).toBe("error");
      activity.apply(formCreated("frm_1"));
      expect(activity.snapshot().phase).toBe("permission");
    });

    it("goes back to the previous phase when the form is replied", () => {
      const activity = new SessionActivity();
      activity.apply(started("ses_1"));
      activity.apply(formCreated("frm_1"));
      expect(activity.snapshot().phase).toBe("permission");
      const snapshot = activity.apply({
        type: "form.replied",
        data: { id: "frm_1", sessionID: "ses_1", answer: { choice: "tray" } },
      });
      expect(snapshot?.phase).toBe("busy");
      expect(activity.snapshot().permissions).toBe(0);
    });

    it("goes back to the previous phase when the form is cancelled", () => {
      const activity = new SessionActivity();
      activity.apply(started("ses_1"));
      activity.apply(formCreated("frm_1"));
      expect(activity.snapshot().phase).toBe("permission");
      const snapshot = activity.apply({
        type: "form.cancelled",
        data: { id: "frm_1", sessionID: "ses_1" },
      });
      expect(snapshot?.phase).toBe("busy");
      expect(activity.snapshot().permissions).toBe(0);
    });

    it("does not clear a pending form for an unknown id", () => {
      const activity = new SessionActivity();
      activity.apply(formCreated("frm_1"));
      expect(activity.snapshot().permissions).toBe(1);
      activity.apply({ type: "form.cancelled", data: { id: "frm_nope", sessionID: "ses_1" } });
      expect(activity.snapshot().permissions).toBe(1);
      expect(activity.snapshot().phase).toBe("permission");
    });

    it("expires a form nobody answered", () => {
      const activity = new SessionActivity();
      const now = 1_000_000;
      activity.apply(formCreated("frm_1"), now);
      expect(activity.snapshot(now + MAX_PERMISSION_MS - 1).phase).toBe("permission");
      expect(activity.snapshot(now + MAX_PERMISSION_MS + 1).phase).toBe("idle");
    });

    it("ignores a form without an id and counts forms and permissions together", () => {
      const activity = new SessionActivity();
      expect(
        activity.apply({ type: "form.created", data: { form: { sessionID: "ses_1", title: "No id", fields: [] } } }),
      ).toBeUndefined();
      activity.apply(asked("per_1", "bash"));
      activity.apply(formCreated("frm_1", "Popup", "Continue?"));
      expect(activity.snapshot().permissions).toBe(2);
    });
  });

  it("keeps the phase stable across repeated events", () => {
    const activity = new SessionActivity();
    activity.apply(started("ses_1"));
    expect(activity.apply({ type: "session.tool.progress", data: { sessionID: "ses_1" } })).toMatchObject({ phase: "busy" });
    expect(activity.apply(asked("per_1", "bash"))?.phase).toBe("permission");
    expect(activity.apply(asked("per_2", "edit"))?.phase).toBe("permission");
  });
});
