import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";

/** Detects when the preceding sentinel scrolls out of the main pane (sticky chrome is pinned). */
export function useStickyStuck(): { sentinelRef: RefObject<HTMLDivElement | null>; stuck: boolean } {
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const root = el.closest(".main-scroll");
    const obs = new IntersectionObserver(
      ([entry]) => {
        setStuck(!entry.isIntersecting);
      },
      { root: root instanceof Element ? root : null, threshold: 0 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return { sentinelRef, stuck };
}

export function MainPaneSticky({ className, children }: { className?: string; children: ReactNode }) {
  const { sentinelRef, stuck } = useStickyStuck();
  return (
    <div className="main-pane-sticky-observe">
      <div ref={sentinelRef} className="main-pane-sticky-sentinel" aria-hidden />
      <div
        className={["main-pane-sticky", stuck ? "main-pane-sticky--stuck" : "", className].filter(Boolean).join(" ")}
      >
        {children}
      </div>
    </div>
  );
}
