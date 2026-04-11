import { useMemo } from "react";
import { NeuSelect } from "./NeuSelect";
import {
  type Mode,
  SEARCH_MODE_OPTIONS,
  SEARCH_SECTION_OPTIONS,
  SEARCH_SORT_OPTIONS,
  topBeatmapIdForMode,
} from "./searchTypes";
import type { SearchDownloadState } from "./useSearchDownloadState";
import { formatAvgPp, useBeatmapAvgPp } from "./useBeatmapAvgPp";

function AvgPpLine({
  beatmapId,
  avgPp,
}: {
  beatmapId: number | null;
  avgPp: Record<number, number | null>;
}) {
  if (beatmapId == null) return null;
  const v = avgPp[beatmapId];
  return (
    <div
      className="result-meta-pp-cap"
      title="Mean PP on osu! global top scores for this difficulty (actual scores, not a theoretical SS)."
    >
      Avg PP: {v === undefined ? "…" : v === null ? "—" : `${formatAvgPp(v)} pp`}
    </div>
  );
}

export function SearchDownloadPanel({
  s,
  variant,
}: {
  s: SearchDownloadState;
  variant: "main" | "overlay";
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
  } = s;

  const avgPpBeatmapIds = useMemo(() => {
    const a = searchDisplayResults.map((r) => topBeatmapIdForMode(r, mode));
    const b = curateResults.map((r) => topBeatmapIdForMode(r, mode));
    return [...a, ...b];
  }, [searchDisplayResults, curateResults, mode]);
  const avgPp = useBeatmapAvgPp(avgPpBeatmapIds, mode);

  const panelClass =
    variant === "overlay" ? "panel panel-elevated overlay-search-panel" : "panel panel-elevated";

  return (
    <>
      <div className={panelClass}>
        <div className="panel-head">
          <h2>Search beatmaps</h2>
          <p className="panel-sub">
            Query the live osu! catalogue, then import or save sets to a collection.
          </p>
        </div>
        {searchError && <div className="error-banner">{searchError}</div>}
        <div className="grid-2">
          <label className="field">
            <span>Query</span>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Artist, title, tags…"
            />
          </label>
          <label className="field">
            <span>Mode</span>
            <NeuSelect
              id={variant === "overlay" ? "search-mode-overlay" : "search-mode"}
              value={mode}
              onChange={(v) => setMode(v as Mode)}
              options={SEARCH_MODE_OPTIONS}
            />
          </label>
          <label className="field">
            <span>Section</span>
            <NeuSelect
              id={variant === "overlay" ? "search-section-overlay" : "search-section"}
              value={section}
              onChange={setSection}
              options={SEARCH_SECTION_OPTIONS}
            />
          </label>
          <label className="field">
            <span>Sort (default: most played)</span>
            <NeuSelect
              id={variant === "overlay" ? "search-sort-overlay" : "search-sort"}
              value={sort}
              onChange={setSort}
              options={SEARCH_SORT_OPTIONS}
            />
          </label>
          <label className="field">
            <span>Min stars (filter)</span>
            <input
              type="number"
              step="0.1"
              value={minStars}
              onChange={(e) => setMinStars(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Max stars (filter)</span>
            <input
              type="number"
              step="0.1"
              value={maxStars}
              onChange={(e) => setMaxStars(e.target.value)}
            />
          </label>
        </div>
        <details className="advanced">
          <summary>Advanced filters (API params)</summary>
          <div className="grid-2" style={{ marginTop: "0.75rem" }}>
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
            <label className="checkbox-row" style={{ alignSelf: "end" }}>
              <input type="checkbox" checked={nsfw} onChange={(e) => setNsfw(e.target.checked)} />
              Include NSFW
            </label>
          </div>
        </details>
        <div className="row-actions">
          <button type="button" className="primary" disabled={searching} onClick={() => void runSearch(false)}>
            {searching ? "Searching…" : "Search"}
          </button>
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
        <div className="curate-panel">
          <div className="curate-panel-title">Curate</div>
          <p className="hint curate-panel-desc">
            Picks maps you don&apos;t have locally yet (same mode / star / advanced filters as above). Discover uses
            your sort and shuffles; New ranked uses ranked sets sorted by most recently ranked.
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
                Clear curated picks
              </button>
            )}
          </div>
        </div>
        <p className="hint">
          Results are filtered client-side so at least one difficulty in the selected mode fits your star range.
          Downloads are full beatmap sets (.osz). After import, press <strong>F5</strong> in osu!stable song select if
          needed.
        </p>
        {total != null && (
          <p className="hint">
            API total (before star filter): <strong>{total}</strong>
          </p>
        )}
        {activeCollection && (
          <p className="hint">
            <strong>Add to collection:</strong> {activeCollection.name}
          </p>
        )}
      </div>

      {curateResults.length > 0 && (
        <div className="panel panel-nested curate-results-panel">
          <div className="panel-head">
            <h2>Curated picks</h2>
            <p className="panel-sub">Sets not detected in your Songs folder — import or save to a collection.</p>
          </div>
          <div className="results results-grid">
            {curateResults.map((raw) => {
              const set = raw as Record<string, unknown>;
              const covers = set.covers as Record<string, string> | undefined;
              const sid = Number(set.id);
              const disabledDl =
                (set.availability as { download_disabled?: boolean } | undefined)?.download_disabled === true;
              const inColl = activeItems.some((c) => c.beatmapsetId === sid);
              const importingThis = directImportSetId === sid;
              const locallyPresent = localBeatmapsetIds.has(sid);
              return (
                <div key={`curate-${sid}`} className="result-card">
                  <img src={covers?.list || covers?.card || ""} alt="" loading="lazy" />
                  <div className="result-meta">
                    <div className="title">{String(set.title)}</div>
                    <div className="sub">
                      {String(set.artist)} — mapped by {String(set.creator)}
                    </div>
                    <AvgPpLine beatmapId={topBeatmapIdForMode(raw, mode)} avgPp={avgPp} />
                    {set.status != null && <span className="tag">{String(set.status)}</span>}
                    {locallyPresent && <span className="tag tag-local">In Songs folder</span>}
                  </div>
                  <div className="result-actions">
                    <button
                      type="button"
                      className="primary"
                      disabled={disabledDl || locallyPresent || importingThis || directImportSetId !== null}
                      onClick={() => void importFromSearch(sid)}
                    >
                      {locallyPresent ? "Already imported" : importingThis ? "Importing…" : "Import now"}
                    </button>
                    {showPartyActions && (
                      <button
                        type="button"
                        className="secondary"
                        disabled={!partyCanSend || disabledDl}
                        onClick={() =>
                          sendBeatmapToParty({
                            beatmapsetId: sid,
                            artist: String(set.artist ?? ""),
                            title: String(set.title ?? ""),
                            creator: String(set.creator ?? ""),
                            coverUrl: covers?.list ?? covers?.card ?? null,
                          })
                        }
                        title={
                          partyCanSend
                            ? "Leader: queue this set for everyone in the lobby"
                            : "Create or join a lobby as leader"
                        }
                      >
                        Send to party
                      </button>
                    )}
                    {showCollectionActions && (
                      <button
                        type="button"
                        className="secondary"
                        disabled={inColl}
                        onClick={() => addToCollection(set)}
                      >
                        {inColl ? "In this collection" : "Add to collection"}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="results results-grid">
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
              Try a wider star range, another section, or a shorter query. Maps with downloads disabled are hidden.
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
          <div className="empty-state">
            <div className="boot-spinner boot-spinner-inline" aria-hidden />
            <p className="empty-text">Fetching results…</p>
          </div>
        )}
        {searchDisplayResults.map((raw) => {
          const set = raw as Record<string, unknown>;
          const covers = set.covers as Record<string, string> | undefined;
          const sid = Number(set.id);
          const disabledDl =
            (set.availability as { download_disabled?: boolean } | undefined)?.download_disabled === true;
          const inColl = activeItems.some((c) => c.beatmapsetId === sid);
          const importingThis = directImportSetId === sid;
          const locallyPresent = localBeatmapsetIds.has(sid);
          return (
            <div key={sid} className="result-card">
              <img src={covers?.list || covers?.card || ""} alt="" loading="lazy" />
              <div className="result-meta">
                <div className="title">{String(set.title)}</div>
                <div className="sub">
                  {String(set.artist)} — mapped by {String(set.creator)}
                </div>
                <AvgPpLine beatmapId={topBeatmapIdForMode(raw, mode)} avgPp={avgPp} />
                {set.status != null && <span className="tag">{String(set.status)}</span>}
                {locallyPresent && <span className="tag tag-local">In Songs folder</span>}
              </div>
              <div className="result-actions">
                <button
                  type="button"
                  className="primary"
                  disabled={disabledDl || locallyPresent || importingThis || directImportSetId !== null}
                  onClick={() => void importFromSearch(sid)}
                >
                  {locallyPresent ? "Already imported" : importingThis ? "Importing…" : "Import now"}
                </button>
                {showPartyActions && (
                  <button
                    type="button"
                    className="secondary"
                    disabled={!partyCanSend || disabledDl}
                    onClick={() =>
                      sendBeatmapToParty({
                        beatmapsetId: sid,
                        artist: String(set.artist ?? ""),
                        title: String(set.title ?? ""),
                        creator: String(set.creator ?? ""),
                        coverUrl: covers?.list ?? covers?.card ?? null,
                      })
                    }
                    title={
                      partyCanSend
                        ? "Leader: queue this set for everyone in the lobby"
                        : "Create or join a lobby as leader"
                    }
                  >
                    Send to party
                  </button>
                )}
                {showCollectionActions && (
                  <button
                    type="button"
                    className="secondary"
                    disabled={inColl}
                    onClick={() => addToCollection(set)}
                  >
                    {inColl ? "In this collection" : "Add to collection"}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
