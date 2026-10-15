/**
 * Gnomi achievement badges (pools.xyz-inspired).
 *
 * Token + Creator: practical on-chain metrics — volume (sampled), buyers,
 * raised, FDV mark (spot×supply with honesty gates), graduate/list, early.
 * Wear ≤2 on Markets; full set on Token / Profile.
 *
 * Pure compute — discretionary recognition, not investment advice / APR.
 */

export const WEAR_LIMIT = 2;

/** @typedef {{
 *  id: string,
 *  scope: "token"|"creator"|"trader"|"season",
 *  icon: string,
 *  titleEn: string,
 *  titleVi: string,
 *  descEn: string,
 *  descVi: string,
 *  rarity: "common"|"rare"|"epic",
 *  priority: number,
 * }} BadgeDef
 */

/** @type {BadgeDef[]} */
export const BADGE_CATALOG = [
  // ── Token — milestones ───────────────────────────────────────────────
  {
    id: "tok_listed",
    scope: "token",
    icon: "🦄",
    titleEn: "DEX Listed",
    titleVi: "Đã list DEX",
    descEn: "Listed on Gnoswap (locked LP path).",
    descVi: "Đã list Gnoswap (LP khóa).",
    rarity: "epic",
    priority: 100,
  },
  {
    id: "tok_grad",
    scope: "token",
    icon: "🎓",
    titleEn: "Graduated",
    titleVi: "Đã graduate",
    descEn: "Reached graduation threshold on the pad.",
    descVi: "Đạt ngưỡng graduate trên pad.",
    rarity: "rare",
    priority: 96,
  },
  {
    id: "tok_raise_half",
    scope: "token",
    icon: "⚓",
    titleEn: "Half Raise",
    titleVi: "Nửa raise",
    descEn: "Curve raised ≥ 5,000 GNOT (~½ of Pearl 10k target).",
    descVi: "Đã raise ≥ 5.000 GNOT trên curve (~½ mục tiêu Pearl 10k).",
    rarity: "epic",
    priority: 86,
  },
  {
    id: "tok_near_grad",
    scope: "token",
    icon: "🔥",
    titleEn: "Near Grad",
    titleVi: "Gần graduate",
    descEn: "Bonding progress ≥ 70% (still on curve).",
    descVi: "Tiến độ bonding ≥ 70% (còn trên curve).",
    rarity: "rare",
    priority: 78,
  },
  {
    id: "tok_fresh",
    scope: "token",
    icon: "🌱",
    titleEn: "Fresh Launch",
    titleVi: "Launch mới",
    descEn: "Created within ~2 hours (best-effort from block height).",
    descVi: "Tạo trong ~2 giờ (ước lượng từ height).",
    rarity: "common",
    priority: 45,
  },

  // ── Token — unique buyers (holders proxy; not GRC20 holders) ─────────
  {
    id: "tok_buyers_l",
    scope: "token",
    icon: "🏛️",
    titleEn: "50 Buyers",
    titleVi: "50 buyers",
    descEn: "≥ 50 unique curve buyers (not full token holders).",
    descVi: "≥ 50 buyer unique trên curve (không phải holders GRC20).",
    rarity: "epic",
    priority: 88,
  },
  {
    id: "tok_buyers_m",
    scope: "token",
    icon: "📣",
    titleEn: "25 Buyers",
    titleVi: "25 buyers",
    descEn: "≥ 25 unique curve buyers.",
    descVi: "≥ 25 buyer unique trên curve.",
    rarity: "rare",
    priority: 80,
  },
  {
    id: "tok_buyers_s",
    scope: "token",
    icon: "👥",
    titleEn: "10 Buyers",
    titleVi: "10 buyers",
    descEn: "≥ 10 unique curve buyers.",
    descVi: "≥ 10 buyer unique trên curve.",
    rarity: "common",
    priority: 66,
  },

  // ── Token — sampled volume (activity window, not lifetime 24h) ───────
  {
    id: "tok_vol_l",
    scope: "token",
    icon: "🌊",
    titleEn: "Volume Wave",
    titleVi: "Volume sóng",
    descEn: "Sampled curve volume ≥ 1,000 GNOT (activity window; not lifetime).",
    descVi: "Volume curve mẫu ≥ 1.000 GNOT (cửa sổ activity; không phải lifetime).",
    rarity: "epic",
    priority: 90,
  },
  {
    id: "tok_vol_m",
    scope: "token",
    icon: "💧",
    titleEn: "Volume Flow",
    titleVi: "Volume chảy",
    descEn: "Sampled curve volume ≥ 250 GNOT (activity window).",
    descVi: "Volume curve mẫu ≥ 250 GNOT (cửa sổ activity).",
    rarity: "rare",
    priority: 82,
  },
  {
    id: "tok_vol_s",
    scope: "token",
    icon: "✨",
    titleEn: "Volume Spark",
    titleVi: "Volume tia",
    descEn: "Sampled curve volume ≥ 50 GNOT (activity window).",
    descVi: "Volume curve mẫu ≥ 50 GNOT (cửa sổ activity).",
    rarity: "common",
    priority: 68,
  },

  // ── Token — FDV mark (spot×1B; dual-gated vs virtual early mark) ─────
  {
    id: "tok_fdv_l",
    scope: "token",
    icon: "📈",
    titleEn: "FDV Mark 40k",
    titleVi: "FDV mark 40k",
    descEn:
      "Spot FDV (price×1B) ≥ 40,000 GNOT and near/at graduate. Early curve FDV can be virtual — not cash raised.",
    descVi:
      "FDV spot (giá×1B) ≥ 40.000 GNOT và gần/đã graduate. FDV sớm có thể ảo — không phải GNOT đã raise.",
    rarity: "epic",
    priority: 92,
  },
  {
    id: "tok_fdv_m",
    scope: "token",
    icon: "📊",
    titleEn: "FDV Mark 15k",
    titleVi: "FDV mark 15k",
    descEn:
      "Spot FDV ≥ 15,000 GNOT and raised ≥ 2,500 GNOT. FDV ≠ cash raised (VirtualUgnot0).",
    descVi:
      "FDV spot ≥ 15.000 GNOT và raised ≥ 2.500 GNOT. FDV ≠ số đã raise (VirtualUgnot0).",
    rarity: "rare",
    priority: 84,
  },

  // ── Creator ──────────────────────────────────────────────────────────
  {
    id: "cre_listed",
    scope: "creator",
    icon: "🦄",
    titleEn: "Lister",
    titleVi: "Người list DEX",
    descEn: "At least one launch listed on Gnoswap.",
    descVi: "Ít nhất 1 launch đã list Gnoswap.",
    rarity: "epic",
    priority: 100,
  },
  {
    id: "cre_grad_pro",
    scope: "creator",
    icon: "🏆",
    titleEn: "Graduation Pro",
    titleVi: "Pro graduate",
    descEn: "≥ 3 launches graduated.",
    descVi: "≥ 3 launch đã graduate.",
    rarity: "epic",
    priority: 94,
  },
  {
    id: "cre_vol_sum",
    scope: "creator",
    icon: "🌊",
    titleEn: "Volume Builder",
    titleVi: "Xây volume",
    descEn: "Sum of sampled launch volumes ≥ 2,000 GNOT (best-effort).",
    descVi: "Tổng volume mẫu các launch ≥ 2.000 GNOT (best-effort).",
    rarity: "epic",
    priority: 90,
  },
  {
    id: "cre_raise_l",
    scope: "creator",
    icon: "🏦",
    titleEn: "Raise 10k",
    titleVi: "Tổng raise 10k",
    descEn: "Sum curve raised ≥ 10,000 GNOT (≈ one full Pearl raise).",
    descVi: "Tổng raise curve ≥ 10.000 GNOT (≈ một raise Pearl đầy).",
    rarity: "epic",
    priority: 88,
  },
  {
    id: "cre_fdv_peak",
    scope: "creator",
    icon: "📈",
    titleEn: "Peak FDV 40k",
    titleVi: "Đỉnh FDV 40k",
    descEn:
      "Max spot FDV across launches ≥ 40,000 GNOT. Mark can be virtual early — not advice.",
    descVi:
      "FDV spot cao nhất ≥ 40.000 GNOT. Mark sớm có thể ảo — không phải lời khuyên.",
    rarity: "epic",
    priority: 86,
  },
  {
    id: "cre_crowd",
    scope: "creator",
    icon: "🧲",
    titleEn: "Crowd Sum",
    titleVi: "Tổng crowd",
    descEn: "Sum of unique curve buyers across launches ≥ 100.",
    descVi: "Tổng buyer unique mọi launch ≥ 100.",
    rarity: "rare",
    priority: 82,
  },
  {
    id: "cre_raise_m",
    scope: "creator",
    icon: "📦",
    titleEn: "Raise 5k",
    titleVi: "Tổng raise 5k",
    descEn: "Sum curve raised ≥ 5,000 GNOT.",
    descVi: "Tổng raise curve ≥ 5.000 GNOT.",
    rarity: "rare",
    priority: 80,
  },
  {
    id: "cre_grad_one",
    scope: "creator",
    icon: "🎯",
    titleEn: "Graduate Maker",
    titleVi: "Người làm graduate",
    descEn: "At least one launch graduated.",
    descVi: "Ít nhất 1 launch đã graduate.",
    rarity: "rare",
    priority: 76,
  },
  {
    id: "cre_vol_sum_s",
    scope: "creator",
    icon: "✨",
    titleEn: "Volume Starter",
    titleVi: "Volume khởi",
    descEn: "Sum of sampled launch volumes ≥ 250 GNOT.",
    descVi: "Tổng volume mẫu ≥ 250 GNOT.",
    rarity: "rare",
    priority: 72,
  },
  {
    id: "cre_raise_s",
    scope: "creator",
    icon: "🌱",
    titleEn: "Raise 1k",
    titleVi: "Tổng raise 1k",
    descEn: "Sum curve raised ≥ 1,000 GNOT.",
    descVi: "Tổng raise curve ≥ 1.000 GNOT.",
    rarity: "common",
    priority: 64,
  },
  {
    id: "cre_first",
    scope: "creator",
    icon: "🚀",
    titleEn: "First Launch",
    titleVi: "Launch đầu",
    descEn: "Created at least one token on the pad.",
    descVi: "Đã tạo ít nhất 1 token trên pad.",
    rarity: "common",
    priority: 50,
  },

  // ── Trader (unchanged this pass) ─────────────────────────────────────
  {
    id: "tr_holder",
    scope: "trader",
    icon: "🎒",
    titleEn: "Bag Holder",
    titleVi: "Giữ túi",
    descEn: "Holds ≥ 1 meme position in portfolio.",
    descVi: "Đang giữ ≥ 1 vị thế meme trong portfolio.",
    rarity: "common",
    priority: 45,
  },
  {
    id: "tr_multi",
    scope: "trader",
    icon: "🗃️",
    titleEn: "Multi-Bag",
    titleVi: "Nhiều túi",
    descEn: "Holds ≥ 3 different meme positions.",
    descVi: "Giữ ≥ 3 vị thế meme khác nhau.",
    rarity: "rare",
    priority: 60,
  },
  {
    id: "tr_heavy",
    scope: "trader",
    icon: "💪",
    titleEn: "Sized Bag (est.)",
    titleVi: "Túi ước tính",
    descEn: "Est. portfolio meme value ≥ 100 GNOT (spot×balance).",
    descVi: "Giá trị meme ước tính ≥ 100 GNOT (spot×balance).",
    rarity: "rare",
    priority: 68,
  },
  {
    id: "tr_diamond",
    scope: "trader",
    icon: "💎",
    titleEn: "Large Bag (est.)",
    titleVi: "Túi lớn (ước tính)",
    descEn: "Est. portfolio meme value ≥ 1,000 GNOT (spot×balance).",
    descVi: "Giá trị meme ước tính ≥ 1.000 GNOT (spot×balance).",
    rarity: "epic",
    priority: 82,
  },
];

