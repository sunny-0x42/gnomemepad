import { UGNOT_PER_GNOT } from "./format";

export function marketKey(id, pkg = "") {
  return `${id || ""}|${pkg || ""}`;
}

/** Hide pad v0–v7 from UI discovery (padv3, padv7, etc.). Keeps padv8+. */
export function isRetiredPad(pkgOrLabel) {
  const s = String(pkgOrLabel || "").toLowerCase();
  return /(?:^|[/_.-])padv?([0-7])(?:$|[/_.-])/.test(s);
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

/**
 * Composite heat score: recent volume (if any) + buyers + raised.
 * Higher = hotter.
 */
export function marketHeatScore(m, volMap = {}) {
  const k = marketKey(m.id, m.pkg || "");
  const vol = volMap[k]?.volumeGnot || 0;
  const trades = volMap[k]?.trades || 0;
  const buyers = Number(m.buyers) || 0;
  const raised = raisedGnotOf(m);
  // Weight recent ring volume heavily when present
  return vol * 12 + trades * 2.5 + buyers * 1.8 + raised * 0.9;
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
