/**
 * Procedural “thocky” mechanical keyboard–style UI feedback (Web Audio API).
 * No asset files; small variation per trigger so repeats feel less robotic.
 */

export type UiThockKind = "click" | "type";

let sharedCtx: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!sharedCtx) {
    try {
      sharedCtx = new AudioContext();
    } catch {
      return null;
    }
  }
  return sharedCtx;
}

function resumeIfNeeded(ctx: AudioContext): void {
  if (ctx.state === "suspended") void ctx.resume();
}

/** Short noise burst + damped tones — reads as a soft tactile “thock”. */
export function playUiThock(kind: UiThockKind): void {
  const c = getContext();
  if (!c) return;
  resumeIfNeeded(c);

  const t0 = c.currentTime;
  const master = c.createGain();
  const vol = kind === "type" ? 0.11 : 0.16;
  master.gain.setValueAtTime(vol, t0);
  master.connect(c.destination);

  const base = kind === "type" ? 168 + Math.random() * 22 : 152 + Math.random() * 38;

  const osc = c.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(base * 1.03, t0);
  osc.frequency.exponentialRampToValueAtTime(base * 0.9, t0 + 0.045);
  const gBody = c.createGain();
  gBody.gain.setValueAtTime(0, t0);
  gBody.gain.linearRampToValueAtTime(1, t0 + 0.002);
  gBody.gain.exponentialRampToValueAtTime(0.001, t0 + (kind === "type" ? 0.065 : 0.095));
  osc.connect(gBody);
  gBody.connect(master);

  const osc2 = c.createOscillator();
  osc2.type = "triangle";
  osc2.frequency.setValueAtTime(base * 2.05, t0);
  const gPart = c.createGain();
  gPart.gain.setValueAtTime(0, t0);
  gPart.gain.linearRampToValueAtTime(0.28, t0 + 0.001);
  gPart.gain.exponentialRampToValueAtTime(0.001, t0 + 0.028);
  osc2.connect(gPart);
  gPart.connect(master);

  const ms = Math.ceil(c.sampleRate * 0.014);
  const buf = c.createBuffer(1, ms, c.sampleRate);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < ms; i++) ch[i] = Math.random() * 2 - 1;
  const noise = c.createBufferSource();
  noise.buffer = buf;
  const lp = c.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = kind === "type" ? 3400 : 2600;
  const gN = c.createGain();
  gN.gain.setValueAtTime(0, t0);
  gN.gain.linearRampToValueAtTime(0.85, t0 + 0.0004);
  gN.gain.exponentialRampToValueAtTime(0.001, t0 + 0.009);
  noise.connect(lp);
  lp.connect(gN);
  gN.connect(master);

  osc.start(t0);
  osc.stop(t0 + 0.11);
  osc2.start(t0);
  osc2.stop(t0 + 0.045);
  noise.start(t0);
  noise.stop(t0 + 0.016);
}

function isInteractiveTarget(el: Element): boolean {
  if (el.closest("[data-no-ui-sound]")) return false;
  const node = el.closest(
    [
      "button",
      "a[href]",
      'input:not([type="hidden"])',
      "textarea",
      "select",
      "summary",
      '[role="button"]',
      '[role="tab"]',
      '[role="switch"]',
      '[role="menuitem"]',
      ".side-nav-item",
      "[data-app-tab]",
    ].join(","),
  );
  return node !== null;
}

export function uiSoundPointerMightPlay(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return isInteractiveTarget(target);
}

export function uiSoundKeydownMightPlay(ev: KeyboardEvent): boolean {
  if (ev.ctrlKey || ev.metaKey || ev.altKey) return false;
  if (ev.isComposing) return false;
  if (ev.repeat) return false;
  const t = ev.target;
  if (!(t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement)) return false;
  if (t instanceof HTMLInputElement) {
    const ty = t.type;
    if (
      ty === "checkbox" ||
      ty === "radio" ||
      ty === "button" ||
      ty === "submit" ||
      ty === "reset" ||
      ty === "file" ||
      ty === "range" ||
      ty === "color"
    ) {
      return false;
    }
  }
  if (ev.key.length !== 1) return false;
  return true;
}