const BY_ID = new Map(BADGE_CATALOG.map((b) => [b.id, b]));

export function getBadgeDef(id) {
  return BY_ID.get(id) || null;
}

export function catalogByScope(scope) {
  return BADGE_CATALOG.filter((b) => b.scope === scope);
}

function enrich(id, reason) {
  const def = getBadgeDef(id);
  if (!def) return null;
  return {
    id: def.id,
    scope: def.scope,
    icon: def.icon,
    titleEn: def.titleEn,
    titleVi: def.titleVi,
    descEn: def.descEn,
    descVi: def.descVi,
    rarity: def.rarity,
    priority: def.priority,
    reason: reason || null,
  };
}

function raisedOf(m) {
  return (
    Number(m?.raisedGnot) ||
    (Number(m?.raised) > 0 ? Number(m.raised) / 1_000_000 : 0) ||
    0
  );
}

/**
 * Evaluate token badges from a market row (+ optional volume sample).
 */
export function evaluateTokenBadges(m, opts = {}) {
  if (!m || m.error) return [];
  const buyers = Number(m.buyers) || 0;
  const pct = Number(m.progressPct) || 0;
  const status = Number(m.status) || 0;
  const listed = !!(m.gnoswapListed || m.listed);
  const raised = raisedOf(m);
  const vol = Number(opts.volumeGnot ?? m.volumeGnot ?? m.sampleVolumeGnot) || 0;
  const mcap = Number(m.mcapGnot) || 0;
  const tip = Number(opts.tipHeight) || 0;
  const created = Number(m.created) || 0;
  const blockSecs = Number(opts.blockSecs) || 2;
  const earned = [];

  if (listed) earned.push(enrich("tok_listed", "gnoswapListed"));
  if (status === 1) earned.push(enrich("tok_grad", "status=graduated"));
  if (raised >= 5000) earned.push(enrich("tok_raise_half", `raised=${raised}`));
  if (pct >= 70 && status !== 1) {
    earned.push(enrich("tok_near_grad", `progress=${pct}%`));
  }

  // Buyers ladder (exclusive)
  if (buyers >= 50) earned.push(enrich("tok_buyers_l", `buyers=${buyers}`));
  else if (buyers >= 25) earned.push(enrich("tok_buyers_m", `buyers=${buyers}`));
  else if (buyers >= 10) earned.push(enrich("tok_buyers_s", `buyers=${buyers}`));

  // Volume sample ladder (exclusive)
  if (vol >= 1000) earned.push(enrich("tok_vol_l", `vol≈${vol}`));
  else if (vol >= 250) earned.push(enrich("tok_vol_m", `vol≈${vol}`));
  else if (vol >= 50) earned.push(enrich("tok_vol_s", `vol≈${vol}`));

  // FDV mark — dual-gated (VirtualUgnot0 makes early FDV look high)
  if (mcap >= 40000 && (status === 1 || raised >= 7000 || listed)) {
    earned.push(enrich("tok_fdv_l", `mcap=${mcap}`));
  } else if (mcap >= 15000 && raised >= 2500) {
    earned.push(enrich("tok_fdv_m", `mcap=${mcap};raised=${raised}`));
  }

  if (tip > 0 && created > 0) {
    const ageSec = Math.max(0, tip - created) * blockSecs;
    if (ageSec <= 2 * 3600) {
      earned.push(enrich("tok_fresh", `age≈${Math.round(ageSec / 60)}m`));
    }
  }

  return earned.filter(Boolean).sort((a, b) => b.priority - a.priority);
}

