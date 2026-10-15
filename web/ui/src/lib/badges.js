/**
 * Client badge catalog (mirrors web/lib/badges.mjs).
 * Prefer API-resolved badge objects; this map fills titles when only ids arrive.
 */

export const WEAR_LIMIT = 2;

export const BADGE_CATALOG = [
  { id: "tok_listed", scope: "token", icon: "🦄", titleEn: "DEX Listed", titleVi: "Đã list DEX", rarity: "epic" },
  { id: "tok_grad", scope: "token", icon: "🎓", titleEn: "Graduated", titleVi: "Đã graduate", rarity: "rare" },
  { id: "tok_raise_half", scope: "token", icon: "⚓", titleEn: "Half Raise", titleVi: "Nửa raise", rarity: "epic" },
  { id: "tok_near_grad", scope: "token", icon: "🔥", titleEn: "Near Grad", titleVi: "Gần graduate", rarity: "rare" },
  { id: "tok_fresh", scope: "token", icon: "🌱", titleEn: "Fresh Launch", titleVi: "Launch mới", rarity: "common" },
  { id: "tok_buyers_l", scope: "token", icon: "🏛️", titleEn: "50 Buyers", titleVi: "50 buyers", rarity: "epic" },
  { id: "tok_buyers_m", scope: "token", icon: "📣", titleEn: "25 Buyers", titleVi: "25 buyers", rarity: "rare" },
  { id: "tok_buyers_s", scope: "token", icon: "👥", titleEn: "10 Buyers", titleVi: "10 buyers", rarity: "common" },
  { id: "tok_vol_l", scope: "token", icon: "🌊", titleEn: "Volume Wave", titleVi: "Volume sóng", rarity: "epic" },
  { id: "tok_vol_m", scope: "token", icon: "💧", titleEn: "Volume Flow", titleVi: "Volume chảy", rarity: "rare" },
  { id: "tok_vol_s", scope: "token", icon: "✨", titleEn: "Volume Spark", titleVi: "Volume tia", rarity: "common" },
  { id: "tok_fdv_l", scope: "token", icon: "📈", titleEn: "FDV Mark 40k", titleVi: "FDV mark 40k", rarity: "epic" },
  { id: "tok_fdv_m", scope: "token", icon: "📊", titleEn: "FDV Mark 15k", titleVi: "FDV mark 15k", rarity: "rare" },
  { id: "cre_listed", scope: "creator", icon: "🦄", titleEn: "Lister", titleVi: "Người list DEX", rarity: "epic" },
  { id: "cre_grad_pro", scope: "creator", icon: "🏆", titleEn: "Graduation Pro", titleVi: "Pro graduate", rarity: "epic" },
  { id: "cre_vol_sum", scope: "creator", icon: "🌊", titleEn: "Volume Builder", titleVi: "Xây volume", rarity: "epic" },
  { id: "cre_raise_l", scope: "creator", icon: "🏦", titleEn: "Raise 10k", titleVi: "Tổng raise 10k", rarity: "epic" },
  { id: "cre_fdv_peak", scope: "creator", icon: "📈", titleEn: "Peak FDV 40k", titleVi: "Đỉnh FDV 40k", rarity: "epic" },
  { id: "cre_crowd", scope: "creator", icon: "🧲", titleEn: "Crowd Sum", titleVi: "Tổng crowd", rarity: "rare" },
  { id: "cre_raise_m", scope: "creator", icon: "📦", titleEn: "Raise 5k", titleVi: "Tổng raise 5k", rarity: "rare" },
  { id: "cre_grad_one", scope: "creator", icon: "🎯", titleEn: "Graduate Maker", titleVi: "Người làm graduate", rarity: "rare" },
  { id: "cre_vol_sum_s", scope: "creator", icon: "✨", titleEn: "Volume Starter", titleVi: "Volume khởi", rarity: "rare" },
  { id: "cre_raise_s", scope: "creator", icon: "🌱", titleEn: "Raise 1k", titleVi: "Tổng raise 1k", rarity: "common" },
  { id: "cre_first", scope: "creator", icon: "🚀", titleEn: "First Launch", titleVi: "Launch đầu", rarity: "common" },
  { id: "tr_holder", scope: "trader", icon: "🎒", titleEn: "Bag Holder", titleVi: "Giữ túi", rarity: "common" },
  { id: "tr_multi", scope: "trader", icon: "🗃️", titleEn: "Multi-Bag", titleVi: "Nhiều túi", rarity: "rare" },
  { id: "tr_heavy", scope: "trader", icon: "💪", titleEn: "Sized Bag (est.)", titleVi: "Túi ước tính", rarity: "rare" },
  { id: "tr_diamond", scope: "trader", icon: "💎", titleEn: "Large Bag (est.)", titleVi: "Túi lớn (ước tính)", rarity: "epic" },
];

const BY_ID = Object.fromEntries(BADGE_CATALOG.map((b) => [b.id, b]));

export function resolveBadge(b, lang = "en") {
  if (!b) return null;
  if (typeof b === "string") {
    const def = BY_ID[b];
    if (!def) return { id: b, icon: "🏅", title: b, rarity: "common" };
    return {
      ...def,
      title: lang === "vi" ? def.titleVi : def.titleEn,
    };
  }
  const def = BY_ID[b.id] || {};
  return {
    ...def,
    ...b,
    title:
      lang === "vi"
        ? b.titleVi || def.titleVi || b.titleEn || b.id
        : b.titleEn || def.titleEn || b.id,
  };
}

export function wearFromMarket(m, limit = WEAR_LIMIT) {
  const list = Array.isArray(m?.wearBadges)
    ? m.wearBadges
    : Array.isArray(m?.badges)
      ? m.badges.slice(0, limit)
      : [];
  return list.slice(0, limit);
}
