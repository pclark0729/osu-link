/** Crockford base32 alphabet (matches party-server lobby codes). */
const CODE_RUN = /[0-9A-HJKMNP-TV-Z]{4,8}/gi;

function normalizeLobbyCode(s: string): string {
  return s.trim().toUpperCase().replace(/[^0-9A-HJKMNP-TV-Z]/g, "");
}

function pickBestRun(runs: string[]): string | null {
  const upper = runs.map((r) => r.toUpperCase());
  const six = upper.find((r) => r.length === 6);
  if (six) return six;
  const ok = upper.filter((r) => r.length >= 4);
  if (ok.length === 0) return null;
  return ok.sort((a, b) => b.length - a.length)[0];
}

/**
 * Extract a lobby join code from free text, a URL (query or last path segment), or a bare code.
 */
export function parseLobbyCodeFromText(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  try {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) || trimmed.startsWith("//")) {
      const u = new URL(trimmed.startsWith("//") ? `https:${trimmed}` : trimmed);
      for (const key of ["code", "lobby", "join", "room"]) {
        const v = u.searchParams.get(key);
        if (v) {
          const c = normalizeLobbyCode(v);
          if (c.length >= 4) return c;
        }
      }
      const segments = u.pathname.split("/").filter(Boolean);
      const last = segments[segments.length - 1];
      if (last) {
        const c = normalizeLobbyCode(last);
        if (c.length >= 4 && c.length <= 8) return c;
      }
    }
  } catch {
    /* not a usable URL */
  }

  const runs = [...trimmed.matchAll(CODE_RUN)].map((m) => m[0]);
  const fromRuns = pickBestRun(runs);
  if (fromRuns) return fromRuns;

  const fallback = normalizeLobbyCode(trimmed);
  return fallback.length >= 4 ? fallback : null;
}