export function wearBadges(badges, limit = WEAR_LIMIT) {
  const list = Array.isArray(badges) ? badges.slice() : [];
  list.sort((a, b) => (b.priority || 0) - (a.priority || 0));
  return list.slice(0, Math.max(0, limit));
}

export function evaluateCreatorBadges(launches = []) {
  const rows = Array.isArray(launches) ? launches.filter((m) => m && !m.error) : [];
  const count = rows.length;
  let graduated = 0;
  let buyersSum = 0;
  let raisedSum = 0;
  let volSum = 0;
  let mcapPeak = 0;
  let listedN = 0;
  for (const m of rows) {
    if (Number(m.status) === 1) graduated += 1;
    buyersSum += Number(m.buyers) || 0;
    raisedSum += raisedOf(m);
    volSum += Number(m.volumeGnot) || Number(m.sampleVolumeGnot) || 0;
    mcapPeak = Math.max(mcapPeak, Number(m.mcapGnot) || 0);
    if (m.gnoswapListed || m.listed) listedN += 1;
  }
  const earned = [];
  if (listedN >= 1) earned.push(enrich("cre_listed", `listed=${listedN}`));
  if (graduated >= 3) earned.push(enrich("cre_grad_pro", `graduated=${graduated}`));
  else if (graduated >= 1) {
    earned.push(enrich("cre_grad_one", `graduated=${graduated}`));
  }

  if (volSum >= 2000) earned.push(enrich("cre_vol_sum", `volSum=${volSum}`));
  else if (volSum >= 250) earned.push(enrich("cre_vol_sum_s", `volSum=${volSum}`));

  if (raisedSum >= 10000) earned.push(enrich("cre_raise_l", `raisedSum=${raisedSum}`));
  else if (raisedSum >= 5000) {
    earned.push(enrich("cre_raise_m", `raisedSum=${raisedSum}`));
  } else if (raisedSum >= 1000) {
    earned.push(enrich("cre_raise_s", `raisedSum=${raisedSum}`));
  }

  if (mcapPeak >= 40000) {
    earned.push(enrich("cre_fdv_peak", `mcapPeak=${mcapPeak}`));
  }
  if (buyersSum >= 100) earned.push(enrich("cre_crowd", `buyersSum=${buyersSum}`));
  if (count >= 1) earned.push(enrich("cre_first", `launches=${count}`));

  return earned.filter(Boolean).sort((a, b) => b.priority - a.priority);
}

