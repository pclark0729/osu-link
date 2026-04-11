import { useEffect, useMemo, useRef, useState } from "react";

/** Hiragana, katakana, and common kanji — decorative only. */
const GLYPH_POOL =
  "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん" +
  "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン" +
  "日月火水木金土山川田人心手口目耳足上下左右大小新旧東西南北春夏秋冬光闇音楽星空雨雪風雲夢想希望";

const MAX_CELLS = 5200;
const OPACITY_MIN = 0.07;
const OPACITY_MAX = 0.42;

function mulberry32(seed: number): () => number {
  return function next() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function computeGridDims(w: number, h: number): { cols: number; rows: number } {
  let cell = 11;
  while (cell < 220) {
    cell += 1;
    const cols = Math.max(1, Math.ceil(w / cell));
    const rows = Math.max(1, Math.ceil(h / cell));
    if (cols * rows <= MAX_CELLS) {
      return { cols, rows };
    }
  }
  return { cols: 1, rows: 1 };
}

type GridCell = { char: string; opacity: number };

function buildGrid(seed: number, cols: number, rows: number): GridCell[] {
  const out: GridCell[] = [];
  const n = cols * rows;
  for (let i = 0; i < n; i++) {
    const rand = mulberry32(seed + i * 1_000_003);
    const char = GLYPH_POOL[Math.floor(rand() * GLYPH_POOL.length)]!;
    const opacity = OPACITY_MIN + rand() * (OPACITY_MAX - OPACITY_MIN);
    out.push({ char, opacity });
  }
  return out;
}

export function JapaneseTextBackdrop() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 800, h: 600 });

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;

    const apply = (w: number, h: number) => {
      const nw = Math.max(1, Math.floor(w));
      const nh = Math.max(1, Math.floor(h));
      setDims((d) => (d.w === nw && d.h === nh ? d : { w: nw, h: nh }));
    };

    apply(el.clientWidth, el.clientHeight);

    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      if (cr) apply(cr.width, cr.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { cols, rows, cells } = useMemo(() => {
    const w = Math.max(320, dims.w);
    const h = Math.max(400, dims.h);
    const { cols: c, rows: r } = computeGridDims(w, h);
    return {
      cols: c,
      rows: r,
      cells: buildGrid(90_271, c, r),
    };
  }, [dims.w, dims.h]);

  return (
    <div ref={rootRef} className="jp-text-backdrop" aria-hidden>
      <div
        className="jp-text-backdrop__grid"
        style={{
          gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
        }}
      >
        {cells.map((cell, i) => (
          <span key={i} className="jp-text-backdrop__cell" style={{ opacity: cell.opacity }}>
            {cell.char}
          </span>
        ))}
      </div>
    </div>
  );
}
