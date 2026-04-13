import { describe, expect, it } from "vitest";
import { asRecord, battleActionSortKey, sortActiveBattlesByPriority } from "./battleUtils";

function battleRow(
  id: number,
  opts: {
    creator: number;
    opponent: number;
    windowEnd: number;
    state?: string;
    scores?: unknown[];
    relative_pp?: number;
  },
): unknown {
  return {
    id,
    creator_osu_id: opts.creator,
    opponent_osu_id: opts.opponent,
    window_end: opts.windowEnd,
    window_start: opts.windowEnd - 86_400_000,
    state: opts.state ?? "open",
    scores: opts.scores ?? [],
    relative_pp: opts.relative_pp ?? 1,
    beatmapset_id: 1,
  };
}

describe("battleActionSortKey", () => {
  const me = 100;
  const other = 200;
  const end = Date.now() + 60_000;

  it("prioritizes your turn over open", () => {
    const open = battleRow(1, { creator: me, opponent: other, windowEnd: end, scores: [] });
    const yourTurn = battleRow(2, {
      creator: me,
      opponent: other,
      windowEnd: end,
      scores: [{ user_osu_id: other, score: 1e6 }],
    });
    expect(battleActionSortKey(yourTurn, me).tier).toBe(0);
    expect(battleActionSortKey(open, me).tier).toBe(1);
  });
});

describe("sortActiveBattlesByPriority", () => {
  const me = 10;
  const other = 20;
  const endSoon = Date.now() + 60_000;
  const endLater = Date.now() + 120_000;

  it("orders by tier then sooner deadline", () => {
    const a = battleRow(1, { creator: me, opponent: other, windowEnd: endLater, scores: [] });
    const b = battleRow(2, {
      creator: me,
      opponent: other,
      windowEnd: endSoon,
      scores: [{ user_osu_id: other, score: 1e6 }],
    });
    const c = battleRow(3, { creator: me, opponent: other, windowEnd: endSoon, scores: [] });
    const sorted = sortActiveBattlesByPriority([a, b, c], me);
    expect(asRecord(sorted[0]).id).toBe(2);
    expect(asRecord(sorted[1]).id).toBe(3);
    expect(asRecord(sorted[2]).id).toBe(1);
  });
});
