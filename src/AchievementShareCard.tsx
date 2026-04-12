import { forwardRef } from "react";
import { toBlob } from "html-to-image";
import type { AchievementDef } from "./achievements/catalog";

export type AchievementShareCardProps = {
  achievement: AchievementDef;
  earnedAtMs: number;
  displayName: string;
};

function formatEarnedDate(ms: number): string {
  try {
    return new Date(ms).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return String(ms);
  }
}

export const AchievementShareCard = forwardRef<HTMLDivElement, AchievementShareCardProps>(
  function AchievementShareCard({ achievement, earnedAtMs, displayName }, ref) {
    return (
      <div
        ref={ref}
        className="achievement-share-card"
        style={{
          width: 560,
          height: 320,
          boxSizing: "border-box",
        }}
      >
        <div className="achievement-share-card-inner">
          <div className="achievement-share-top">
            <p className="achievement-share-brand">osu!link</p>
            <p className="achievement-share-username">{displayName}</p>
          </div>
          <p className={`achievement-share-tier achievement-share-tier--${achievement.tier}`}>{achievement.tier}</p>
          <h2 className="achievement-share-title">{achievement.title}</h2>
          <p className="achievement-share-desc">{achievement.description}</p>
          <div className="achievement-share-meta">
            <span className="achievement-share-earned-label">Earned</span>
            <span className="achievement-share-date">{formatEarnedDate(earnedAtMs)}</span>
          </div>
        </div>
      </div>
    );
  },
);

export async function achievementCardToPngBlob(el: HTMLElement): Promise<Blob | null> {
  return toBlob(el, {
    pixelRatio: 2,
    cacheBust: true,
    backgroundColor: "#14141c",
  });
}

export async function copyAchievementPngToClipboard(el: HTMLElement): Promise<boolean> {
  const blob = await achievementCardToPngBlob(el);
  if (!blob || !navigator.clipboard?.write) return false;
  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    return true;
  } catch {
    return false;
  }
}

export function downloadAchievementPng(blob: Blob, safeTitle: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `osu-link-${safeTitle.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "achievement"}.png`;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
