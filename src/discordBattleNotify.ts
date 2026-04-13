const STORAGE_KEY = "osu-link.discord-battle-notifications.v1";

export function loadDiscordBattleNotificationsEnabled(): boolean {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "1";
  } catch {
    return false;
  }
}

export function saveDiscordBattleNotificationsEnabled(on: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
}

/**
 * Fire-and-forget DM via party-server (same Bearer as Discord control session).
 */
export function notifyDiscordBattle(
  socialApiBase: string,
  discordSessionToken: string,
  title: string,
  body: string,
): void {
  const base = socialApiBase.trim().replace(/\/$/, "");
  if (!base || !discordSessionToken.trim()) return;
  const url = `${base}/api/v1/discord-control/notify`;
  void fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${discordSessionToken.trim()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ title, body }),
  }).catch(() => {
    /* best-effort */
  });
}
