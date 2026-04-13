/**
 * Party-server challenge list and standings shapes (snake_case from SQLite / JSON).
 */
export type ChallengeScoreRow = {
  user_osu_id: number;
  score: number;
  rank_value: number | null;
  pp: number | null;
  stars: number | null;
  play_beatmap_id: number | null;
  baseline_pp_per_star: number | null;
  is_unweighted: number | boolean;
};

export type ChallengeRow = {
  id: number;
  creator_osu_id: number;
  beatmapset_id: number;
  beatmap_id: number | null;
  rules_json: unknown;
  deadline: number;
  status: string;
  created_at: number;
  participant_count: number;
  /** In the participant table (Join or first submit on a global challenge). */
  joined?: boolean;
  i_am_in: boolean;
  standings_top: ChallengeScoreRow[];
  my_standing: ChallengeScoreRow | null;
};
