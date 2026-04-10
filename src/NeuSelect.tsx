import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";

export type NeuSelectOption = { value: string; label: string };

export function NeuSelect({
  value,
  onChange,
  options,
  disabled,
  id: idProp,
}: {
  value: string;
  onChange: (v: string) => void;
  options: readonly NeuSelectOption[];
  disabled?: boolean;
  id?: string;
}) {
  const autoId = useId();
  const id = idProp ?? autoId;
  const listId = `${id}-list`;
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(() =>
    Math.max(0, options.findIndex((o) => o.value === value)),
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const itemRefs = useRef<(HTMLLIElement | null)[]>([]);

  useLayoutEffect(() => {
    if (open) setHighlight(Math.max(0, options.findIndex((o) => o.value === value)));
  }, [open, value, options]);

  useEffect(() => {
    if (!open) {
      setHighlight(Math.max(0, options.findIndex((o) => o.value === value)));
    }
  }, [value, options, open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const pick = useCallback(
    (v: string) => {
      onChange(v);
      setOpen(false);
    },
    [onChange],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlight((h) => Math.min(h + 1, options.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlight((h) => Math.max(h - 1, 0));
        return;
      }
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        const o = options[highlight];
        if (o) pick(o.value);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, highlight, options, pick]);

  useLayoutEffect(() => {
    if (!open) return;
    const el = itemRefs.current[highlight];
    el?.scrollIntoView({ block: "nearest" });
  }, [open, highlight]);

  const label = options.find((o) => o.value === value)?.label ?? value;

  return (
    <div className={`neu-select${open ? " neu-select-open" : ""}`} ref={rootRef}>
      <button
        type="button"
        id={id}
        className="neu-select-trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => !disabled && setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (open && (e.key === " " || e.key === "Enter")) {
            e.preventDefault();
          }
          if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span className="neu-select-value">{label}</span>
        <span className="neu-select-chevron" aria-hidden>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path
              d="M7 10l5 5 5-5"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </button>
      {open && (
        <ul
          ref={listRef}
          id={listId}
          className="neu-select-list"
          role="listbox"
          aria-labelledby={id}
          aria-activedescendant={`${id}-opt-${highlight}`}
        >
          {options.map((o, i) => (
            <li
              key={o.value}
              id={`${id}-opt-${i}`}
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              role="option"
              aria-selected={o.value === value}
              className={`neu-select-option ${o.value === value ? "selected" : ""} ${
                i === highlight ? "highlighted" : ""
              }`}
              onMouseEnter={() => setHighlight(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(o.value)}
            >
              {o.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
