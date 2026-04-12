import type { StatsSubTab } from "./statsTypes";

const TABS: { id: StatsSubTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "charts", label: "Charts" },
  { id: "insights", label: "Insights" },
];

export function StatsSubnav({
  tab,
  onChange,
}: {
  tab: StatsSubTab;
  onChange: (t: StatsSubTab) => void;
}) {
  return (
    <div className="stats-subnav" role="tablist" aria-label="Stats sections">
      {TABS.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={tab === id}
          className={`stats-subnav-btn ${tab === id ? "active" : ""}`}
          onClick={() => onChange(id)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
