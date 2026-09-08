/**
 * Probe Gnoswap swap history for live listed meme markets.
 * Exit 1 when every listed market has empty DEX history (monitor / CI signal).
 *
 * Usage: node scripts/probe-gnoswap-history.mjs
 */
const API = process.env.GNOMI_API || "https://gnomi.fun";
const GNOSWAP = process.env.GNOSWAP_API_BASE || "https://beta.api.gnoswap.io/v1";
const WUGNOT = "gno.land/r/gnoland/wugnot.wugnot";

function marketTokenKey(m) {
  const pool = String(m.gnoswapPoolPath || "").trim();
  if (pool) {
    const parts = pool.split(":").filter(Boolean);
    const fee = Number(parts[parts.length - 1]);
    const tokens = Number.isFinite(fee) && fee > 0 ? parts.slice(0, -1) : parts;
    const meme = tokens.find(
      (p) =>
        !/wugnot|ugnot/i.test(p) &&
        !p.endsWith("/wugnot") &&
        !p.endsWith(".wugnot"),
    );
    if (meme) return meme;
  }
  const sym = String(m.symbol || "").trim();
  const pkg = String(m.pkg || "").trim();
  if (pkg && sym) return `${pkg}.${sym}`;
  return "";
}

async function swapCount(tokenPath) {
  const qs = new URLSearchParams({
    tokenAPath: WUGNOT,
    tokenBPath: tokenPath,
    limit: "20",
  });
  const r = await fetch(`${GNOSWAP}/swap/history?${qs}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const body = await r.json();
  return Array.isArray(body?.data) ? body.data.length : 0;
}

const marketsRes = await fetch(`${API}/api/markets?network=sapphire`, {
  signal: AbortSignal.timeout(90_000),
});
if (!marketsRes.ok) {
  console.error("markets failed", marketsRes.status);
  process.exit(2);
}
const marketsBody = await marketsRes.json();
const listed = (marketsBody.markets || []).filter((m) => m.gnoswapListed);
console.log(`listed=${listed.length}`);

let empty = 0;
for (const m of listed) {
  const key = marketTokenKey(m);
  let n = 0;
  let err = "";
  try {
    n = key ? await swapCount(key) : 0;
  } catch (e) {
    err = String(e.message || e);
  }
  const flag = m.dexHistoryEmpty === true ? "apiEmpty" : "apiHasDex";
  console.log(
    `${m.symbol} ${m.id} key=${key || "?"} gnoswapRows=${n} ${flag}${err ? ` err=${err}` : ""} markRel=? priceSrc=${m.priceSource}`,
  );
  if (n === 0) empty += 1;
}

if (!listed.length) {
  console.log("OK no listed markets");
  process.exit(0);
}
if (empty === listed.length) {
  console.error(
    `WARN: all ${listed.length} listed markets have empty Gnoswap /swap/history — rely on curve + /api/trades/report`,
  );
  process.exit(1);
}
console.log(`OK ${listed.length - empty}/${listed.length} have indexer rows`);
process.exit(0);
