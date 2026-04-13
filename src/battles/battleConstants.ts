import type { NeuSelectOption } from "../NeuSelect";

export const AUTO_SUBMIT_STORAGE_KEY = "osu-link.battles.autoSubmit.v1";

export function loadAutoSubmitEnabled(): boolean {
  try {
    const v = localStorage.getItem(AUTO_SUBMIT_STORAGE_KEY);
    if (v === "0") return false;
    return true;
  } catch {
    return true;
  }
}

export function saveAutoSubmitEnabled(on: boolean): void {
  try {
    localStorage.setItem(AUTO_SUBMIT_STORAGE_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export const BATTLE_WINDOW_PRESET_OPTIONS: NeuSelectOption[] = [
  { value: "", label: "Choose time limit…" },
  { value: "86400000", label: "24 hours" },
  { value: "172800000", label: "48 hours" },
  { value: "604800000", label: "7 days" },
  { value: "custom", label: "Custom end date…" },
];

/** Deadlines for open challenges (multiplayer leaderboard). */
export const CHALLENGE_DEADLINE_PRESET_OPTIONS: NeuSelectOption[] = [
  { value: "", label: "Choose deadline…" },
  { value: "86400000", label: "24 hours" },
  { value: "259200000", label: "3 days" },
  { value: "604800000", label: "7 days" },
  { value: "1209600000", label: "14 days" },
  { value: "custom", label: "Custom date & time…" },
];

export const BATTLE_NEW_FLOW_SCROLL_CLASS = "battles-panel__new";
