import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { type CSSProperties, memo, useEffect, useRef, useState } from "react";

/** Must match `BANDS` in `src-tauri/src/audio_viz.rs` */
export const HEADER_VIS_BAR_COUNT = 64;

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function resampleLevels(raw: number[], target: number): number[] {
  if (raw.length === target) {
    return raw.map(clamp01);
  }
  if (raw.length === 0) {
    return Array.from({ length: target }, () => 0.06);
  }
  const out: number[] = [];
  for (let i = 0; i < target; i++) {
    const t = (i / Math.max(1, target - 1)) * (raw.length - 1);
    const j = Math.floor(t);
    const f = t - j;
    const a = raw[j] ?? 0;
    const b = raw[j + 1] ?? a;
    out.push(clamp01(a + f * (b - a)));
  }
  return out;
}

/** Loopback spectrum from the Tauri backend, with a soft idle motion in the browser. */
export const HeaderVisualizer = memo(function HeaderVisualizer() {
  const [levels, setLevels] = useState<number[]>(() =>
    Array.from({ length: HEADER_VIS_BAR_COUNT }, () => 0.07),
  );
  const rafRef = useRef<number | null>(null);
  const phaseRef = useRef(0);

  useEffect(() => {
    if (!isTauri()) {
      const tick = () => {
        phaseRef.current += 0.035;
        const p = phaseRef.current;
        setLevels(
          Array.from({ length: HEADER_VIS_BAR_COUNT }, (_, i) => {
            const w = 0.5 + 0.5 * Math.sin(p * 1.15 + i * 0.27 + Math.sin(i * 0.09) * 0.4);
            return 0.06 + 0.1 * w;
          }),
        );
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
      return () => {
        if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      };
    }

    let unlisten: (() => void) | undefined;
    void listen<{ levels?: number[] }>("audio-viz", (e) => {
      const raw = e.payload.levels;
      if (!Array.isArray(raw)) return;
      setLevels(resampleLevels(raw, HEADER_VIS_BAR_COUNT));
    }).then((u) => {
      unlisten = u;
    });
    return () => {
      unlisten?.();
    };
  }, []);

  return (
    <div className="header-visualizer" aria-hidden>
      {levels.map((h, i) => (
        <span
          key={i}
          className="header-visualizer__bar"
          style={{ "--viz": clamp01(h) } as CSSProperties}
        />
      ))}
    </div>
  );
});
