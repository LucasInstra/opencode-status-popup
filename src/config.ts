export type PopupMode = "window" | "tray";
export type PopupPosition = "bottom-right" | "bottom-left" | "top-right" | "top-left";

export interface PopupConfig {
  readonly enabled: boolean;
  readonly mode: PopupMode;
  readonly word: string;
  readonly typeMs: number;
  readonly position: PopupPosition;
  readonly freshSeconds: number;
  readonly idleSeconds: number;
  readonly errorHoldSeconds: number;
  readonly mark: boolean;
  readonly trayIdleStatic: boolean;
  readonly shellPath: string | null;
}

export const DEFAULT_WORD = "opencode";
export const DEFAULT_TYPE_MS = 140;
export const DEFAULT_FRESH_SECONDS = 20;
export const DEFAULT_IDLE_SECONDS = 25;
export const DEFAULT_ERROR_HOLD_SECONDS = 90;

const MIN_TYPE_MS = 40;
const MAX_TYPE_MS = 2000;
const MIN_FRESH_SECONDS = 5;
const MAX_FRESH_SECONDS = 600;
const MIN_IDLE_SECONDS = 5;
const MAX_IDLE_SECONDS = 3600;
const MAX_ERROR_HOLD_SECONDS = 3600;
const MAX_WORD_LENGTH = 24;

export function parseConfig(options: unknown): PopupConfig {
  const input = isRecord(options) ? options : {};
  return {
    enabled: input.enabled !== false,
    mode: input.mode === "tray" ? "tray" : "window",
    word: parseWord(input.word),
    typeMs: parseNumber(input.typeMs, DEFAULT_TYPE_MS, MIN_TYPE_MS, MAX_TYPE_MS),
    position: parsePosition(input.position),
    freshSeconds: parseNumber(
      input.freshSeconds,
      DEFAULT_FRESH_SECONDS,
      MIN_FRESH_SECONDS,
      MAX_FRESH_SECONDS,
    ),
    idleSeconds: parseNumber(
      input.idleSeconds,
      DEFAULT_IDLE_SECONDS,
      MIN_IDLE_SECONDS,
      MAX_IDLE_SECONDS,
    ),
    errorHoldSeconds: parseNumber(
      input.errorHoldSeconds,
      DEFAULT_ERROR_HOLD_SECONDS,
      0,
      MAX_ERROR_HOLD_SECONDS,
    ),
    mark: input.mark === true,
    trayIdleStatic: input.trayIdleStatic === true,
    shellPath: parseShellPath(input.shellPath),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseWord(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_WORD;
  const word = value.trim();
  if (!word) return DEFAULT_WORD;
  return word.slice(0, MAX_WORD_LENGTH);
}

function parseNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function parsePosition(value: unknown): PopupPosition {
  switch (value) {
    case "bottom-left":
    case "top-right":
    case "top-left":
      return value;
    default:
      return "bottom-right";
  }
}

function parseShellPath(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
