import { resolveBadge } from "../lib/badges";
import { usePrefs } from "../context/PrefsContext";

/**
 * Pools-style achievement badge chip (token / creator / trader).
 * Distinct from status Badge (curve/grad/heat).
 */
export function AchievementBadge({ badge, size = "md", className = "" }) {
  const { lang } = usePrefs();
  const b = resolveBadge(badge, lang === "vi" ? "vi" : "en");
  if (!b) return null;
  const tip = [b.title, b.descEn || b.descVi || b.reason].filter(Boolean).join(" — ");
  return (
    <span
      className={`ach-badge ach-${b.rarity || "common"} ach-${size}${className ? ` ${className}` : ""}`}
      title={tip}
      data-badge-id={b.id}
    >
      <span className="ach-icon" aria-hidden="true">
        {b.icon || "🏅"}
      </span>
      <span className="ach-title">{b.title}</span>
    </span>
  );
}

/** Row of badges — wear (compact) or full collection. */
export function AchievementBadgeRow({
  badges = [],
  limit = null,
  size = "sm",
  empty = null,
  className = "",
}) {
  const list = Array.isArray(badges) ? badges : [];
  const shown = limit != null ? list.slice(0, limit) : list;
  if (!shown.length) return empty;
  return (
    <div className={`ach-badge-row${className ? ` ${className}` : ""}`}>
      {shown.map((b) => (
        <AchievementBadge key={b.id || b} badge={b} size={size} />
      ))}
    </div>
  );
}

export default AchievementBadge;