export function evaluateTraderBadges(portfolio = {}) {
  const holdings = Array.isArray(portfolio.holdings)
    ? portfolio.holdings
    : Array.isArray(portfolio.positions)
      ? portfolio.positions
      : [];
  const n = holdings.filter((h) => (Number(h.balance ?? h.amount ?? h.tokens) || 0) > 0)
    .length;
  const value =
    Number(portfolio.totalValueGnot) ||
    Number(portfolio.valueGnot) ||
    holdings.reduce((s, h) => s + (Number(h.valueGnot) || Number(h.estGnot) || 0), 0) ||
    0;
  const earned = [];
  if (n >= 1) earned.push(enrich("tr_holder", `positions=${n}`));
  if (n >= 3) earned.push(enrich("tr_multi", `positions=${n}`));
  if (value >= 100) earned.push(enrich("tr_heavy", `value≈${value}`));
  if (value >= 1000) earned.push(enrich("tr_diamond", `value≈${value}`));
  return earned.filter(Boolean).sort((a, b) => b.priority - a.priority);
}

export function listCatalogPublic() {
  return BADGE_CATALOG.map((b) => ({
    id: b.id,
    scope: b.scope,
    icon: b.icon,
    titleEn: b.titleEn,
    titleVi: b.titleVi,
    descEn: b.descEn,
    descVi: b.descVi,
    rarity: b.rarity,
    priority: b.priority,
  }));
}
