import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { BeatmapResultCard } from "./BeatmapResultCard";
import { NeuSelect } from "./NeuSelect";
import {
  type Mode,
  SEARCH_MODE_OPTIONS,
  SEARCH_SECTION_OPTIONS,
  SEARCH_SORT_OPTIONS,
  topBeatmapIdForMode,
} from "./searchTypes";
import { serializePresetsForExport, type ResultsLayout } from "./searchPresetStorage";
import type { SearchDownloadState } from "./useSearchDownloadState";
import { useBeatmapAvgPp } from "./useBeatmapAvgPp";

export function SearchDownloadPanel({
  s,
  onInspectSet,
}: {
  s: SearchDownloadState;
  onInspectSet?: (raw: unknown) => void;
}) {
  const {
    query,
    setQuery,
    mode,
    setMode,
    section,
    setSection,
    sort,
    setSort,
    minStars,
    setMinStars,
    maxStars,
    setMaxStars,
    noVideo,
    setNoVideo,
    genre,
    setGenre,
    language,
    setLanguage,
    extras,
    setExtras,
    general,
    setGeneral,
    ranks,
    setRanks,
    nsfw,
    setNsfw,
    searching,
    searchError,
    searchAttempted,
    rawResults,
    cursorString,
    total,
    runSearch,
    hideOwnedSearch,
    setHideOwnedSearch,
    directImportSetId,
    importFromSearch,
    curateResults,
    setCurateResults,
    curating,
    curateError,
    runCurateDiscover,
    runCurateNewRanked,
    activeCollection,
    activeItems,
    addToCollection,
    searchDisplayResults,
    partyCanSend,
    sendBeatmapToParty,
    showPartyActions,
    showCollectionActions,
    localBeatmapsetIds,
    presets,
    applyPreset,
    savePreset,
    deletePreset,
    renamePreset,
    importPresetsFromJsonText,
    resultsLayout,
    setResultsLayout,
  } = s;

  const [presetPickerValue, setPresetPickerValue] = useState("");
  const [presetSaveName, setPresetSaveName] = useState("");
  const [presetRenameValue, setPresetRenameValue] = useState("");
  const presetImportRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const p = presets.find((x) => x.id === presetPickerValue);
    setPresetRenameValue(p?.name ?? "");
  }, [presetPickerValue, presets]);

  const avgPpBeatmapIds = useMemo(() => {
    const a = searchDisplayResults.map((r) => topBeatmapIdForMode(r, mode));
    const b = curateResults.map((r) => topBeatmapIdForMode(r, mode));
    return [...a, ...b];
  }, [searchDisplayResults, curateResults, mode]);
  const avgPp = useBeatmapAvgPp(avgPpBeatmapIds, mode);

  const effectiveLayout: ResultsLayout = resultsLayout;

  const resultsGridClass = [
    "results",
    "results-grid",
    effectiveLayout === "compact" && "results-grid--compact",
    effectiveLayout === "tiles" && "results-grid--tiles",
  ]
    .filter(Boolean)
    .join(" ");

  const presetOptions = useMemo(() => {
    const base = [{ value: "", label: "— Preset —" }] as const;
    return [...base, ...presets.map((p) => ({ value: p.id, label: p.name }))];
  }, [presets]);

  const onQueryKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    void runSearch(false);
  };

  return (
    <>
      <div className="panel panel-elevated">
        <div className="main-pane-sticky">
          <div className="panel-head">
            <h2>Search beatmaps</h2>
            <p className="panel-sub">
              Tune filters, then run Search. Imports add full sets (.osz) to your Songs folder or a collection.
            </p>
          </div>
          <div className="search-toolbar-row">
            <details className="disclosure-block search-presets-details">
              <summary>
                Search presets
                {presets.length > 0 ? (
                  <span className="disclosure-summary-meta"> {presets.length} saved</span>
                ) : null}
              </summary>
              <div className="search-presets">
                <label className="field search-presets-field">
                  <span className="visually-hidden">Preset management</span>
                  <div className="search-presets-controls">
                    <NeuSelect
                      id="search-presets-load"
                      value={presetPickerValue}
                      onChange={(v) => {
                        if (v === "") {
                          setPresetPickerValue("");
                          return;
                        }
                        applyPreset(v);
                        setPresetPickerValue(v);
                      }}
                      options={presetOptions}
                      disabled={searching}
                    />
                    <label className="search-presets-inline-name">
                      <span className="visually-hidden">New preset name</span>
                      <input
                        type="text"
                        className="search-presets-name-input"
                        placeholder="Preset name"
                        autoComplete="off"
                        value={presetSaveName}
                        disabled={searching}
                        onChange={(e) => setPresetSaveName(e.target.value)}
                      />
                    </label>
                    <button
                      type="button"
                      className="secondary"
                      disabled={searching || presetSaveName.trim() === ""}
                      onClick={() => {
                        const id = savePreset(presetSaveName);
                        if (id) {
                          setPresetPickerValue(id);
                          setPresetSaveName("");
                        }
                      }}
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      disabled={!presetPickerValue || searching}
                      onClick={() => {
                        if (!presetPickerValue) return;
                        deletePreset(presetPickerValue);
                        setPresetPickerValue("");
                      }}
                    >
                      Delete
                    </button>
                  </div>
                  <div className="search-presets-controls search-presets-row2">
                    <label className="search-presets-inline-name search-presets-rename">
                      <span className="visually-hidden">Rename preset</span>
                      <input
                        type="text"
                        className="search-presets-name-input"
                        placeholder="New name"
                        autoComplete="off"
                        value={presetRenameValue}
                        disabled={searching || !presetPickerValue}
                        onChange={(e) => setPresetRenameValue(e.target.value)}
                      />
                    </label>
                    <button
                      type="button"
                      className="secondary"
                      disabled={searching || !presetPickerValue || presetRenameValue.trim() === ""}
                      onClick={() => {
                        if (!presetPickerValue) return;
                        renamePreset(presetPickerValue, presetRenameValue);
                      }}
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      disabled={searching}
                      onClick={() => {
                        const text = serializePresetsForExport(presets);
                        const blob = new Blob([text], { type: "application/json;charset=utf-8" });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = "osu-link-search-presets.json";
                        a.rel = "noopener";
                        document.body.appendChild(a);
                        a.click();
                        a.remove();
                        URL.revokeObjectURL(url);
                      }}
                    >
                      Export
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      disabled={searching}
                      onClick={() => presetImportRef.current?.click()}
                    >
                      Import
                    </button>
                    <input
                      ref={presetImportRef}
                      type="file"
                      accept="application/json,.json"
                      className="visually-hidden"
                      aria-hidden
                      tabIndex={-1}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = "";
                        if (!f) return;
                        void f.text().then((raw) => importPresetsFromJsonText(raw));
                      }}
                    />
                  </div>
                </label>
              </div>
            </details>
            <div className="search-layout-toggle" role="group" aria-label="Results layout">
              <span className="search-layout-label">Layout</span>
              <div className="search-layout-buttons">
                {(
                  [
                    ["comfortable", "Comfortable"],
                    ["compact", "Compact"],
                    ["tiles", "Tiles"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={`search-layout-btn ${resultsLayout === value ? "active" : ""}`}
                    aria-pressed={resultsLayout === value}
                    onClick={() => setResultsLayout(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            </div>
        <div className="search-hero-row">
          <label className="field search-hero-query">
            <span>Query</span>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onQueryKeyDown}
              placeholder="Artist, title, tags…"
            />
          </label>
          <label className="field search-hero-mode">
            <span>Mode</span>
            <NeuSelect
              id="search-mode"
              value={mode}
              onChange={(v) => setMode(v as Mode)}
              options={SEARCH_MODE_OPTIONS}
            />
          </label>
          <label className="field search-hero-section">
            <span>Section</span>
            <NeuSelect
              id="search-section"
              value={section}
              onChange={setSection}
              options={SEARCH_SECTION_OPTIONS}
            />
          </label>
          <label className="field search-hero-sort">
            <span>Sort</span>
            <NeuSelect
              id="search-sort"
              value={sort}
              onChange={setSort}
              options={SEARCH_SORT_OPTIONS}
            />
          </label>
          <div className="search-hero-actions">
            <button type="button" className="primary" disabled={searching} onClick={() => void runSearch(false)}>
              {searching ? "Searching…" : "Search"}
            </button>
          </div>
        </div>
        </div>
        {searchError && (
          <div className="error-banner error-banner--recover" role="alert">
            <span>{searchError}</span>
            <button type="button" className="secondary" disabled={searching} onClick={() => void runSearch(false)}>
              Try again
            </button>
          </div>
        )}
        <details className="disclosure-block search-advanced-filters">
          <summary>More filters — star range, API ids, NSFW</summary>
          <div className="grid-2 search-catalog-filters-grid">
            <label className="field">
              <span>Min stars</span>
              <input
                type="number"
                step="0.1"
                value={minStars}
                onChange={(e) => setMinStars(e.target.value)}
              />
            </label>
            <label className="field">
              <span>Max stars</span>
              <input
                type="number"
                step="0.1"
                value={maxStars}
                onChange={(e) => setMaxStars(e.target.value)}
              />
            </label>
            <label className="field">
              <span>Genre id (g)</span>
              <input
                type="text"
                value={genre}
                onChange={(e) => setGenre(e.target.value)}
                placeholder="e.g. 4"
              />
            </label>
            <label className="field">
              <span>Language id (l)</span>
              <input type="text" value={language} onChange={(e) => setLanguage(e.target.value)} />
            </label>
            <label className="field">
              <span>Extras (e), dot-separated</span>
              <input
                type="text"
                value={extras}
                onChange={(e) => setExtras(e.target.value)}
                placeholder="video"
              />
            </label>
            <label className="field">
              <span>General (c), dot-separated</span>
              <input
                type="text"
                value={general}
                onChange={(e) => setGeneral(e.target.value)}
                placeholder="featured_artists"
              />
            </label>
            <label className="field">
              <span>Ranks (r), dot-separated</span>
              <input
                type="text"
                value={ranks}
                onChange={(e) => setRanks(e.target.value)}
                placeholder="S.SH.X"
              />
            </label>
            <label className="checkbox-row checkbox-row--align-end">
              <input type="checkbox" checked={nsfw} onChange={(e) => setNsfw(e.target.checked)} />
              Include NSFW
            </label>
          </div>
        </details>
        <div className="search-secondary-actions row-actions">
          <button
            type="button"
            className="secondary"
            disabled={searching || !cursorString}
            onClick={() => void runSearch(true)}
          >
            Load more
          </button>
          <label className="checkbox-row">
            <input type="checkbox" checked={noVideo} onChange={(e) => setNoVideo(e.target.checked)} />
            Downloads without video (recommended)
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={hideOwnedSearch}
              onChange={(e) => setHideOwnedSearch(e.target.checked)}
            />
            Hide maps already in Songs folder
          </label>
        </div>
        <details className="disclosure-block curate-panel">
          <summary>Curate — maps you don&apos;t have yet</summary>
          <p className="hint curate-panel-desc">
            Uses the same filters as search. Discover shuffles; New ranked picks latest ranked first.
          </p>
          {curateError && <div className="error-banner">{curateError}</div>}
          <div className="row-actions">
            <button
              type="button"
              className="primary"
              disabled={curating || searching}
              onClick={() => void runCurateDiscover()}
            >
              {curating ? "Curating…" : "Discover (shuffle)"}
            </button>
            <button
              type="button"
              className="secondary"
              disabled={curating || searching}
              onClick={() => void runCurateNewRanked()}
            >
              New ranked
            </button>
            {curateResults.length > 0 && (
              <button type="button" className="secondary" onClick={() => setCurateResults([])}>
                Clear picks
              </button>
            )}
          </div>
        </details>
        <details className="disclosure-block search-tips">
          <summary>Search tips</summary>
          <p className="hint">
            Star range filters by mode on the client. Imports are full sets (.osz); press <strong>F5</strong> in song
            select if a new set doesn&apos;t appear.
            {total != null && (
              <>
                {" "}
                API total (pre-filter): <strong>{total}</strong>.
              </>
            )}
          </p>
        </details>
        {activeCollection && (
          <p className="hint search-active-collection-hint">
            <strong>Collection:</strong> {activeCollection.name}
          </p>
        )}
      </div>

      {curateResults.length > 0 && (
        <div className="panel panel-nested curate-results-panel">
          <div className="panel-head">
            <h2>Curated picks</h2>
            <p className="panel-sub">Not in Songs — import or save to a collection.</p>
          </div>
          <div className={resultsGridClass}>
            {curateResults.map((raw) => {
              const sid = Number((raw as Record<string, unknown>).id);
              return (
                <BeatmapResultCard
                  key={`curate-${sid}`}
                  raw={raw}
                  mode={mode}
                  avgPp={avgPp}
                  directImportSetId={directImportSetId}
                  activeItems={activeItems}
                  localBeatmapsetIds={localBeatmapsetIds}
                  importFromSearch={importFromSearch}
                  onInspectSet={onInspectSet}
                  sendBeatmapToParty={sendBeatmapToParty}
                  addToCollection={addToCollection}
                  showPartyActions={showPartyActions}
                  showCollectionActions={showCollectionActions}
                  partyCanSend={partyCanSend}
                />
              );
            })}
          </div>
        </div>
      )}

      <div className={resultsGridClass} aria-busy={searching ? true : undefined} aria-live="polite">
        {searchDisplayResults.length === 0 &&
          rawResults.length > 0 &&
          hideOwnedSearch &&
          searchAttempted &&
          !searching && (
            <div className="empty-state">
              <p className="empty-title">All hidden</p>
              <p className="empty-text">
                Every result is already in your Songs folder. Turn off &quot;Hide maps already in Songs folder&quot; to
                see them, or run Search again for different maps.
              </p>
            </div>
          )}
        {rawResults.length === 0 && searchAttempted && !searching && (
          <div className="empty-state">
            <p className="empty-title">No beatmaps here</p>
            <p className="empty-text">
              {query.trim() === ""
                ? "Add a keyword in Query, or relax filters (section, star range, advanced). Very narrow filters can return nothing."
                : "Try a wider star range, another section, or a shorter query. Maps with downloads disabled are hidden."}
            </p>
          </div>
        )}
        {rawResults.length === 0 && !searchAttempted && !searching && (
          <div className="empty-state">
            <p className="empty-title">Ready when you are</p>
            <p className="empty-text">Set mode and filters, then press Search to load beatmap sets from osu!.</p>
          </div>
        )}
        {searching && rawResults.length === 0 && (
          <>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={`sk-${i}`} className="result-skeleton-card" aria-hidden>
                <div className="result-skeleton-card__thumb" />
                <div className="result-skeleton-card__lines">
                  <div className="result-skeleton-card__line" />
                  <div className="result-skeleton-card__line result-skeleton-card__line--short" />
                </div>
              </div>
            ))}
            <span className="visually-hidden">Fetching results</span>
          </>
        )}
        {searchDisplayResults.map((raw) => {
          const set = raw as Record<string, unknown>;
          const sid = Number(set.id);
          return (
            <BeatmapResultCard
              key={sid}
              raw={raw}
              mode={mode}
              avgPp={avgPp}
              directImportSetId={directImportSetId}
              activeItems={activeItems}
              localBeatmapsetIds={localBeatmapsetIds}
              importFromSearch={importFromSearch}
              onInspectSet={onInspectSet}
              sendBeatmapToParty={sendBeatmapToParty}
              addToCollection={addToCollection}
              showPartyActions={showPartyActions}
              showCollectionActions={showCollectionActions}
              partyCanSend={partyCanSend}
            />
          );
        })}
      </div>
    </>
  );
}
