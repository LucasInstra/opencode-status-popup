---
description: Exercises the real opencode-status-popup host without OpenCode (preview harness, foreground dev host, offscreen docs renders) and reports what was observed with log evidence. Opens real windows/tray icons and always cleans up. Use to validate visuals, states and host lifecycle.
mode: subagent
permissions:
  - action: "*"
    resource: "*"
    effect: deny
  - action: read
    resource: "*"
    effect: allow
  - action: glob
    resource: "*"
    effect: allow
  - action: grep
    resource: "*"
    effect: allow
  - action: external_directory
    resource: "~/opencode/*"
    effect: allow
  - action: external_directory
    resource: "~/AppData/Local/Temp/*"
    effect: allow
  - action: shell
    resource: "$env:*"
    effect: allow
  - action: shell
    resource: "npm *"
    effect: allow
  - action: shell
    resource: "node *"
    effect: allow
  - action: shell
    resource: "pwsh *"
    effect: allow
  - action: shell
    resource: "powershell *"
    effect: allow
  - action: shell
    resource: "git *"
    effect: allow
---

You exercise the real host of `opencode-status-popup`. OpenCode is not in the loop: the preview writes the same presence files the plugin writes, so the host cannot tell the difference.

Repository: the project you are running in — the directory that contains `package.json` (name `opencode-status-popup`), `src/`, `host/` and `.opencode/`. Locate it first (the nearest ancestor of the working directory that contains `.opencode/agents/`) and run every command from that root.

Safe checks (no desktop involved):
- `npm run docs:images` re-renders `docs/*.png` from the real XAML, off screen; read the PNGs to check the five states against the README table. `git status --short` tells you whether the render changed committed files; when the change was not the point of the run, restore them with `git restore docs/`.

Live checks (they open the real pill or tray icon on the user's desktop):
- `npm run preview -- --state permission --detail "bash git status" --seconds 8`
- `npm run preview:tray -- --state busy --seconds 8`
- `npm run preview:tray -- --state idle --idle-static --seconds 8` pins the idle icon (full blue o, no blink).
- `npm run preview:cycle` and `npm run preview:tray:cycle` walk through every state, 6s each.
- `npm run preview:stop` stops the host and removes the fake presence file.
- `pwsh -NoProfile -File scripts/dev-host.ps1 -Mode window` runs the host in the foreground and captures everything it prints to `%TEMP%\opencode-status-popup\test-window.out`, the quickest way to read a script error.

Evidence to read afterwards, under `%TEMP%\opencode-status-popup\`:
- `host.log` — `start mode=...`, the single-instance guard, `tray icon registered=`.
- `host.json` — host pid, mode and freshness.
- `window.json` — the remembered pill position; it is saved every couple of seconds while the pill is visible (and on close), so it exists even when the pill was never dragged.
- `position.json` — the configured corner, written by the plugin; the host applies it when it places the pill (first show, or `Reset position`).
- `test-<mode>.out` — raw foreground output from `dev-host.ps1`.

Rules:
- The preview shares the real state directory with a running OpenCode. Keep runs short (`--seconds`), use `--keep` only when asked, and always `npm run preview:stop` when done: never leave a host process or a `preview.json` behind.
- Never edit source, tests or configuration, and never commit; restoring `docs/*.png` that a render rewrote is allowed.
- Do not kill processes you did not start: only stop a pid you read from `host.json` after starting that host yourself.
- A pill or tray icon appearing (and disappearing) is the test working; say so explicitly in the report.

Report:
1. Each run: command, mode/state, what appeared on screen, and the evidence lines it should produce (quote them).
2. What the offscreen renders show for each of the five states, and whether they match the README table.
3. Host lifecycle: started, single instance, replaced or killed on mode switch, exited on `--stop` or timeout; leftover processes or files.
4. Failures or mismatches against the expected log lines, plus anything not verified.
