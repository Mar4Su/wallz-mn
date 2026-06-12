import type { TimeControlConfig, TimeControlId } from "./types";

export const DEFAULT_TIME_CONTROL_ID: TimeControlId = "3+3";

export const TIME_CONTROLS: TimeControlConfig[] = [
  { id: "1+1", label: "1 min + 1 sec", baseMs: 60_000, incrementMs: 1_000, turnMs: 30_000 },
  { id: "3+3", label: "3 min + 3 sec", baseMs: 180_000, incrementMs: 3_000, turnMs: 30_000 },
  { id: "5+5", label: "5 min + 5 sec", baseMs: 300_000, incrementMs: 5_000, turnMs: 30_000 },
];

export function resolveTimeControl(id?: string | null): TimeControlConfig {
  return TIME_CONTROLS.find((control) => control.id === id) ?? TIME_CONTROLS.find((control) => control.id === DEFAULT_TIME_CONTROL_ID)!;
}
