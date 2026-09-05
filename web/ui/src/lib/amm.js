import { UGNOT_PER_GNOT } from "./format";

export const FEE_CREATOR_SHARE_BPS = 4000;
export const FEE_PROTOCOL_SHARE_BPS = 4000;

export function feeBpsOf(m) {
  const b = Number(m?.feeBps ?? m?.params?.feeBps);
  return Number.isFinite(b) && b > 0 ? b : 120;
}

function toBig(n) {
  if (typeof n === "bigint") return n;
  if (typeof n === "number") {
    if (!Number.isFinite(n)) return 0n;
    return BigInt(Math.trunc(n));
  }
  try {
    return BigInt(String(n || "0").split(".")[0] || "0");
  } catch {
    return 0n;
  }
}

function bigToNum(x) {
  // Safe for token amounts / ugnot that fit JS number (<< 2^53)
  const n = Number(x);
  return Number.isSafeInteger(n) ? n : Number(x);
}

export function applyFee(gross, feeBPS = 120) {
  const g = toBig(gross);
  const bps = toBig(feeBPS);
  const fee = (g * bps) / 10000n;
  const net = g - fee;
  const creator = (fee * BigInt(FEE_CREATOR_SHARE_BPS)) / 10000n;
  const protocol = (fee * BigInt(FEE_PROTOCOL_SHARE_BPS)) / 10000n;
  const remainder = fee - creator - protocol;
  const netIn = net + remainder;
  return {
    gross: bigToNum(g),
    fee: bigToNum(fee),
    net: bigToNum(net),
    creator: bigToNum(creator),
    protocol: bigToNum(protocol),
    remainder: bigToNum(remainder),
    netIn: bigToNum(netIn),
  };
}

/**
 * Quote buy when net ugnot already enters the curve (after fee split).
 * Uses BigInt for k = vu*vt — Number overflows past ~9e15 (common near graduation).
 */
export function quoteCurveBuyNet(vu, vt, netIn) {
  const vuB = toBig(vu);
  const vtB = toBig(vt);
  const netB = toBig(netIn);
  if (vuB <= 0n || vtB <= 0n || netB <= 0n) {
    return { ok: false, tokensOut: 0, netIn: bigToNum(netB) };
  }
  const newVU = vuB + netB;
  const k = vuB * vtB;
  const newVT = k / newVU;
  if (newVT <= 0n || newVT >= vtB) {
    return {
      ok: false,
      tokensOut: 0,
      netIn: bigToNum(netB),
      newVU: bigToNum(newVU),
      newVT: bigToNum(newVT),
    };
  }
  const tokensOut = vtB - newVT;
  // Spot for impact display only — float is fine
  const spotBefore = Number(vtB) > 0 ? Number(vuB) / Number(vtB) : 0;
  const spotAfter = Number(newVT) > 0 ? Number(newVU) / Number(newVT) : 0;
  const priceImpactPct =
    spotBefore > 0 ? ((spotAfter - spotBefore) / spotBefore) * 100 : 0;
  return {
    ok: tokensOut > 0n,
    tokensOut: bigToNum(tokensOut),
    newVU: bigToNum(newVU),
    newVT: bigToNum(newVT),
    netIn: bigToNum(netB),
    priceImpactPct,
  };
}

/**
 * Largest gross ugnot ≤ sentMax whose fee-split netIn (net+remainder) ≤ maxNet.
 * Mirrors on-chain maxGrossForNetIn (int64 binary search).
 */
export function maxGrossForNetIn(maxNet, sentMax, feeBps = 120) {
  let lo = 0n;
  let hi = toBig(sentMax);
  const maxN = toBig(maxNet);
  if (maxN <= 0n || hi <= 0n) return 0;
  while (lo < hi) {
    const mid = (lo + hi + 1n) / 2n;
    const f = applyFee(mid, feeBps);
    const net = toBig(f.net) + toBig(f.remainder);
    if (net <= maxN) lo = mid;
    else hi = mid - 1n;
  }
  return bigToNum(lo);
}

export function quoteCurveBuy(vu, vt, ugnotIn, feeBps = 120) {
  if (toBig(vu) <= 0n || toBig(vt) <= 0n || toBig(ugnotIn) <= 0n) {
    return { ok: false, tokensOut: 0 };
  }
  const fee = applyFee(ugnotIn, feeBps);
  const { netIn } = fee;
  if (netIn <= 0) return { ok: false, tokensOut: 0, fee };
  const q = quoteCurveBuyNet(vu, vt, netIn);
  return {
    ...q,
    fee,
    minOut: q.ok ? Math.max(1, Math.floor(q.tokensOut * 0.99)) : 0,
  };
}

/** Sell tokens → ugnot out (gross before fee split on receive path). */
export function quoteCurveSell(vu, vt, tokensIn, feeBps = 120) {
  const vuB = toBig(vu);
  const vtB = toBig(vt);
  const tB = toBig(tokensIn);
  if (vuB <= 0n || vtB <= 0n || tB <= 0n) return { ok: false, ugnotOut: 0 };
  if (tB >= vtB) return { ok: false, ugnotOut: 0, reason: "too large" };
  const newVT = vtB + tB;
  const k = vuB * vtB;
  const newVU = k / newVT;
  const grossOut = vuB - newVU;
  if (grossOut <= 0n) return { ok: false, ugnotOut: 0 };
  const fee = applyFee(grossOut, feeBps);
  const ugnotOut = fee.net; // trader receives net after fee
  const spotBefore = Number(vtB) > 0 ? Number(vuB) / Number(vtB) : 0;
  const spotAfter = Number(newVT) > 0 ? Number(newVU) / Number(newVT) : 0;
  const priceImpactPct =
    spotBefore > 0 ? ((spotBefore - spotAfter) / spotBefore) * 100 : 0;
  return {
    ok: ugnotOut > 0,
    ugnotOut,
    grossOut: bigToNum(grossOut),
    newVU: bigToNum(newVU),
    newVT: bigToNum(newVT),
    fee,
    priceImpactPct,
    minOut: Math.max(0, Math.floor(ugnotOut * 0.99)),
  };
}

export function curveRemainingTokens(m) {
  const curve = Number(m?.curveSupply) || 800_000_000;
  const sold = Number(m?.sold) || 0;
  return Math.max(0, curve - sold);
}

/**
 * Gross ugnot needed so fee-split netIn covers remaining raise (last fill).
 * Headroom cap defaults to 2× remaining + 2 GNOT.
 */
export function grossForRemainingRaise(remRaiseUg, feeBps = 120) {
  const rem = toBig(remRaiseUg);
  if (rem <= 0n) return 0;
  const cap = rem * 2n + 2_000_000n;
  return maxGrossForNetIn(bigToNum(rem), bigToNum(cap), feeBps);
}
