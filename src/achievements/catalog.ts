/** Static achievement definitions (ids must stay stable for server sync). */

export const ACHIEVEMENT_CATALOG_VERSION = 2 as const;

export type AchievementCategory = "app" | "training" | "social";

export type AchievementTier = "bronze" | "silver" | "gold" | "special";

export interface AchievementDef {
  id: string;
  title: string;
  description: string;
  category: AchievementCategory;
  tier: AchievementTier;
  /** If true, title/description hidden in UI until earned */
  hiddenUntilEarned?: boolean;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  /* —— App —— */
  {
    id: "app-onboarding",
    title: "Welcome aboard",
    description: "Finish onboarding and connect osu-link.",
    category: "app",
    tier: "bronze",
  },
  {
    id: "app-oauth",
    title: "Signed in",
    description: "Connect your osu! account via OAuth.",
    category: "app",
    tier: "bronze",
  },
  {
    id: "app-library-10",
    title: "Collector",
    description: "Index at least 10 beatmap sets in your Songs folder.",
    category: "app",
    tier: "bronze",
  },
  {
    id: "app-library-50",
    title: "Archivist",
    description: "Index at least 50 beatmap sets locally.",
    category: "app",
    tier: "silver",
  },
  {
    id: "app-library-100",
    title: "Library whale",
    description: "Index at least 100 beatmap sets locally.",
    category: "app",
    tier: "gold",
  },
  {
    id: "app-library-250",
    title: "Hoarder supreme",
    description: "Index at least 250 beatmap sets locally.",
    category: "app",
    tier: "gold",
  },

  /* —— Training —— */
  {
    id: "train-first-session",
    title: "First drill",
    description: "Complete at least one training session.",
    category: "training",
    tier: "bronze",
  },
  {
    id: "train-sessions-5",
    title: "Routine",
    description: "Complete 5 training sessions.",
    category: "training",
    tier: "bronze",
  },
  {
    id: "train-sessions-25",
    title: "Grinder",
    description: "Complete 25 training sessions.",
    category: "training",
    tier: "silver",
  },
  {
    id: "train-custom-set",
    title: "Curator",
    description: "Finish a session using a custom training set.",
    category: "training",
    tier: "bronze",
  },
  {
    id: "train-mode-taiko",
    title: "Don notes",
    description: "Complete a training session in Taiko mode.",
    category: "training",
    tier: "bronze",
  },
  {
    id: "train-mode-catch",
    title: "Fruit catcher",
    description: "Complete a training session in Catch mode.",
    category: "training",
    tier: "bronze",
  },
  {
    id: "train-mode-mania",
    title: "Keysmith",
    description: "Complete a training session in Mania mode.",
    category: "training",
    tier: "bronze",
  },
  {
    id: "train-oops",
    title: "Honest attempt",
    description: "Fail a training map (below accuracy threshold) at least once.",
    category: "training",
    tier: "bronze",
  },
  {
    id: "train-maps-10",
    title: "Ten clears",
    description: "Pass 10 maps in training.",
    category: "training",
    tier: "silver",
  },
  {
    id: "train-maps-50",
    title: "Fifty clears",
    description: "Pass 50 maps in training.",
    category: "training",
    tier: "gold",
  },
  {
    id: "train-maps-100",
    title: "Century club",
    description: "Pass 100 maps in training.",
    category: "training",
    tier: "gold",
  },
  {
    id: "train-maps-250",
    title: "Quarter thousand",
    description: "Pass 250 maps in training.",
    category: "training",
    tier: "special",
  },
  {
    id: "train-accuracy-99",
    title: "Nail the acc",
    description: "Pass a training map with 99% accuracy or higher.",
    category: "training",
    tier: "silver",
  },
  {
    id: "train-peak-4",
    title: "Peak IV",
    description: "Reach 4★ peak stars in a training session.",
    category: "training",
    tier: "bronze",
  },
  {
    id: "train-peak-5",
    title: "Peak V",
    description: "Reach 5★ peak stars in a training session.",
    category: "training",
    tier: "silver",
  },
  {
    id: "train-peak-6",
    title: "Peak VI",
    description: "Reach 6★ peak stars in a training session.",
    category: "training",
    tier: "silver",
  },
  {
    id: "train-peak-7",
    title: "Peak VII",
    description: "Reach 7★ peak stars in a training session.",
    category: "training",
    tier: "gold",
  },
  {
    id: "train-peak-8",
    title: "Peak VIII",
    description: "Reach 8★ peak stars in a training session.",
    category: "training",
    tier: "gold",
  },

  /* —— Social —— */
  {
    id: "social-friend-request",
    title: "Reach out",
    description: "Send a friend request on the party server.",
    category: "social",
    tier: "bronze",
  },
  {
    id: "social-first-friend",
    title: "Circle",
    description: "Have an accepted friend on the party server.",
    category: "social",
    tier: "bronze",
  },
  {
    id: "social-friends-5",
    title: "Squad",
    description: "Have 5 accepted friends on the party server.",
    category: "social",
    tier: "silver",
  },
  {
    id: "social-challenge-join",
    title: "Contender",
    description: "Join an open challenge.",
    category: "social",
    tier: "silver",
  },
  {
    id: "social-challenge-join-3",
    title: "Regular",
    description: "Join 3 open challenges (lifetime).",
    category: "social",
    tier: "silver",
  },
  {
    id: "social-battle-done",
    title: "Duelist",
    description: "Complete an async battle (closed).",
    category: "social",
    tier: "silver",
  },
  {
    id: "social-battle-win",
    title: "Victory lap",
    description: "Win an async battle.",
    category: "social",
    tier: "gold",
  },
  {
    id: "social-battle-wins-3",
    title: "Triumphant",
    description: "Win 3 async battles.",
    category: "social",
    tier: "gold",
  },
];

const byId = new Map(ACHIEVEMENTS.map((a) => [a.id, a]));

export function getAchievementDef(id: string): AchievementDef | undefined {
  return byId.get(id);
}
