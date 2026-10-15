import { UGNOT_PER_GNOT } from "./format";

export function marketKey(id, pkg = "") {
  return `${id || ""}|${pkg || ""}`;
}

/**
 * Hide legacy pads from discovery (old gnomemepad padv0–v13 / legacy_*).
 * Never retire /gnomi/* or bare hub labels ("pad", "padv3") — live mainnet is …/gnomi/padv3.
 */
export function isRetiredPad(pkgOrLabel) {
  const s = String(pkgOrLabel || "").toLowerCase();
  if (!s) return false;
  if (/\/gnomi\//.test(s)) return false;
  if (/legacy/.test(s)) return true;
  // Hub source labels are not package paths.
  if (!/[/.]/.test(s)) return false;
  const m = s.match(/(?:^|[/_.-])padv?(\d+)(?:$|[/_.-])/);
  if (!m) return false;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n < 14;
}

export function isVisiblePadMarket(m) {
  if (!m || m.error) return false;
  if (isRetiredPad(m.pkg) || isRetiredPad(m.padLabel)) return false;
  return true;
}

export function raisedGnotOf(m) {
  if (!m) return 0;
  const fromApi = Number(m.raisedGnot);
  if (Number.isFinite(fromApi) && fromApi > 0) return fromApi;
  const raised = (Number(m.raised) || 0) / UGNOT_PER_GNOT;
  if (raised > 0) return raised;
  // Graduated: on-chain RaisedUgnot is zeroed; poolUgnot = raise moved to LP
  if (Number(m.status) === 1) {
    if (Number(m.poolGnot) > 0) return Number(m.poolGnot);
    if (Number(m.poolUgnot) > 0) return Number(m.poolUgnot) / UGNOT_PER_GNOT;
    if (Number(m.raisedAtGraduateUgnot) > 0) {
      return Number(m.raisedAtGraduateUgnot) / UGNOT_PER_GNOT;
    }
  }
  return 0;
}

/** Build volume map from /api/activity events (buy/sell only). */
export function volumeMapFromActivity(events) {
  const map = {};
  for (const e of events || []) {
    const side = Number(e.side);
    // 2=open · 3=add_lp · 4=remove_lp — not trading volume
    if (side !== 0 && side !== 1) continue;
    const k = marketKey(e.id, e.pkg || "");
    if (!map[k]) map[k] = { volumeGnot: 0, trades: 0, buyVol: 0, sellVol: 0 };
    const vol = Number(e.volumeGnot) || 0;
    map[k].trades += 1;
    map[k].volumeGnot += vol;
    if (side === 0) map[k].buyVol += vol;
    else if (side === 1) map[k].sellVol += vol;
  }
  return map;
}

/** Volume row from market.tradeStats (full TradeHistory ring — matches Token page). */
export function volumeRowFromMarket(m) {
  const ts = m?.tradeStats;
  if (!ts) return null;
  const volumeGnot = Number(ts.volumeGnot) || 0;
  const trades = Number(ts.trades) || 0;
  if (volumeGnot <= 0 && trades <= 0) return null;
  return {
    volumeGnot,
    trades,
    buyVol: Number(ts.buyVolumeGnot) || 0,
    sellVol: Number(ts.sellVolumeGnot) || 0,
  };
}

/** Seed volMap from markets list tradeStats (preferred over truncated activity sample). */
export function volumeMapFromMarkets(markets) {
  const map = {};
  for (const m of markets || []) {
    if (!m || m.error || !m.id) continue;
    const row = volumeRowFromMarket(m);
    if (!row) continue;
    map[marketKey(m.id, m.pkg || "")] = row;
  }
  return map;
}

/**
 * Merge volume maps — keep the richer row per key (higher volume / trades).
 * Prevents /api/activity?limit=40 from wiping full TradeHistory totals on cards.
 */
export function mergeVolumeMaps(...maps) {
  const out = {};
  for (const map of maps) {
    for (const [k, row] of Object.entries(map || {})) {
      if (!row) continue;
      const cur = out[k];
      if (!cur) {
        out[k] = {
          volumeGnot: Number(row.volumeGnot) || 0,
          trades: Number(row.trades) || 0,
          buyVol: Number(row.buyVol) || 0,
          sellVol: Number(row.sellVol) || 0,
        };
        continue;
      }
      const nextVol = Number(row.volumeGnot) || 0;
      const nextTrades = Number(row.trades) || 0;
      const curVol = Number(cur.volumeGnot) || 0;
      const curTrades = Number(cur.trades) || 0;
      if (nextVol > curVol || (nextVol === curVol && nextTrades > curTrades)) {
        out[k] = {
          volumeGnot: Math.max(curVol, nextVol),
          trades: Math.max(curTrades, nextTrades),
          buyVol: Math.max(Number(cur.buyVol) || 0, Number(row.buyVol) || 0),
          sellVol: Math.max(Number(cur.sellVol) || 0, Number(row.sellVol) || 0),
        };
      }
    }
  }
  return out;
}

/**
 * Card volume: prefer market.tradeStats (full ring), else volMap (activity).
 * Keeps Markets Vol in sync with Token page tradeStats.
 */
export function cardVolumeOf(m, volMap = {}) {
  const fromTs = volumeRowFromMarket(m);
  const fromMap = volMap[marketKey(m?.id, m?.pkg || "")] || null;
  if (fromTs && fromMap) {
    if (
      fromTs.volumeGnot > fromMap.volumeGnot ||
      (fromTs.volumeGnot === fromMap.volumeGnot && fromTs.trades >= fromMap.trades)
    ) {
      return fromTs;
    }
    return {
      volumeGnot: Math.max(fromTs.volumeGnot, fromMap.volumeGnot || 0),
      trades: Math.max(fromTs.trades, fromMap.trades || 0),
      buyVol: Math.max(fromTs.buyVol, fromMap.buyVol || 0),
      sellVol: Math.max(fromTs.sellVol, fromMap.sellVol || 0),
    };
  }
  return fromTs || fromMap || { volumeGnot: 0, trades: 0, buyVol: 0, sellVol: 0 };
}

/**
 * Live interaction / “momentum” score for homepage ordering.
 * Strong recent volume + trades bubble up; quiet tokens sink.
 * Higher = hotter. Recalculated whenever volMap / market stats change.
 */
export function marketHeatScore(m, volMap = {}) {
  const k = marketKey(m.id, m.pkg || "");
  const row = volMap[k] || {};
  const vol = Number(row.volumeGnot) || 0;
  const trades = Number(row.trades) || 0;
  const buyVol = Number(row.buyVol) || 0;
  const sellVol = Number(row.sellVol) || 0;
  const buyers = Number(m.buyers) || 0;
  const raised = raisedGnotOf(m);
  const pct = Math.min(100, Number(m.progressPct) || 0);
  const listed = !!(m.gnoswapListed || m.listed);
  const graduated = Number(m.status) === 1;

  // Recent activity dominates (sampled activity window)
  let score =
    vol * 28 +
    trades * 9 +
    buyVol * 6 +
    sellVol * 3 +
    buyers * 2.2 +
    raised * 0.55;

  // Near-grad / hot curve bump (still tradable on pad)
  if (!graduated && pct >= 70) score += 80 + (pct - 70) * 1.5;
  else if (!graduated && pct >= 40) score += 25;

  // Listed with ongoing volume stays visible; idle graduated sinks
  if (listed && vol > 0) score += 40;
  if (graduated && vol <= 0 && trades <= 0) score *= 0.35;
  if (!graduated && vol <= 0 && trades <= 0 && buyers < 2 && raised < 1) {
    score *= 0.55; // cold / unused → push down
  }

  return score;
}

/** Alias for UI copy — same ranking engine. */
export function liveInteractionScore(m, volMap = {}) {
  return marketHeatScore(m, volMap);
}

/**
 * Tier 0 none · 1 warm · 2 hot · 3 fire
 */
export function marketHeatTiers(list, volMap = {}) {
  const tiers = new Map();
  const raising = (list || []).filter((m) => !m.error && m.status !== 1);
  if (!raising.length) return tiers;

  const scored = raising.map((m) => ({
    key: marketKey(m.id, m.pkg || ""),
    score: marketHeatScore(m, volMap),
    buyers: Number(m.buyers) || 0,
    raised: raisedGnotOf(m),
    vol: volMap[marketKey(m.id, m.pkg || "")]?.volumeGnot || 0,
  }));
  const max = Math.max(...scored.map((s) => s.score), 0.0001);

  for (const s of scored) {
    const active = s.buyers >= 1 || s.raised >= 0.5 || s.vol > 0;
    if (!active) {
      tiers.set(s.key, 0);
      continue;
    }
    const rel = s.score / max;
    if (
      (s.buyers >= 5 || s.raised >= 8 || s.vol >= 5 || rel >= 0.85) &&
      (s.buyers >= 2 || s.raised >= 2 || s.vol >= 1)
    ) {
      tiers.set(s.key, 3);
    } else if (s.buyers >= 3 || s.raised >= 3 || s.vol >= 2 || rel >= 0.55) {
      tiers.set(s.key, 2);
    } else if (s.buyers >= 1 || s.raised >= 1 || s.vol > 0 || rel >= 0.3) {
      tiers.set(s.key, 1);
    } else {
      tiers.set(s.key, 0);
    }
  }
  return tiers;
}

export function heatLabel(tier) {
  if (tier >= 3) return { kind: "fire", text: "🔥 Fire" };
  if (tier >= 2) return { kind: "hot", text: "Hot" };
  if (tier >= 1) return { kind: "warm", text: "Active" };
  return null;
}

/** Almost ready to graduate / list */
export function isAlmostList(m, threshold = 70) {
  if (!m || m.status === 1) return false;
  return (Number(m.progressPct) || 0) >= threshold;
}

export function isReadyToGraduate(m) {
  if (!m || m.status === 1) return false;
  return (Number(m.progressPct) || 0) >= 100;
}

export function isRaising(m) {
  return !!m && m.status !== 1 && !m.error;
}

/**
 * Featured rails from full market list + volume map.
 */
export function buildFeaturedRails(allMarkets, volMap = {}) {
  const clean = (allMarkets || []).filter((m) => !m.error);
  const tiers = marketHeatTiers(clean, volMap);

  const almost = clean
    .filter((m) => isAlmostList(m, 70))
    .sort((a, b) => (b.progressPct || 0) - (a.progressPct || 0))
    .slice(0, 8);

  const hot = [...clean]
    .map((m) => ({
      m,
      score: marketHeatScore(m, volMap),
      vol: volMap[marketKey(m.id, m.pkg || "")]?.volumeGnot || 0,
    }))
    .filter((x) => x.score > 0 && (x.vol > 0 || (x.m.buyers || 0) >= 1 || raisedGnotOf(x.m) >= 0.5))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map((x) => x.m);

  const raising = clean
    .filter((m) => isRaising(m) && !m.legacy)
    .sort((a, b) => {
      const sa = marketHeatScore(a, volMap);
      const sb = marketHeatScore(b, volMap);
      if (sb !== sa) return sb - sa;
      return raisedGnotOf(b) - raisedGnotOf(a);
    })
    .slice(0, 8);

  // Fallback: if no active-pad raising, include legacy raising
  const raisingFinal =
    raising.length > 0
      ? raising
      : clean
          .filter((m) => isRaising(m))
          .sort((a, b) => raisedGnotOf(b) - raisedGnotOf(a))
          .slice(0, 8);

  return { almost, hot, raising: raisingFinal, tiers };
}
