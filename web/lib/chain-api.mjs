/**
 * Shared Gno.land read API for local server + Netlify functions.
 * Env: RPC_URL, PKG, HUB, PROFILE, META, POINTS, CHAIN_ID, SIGNER_ADDR
 *
 * When HUB is set, pad path is resolved via hub.GetModule("pad") (fallback PKG).
 *
 * Token logos on Gnoswap: TOKEN_RESOURCE_GITHUB_TOKEN + TOKEN_RESOURCE_FORK
 * for auto PR to onbloc/gno-token-resource (see web/lib/token-resource.mjs).
 */

import {
  TOKEN_RESOURCE_SPEC,
  adenaTokenKey,
  buildRegistrationPlan,
  buildRegistryEntry,
  imageFileName,
  resolveImageUrl,
  svgForMarket,
  syncTokenResourcePr,
} from "./token-resource.mjs";
import {
  configForNetwork,
  listNetworks,
  listVenuesFallback,
  normalizeNetworkId,
  DEFAULT_NETWORK_ID,
} from "./networks.mjs";
import {
  buildAuthorizeUrl,
  clearXOauthPendingCookies,
  clearXSession,
  clearXSessionCookie,
  createPkcePair,
  createXSession,
  exchangeCodeForToken,
  fetchXUserMe,
  getXSession,
  parseCookieHeader,
  redirectResponse,
  xOAuthConfig,
  xOAuthConfigured,
  xOauthPendingCookies,
  xSessionCookie,
} from "./x-oauth.mjs";
import {
  readMarketsSnapshot,
  snapshotFresh,
  snapshotUsable,
  writeMarketsSnapshot,
} from "./markets-snapshot.mjs";
import {
  evaluateCreatorBadges,
  evaluateTokenBadges,
  evaluateTraderBadges,
  listCatalogPublic,
  wearBadges,
  WEAR_LIMIT,
} from "./badges.mjs";

const UGNOT_PER_GNOT = 1_000_000;
const HOLDER_INDEXER_MAX_PAGES = 20;
// memepad MaxTradeHistory. A full TradeHistory has already dropped older points.
const CURVE_RING_LEN = 128;
const INDEXER_CURVE_VOLUME_MAX_PAGES = 8;
// One unbounded event query no longer returns inside the abort. Walk fixed height
// windows instead, and keep enough pages to reach the chain tip.
const INDEXER_WALK_SPAN = 100_000;
const INDEXER_WALK_PAGE_CAP = 80;
const TRANSFER_HOLDERS_OMISSION =
  "Transfer-only holders are omitted. ListBuyers and indexer Buy/SwapBuy pages do not include wallets that only received tokens by transfer.";

function fullMetrics() {
  return process.env.FULL_METRICS === "1";
}

const DEFAULT_ADDR = "g1mv0052e7r6s09f5t9xsqf00nj3tqsgt9dg52jr";

/** In-memory TTL cache for expensive multi-RPC reads (Netlify function / local server). */
const memCache = new Map();

function cacheGet(key) {
  const e = memCache.get(key);
  if (!e) return null;
  if (Date.now() - e.at > e.ttlMs) {
    memCache.delete(key);
    return null;
  }
  return e.value;
}

function cacheSet(key, value, ttlMs) {
  memCache.set(key, { at: Date.now(), ttlMs, value });
  // Soft cap — drop oldest if oversized. Room for pad-tx walks plus one detail per launch.
  if (memCache.size > 160) {
    const first = memCache.keys().next().value;
    if (first != null) memCache.delete(first);
  }
}

/** Last complete payload. Served after the fresh TTL until maxStaleMs, then dropped. */
const staleCache = new Map();
const routeInflight = new Map();

function rememberFresh(key, value, ttlMs) {
  cacheSet(key, value, ttlMs);
  staleCache.set(key, { at: Date.now(), value });
  if (staleCache.size > 80) {
    const first = staleCache.keys().next().value;
    if (first != null) staleCache.delete(first);
  }
}

function readFreshOrStale(key, maxStaleMs) {
  const fresh = cacheGet(key);
  if (fresh) return { value: fresh, fresh: true };
  const stale = staleCache.get(key);
  if (!stale) return null;
  if (Date.now() - stale.at > maxStaleMs) {
    staleCache.delete(key);
    return null;
  }
  return { value: stale.value, fresh: false };
}

function singleflight(key, fn) {
  const hit = routeInflight.get(key);
  if (hit) return hit;
  const job = Promise.resolve()
    .then(fn)
    .finally(() => {
      if (routeInflight.get(key) === job) routeInflight.delete(key);
    });
  routeInflight.set(key, job);
  return job;
}

/** Concurrency-limited Promise.all (speedup #2 — avoid sequential qeval). */
async function mapPool(items, concurrency, fn) {
  const list = Array.isArray(items) ? items : [];
  const limit = Math.max(1, Math.min(Number(concurrency) || 6, 16));
  const out = new Array(list.length);
  let i = 0;
  async function worker() {
    while (i < list.length) {
      const idx = i++;
      out[idx] = await fn(list[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, list.length || 1) }, () => worker()));
  return out;
}

/** Default config = DEFAULT_NETWORK_ID (Sapphire unless env says Pearl). */
export function getConfig(networkId) {
  const id = normalizeNetworkId(networkId || DEFAULT_NETWORK_ID);
  return configForNetwork(id);
}

/** Parse hub ListModules() → { name: path } */
function parseModuleList(raw) {
  const mods = {};
  for (const line of String(raw || "").split("\n")) {
    const i = line.indexOf("|");
    if (i <= 0) continue;
    const name = line.slice(0, i).trim();
    const path = line.slice(i + 1).trim();
    if (name && path) mods[name] = path;
  }
  return mods;
}

async function resolvePadPkg(RPC, cfg) {
  if (!cfg.HUB) return cfg.PKG;
  try {
    const raw = await qeval(RPC, cfg.HUB, `${cfg.HUB}.GetModule("pad")`);
    const path = String(raw || "").replace(/^"|"$/g, "").trim();
    if (path && path.startsWith("gno.land/")) return path;
  } catch {
    /* hub missing or not inited — use PKG */
  }
  return cfg.PKG;
}

async function getHubInfo(RPC, cfg) {
  if (!cfg.HUB) {
    return {
      hub: null,
      modules: {},
      pad: cfg.PKG,
      profile: cfg.PROFILE,
      meta: cfg.META,
      points: cfg.POINTS,
    };
  }
  try {
    const listRaw = await qeval(RPC, cfg.HUB, `${cfg.HUB}.ListModules()`, 12000);
    const modules = parseModuleList(listRaw);
    return {
      hub: cfg.HUB,
      modules,
      pad: modules.pad || cfg.PKG,
      profile: modules.profile || cfg.PROFILE,
      meta: modules.meta || cfg.META,
      points: modules.points || cfg.POINTS,
    };
  } catch (e) {
    return {
      hub: cfg.HUB,
      modules: {},
      pad: cfg.PKG,
      profile: cfg.PROFILE,
      meta: cfg.META,
      points: cfg.POINTS,
      hubError: String(e.message || e),
    };
  }
}

function parseProfile(raw) {
  const s = String(raw || "").replace(/^"|"$/g, "").trim();
  if (!s) return null;
  const p = s.split("|");
  return {
    name: p[0] || "",
    bio: p[1] || "",
    uri: p[2] || "",
    updated: Number(p[3]) || 0,
  };
}

/** owner|description|imageURI|website|twitter|telegram|updated */
function parseMeta(raw) {
  const s = String(raw || "").replace(/^"|"$/g, "").trim();
  if (!s) return null;
  const p = s.split("|");
  return {
    owner: p[0] || "",
    description: p[1] || "",
    imageURI: p[2] || "",
    website: p[3] || "",
    twitter: p[4] || "",
    telegram: p[5] || "",
    updated: Number(p[6]) || 0,
  };
}

function parseLeaderboard(raw) {
  const rows = [];
  for (const line of String(raw || "").split("\n")) {
    const t = line.trim();
    if (!t) continue;
    const i = t.indexOf("|");
    if (i <= 0) continue;
    rows.push({
      address: t.slice(0, i),
      points: Number(t.slice(i + 1)) || 0,
    });
  }
  return rows;
}

async function rpc(RPC, method, params, signal) {
  const r = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal,
  });
  if (!r.ok) throw new Error(`RPC HTTP ${r.status}`);
  const j = await r.json();
  if (j.error) throw new Error(j.error.message || "RPC error");
  return j.result;
}

function b64utf8(b64) {
  if (!b64) return "";
  return Buffer.from(b64, "base64").toString("utf8");
}

async function qevalRaw(RPC, expr, signal) {
  const data = Buffer.from(expr, "utf8").toString("base64");
  const result = await rpc(RPC, "abci_query", {
    path: "vm/qeval",
    data,
    height: "0",
    prove: false,
  }, signal);
  const rb = result?.response?.ResponseBase;
  if (rb?.Error) {
    const err = typeof rb.Error === "string" ? rb.Error : JSON.stringify(rb.Error);
    throw new Error(err);
  }
  return b64utf8(rb?.Data);
}

async function qeval(RPC, PKG, expr, timeoutMs) {
  let signal;
  let timer;
  if (timeoutMs > 0) {
    const ctrl = new AbortController();
    signal = ctrl.signal;
    timer = setTimeout(() => ctrl.abort(), timeoutMs);
  }
  try {
  let text = await qevalRaw(RPC, expr, signal);
  const m = text.match(/^\((.*)\)\s*$/s);
  if (m) {
    let inner = m[1].trim();
    const sm = inner.match(/^"(.*)"\s+string$/s);
    if (sm) return sm[1].replace(/\\n/g, "\n").replace(/\\"/g, '"');
    const nm = inner.match(/^(-?\d+)\s+\w+$/);
    if (nm) return nm[1];
    return inner;
  }
  return text;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Parse all `(N int64)` values from a multi-result qeval payload. */
function parseQevalInt64s(text) {
  return [...String(text || "").matchAll(/\((-?\d+)\s+int64\)/g)].map((x) => Number(x[1]));
}

const GNOSWAP_POOL_PKG = "gno.land/r/gnoswap/pool";

/**
 * Live Gnoswap pool balances via pool.GetBalances(poolPath).
 * Returns { ugnot, tokens, t0IsWugnot } or null.
 */
async function fetchGnoswapPoolBalances(RPC, poolPath) {
  const path = String(poolPath || "").trim();
  if (!path || !path.includes(":")) return null;
  const cacheKey = `gnoswap:poolBal:${path}`;
  const hit = cacheGet(cacheKey);
  if (hit) return hit;
  try {
    const exists = await qeval(
      RPC,
      GNOSWAP_POOL_PKG,
      `${GNOSWAP_POOL_PKG}.ExistsPoolPath(${JSON.stringify(path)})`,
    );
    // qeval may return "true", true, or "true bool"
    const existsOk =
      exists === true ||
      exists === 1 ||
      /^(true|1)\b/i.test(String(exists || "").trim());
    if (!existsOk) {
      cacheSet(cacheKey, null, 30_000);
      return null;
    }
    const raw = await qevalRaw(
      RPC,
      `${GNOSWAP_POOL_PKG}.GetBalances(${JSON.stringify(path)})`,
    );
    const bals = parseQevalInt64s(raw);
    if (bals.length < 2) {
      cacheSet(cacheKey, null, 15_000);
      return null;
    }
    const t0 = path.split(":")[0] || "";
    const t0IsWugnot = /wugnot/i.test(t0);
    const out = {
      bal0: bals[0],
      bal1: bals[1],
      ugnot: t0IsWugnot ? bals[0] : bals[1],
      tokens: t0IsWugnot ? bals[1] : bals[0],
      t0IsWugnot,
      poolPath: path,
    };
    cacheSet(cacheKey, out, 20_000);
    return out;
  } catch {
    cacheSet(cacheKey, null, 10_000);
    return null;
  }
}

async function qrender(RPC, PKG, subpath = "") {
  const payload = `${PKG}:${subpath}`;
  const data = Buffer.from(payload, "utf8").toString("base64");
  const result = await rpc(RPC, "abci_query", {
    path: "vm/qrender",
    data,
    height: "0",
    prove: false,
  });
  const rb = result?.response?.ResponseBase;
  if (rb?.Error) throw new Error(String(rb.Error));
  return b64utf8(rb?.Data);
}

function enrichPricing(m, totalSupply = 1_000_000_000) {
  let priceUgnot = 0;
  if (m.status === 1) {
    if (m.poolToken > 0) priceUgnot = m.poolUgnot / m.poolToken;
  } else if (m.virtualToken > 0) {
    priceUgnot = m.virtualUgnot / m.virtualToken;
  }
  const priceGnot = priceUgnot / UGNOT_PER_GNOT;
  const supplyNum = Number(totalSupply);
  const supplyKnown = totalSupply != null && Number.isFinite(supplyNum);
  const mcapGnot = supplyKnown ? priceGnot * supplyNum : null;
  const circ = m.sold > 0 ? m.sold : 0;
  const circMcapGnot = supplyKnown ? priceGnot * circ : null;
  m.priceUgnot = priceUgnot;
  m.priceGnot = priceGnot;
  m.mcapGnot = mcapGnot;
  m.circMcapGnot = circMcapGnot;
  // On graduate, pad zeros RaisedUgnot after moving capital into PoolUgnot.
  // Surface raise-at-grad for UI/leaderboards so platform matches on-chain economics.
  let raisedUgnot = Number(m.raised) || 0;
  if (m.status === 1 && raisedUgnot <= 0 && Number(m.poolUgnot) > 0) {
    raisedUgnot = Number(m.poolUgnot) || 0;
    m.raisedAtGraduateUgnot = raisedUgnot;
    m.raisedSource = "pool_at_grad";
  } else {
    m.raisedSource = "launch_raised";
  }
  m.raisedGnot = raisedUgnot / UGNOT_PER_GNOT;
  m.creatorFeesGnot = (m.creatorFees || 0) / UGNOT_PER_GNOT;
  m.poolGnot = (m.poolUgnot || 0) / UGNOT_PER_GNOT;
  m.spotScaled = Math.floor(priceUgnot * 1_000_000);
  m.priceSource = m.status === 1 ? "pool_mark" : "curve";
  attachLiquidityTvl(m);
  return m;
}

/**
 * Fallback TVL from pad seed / list note (used until live pool balances load).
 * Pad poolUgnot alone equals raise-at-grad — never show that alone as Liquidity.
 */
function attachLiquidityTvl(m) {
  if (!m || m.status !== 1) {
    m.liquidityGnot = 0;
    m.liquidityWugnotGnot = 0;
    m.liquidityTokenGnot = 0;
    m.liquiditySource = null;
    return m;
  }
  // Keep live gnoswap_pool_balances if already set
  if (m.liquiditySource === "gnoswap_pool_balances" && Number(m.liquidityGnot) > 0) {
    return m;
  }
  const px = Number(m.spotGnot || m.priceGnot) || 0;
  const poolUg = Number(m.poolUgnot) || 0;
  const poolTok = Number(m.poolToken) || 0;
  let ug = poolUg;
  let tok = poolTok;
  let source = "pad_pool";

  const note = String(m.gnoswapNote || "");
  const a0 = Number(note.match(/a0=(\d+)/)?.[1] || 0);
  const a1 = Number(note.match(/a1=(\d+)/)?.[1] || 0);
  const wUsed = Number(note.match(/wugnotUsed=(\d+)/)?.[1] || 0);
  if (m.gnoswapListed && (a0 > 0 || a1 > 0 || wUsed > 0)) {
    const t0 = String(m.gnoswapPoolPath || note.match(/pool=([^\s]+)/)?.[1] || "").split(":")[0] || "";
    const t0IsWugnot = /wugnot/i.test(t0);
    if (wUsed > 0) {
      ug = wUsed;
      tok = t0IsWugnot ? a1 : a0;
      if (!(tok > 0)) tok = t0IsWugnot ? a0 : a1;
    } else if (t0IsWugnot) {
      ug = a0;
      tok = a1;
    } else {
      ug = a1;
      tok = a0;
    }
    source = "gnoswap_list_note";
  }

  const wugnotGnot = ug / UGNOT_PER_GNOT;
  const tokenGnot = px > 0 && tok > 0 ? tok * px : wugnotGnot;
  m.liquidityWugnotGnot = wugnotGnot;
  m.liquidityTokenGnot = tokenGnot;
  m.liquidityGnot = wugnotGnot + tokenGnot;
  m.liquiditySource = source;
  return m;
}

/**
 * After list: overwrite liquidity with live Gnoswap pool.GetBalances (on-chain TVL).
 * Token side MUST be valued at pool-implied spot (ugnot/tokens), never pad dump
 * pool_mark (raised/remaining) — that understates TVL by orders of magnitude.
 */
async function enrichLiveGnoswapLiquidity(RPC, m, opts = {}) {
  if (!m || !m.gnoswapListed) return m;
  const poolPath = String(m.gnoswapPoolPath || "").trim();
  if (!poolPath) return m;
  const bal = await fetchGnoswapPoolBalances(RPC, poolPath);
  if (!bal || !(bal.ugnot >= 0) || !(bal.tokens >= 0)) return m;

  const wugnotGnot = bal.ugnot / UGNOT_PER_GNOT;
  // Spot from live reserves (GNOT per 1 token base unit)
  let poolSpotGnot = 0;
  if (bal.tokens > 0 && bal.ugnot > 0) {
    poolSpotGnot = wugnotGnot / bal.tokens;
  }
  const supply =
    Number(m?.params?.totalSupply) ||
    Number(m?.totalSupply) ||
    1_000_000_000;
  const poolShare = supply > 0 ? bal.tokens / supply : 0;
  // Thin token-side LP: pool-implied spot is not usable for TVL (was ~$1B on JAE).
  // Show WUGNOT leg only and flag reliability.
  const thin = poolShare > 0 && poolShare < 0.005;
  const px =
    !thin && poolSpotGnot > 0
      ? poolSpotGnot
      : Number(m.spotGnot || m.priceGnot) > 0
        ? Number(m.spotGnot || m.priceGnot)
        : 0;
  const tokenGnot =
    !thin && px > 0 && bal.tokens > 0 ? bal.tokens * px : 0;

  m.liquidityWugnotGnot = wugnotGnot;
  m.liquidityTokenGnot = tokenGnot;
  m.liquidityGnot = thin ? wugnotGnot : wugnotGnot + tokenGnot;
  m.liquiditySource = thin
    ? "gnoswap_pool_wugnot_only"
    : "gnoswap_pool_balances";
  m.liquidityThin = thin;
  m.poolBalUgnot = bal.ugnot;
  m.poolBalTokens = bal.tokens;
  // Internal helper for TVL only — do NOT write into spotGnot/priceGnot
  // (that broke PriceChart mark injection / cliff vs curve history).
  if (poolSpotGnot > 0) m.poolSpotGnot = poolSpotGnot;
  return m;
}

/**
 * Set spot price (GNOT/token) and recompute FDV / circ mcap so list cards
 * stay consistent with Token page after Gnoswap fills.
 */
function applySpotPrice(m, priceGnot, totalSupply = 1_000_000_000, source = "spot") {
  const px = Number(priceGnot);
  if (!m || !(px > 0) || !Number.isFinite(px)) return m;
  const supplyN = Number(totalSupply);
  const supply =
    Number.isFinite(supplyN) && supplyN > 0
      ? supplyN
      : fullMetrics()
        ? null
        : 1_000_000_000;
  m.priceGnot = px;
  m.spotGnot = px;
  m.priceUgnot = px * UGNOT_PER_GNOT;
  m.spotScaled = Math.floor(m.priceUgnot * 1_000_000);
  m.mcapGnot = supply == null ? null : px * supply;
  const circ = Number(m.sold) > 0 ? Number(m.sold) : 0;
  m.circMcapGnot = px * circ;
  m.priceSource = source;
  attachLiquidityTvl(m);
  return m;
}

/**
 * Gnoswap public prices API (api.gnoswap.io).
 * Returns GNOT USD (ORACLE grade for ugnot/wugnot) + optional per-token path map.
 * Cached ~60s. Fallback: CoinGecko gno-land, then optional GNOT_USD env pin.
 * Never invent a fake USD when all sources miss.
 */
/** Live GNOT/ugnot USD — Gnoswap ORACLE (post KuCoin/Kraken listing ~2026-09-16). */
const GNOSWAP_PRICES_URL =
  process.env.GNOSWAP_PRICES_URL || "https://api.gnoswap.io/v1/tokens/prices";
const GNOSWAP_API_BASE =
  process.env.GNOSWAP_API_BASE || "https://api.gnoswap.io/v1";
const COINGECKO_GNOT_URL =
  process.env.COINGECKO_GNOT_URL ||
  "https://api.coingecko.com/api/v3/simple/price?ids=gno-land&vs_currencies=usd";
const WUGNOT_TOKEN_KEY = "gno.land/r/gnoland/wugnot.wugnot";
/**
 * Optional override: GNOT_USD=… only when you intentionally pin a price.
 * Default 0 — prefer live Gnoswap ORACLE / CoinGecko; never invent a fake price.
 */
const ENV_GNOT_USD = Number(process.env.GNOT_USD);
const PINNED_GNOT_USD =
  Number.isFinite(ENV_GNOT_USD) && ENV_GNOT_USD > 0 ? ENV_GNOT_USD : 0;

async function fetchCoinGeckoGnotUsd() {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6_000);
    const res = await fetch(COINGECKO_GNOT_URL, {
      signal: ctrl.signal,
      headers: { Accept: "application/json" },
    });
    clearTimeout(timer);
    if (!res.ok) return 0;
    const body = await res.json();
    const usd = Number(body?.["gno-land"]?.usd);
    return Number.isFinite(usd) && usd > 0 ? usd : 0;
  } catch {
    return 0;
  }
}

async function fetchGnoswapFx() {
  const hit = cacheGet("fx:gnoswap");
  if (hit) return hit;
  const empty = {
    gnotUsd: PINNED_GNOT_USD,
    byPath: {},
    source: PINNED_GNOT_USD > 0 ? "env" : "none",
    updatedAt: null,
  };
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8_000);
    const res = await fetch(GNOSWAP_PRICES_URL, {
      signal: ctrl.signal,
      headers: { Accept: "application/json" },
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`gnoswap prices HTTP ${res.status}`);
    const body = await res.json();
    const rows = Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : [];
    const byPath = {};
    let gnotUsd = 0;
    let gnotSource = null;
    for (const row of rows) {
      const path = String(row?.path || "").trim();
      if (!path) continue;
      const usd = Number(row?.usd);
      const grade = String(row?.priceGradeType || "").toUpperCase();
      byPath[path] = {
        usd: Number.isFinite(usd) && usd > 0 ? usd : 0,
        grade,
        marketCap: Number(row?.marketCap) || 0,
        liquidity: Number(row?.liquidity) || 0,
      };
      if (
        (path === "ugnot" ||
          path === "gno.land/r/gnoland/wugnot.wugnot" ||
          path.endsWith("/wugnot.wugnot") ||
          path.endsWith(".wugnot")) &&
        Number.isFinite(usd) &&
        usd > 0
      ) {
        // Prefer ORACLE grade for ugnot (Gnoswap prices API)
        if (!gnotUsd || grade === "ORACLE") {
          gnotUsd = usd;
          gnotSource = grade === "ORACLE" ? "oracle" : "gnoswap";
        }
      }
    }
    if (!(gnotUsd > 0)) {
      const cg = await fetchCoinGeckoGnotUsd();
      if (cg > 0) {
        gnotUsd = cg;
        gnotSource = "coingecko";
      }
    }
    if (!(gnotUsd > 0) && PINNED_GNOT_USD > 0) {
      gnotUsd = PINNED_GNOT_USD;
      gnotSource = "env";
    }
    const fx = {
      gnotUsd: gnotUsd > 0 ? gnotUsd : 0,
      byPath,
      source: gnotUsd > 0 ? gnotSource || "gnoswap" : "none",
      updatedAt: Date.now(),
    };
    cacheSet("fx:gnoswap", fx, 60_000);
    return fx;
  } catch {
    // Gnoswap down → CoinGecko / env
    try {
      const cg = await fetchCoinGeckoGnotUsd();
      if (cg > 0) {
        const fx = {
          gnotUsd: cg,
          byPath: {},
          source: "coingecko",
          updatedAt: Date.now(),
        };
        cacheSet("fx:gnoswap", fx, 60_000);
        return fx;
      }
    } catch {
      /* fall through */
    }
    cacheSet("fx:gnoswap", empty, 15_000);
    return empty;
  }
}

/** Adena / Gnoswap token key from market (packagePath.SYMBOL). */
function marketTokenKey(m) {
  if (!m) return "";
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
  const tid = String(m.tokenId || m.TokenID || "").trim();
  if (tid && sym) {
    const esc = sym.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`\\.${esc}\\.\\d+$`);
    if (re.test(tid)) return tid.replace(re, `.${sym}`);
    if (tid.endsWith(`.${sym}`)) return tid;
  }
  const pkg = String(m.pkg || "").trim();
  if (pkg && sym) return `${pkg}.${sym}`;
  return tid || "";
}

/**
 * Attach USD fields using GNOT oracle × on-chain GNOT price.
 * Prefer direct Gnoswap ORACLE quote when present for listed tokens.
 */
function applyUsdPricing(m, fx) {
  if (!m || m.error) return m;
  const gnotUsd = Number(fx?.gnotUsd) || 0;
  m.gnotUsd = gnotUsd;
  m.fxSource = fx?.source || null;

  const priceGnot = Number(m.priceGnot) || Number(m.spotGnot) || 0;
  const mcapKnown = m.mcapGnot != null && Number(m.mcapGnot) > 0;
  const mcapGnot = mcapKnown ? Number(m.mcapGnot) : 0;
  const raisedGnot = Number(m.raisedGnot) || 0;
  const circMcapGnot = Number(m.circMcapGnot) || 0;

  let priceUsd = gnotUsd > 0 && priceGnot > 0 ? priceGnot * gnotUsd : 0;
  let mcapUsd =
    gnotUsd > 0 && mcapGnot > 0 ? mcapGnot * gnotUsd : fullMetrics() && m.mcapGnot == null ? null : 0;
  let priceSource = priceUsd > 0 ? "gnot_fx" : null;

  const key = marketTokenKey(m);
  const direct = key && fx?.byPath?.[key];
  // ORACLE replaces priceUsd only. FDV stays mcapGnot (ParamsInfo supply × priceGnot) × gnotUsd.
  if (direct && direct.usd > 0 && direct.grade === "ORACLE") {
    priceUsd = direct.usd;
    priceSource = "gnoswap_oracle";
  }

  m.priceUsd = priceUsd;
  m.mcapUsd = mcapUsd;
  m.circMcapUsd = gnotUsd > 0 && circMcapGnot > 0 ? circMcapGnot * gnotUsd : 0;
  m.raisedUsd = gnotUsd > 0 && raisedGnot > 0 ? raisedGnot * gnotUsd : 0;
  const liqG = Number(m.liquidityGnot) || 0;
  m.liquidityUsd = gnotUsd > 0 && liqG > 0 ? liqG * gnotUsd : 0;
  m.priceUsdSource = priceSource;
  if (m.spotGnot != null && gnotUsd > 0) {
    m.spotUsd = Number(m.spotGnot) * gnotUsd;
  }
  if (m.openPriceGnot != null && gnotUsd > 0) {
    m.openPriceUsd = Number(m.openPriceGnot) * gnotUsd;
  }
  // Chart points (optional light conversion for clients that prefer USD series)
  if (Array.isArray(m.chart) && gnotUsd > 0) {
    for (const pt of m.chart) {
      if (pt && pt.priceGnot != null && pt.priceUsd == null) {
        pt.priceUsd = Number(pt.priceGnot) * gnotUsd;
      }
      if (pt && pt.volumeGnot != null && pt.volumeUsd == null) {
        pt.volumeUsd = Number(pt.volumeGnot) * gnotUsd;
      }
    }
  }
  return m;
}

async function withUsdPricing(payload) {
  const fx = await fetchGnoswapFx();
  if (payload && Array.isArray(payload.markets)) {
    for (const m of payload.markets) applyUsdPricing(m, fx);
    payload.gnotUsd = fx.gnotUsd || 0;
    payload.fxSource = fx.source;
    payload.fxUpdatedAt = fx.updatedAt;
  } else if (payload && typeof payload === "object" && !payload.error) {
    applyUsdPricing(payload, fx);
  }
  return payload;
}

/** Net ugnot still needed to hit graduation (0 if graduated / already filled). */
function remainingRaiseUgnot(m, graduationUgnot) {
  if (!m || m.status === 1) return 0;
  const thr = Number(graduationUgnot) || 0;
  const raised = Number(m.raised) || 0;
  if (thr <= 0 || raised >= thr) return 0;
  return thr - raised;
}

/** One decimal. Graduated is 100. Missing or non-positive graduation stays null. */
function progressPctFromRaise(status, raised, graduation) {
  if (Number(status) === 1) return 100;
  const grad = Number(graduation);
  const raisedN = Number(raised);
  if (!(grad > 0) || !Number.isFinite(raisedN)) return null;
  return Math.min(100, Math.round((raisedN * 1000) / grad) / 10);
}

function parseLaunchInfo(line, totalSupply = 1_000_000_000, gradUgnot = 0) {
  const p = line.split("|");
  if (p.length < 15) return null;
  const status = Number(p[3]);
  const raised = Number(p[4]);
  const sold = Number(p[5]);
  // Tail after fixed prefix (0..17): poolPath|note|listVenue.
  // Zdex ConfirmZdexList stores poolId "ugnot|SYMBOL" — extra "|" shifts indices.
  // Rebuild from the right so listVenue/note stay correct.
  let gnoswapPoolPath = "";
  let gnoswapNote = "";
  let listVenue = "";
  if (p.length >= 18) {
    const tail = p.slice(18);
    if (tail.length >= 3) {
      listVenue = tail[tail.length - 1] || "";
      gnoswapNote = tail[tail.length - 2] || "";
      gnoswapPoolPath = tail.slice(0, -2).join("|");
    } else if (tail.length === 2) {
      gnoswapPoolPath = tail[0] || "";
      gnoswapNote = tail[1] || "";
    } else if (tail.length === 1) {
      gnoswapPoolPath = tail[0] || "";
    }
  }
  // Compat default only when pad omits listVenue; zdex pool ids use "ugnot|…"
  if (!listVenue && p[17] === "1") {
    listVenue = /^ugnot\|/i.test(gnoswapPoolPath) ? "zdex" : "gnoswap";
  }
  const m = {
    id: p[0],
    name: p[1],
    symbol: p[2],
    status,
    statusLabel: status === 1 ? "graduated" : "curve",
    raised,
    sold,
    buyers: Number(p[6]),
    creatorFees: Number(p[7]),
    poolUgnot: Number(p[8]),
    poolToken: Number(p[9]),
    uri: p[10],
    creator: p[11],
    virtualUgnot: Number(p[12]),
    virtualToken: Number(p[13]),
    created: Number(p[14]),
    // Extended fields (GRC20 / Gnoswap) — optional for older deploys
    tokenId: p[15] || "",
    gnoswapReady: p[16] === "1" || status === 1,
    // padv8+: gnoswapListed|gnoswapPoolPath; padv12+: gnoswapNote
    gnoswapListed: p[17] === "1",
    gnoswapPoolPath,
    gnoswapNote,
    // padv23+: listVenue (e.g. "gnoswap"|"zdex"); empty if unlisted / older pads
    listVenue,
    progressPct: progressPctFromRaise(status, raised, gradUgnot),
  };
  return enrichPricing(m, totalSupply);
}

async function getParams(RPC, PKG) {
  const cacheKey = `params:${PKG}:${fullMetrics() ? "full" : "fast"}`;
  const hit = cacheGet(cacheKey);
  if (hit) return hit;
  try {
    const raw = await qeval(
      RPC,
      PKG,
      `${PKG}.ParamsInfo()`,
      fullMetrics() ? 20_000 : 0,
    );
    const parsed = paramsFromInfoRaw(raw);
    if (parsed) {
      cacheSet(cacheKey, parsed, 60_000);
      return parsed;
    }
    throw new Error("bad ParamsInfo");
  } catch {
    // Netlify fast path keeps the old display fallback. Full metrics must not
    // invent graduation, supply, or a threshold when ParamsInfo failed.
    if (fullMetrics()) return null;
    return {
      totalSupply: 1e9,
      curveSupply: 8e8,
      poolSeed: 2e8,
      graduation: 5e7,
      graduationGnot: 50,
      feeBps: 120,
      createBond: 1e6,
      createBondGnot: 1,
      listFeeGns: 0,
      listFeeGnsUnits: 0,
      ugnotPerGnot: UGNOT_PER_GNOT,
    };
  }
}

/**
 * Minimum public pad generation: padv14 (WUGNOT curve + auto-list).
 * Older pads (padv13 and below) are hidden from markets / portfolio / activity / creator.
 * Active hub pad is always kept.
 */
const MIN_PUBLIC_PAD_VERSION = 14;

/**
 * Extract pad version number from package path or hub key (padv13, pad14, legacy_padv9).
 * Returns null if unversioned.
 */
function padVersionNumber(pkgOrKey) {
  const s = String(pkgOrKey || "").toLowerCase();
  const m = s.match(/(?:^|[/_.-])padv?(\d+)(?:$|[/_.-])/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * True if this pad must not appear in public discovery.
 * - Old gnomemepad paths with padvN where N < MIN_PUBLIC_PAD_VERSION
 * - Hub keys named legacy*
 * Never retire /gnomi/* (padv3 = third gnomi cut, not legacy padv3).
 * Bare hub labels ("pad", "padv3") are not package paths — keep visible.
 */
function isRetiredPadVersion(pkgOrKey) {
  const s = String(pkgOrKey || "").toLowerCase();
  if (!s) return false;
  if (/\/gnomi\//.test(s)) return false;
  if (/(?:^|[/_.-])legacy(?:$|[/_.-])/.test(s) || s.startsWith("legacy")) return true;
  // Hub source labels only (no path separators)
  if (!/[/.]/.test(s)) return false;
  const n = padVersionNumber(s);
  if (n == null) return false;
  return n < MIN_PUBLIC_PAD_VERSION;
}

/**
 * Pad packages to scan: active hub "pad" (+ future padv14+ only).
 * Does not scan padv13 and older even if still on hub as legacy_*.
 * @returns {{ key: string, pkg: string, active: boolean, legacy: boolean }[]}
 */
function listPadSources(hubInfo, cfg) {
  const activePkg = hubInfo.pad || cfg.PKG;
  const mods = hubInfo.modules || {};
  const seen = new Set();
  const out = [];

  function add(key, pkg, active) {
    if (!pkg || !pkg.startsWith("gno.land/")) return;
    if (seen.has(pkg)) return;
    // Always show active hub pad; hide retired versions for non-active sources
    if (!active && (isRetiredPadVersion(pkg) || isRetiredPadVersion(key))) return;
    seen.add(pkg);
    out.push({
      key,
      pkg,
      active: !!active,
      legacy: !active,
    });
  }

  // Only the active pad (padv14+) — primary discovery surface
  add("pad", activePkg, true);

  // Optional: other hub pad_* modules that are padv14+ (e.g. future padv15)
  for (const [key, path] of Object.entries(mods)) {
    if (key === "pad" || key === "profile" || key === "meta" || key === "points" || key === "bond") {
      continue;
    }
    if (key.startsWith("legacy") || key.startsWith("pad")) {
      add(key, path, path === activePkg);
    }
  }
  // Env PKG only if padv14+ and distinct from active
  if (cfg.PKG && cfg.PKG !== activePkg && !isRetiredPadVersion(cfg.PKG)) {
    add("env_pkg", cfg.PKG, false);
  }
  return out;
}

async function getMarketsOne(RPC, PKG, meta = {}) {
  const params = await getParams(RPC, PKG);
  const paramsWarning = params
    ? null
    : "ParamsInfo failed; graduation, fee bps, and supply were not substituted";
  let idsRaw = "";
  try {
    idsRaw = await qeval(RPC, PKG, `${PKG}.ListIDs()`, fullMetrics() ? 20_000 : 0);
  } catch (e) {
    return {
      params,
      protocolFees: 0,
      markets: [],
      error: String(e.message || e),
      warning: paramsWarning,
      ...meta,
    };
  }
  const ids = String(idsRaw)
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  // Speedup #2: PadAddress once per pad (not per market)
  let padAddr = "";
  try {
    const pa = String(await qeval(RPC, PKG, `${PKG}.PadAddress()`) || "").replace(/^"|"$/g, "");
    if (/^g1[a-z0-9]+$/i.test(pa)) padAddr = pa;
  } catch {
    /* optional */
  }

  const padLabel = String(PKG).split("/").pop() || "pad";
  const collateral = /padv1[4-9]\b|padv[2-9]\d\b/i.test(String(PKG)) ? "wugnot" : "ugnot";
  const supplyArg = params ? params.totalSupply : null;
  const gradArg = params ? params.graduation : 0;
  const callMs = fullMetrics() ? 20_000 : 0;

  // Speedup #2: parallel LaunchInfo (bounded concurrency)
  const markets = await mapPool(ids, fullMetrics() ? 12 : 8, async (id) => {
    try {
      const info = await qeval(
        RPC,
        PKG,
        `${PKG}.LaunchInfo(${JSON.stringify(id)})`,
        callMs,
      );
      const parsed = parseLaunchInfo(String(info), supplyArg, gradArg);
      if (!parsed) {
        return {
          id,
          pkg: PKG,
          sourceKey: meta.sourceKey,
          active: !!meta.active,
          legacy: !!meta.legacy,
          error: "parse_failed",
        };
      }
      if (parsed.status !== 1) {
        parsed.progressPct = progressPctFromRaise(
          parsed.status,
          parsed.raised,
          params ? params.graduation : 0,
        );
      }
      enrichPricing(parsed, supplyArg);
      parsed.pkg = PKG;
      parsed.sourceKey = meta.sourceKey || "pad";
      parsed.active = !!meta.active;
      parsed.legacy = !!meta.legacy;
      parsed.padLabel = padLabel;
      parsed.collateral = collateral;
      if (padAddr) parsed.padAddr = padAddr;
      if (params) {
        const rem = remainingRaiseUgnot(parsed, params.graduation);
        parsed.remainingRaiseUgnot = rem;
        parsed.remainingRaiseGnot = rem / UGNOT_PER_GNOT;
      } else {
        parsed.remainingRaiseUgnot = null;
        parsed.remainingRaiseGnot = null;
      }
      // TradeHistory is one RPC per token. The page request skips it.
      // The snapshot worker still fills tradeStats so cards keep volume.
      if (meta.tradeStats !== false) {
        try {
          const hist = await qeval(
            RPC,
            PKG,
            `${PKG}.TradeHistory(${JSON.stringify(id)})`,
            callMs,
          );
          const pts = parseTradeHistory(hist).map((pt) => ({
            ...pt,
            volumeGnot: (Number(pt.ugnot) || 0) / UGNOT_PER_GNOT,
          }));
          parsed.tradeStats = summarizeTradeStats(pts);
          markCurveRingLowerBound(parsed.tradeStats, pts.length);
          rememberCurvePoints(PKG, id, pts);
          await maybeUpgradeCurveVolume(PKG, id, parsed.tradeStats, pts, null);
          attachCurveDexVolume(parsed);
        } catch (e) {
          if (fullMetrics()) {
            parsed.tradeStats = null;
            parsed.tradeStatsError = String(e.message || e).slice(0, 180);
          } else {
            parsed.tradeStats = {
              trades: 0,
              buyCount: 0,
              sellCount: 0,
              volumeGnot: 0,
              buyVolumeGnot: 0,
              sellVolumeGnot: 0,
            };
          }
        }
      }
      return parsed;
    } catch (e) {
      return {
        id,
        pkg: PKG,
        sourceKey: meta.sourceKey,
        active: !!meta.active,
        legacy: !!meta.legacy,
        error: String(e.message || e),
      };
    }
  });

  let protocolFees = 0;
  let protocolFeesPaid = 0;
  let protocolAddr = "";
  try {
    protocolFees = Number(await qeval(RPC, PKG, `${PKG}.ProtocolFees()`)) || 0;
  } catch {
    /* ignore */
  }
  try {
    // FeeInfo: protocolAddr|pending|paid (padv8+)
    const fi = String(await qeval(RPC, PKG, `${PKG}.FeeInfo()`) || "");
    const fp = fi.replace(/^"|"$/g, "").split("|");
    if (fp.length >= 3) {
      protocolAddr = fp[0] || "";
      if (Number.isFinite(Number(fp[1]))) protocolFees = Number(fp[1]);
      if (Number.isFinite(Number(fp[2]))) protocolFeesPaid = Number(fp[2]);
    }
  } catch {
    try {
      protocolAddr = String(await qeval(RPC, PKG, `${PKG}.ProtocolAddress()`) || "").replace(
        /^"|"$/g,
        "",
      );
    } catch {
      /* ignore */
    }
  }
  return {
    params,
    protocolFees,
    protocolFeesGnot: protocolFees / UGNOT_PER_GNOT,
    protocolFeesPaid,
    protocolFeesPaidGnot: protocolFeesPaid / UGNOT_PER_GNOT,
    protocolAddr,
    markets,
    warning: paramsWarning,
    ...meta,
  };
}

/** Curve tradeStats plus dexTradeStats when that leg was loaded. Never raisedGnot. */
function attachCurveDexVolume(m) {
  if (!fullMetrics() || !m || m.error || !m.tradeStats) return m;
  const curve = Number(m.tradeStats.volumeGnot);
  if (!Number.isFinite(curve)) return m;
  const dexRaw = m.dexTradeStats == null ? 0 : Number(m.dexTradeStats.volumeGnot);
  const dex = Number.isFinite(dexRaw) ? dexRaw : 0;
  m.volumeGnot = curve + dex;
  return m;
}

/** Aggregate markets across active + legacy pads.
 *  opts.lite: skip Gnoswap enrich (speedup #1 markets-lite).
 */
async function getMarkets(RPC, sources, opts = {}) {
  const lite = !!opts.lite;
  if (!Array.isArray(sources) || sources.length === 0) {
    return {
      params: null,
      protocolFees: 0,
      protocolFeesGnot: 0,
      markets: [],
      count: 0,
      sources: [],
      lite,
    };
  }
  const active = sources.find((s) => s.active) || sources[0];
  if (fullMetrics()) {
    const pkgs = new Set((sources || []).map((s) => s && s.pkg).filter(Boolean));
    for (const pkg of pkgs) replayPadBalances(pkg).catch(() => {});
  }
  const parts = await Promise.all(
    sources.map((s) =>
      getMarketsOne(RPC, s.pkg, {
        sourceKey: s.key,
        active: s.active,
        legacy: s.legacy,
        tradeStats: opts.tradeStats !== false,
      }),
    ),
  );
  const markets = [];
  let protocolFees = 0;
  for (const part of parts) {
    if (part.active) protocolFees = part.protocolFees || 0;
    for (const m of part.markets || []) {
      // Belt-and-suspenders: never surface pad v0–v7 in list APIs
      if (isRetiredPadVersion(m.pkg) || isRetiredPadVersion(m.padLabel)) continue;
      markets.push(m);
    }
  }
  // Active first, then by created desc
  markets.sort((a, b) => {
    if (!!a.legacy !== !!b.legacy) return a.legacy ? 1 : -1;
    return (Number(b.created) || 0) - (Number(a.created) || 0);
  });

  // Full path only: live Gnoswap enrich (skip on markets-lite — speedup #1)
  if (!lite) {
    await enrichListedMarketsFromGnoswap(RPC, markets, parts);
  }
  if (fullMetrics()) {
    for (const m of markets) attachCurveDexVolume(m);
    const byPkg = new Map();
    for (const m of markets) {
      if (!m?.pkg || m.error) continue;
      if (!byPkg.has(m.pkg)) byPkg.set(m.pkg, []);
      byPkg.get(m.pkg).push(m);
    }
    await Promise.all(
      [...byPkg.entries()].map(([pkg, rows]) => attachLedgerHolderCounts(pkg, rows)),
    );
    await attachListStatWindows(RPC, markets);
  }

  const params = (parts.find((p) => p.active) || parts[0])?.params || null;
  const warnings = [];
  for (const part of parts) {
    if (part?.warning) warnings.push(String(part.warning));
  }
  if (!params && !warnings.length) {
    warnings.push("ParamsInfo failed; graduation, fee bps, and supply were not substituted");
  }
  return {
    params: params || null,
    ...(warnings.length ? { warnings } : {}),
    protocolFees,
    protocolFeesGnot: protocolFees / UGNOT_PER_GNOT,
    markets,
    count: markets.length,
    lite,
    ...(fullMetrics() ? { fullMetrics: true } : {}),
    sources: sources.map((s) => ({
      key: s.key,
      pkg: s.pkg,
      active: s.active,
      legacy: s.legacy,
      label: String(s.pkg).split("/").pop(),
    })),
  };
}

/**
 * Attach pools-style achievement badges onto market rows.
 * volByKey: optional map `${pkg}|${id}` → volumeGnot from activity sample.
 */
function attachTokenBadges(markets, opts = {}) {
  const tipHeight = Number(opts.tipHeight) || 0;
  const volByKey = opts.volByKey || null;
  const list = Array.isArray(markets) ? markets : [];
  for (const m of list) {
    if (!m || m.error) continue;
    const k = `${m.pkg || ""}|${m.id || ""}`;
    const volumeGnot = volByKey ? Number(volByKey[k]) || 0 : Number(m.volumeGnot) || 0;
    const all = evaluateTokenBadges(m, {
      volumeGnot,
      tipHeight,
      blockSecs: opts.blockSecs || 2,
    });
    m.badges = all;
    m.wearBadges = wearBadges(all, WEAR_LIMIT);
  }
  return list;
}

async function tipHeightCached(RPC) {
  const key = `tip:${RPC}`;
  const hit = cacheGet(key);
  if (hit != null) return Number(hit) || 0;
  try {
    const st = await rpc(RPC, "status", {});
    const h = Number(st?.sync_info?.latest_block_height) || 0;
    cacheSet(key, h, 15_000);
    return h;
  } catch {
    return 0;
  }
}

async function decorateMarketsBadges(RPC, marketsPayload) {
  if (!marketsPayload || !Array.isArray(marketsPayload.markets)) return marketsPayload;
  const tip = await tipHeightCached(RPC);
  attachTokenBadges(marketsPayload.markets, { tipHeight: tip });
  return marketsPayload;
}

/**
 * For gnoswapListed markets, pull last swap mark (cached) and recompute mcap.
 * Volume on cards still comes from /api/activity (already merges DEX).
 */
async function enrichListedMarketsFromGnoswap(RPC, markets, parts = []) {
  const supplyByPkg = new Map();
  for (const part of parts || []) {
    const supply = Number(part?.params?.totalSupply);
    if (!(supply > 0)) continue;
    for (const m of part?.markets || []) {
      if (m?.pkg) supplyByPkg.set(m.pkg, supply);
    }
  }

  const listed = (markets || []).filter((m) => m && !m.error && m.gnoswapListed);
  if (!listed.length) return;

  await Promise.all(
    listed.map(async (m) => {
      try {
        const tokenKey = marketTokenKey(m);
        if (!tokenKey) {
          m.dexHistoryEmpty = true;
          m.volumeScope = "curve_only";
        } else {
          const pts = await fetchGnoswapSwapHistory(tokenKey, 30);
          const lastPx = lastTradePriceGnot(pts, "gnoswap");
          if (!(lastPx > 0)) {
            // Keep frozen pool_mark from enrichPricing — matches Token page when DEX empty
            m.dexHistoryEmpty = true;
            m.volumeScope = "curve_only";
          } else {
            const supply = supplyByPkg.has(m.pkg) ? supplyByPkg.get(m.pkg) : null;
            applySpotPrice(m, lastPx, supply, "gnoswap_last_trade");
            m.dexHistoryEmpty = false;
            m.volumeScope = "curve_and_dex";
            const stats = summarizeTradeStats(pts);
            if (stats && stats.trades > 0) {
              m.dexTradeStats = stats;
            }
          }
        }
      } catch {
        m.dexHistoryEmpty = true;
        m.volumeScope = "curve_only";
        /* keep pad pool mark */
      }
      // Live pool TVL + valuation spot for PnL (sane pool spot / last trade)
      try {
        await enrichLiveGnoswapLiquidity(RPC, m);
        const supply = supplyByPkg.has(m.pkg) ? supplyByPkg.get(m.pkg) : null;
        const valued = resolveValuationSpotGnot(m, { totalSupply: supply });
        if (valued.spot > 0) {
          applySpotPrice(m, valued.spot, supply, valued.source || "gnoswap_pool_spot");
        }
      } catch {
        /* keep seed/list-note fallback */
      }
    }),
  );
}

/**
 * Trade sides (pad + UI extensions):
 *  0 buy · 1 sell · 2 open (curve mark, 0 volume)
 *  3 add_lp (graduate seed / Gnoswap mint) · 4 remove_lp
 */
function parseTradeHistory(raw) {
  const points = [];
  for (const line of String(raw || "").split("\n")) {
    const t = line.trim();
    if (!t) continue;
    const p = t.split("|");
    if (p.length < 5) continue;
    let side = Number(p[1]);
    const ugnot = Number(p[2]) || 0;
    const tokens = Number(p[3]) || 0;
    // Graduate records TradeSideOpen with poolU/poolT — treat as Add LP
    let sideLabel = "open";
    if (side === 0) sideLabel = "buy";
    else if (side === 1) sideLabel = "sell";
    else if (side === 2 && (ugnot > 0 || tokens > 0)) {
      side = 3;
      sideLabel = "add_lp";
    } else if (side === 3) sideLabel = "add_lp";
    else if (side === 4) sideLabel = "remove_lp";
    else sideLabel = "open";
    points.push({
      height: Number(p[0]),
      side,
      sideLabel,
      ugnot,
      tokens,
      price: Number(p[4]),
      source: sideLabel === "add_lp" || sideLabel === "remove_lp" ? "lp" : "curve",
    });
  }
  return points;
}

/**
 * Shared ExactIn reports from gnomi.fun clients (Gnoswap public indexer
 * does not list Sapphire meme pools today — REST /swap/history stays empty).
 * Prefer Netlify Blobs (cross-isolate); fall back to in-memory.
 */
const reportedTradesByToken = new Map(); // tokenKey -> { at, rows[] }
const REPORTED_MAX_PER_TOKEN = 80;
const REPORTED_TTL_MS = 6 * 60 * 60 * 1000;
const reportRateByIp = new Map(); // ip -> { at, n }
let reportedBlobStorePromise = null;

function reportedStoreKey(tokenKey, poolPath) {
  return String(tokenKey || poolPath || "").trim();
}

async function getReportedBlobStore() {
  if (reportedBlobStorePromise) return reportedBlobStorePromise;
  reportedBlobStorePromise = (async () => {
    try {
      const mod = await import("@netlify/blobs");
      const getStore = mod.getStore || mod.default?.getStore;
      if (typeof getStore !== "function") return null;
      return getStore("gnomi-reported-trades");
    } catch {
      return null;
    }
  })();
  return reportedBlobStorePromise;
}

async function getReportedTrades(tokenKey, poolPath) {
  const k = reportedStoreKey(tokenKey, poolPath);
  if (!k) return [];
  const store = await getReportedBlobStore();
  if (store) {
    try {
      const raw = await store.get(k, { type: "json" });
      const rows = Array.isArray(raw?.rows) ? raw.rows : Array.isArray(raw) ? raw : [];
      return rows.slice(-REPORTED_MAX_PER_TOKEN);
    } catch {
      /* fall through to memory */
    }
  }
  const e = reportedTradesByToken.get(k);
  if (!e) return [];
  if (Date.now() - e.at > REPORTED_TTL_MS) {
    reportedTradesByToken.delete(k);
    return [];
  }
  return Array.isArray(e.rows) ? e.rows.slice() : [];
}

async function pushReportedTrade(tokenKey, poolPath, row) {
  const k = reportedStoreKey(tokenKey, poolPath);
  if (!k || !row) return false;
  const prevRows = await getReportedTrades(k, "");
  const merged = mergeChartPoints(prevRows, [row]).slice(-REPORTED_MAX_PER_TOKEN);
  reportedTradesByToken.set(k, { at: Date.now(), rows: merged });
  if (reportedTradesByToken.size > 128) {
    const first = reportedTradesByToken.keys().next().value;
    if (first != null) reportedTradesByToken.delete(first);
  }
  const store = await getReportedBlobStore();
  if (store) {
    try {
      await store.setJSON(k, { at: Date.now(), rows: merged });
    } catch {
      /* memory still holds for this isolate */
    }
  }
  return true;
}

function allowReportRequest(ip) {
  const key = String(ip || "unknown");
  const now = Date.now();
  const cur = reportRateByIp.get(key) || { at: now, n: 0 };
  if (now - cur.at > 60_000) {
    reportRateByIp.set(key, { at: now, n: 1 });
    return true;
  }
  if (cur.n >= 30) return false;
  cur.n += 1;
  reportRateByIp.set(key, cur);
  return true;
}

/** Ambassador Season 1 applications + content URLs (Blobs + memory). */
const ambassadorMem = { apply: [], content: [] };
const ambassadorRateByIp = new Map();
let ambassadorBlobStorePromise = null;
const AMBASSADOR_MAX = 500;

async function getAmbassadorBlobStore() {
  if (ambassadorBlobStorePromise) return ambassadorBlobStorePromise;
  ambassadorBlobStorePromise = (async () => {
    try {
      const mod = await import("@netlify/blobs");
      const getStore = mod.getStore || mod.default?.getStore;
      if (typeof getStore !== "function") return null;
      return getStore("gnomi-ambassadors");
    } catch {
      return null;
    }
  })();
  return ambassadorBlobStorePromise;
}

function allowAmbassadorRequest(ip) {
  const key = String(ip || "unknown");
  const now = Date.now();
  const cur = ambassadorRateByIp.get(key) || { at: now, n: 0 };
  if (now - cur.at > 60_000) {
    ambassadorRateByIp.set(key, { at: now, n: 1 });
    return true;
  }
  if (cur.n >= 20) return false;
  cur.n += 1;
  ambassadorRateByIp.set(key, cur);
  return true;
}

async function loadAmbassadorList(kind) {
  const k = kind === "apply" ? "apply" : "content";
  const store = await getAmbassadorBlobStore();
  if (store) {
    try {
      const raw = await store.get(k, { type: "json" });
      if (Array.isArray(raw?.rows)) return raw.rows;
      if (Array.isArray(raw)) return raw;
    } catch {
      /* memory */
    }
  }
  return Array.isArray(ambassadorMem[k]) ? ambassadorMem[k].slice() : [];
}

async function saveAmbassadorList(kind, rows) {
  const k = kind === "apply" ? "apply" : "content";
  const next = (Array.isArray(rows) ? rows : []).slice(-AMBASSADOR_MAX);
  ambassadorMem[k] = next;
  let durable = false;
  const store = await getAmbassadorBlobStore();
  if (store) {
    try {
      await store.setJSON(k, { at: Date.now(), rows: next });
      durable = true;
    } catch {
      durable = false;
    }
  }
  return { n: next.length, durable };
}

async function pushAmbassadorRecord(kind, row) {
  const k = kind === "apply" ? "apply" : "content";
  const prev = await loadAmbassadorList(k);
  return saveAmbassadorList(k, [...prev, row]);
}

async function ambassadorPublicCounts() {
  const apply = await loadAmbassadorList("apply");
  const content = await loadAmbassadorList("content");
  const scored = content.filter((r) => Number.isFinite(Number(r.score)));
  return {
    applications: apply.length,
    contentSubmissions: content.length,
    contentScored: scored.length,
  };
}

/** Aggregate public leaderboard from scored content (content pillar first). */
function buildAmbassadorLeaderboard(contentRows) {
  const byKey = new Map();
  for (const row of contentRows || []) {
    const g1 = String(row.g1 || "").toLowerCase();
    const x = String(row.xHandle || "").toLowerCase();
    const key = g1 || (x ? `x:${x}` : "");
    if (!key) continue;
    let e = byKey.get(key);
    if (!e) {
      e = {
        g1: row.g1 || "",
        xHandle: row.xHandle || "",
        displayName: row.displayName || row.xHandle || shortAddrSafe(row.g1),
        submissions: 0,
        scoredCount: 0,
        contentScoreSum: 0,
        contentScoreAvg: null,
        contentScoreBest: null,
        lastSubmitAt: 0,
      };
      byKey.set(key, e);
    }
    e.submissions += 1;
    e.lastSubmitAt = Math.max(e.lastSubmitAt, Number(row.at) || 0);
    if (row.displayName) e.displayName = row.displayName;
    if (row.xHandle) e.xHandle = row.xHandle;
    if (row.g1) e.g1 = row.g1;
    const sc = Number(row.score);
    if (Number.isFinite(sc)) {
      e.scoredCount += 1;
      e.contentScoreSum += sc;
      e.contentScoreBest =
        e.contentScoreBest == null ? sc : Math.max(e.contentScoreBest, sc);
    }
  }
  const rows = [...byKey.values()].map((e) => {
    const avg = e.scoredCount > 0 ? e.contentScoreSum / e.scoredCount : null;
    // Weighted contribution of content pillar (50%) using average 0–100 score.
    const contentWeighted =
      avg != null ? Math.round((avg / 100) * 50 * 100) / 100 : 0;
    return {
      ...e,
      contentScoreAvg: avg != null ? Math.round(avg * 10) / 10 : null,
      contentWeighted,
      // MVP total = contentWeighted; other pillars filled later.
      totalScore: contentWeighted,
    };
  });
  rows.sort((a, b) => {
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
    if ((b.contentScoreBest || 0) !== (a.contentScoreBest || 0)) {
      return (b.contentScoreBest || 0) - (a.contentScoreBest || 0);
    }
    return (b.lastSubmitAt || 0) - (a.lastSubmitAt || 0);
  });
  return rows.map((r, i) => ({ ...r, rank: i + 1 }));
}

function shortAddrSafe(addr) {
  const s = String(addr || "");
  if (s.length < 12) return s || "—";
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}

/**
 * Post-list swaps live on Gnoswap, not pad TradeHistory.
 * Fetch recent WUGNOT↔token swaps for chart continuity after listing.
 * Note: Sapphire meme pools are often missing from the Gnoswap indexer —
 * empty 200 is common; transport errors must not poison-cache as empty.
 */
async function fetchGnoswapSwapHistory(tokenPath, limit = 80) {
  const path = String(tokenPath || "").trim();
  if (!path || path === WUGNOT_TOKEN_KEY) return [];
  const cacheKey = `gnoswap:swaps:${path}:${limit}`;
  const hit = cacheGet(cacheKey);
  if (hit) return hit;

  const qs = new URLSearchParams({
    tokenAPath: WUGNOT_TOKEN_KEY,
    tokenBPath: path,
    limit: String(Math.min(100, Math.max(10, limit))),
  });
  const url = `${GNOSWAP_API_BASE}/swap/history?${qs}`;

  async function once() {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8_000);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: { Accept: "application/json" },
      });
      if (!res.ok) throw new Error(`swap history HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  try {
    let body;
    try {
      body = await once();
    } catch (e1) {
      // one retry on timeout / 5xx / network
      body = await once();
    }
    const rows = Array.isArray(body?.data) ? body.data : [];
    const points = [];
    for (const row of rows) {
      const fromPath = String(row?.fromToken?.path || "").trim();
      const toPath = String(row?.toToken?.path || "").trim();
      const fromAmt = Number(row?.fromTokenAmount) || 0;
      const toAmt = Number(row?.toTokenAmount) || 0;
      if (fromAmt <= 0 || toAmt <= 0) continue;

      const fromIsWugnot =
        fromPath === WUGNOT_TOKEN_KEY ||
        fromPath.endsWith("/wugnot.wugnot") ||
        fromPath === "ugnot" ||
        /wugnot/i.test(String(row?.fromToken?.symbol || ""));
      const toIsWugnot =
        toPath === WUGNOT_TOKEN_KEY ||
        toPath.endsWith("/wugnot.wugnot") ||
        toPath === "ugnot" ||
        /wugnot/i.test(String(row?.toToken?.symbol || ""));

      let side = 0; // buy meme with wugnot
      let ugnot = 0;
      let tokens = 0;
      if (fromIsWugnot && !toIsWugnot) {
        side = 0;
        ugnot = fromAmt;
        tokens = toAmt;
      } else if (toIsWugnot && !fromIsWugnot) {
        side = 1;
        ugnot = toAmt;
        tokens = fromAmt;
      } else {
        continue;
      }
      const priceGnot = tokens > 0 ? ugnot / UGNOT_PER_GNOT / tokens : 0;
      const timeMs = row?.time ? Date.parse(row.time) : 0;
      points.push({
        height: 0,
        side,
        sideLabel: side === 0 ? "buy" : "sell",
        ugnot,
        tokens,
        price: Math.floor(priceGnot * UGNOT_PER_GNOT * 1_000_000),
        priceGnot,
        volumeGnot: ugnot / UGNOT_PER_GNOT,
        timeMs: Number.isFinite(timeMs) ? timeMs : 0,
        time: row?.time || null,
        hash: String(row?.txHash || ""),
        source: "gnoswap",
      });
    }
    // oldest → newest for chart
    points.sort((a, b) => (a.timeMs || 0) - (b.timeMs || 0));
    // Genuine empty 200: short TTL. Non-empty: normal TTL.
    cacheSet(cacheKey, points, points.length ? 25_000 : 5_000);
    return points;
  } catch {
    // Transport / 5xx — do NOT cache [] (avoids 10s blackout after blip)
    return [];
  }
}

/** Merge pad curve history + Gnoswap swaps (dedupe by hash / fingerprint). */
function mergeChartPoints(curvePts, dexPts) {
  const out = [];
  const byHash = new Map();
  const byFp = new Map();
  function normHash(h) {
    let s = String(h || "").trim();
    if (!s) return "";
    if (s.startsWith("0x") || s.startsWith("0X")) s = s.slice(2);
    return s.replace(/-/g, "+").replace(/_/g, "/").toLowerCase();
  }
  function fp(pt) {
    const side = Number(pt.side);
    const ug = Math.round(Number(pt.ugnot) || 0);
    const tb = Math.floor((Number(pt.timeMs) || 0) / 180_000);
    if (ug > 0) return `u:${side}|${ug}|${tb}`;
    return [
      pt.source || "",
      side,
      ug,
      Math.round(Number(pt.tokens) || 0),
      Number(pt.height) || 0,
      tb,
    ].join("|");
  }
  function prefer(a, b) {
    const score = (t) =>
      (normHash(t.hash) ? 4 : 0) +
      (Number(t.tokens) > 0 ? 2 : 0) +
      (Number(t.ugnot) > 0 ? 1 : 0);
    return score(a) >= score(b) ? a : b;
  }
  for (const pt of [...(curvePts || []), ...(dexPts || [])]) {
    if (!pt) continue;
    const h = normHash(pt.hash);
    if (h) {
      const prev = byHash.get(h);
      byHash.set(h, prev ? prefer(prev, pt) : pt);
      continue;
    }
    const k = fp(pt);
    const prev = byFp.get(k);
    byFp.set(k, prev ? prefer(prev, pt) : pt);
  }
  // Drop fingerprint rows that collide with a hashed row (same ugnot/side/bucket)
  for (const pt of byHash.values()) {
    byFp.delete(fp(pt));
    out.push(pt);
  }
  for (const pt of byFp.values()) out.push(pt);
  out.sort((a, b) => {
    const ta = Number(a.timeMs) || 0;
    const tb = Number(b.timeMs) || 0;
    if (ta && tb && ta !== tb) return ta - tb;
    return (Number(a.height) || 0) - (Number(b.height) || 0);
  });
  return out;
}

/** Volume-weighted avg buy price in GNOT per token from trade chart. */
function marketVwapBuyGnot(chart) {
  let ug = 0;
  let tok = 0;
  for (const pt of chart || []) {
    if (Number(pt.side) !== 0) continue;
    ug += Number(pt.ugnot) || 0;
    tok += Number(pt.tokens) || 0;
  }
  if (tok <= 0 || ug <= 0) return null;
  // ugnot/token → GNOT/token
  return ug / tok / UGNOT_PER_GNOT;
}

/**
 * Last non-open/non-LP trade price in GNOT/token.
 * @param {object[]} chart
 * @param {string|null} sourceFilter  e.g. "gnoswap" — only that source; null = any
 */
function lastTradePriceGnot(chart, sourceFilter = null) {
  const pts = [...(chart || [])].reverse();
  for (const pt of pts) {
    const s = Number(pt.side);
    if (s === 2 || s === 3 || s === 4) continue;
    if (sourceFilter && pt.source !== sourceFilter) continue;
    const px = Number(pt.priceGnot);
    if (px > 0) return px;
  }
  return null;
}

/**
 * Mark used for PnL / portfolio / holders — must track live market, not pad dump seed.
 * Priority: DEX last trade → sane live pool spot → last curve trade → VWAP → pad mark.
 */
function resolveValuationSpotGnot(m, opts = {}) {
  const lastDex =
    opts.lastDexPx != null
      ? Number(opts.lastDexPx)
      : lastTradePriceGnot(m?.chart, "gnoswap") ||
        lastTradePriceGnot(m?.chart, "reported");
  if (lastDex > 0) {
    return {
      spot: lastDex,
      source: lastTradePriceGnot(m?.chart, "gnoswap")
        ? "gnoswap_last_trade"
        : "gnoswap_last_trade",
    };
  }

  const poolSpot = Number(m?.poolSpotGnot) || 0;
  const poolTok = Number(m?.poolBalTokens) || 0;
  const knownSupply =
    Number(opts.totalSupply) ||
    Number(m?.params?.totalSupply) ||
    Number(m?.totalSupply) ||
    0;
  const supply = knownSupply > 0 ? knownSupply : fullMetrics() ? 0 : 1_000_000_000;
  const poolShare = supply > 0 ? poolTok / supply : 0;
  const vwap = Number(opts.vwap) || Number(m?.avgEntryGnot) || 0;
  const lastCurve =
    opts.lastCurvePx != null
      ? Number(opts.lastCurvePx)
      : lastTradePriceGnot(m?.chart, "curve") || lastTradePriceGnot(m?.chart);
  const ref = vwap > 0 ? vwap : lastCurve > 0 ? lastCurve : 0;

  // Live pool spot only when reserves look usable (not a near-empty token side)
  let usePool = m?.gnoswapListed && poolSpot > 0 && poolShare >= 0.005;
  if (usePool && ref > 0) {
    const ratio = poolSpot / ref;
    if (!(ratio >= 0.02 && ratio <= 50)) usePool = false;
  }
  if (usePool) return { spot: poolSpot, source: "gnoswap_pool_spot" };

  if (lastCurve > 0) return { spot: lastCurve, source: "last_trade" };
  if (vwap > 0) return { spot: vwap, source: "vwap_buy" };

  const padMark = Number(m?.priceGnot) || Number(m?.spotGnot) || 0;
  if (padMark > 0) return { spot: padMark, source: "pool_mark" };
  return { spot: 0, source: null };
}

/**
 * Parse GnoswapListed note for LP mint amounts:
 * "listed pool=... pos=606 liq=... a0=205 a1=4210 wugnotUsed=... feeWugnot=0"
 */
function lpEventFromGnoswapNote(m) {
  const note = String(m?.gnoswapNote || "");
  if (!m?.gnoswapListed && !/listed pool=/i.test(note)) return null;
  const a0 = Number(note.match(/a0=(\d+)/)?.[1] || 0);
  const a1 = Number(note.match(/a1=(\d+)/)?.[1] || 0);
  const wUsed = Number(note.match(/wugnotUsed=(\d+)/)?.[1] || 0);
  const pos = note.match(/pos=(\d+)/)?.[1] || "";
  const poolPath = String(m.gnoswapPoolPath || note.match(/pool=([^\s]+)/)?.[1] || "");
  // Which side is WUGNOT in pool path token0:token1:fee
  const parts = poolPath.split(":").filter(Boolean);
  const t0 = parts[0] || "";
  const t1 = parts[1] || "";
  const wugnotKey = "gno.land/r/gnoland/wugnot.wugnot";
  let ugnot = wUsed;
  let tokens = 0;
  if (!ugnot) {
    if (t0.includes("wugnot")) {
      ugnot = a0;
      tokens = a1;
    } else if (t1.includes("wugnot")) {
      ugnot = a1;
      tokens = a0;
    } else {
      // fallback: smaller of a0/a1 if one looks like ugnot-scale
      ugnot = a1 > 0 && a1 < a0 ? a1 : a0;
      tokens = a1 > 0 && a1 < a0 ? a0 : a1;
    }
  } else {
    tokens = t0.includes("wugnot") ? a1 : a0;
  }
  if (ugnot <= 0 && tokens <= 0) {
    // still show a list marker using pool reserve if any
    ugnot = Number(m.poolUgnot) || 0;
    tokens = Number(m.poolToken) || 0;
  }
  const price =
    tokens > 0 && ugnot > 0 ? Math.floor((ugnot * 1_000_000) / tokens) : 0;
  return {
    height: Number(m.created) || 0,
    side: 3,
    sideLabel: "add_lp",
    ugnot,
    tokens,
    price,
    priceGnot: tokens > 0 ? ugnot / tokens / UGNOT_PER_GNOT : 0,
    volumeGnot: ugnot / UGNOT_PER_GNOT,
    source: "gnoswap",
    label: pos ? `List LP #${pos}` : "List LP",
    timeMs: null,
  };
}

const INDEXER_GQL = "https://indexer.gno.land/graphql/query";

async function indexerBuyerPage(pkg, func, afterHeight, timeoutMs) {
  const height =
    Number(afterHeight) > 0
      ? `block_height: { gt: ${Math.floor(Number(afterHeight))} }`
      : "";
  const query = `{
    getTransactions(
      where: {
        success: { eq: true }
        ${height}
        messages: { value: { MsgCall: { pkg_path: { eq: ${JSON.stringify(pkg)} }, func: { eq: ${JSON.stringify(func)} } } } }
      }
      order: { heightAndIndex: ASC }
    ) {
      hash
      index
      block_height
      messages { value { ... on MsgCall { func pkg_path caller args } } }
    }
  }`;
  let signal;
  let timer;
  if (timeoutMs > 0) {
    const ctrl = new AbortController();
    signal = ctrl.signal;
    timer = setTimeout(() => ctrl.abort(), timeoutMs);
  }
  try {
    const res = await fetch(INDEXER_GQL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query }),
      signal,
    });
    if (!res.ok) throw new Error(`indexer HTTP ${res.status}`);
    const body = await res.json();
    if (body.errors?.length) throw new Error(body.errors[0].message || "indexer");
    const txs = body.data?.getTransactions;
    return Array.isArray(txs) ? txs : [];
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Unique Buy and SwapBuy callers for one launch. Read-only indexer query; does not touch the pad. */
export async function indexerPadBuyers(pkg, id) {
  const full = fullMetrics();
  const timeoutMs = full ? 20_000 : 0;
  const cacheKey = `holders:buyers:${pkg}:${id}:${full ? "full" : "once"}`;
  const hit = cacheGet(cacheKey);
  if (hit) return hit;
  const found = new Set();
  const seenTx = new Set();
  let capped = false;
  let pages = 0;
  const pageBudget = full ? HOLDER_INDEXER_MAX_PAGES : 2;
  for (const func of ["Buy", "SwapBuy"]) {
    let cursor = 0;
    while (pages < pageBudget) {
      const txs = await indexerBuyerPage(pkg, func, cursor, timeoutMs);
      pages += 1;
      if (!txs.length) break;
      let maxH = cursor;
      let added = 0;
      for (const tx of txs) {
        const h = Number(tx.block_height) || 0;
        if (h > maxH) maxH = h;
        const key = `${tx.hash || ""}:${tx.index ?? ""}:${h}`;
        if (seenTx.has(key)) continue;
        seenTx.add(key);
        added += 1;
        for (const msg of tx.messages || []) {
          const value = msg.value || {};
          if (value.func !== func || value.pkg_path !== pkg) continue;
          if (!Array.isArray(value.args) || value.args[0] !== id) continue;
          const caller = String(value.caller || "");
          if (/^g1[a-z0-9]{38,}$/i.test(caller)) found.add(caller);
        }
      }
      if (added === 0 || maxH <= cursor) break;
      // Indexer filter is block_height.gt (no gte). Re-read the last height and dedupe.
      cursor = maxH > 0 ? maxH - 1 : maxH;
      if (!full) break;
      if (pages >= pageBudget) capped = true;
    }
  }
  const list = [...found];
  list.capped = capped;
  list.pages = pages;
  cacheSet(cacheKey, list, 5 * 60_000);
  return list;
}

const curveVolumeInflight = new Map();
const padTxInflight = new Map();
const curvePtsCache = new Map();

function rememberCurvePoints(pkg, id, pts) {
  if (!pkg || !id || !Array.isArray(pts)) return;
  curvePtsCache.set(`${pkg}|${id}`, { at: Date.now(), pts });
  if (curvePtsCache.size > 400) {
    const first = curvePtsCache.keys().next().value;
    if (first != null) curvePtsCache.delete(first);
  }
}

function rememberedCurvePoints(pkg, id, maxAgeMs = 90_000) {
  const hit = curvePtsCache.get(`${pkg}|${id}`);
  if (!hit || Date.now() - hit.at > maxAgeMs) return null;
  return hit.pts;
}

function eventAttr(attrs, key) {
  for (const a of attrs || []) {
    if (a && a.key === key) return a.value;
  }
  return undefined;
}

function parseWholeUgnot(v) {
  if (typeof v !== "string" || !/^\d+$/.test(v)) return null;
  const n = Number(v);
  return Number.isSafeInteger(n) ? n : null;
}

/** Buy/sell ugnot stored on the curve ring. Null when a point is not a safe integer. */
function curveRingUgnot(points) {
  let volumeUgnot = 0;
  let trades = 0;
  for (const pt of points || []) {
    if (!isVolumeTradeSide(pt.side)) continue;
    const u = Number(pt.ugnot);
    if (!Number.isSafeInteger(u) || u < 0) return null;
    volumeUgnot += u;
    trades += 1;
    if (!Number.isSafeInteger(volumeUgnot)) return null;
  }
  return { volumeUgnot, trades };
}

/** DEX and client-reported buys/sells. Curve ring and open/add_lp stay out. */
function chartOutsideCurve(chart) {
  return summarizeTradeStats(
    (chart || []).filter((pt) => {
      if (!isVolumeTradeSide(pt.side)) return false;
      const src = pt.source;
      return src && src !== "curve" && src !== "lp";
    }),
  );
}

function markCurveRingLowerBound(stats, curveLen) {
  if (!stats || curveLen < CURVE_RING_LEN) return stats;
  stats.volumeCapped = true;
  stats.volumeNote = "on-chain ring, lower bound";
  return stats;
}

let indexerTipCache = { at: 0, h: 0 };

async function indexerTipHeight() {
  if (indexerTipCache.h > 0 && Date.now() - indexerTipCache.at < 15_000) {
    return indexerTipCache.h;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8_000);
  try {
    const res = await fetch(INDEXER_GQL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "{ latestBlockHeight }" }),
      signal: ctrl.signal,
    });
    if (!res.ok) return 0;
    const body = await res.json();
    const h = Number(body.data?.latestBlockHeight) || 0;
    if (h > 0) indexerTipCache = { at: Date.now(), h };
    return h;
  } catch {
    return 0;
  } finally {
    clearTimeout(timer);
  }
}

async function indexerTradeEventPage(pkg, func, afterHeight, beforeHeight) {
  const bounds = [];
  if (Number(afterHeight) > 0) bounds.push(`gt: ${Math.floor(Number(afterHeight))}`);
  if (Number(beforeHeight) > 0) bounds.push(`lt: ${Math.floor(Number(beforeHeight))}`);
  const height = bounds.length ? `block_height: { ${bounds.join(", ")} }` : "";
  const query = `{
    getTransactions(
      where: {
        success: { eq: true }
        ${height}
        messages: { value: { MsgCall: { pkg_path: { eq: ${JSON.stringify(pkg)} }, func: { eq: ${JSON.stringify(func)} } } } }
      }
      order: { heightAndIndex: ASC }
    ) {
      hash
      index
      block_height
      messages { value { ... on MsgCall { func pkg_path } } }
      response { events { ... on GnoEvent { type pkg_path attrs { key value } } } }
    }
  }`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const res = await fetch(INDEXER_GQL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`indexer HTTP ${res.status}`);
    const body = await res.json();
    if (body.errors?.length) throw new Error(body.errors[0].message || "indexer");
    const txs = body.data?.getTransactions;
    return Array.isArray(txs) ? txs : [];
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** One finished walk of a pad MsgCall, shared by volume and the holder ledger. */
async function cachedIndexerFuncTxs(pkg, func) {
  const cacheKey = `pad-txs:${pkg}:${func}`;
  const hit = cacheGet(cacheKey);
  if (hit) return hit;
  const inflightKey = `${pkg}|${func}`;
  const inflight = padTxInflight.get(inflightKey);
  if (inflight) return inflight;
  const job = (async () => {
    const rows = [];
    const seen = new Set();
    // Netlify stays on the short walk. A full-metrics host needs every height,
    // and an unbounded event query does not return before the abort.
    if (!fullMetrics()) {
      let cursor = 0;
      let pages = 0;
      let done = false;
      const volumeFunc =
        func === "Buy" || func === "Sell" || func === "SwapBuy" || func === "SwapSell";
      const budget = volumeFunc ? INDEXER_CURVE_VOLUME_MAX_PAGES : 2;
      while (pages < budget) {
        const txs = await indexerTradeEventPage(pkg, func, cursor, 0);
        pages += 1;
        if (!txs.length) {
          done = true;
          break;
        }
        let maxH = cursor;
        let added = 0;
        for (const tx of txs) {
          const h = Number(tx.block_height) || 0;
          if (h > maxH) maxH = h;
          const txKey = `${func}:${tx.hash || ""}:${tx.index ?? ""}:${h}`;
          if (seen.has(txKey)) continue;
          seen.add(txKey);
          added += 1;
          rows.push(tx);
        }
        if (added === 0 || maxH <= cursor) {
          done = true;
          break;
        }
        cursor = maxH > 0 ? maxH - 1 : maxH;
      }
      return { ok: done, pages, rows };
    }
    const tip = await indexerTipHeight();
    if (!(tip > 0)) return { ok: false, pages: 0, rows };
    const windows = Math.ceil((tip + 1) / INDEXER_WALK_SPAN);
    const budget = Math.min(INDEXER_WALK_PAGE_CAP, windows + INDEXER_CURVE_VOLUME_MAX_PAGES);
    let pages = 0;
    let start = 0;
    while (start <= tip) {
      if (pages >= budget) return { ok: false, pages, rows };
      const end = Math.min(tip + 1, start + INDEXER_WALK_SPAN);
      let cursor = start > 0 ? start - 1 : 0;
      let guard = 0;
      while (guard < 6) {
        if (pages >= budget) return { ok: false, pages, rows };
        const txs = await indexerTradeEventPage(pkg, func, cursor, end);
        pages += 1;
        guard += 1;
        if (!txs.length) break;
        let maxH = cursor;
        let added = 0;
        for (const tx of txs) {
          const h = Number(tx.block_height) || 0;
          if (h > maxH) maxH = h;
          const txKey = `${func}:${tx.hash || ""}:${tx.index ?? ""}:${h}`;
          if (seen.has(txKey)) continue;
          seen.add(txKey);
          added += 1;
          rows.push(tx);
        }
        // The indexer caps a response. A short page is the whole window.
        if (txs.length < 9000) break;
        if (added === 0 || maxH <= cursor || maxH >= end) return { ok: false, pages, rows };
        cursor = maxH > 0 ? maxH - 1 : maxH;
      }
      start = end;
    }
    return { ok: true, pages, rows };
  })();
  padTxInflight.set(inflightKey, job);
  try {
    const result = await job;
    cacheSet(cacheKey, result, result.ok ? 180_000 : 15_000);
    return result;
  } finally {
    padTxInflight.delete(inflightKey);
  }
}

/**
 * Lifetime pad curve volume from Buy, Sell, SwapBuy, SwapSell events.
 * ugnot on those events is the same integer recordTrade stores.
 * Swap* is the pad CPMM and is not a Gnoswap fill, so it is not in dexTradeStats.
 * Returns ok:false when a call has no ugnot/id or the page walk does not finish.
 */
async function scanIndexerCurveVolume(pkg) {
  const byId = Object.create(null);
  const buySide = new Set(["Buy", "SwapBuy"]);
  for (const func of ["Buy", "Sell", "SwapBuy", "SwapSell"]) {
    const pack = await cachedIndexerFuncTxs(pkg, func);
    if (!pack.ok) return { ok: false, byId: {} };
    for (const tx of pack.rows) {
      let calls = 0;
      for (const msg of tx.messages || []) {
        const v = msg?.value || {};
        if (v.func === func && v.pkg_path === pkg) calls += 1;
      }
      let matched = 0;
      for (const ev of tx.response?.events || []) {
        if (!ev || ev.type !== func || ev.pkg_path !== pkg) continue;
        matched += 1;
        const id = eventAttr(ev.attrs, "id");
        const ugnot = parseWholeUgnot(eventAttr(ev.attrs, "ugnot"));
        if (!id || ugnot == null) return { ok: false, byId: {} };
        let row = byId[id];
        if (!row) {
          row = {
            volumeUgnot: 0,
            buyUgnot: 0,
            sellUgnot: 0,
            buyCount: 0,
            sellCount: 0,
            trades: 0,
          };
          byId[id] = row;
        }
        row.volumeUgnot += ugnot;
        row.trades += 1;
        if (buySide.has(func)) {
          row.buyUgnot += ugnot;
          row.buyCount += 1;
        } else {
          row.sellUgnot += ugnot;
          row.sellCount += 1;
        }
        if (!Number.isSafeInteger(row.volumeUgnot)) return { ok: false, byId: {} };
      }
      if (calls !== matched) return { ok: false, byId: {} };
    }
  }
  return { ok: true, byId };
}

/** Buy/sell points for one launch from the same indexer walk as curve volume. */
async function curveTradePointsFromIndexer(pkg, id) {
  const pts = [];
  let ugnotSum = 0;
  const buySide = new Set(["Buy", "SwapBuy"]);
  for (const func of ["Buy", "Sell", "SwapBuy", "SwapSell"]) {
    const pack = await cachedIndexerFuncTxs(pkg, func);
    if (!pack?.ok) return null;
    for (const tx of pack.rows) {
      const height = Number(tx.block_height) || 0;
      const hash = String(tx.hash || "");
      for (const ev of tx.response?.events || []) {
        if (!ev || ev.type !== func || ev.pkg_path !== pkg) continue;
        if (eventAttr(ev.attrs, "id") !== id) continue;
        const ugnot = parseWholeUgnot(eventAttr(ev.attrs, "ugnot"));
        const tokens = parseWholeUgnot(eventAttr(ev.attrs, "tokens"));
        if (ugnot == null || tokens == null) return null;
        const side = buySide.has(func) ? 0 : 1;
        ugnotSum += ugnot;
        if (!Number.isSafeInteger(ugnotSum)) return null;
        const priceGnot = tokens > 0 ? ugnot / UGNOT_PER_GNOT / tokens : 0;
        pts.push({
          height,
          hash,
          side,
          sideLabel: side === 0 ? "buy" : "sell",
          ugnot,
          tokens,
          price: tokens > 0 ? (ugnot / tokens) * 1_000_000 : 0,
          priceGnot,
          volumeGnot: ugnot / UGNOT_PER_GNOT,
          source: "curve",
          trader: String(eventAttr(ev.attrs, side === 0 ? "buyer" : "seller") || ""),
        });
      }
    }
  }
  pts.sort((a, b) => (a.height || 0) - (b.height || 0) || a.side - b.side);
  return { pts, ugnotSum };
}

function dexLegOfChart(chart) {
  let n = 0;
  let ug = 0;
  for (const p of chart || []) {
    if (p.source !== "gnoswap" && p.source !== "reported") continue;
    if (!isVolumeTradeSide(p.side)) continue;
    n += 1;
    ug += Number(p.ugnot) || 0;
  }
  return { n, ug };
}

const STAT_WINDOW_MS = [
  ["5m", 5 * 60 * 1000],
  ["1h", 60 * 60 * 1000],
  ["6h", 6 * 60 * 60 * 1000],
  ["24h", 24 * 60 * 60 * 1000],
];

/** GNOT/token from a curve point. Ring rows store pad Price, not priceGnot. */
function volumePointPriceGnot(p) {
  const direct = Number(p?.priceGnot);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const scaled = Number(p?.price);
  if (Number.isFinite(scaled) && scaled > 0) return scaled / 1_000_000 / UGNOT_PER_GNOT;
  const ug = Number(p?.ugnot);
  const tok = Number(p?.tokens);
  if (ug > 0 && tok > 0) return ug / UGNOT_PER_GNOT / tok;
  return 0;
}

/**
 * Buy/sell windows from one complete series.
 * Returns null when any volume point lacks a timestamp or a safe ugnot integer.
 */
function buildStatWindows(chart, spotGnot, nowMs) {
  const now = Number(nowMs) > 0 ? Number(nowMs) : Date.now();
  const pts = [];
  for (const p of chart || []) {
    if (!isVolumeTradeSide(p.side)) continue;
    const ug = Number(p.ugnot);
    const tMs = Number(p.timeMs) || 0;
    if (!Number.isSafeInteger(ug) || ug < 0 || !(tMs > 0)) return null;
    pts.push({
      tMs,
      side: Number(p.side),
      ug,
      price: volumePointPriceGnot(p),
    });
  }
  pts.sort((a, b) => a.tMs - b.tMs || a.side - b.side);
  const lastPx = pts.length ? pts[pts.length - 1].price : 0;
  const spot = Number(spotGnot) > 0 ? Number(spotGnot) : lastPx;
  const firstPx = pts.find((p) => p.price > 0)?.price || 0;
  const windows = {};
  for (const [key, span] of STAT_WINDOW_MS) {
    const cutoff = now - span;
    let base = 0;
    let buyUg = 0;
    let sellUg = 0;
    let buys = 0;
    let sells = 0;
    for (const p of pts) {
      if (p.tMs <= cutoff) {
        if (p.price > 0) base = p.price;
        continue;
      }
      if (p.side === 0) {
        buys += 1;
        buyUg += p.ug;
      } else if (p.side === 1) {
        sells += 1;
        sellUg += p.ug;
      }
      if (!Number.isSafeInteger(buyUg) || !Number.isSafeInteger(sellUg)) return null;
    }
    if (!(base > 0)) base = firstPx;
    const volUg = buyUg + sellUg;
    if (!Number.isSafeInteger(volUg)) return null;
    windows[key] = {
      buys,
      sells,
      trades: buys + sells,
      volumeGnot: volUg / UGNOT_PER_GNOT,
      buyVolumeGnot: buyUg / UGNOT_PER_GNOT,
      sellVolumeGnot: sellUg / UGNOT_PER_GNOT,
      netGnot: (buyUg - sellUg) / UGNOT_PER_GNOT,
      pricePct: base > 0 && spot > 0 ? ((spot - base) / base) * 100 : null,
    };
  }
  return {
    asOfMs: now,
    incomplete: false,
    spotGnot: spot > 0 ? spot : null,
    windows,
  };
}

const HOLDER_G1 = /^g1[a-z0-9]{38,}$/i;
const ledgerInflight = new Map();

function ledgerBook(byId, id) {
  let book = byId[id];
  if (!book) {
    book = new Map();
    byId[id] = book;
  }
  return book;
}

function ledgerAdd(book, addr, delta) {
  if (!HOLDER_G1.test(String(addr || ""))) return false;
  const next = (book.get(addr) || 0) + delta;
  if (!Number.isSafeInteger(next)) return false;
  book.set(addr, next);
  return true;
}

/**
 * Replay mint, burn, and transfer events into per-launch balances.
 * A launch is usable only when the caller checks the positive sum against RealSold.
 */
async function replayPadBalances(pkg) {
  const cacheKey = `pad-ledger:${pkg}`;
  const hit = cacheGet(cacheKey);
  if (hit) return hit;
  const inflight = ledgerInflight.get(pkg);
  if (inflight) return inflight;
  const job = (async () => {
    const byId = Object.create(null);
    const funcs = ["Buy", "Sell", "SwapBuy", "SwapSell", "Transfer", "TransferFrom", "ReleaseListSeed"];
    // Parallel pages. ok:false if any walk stops early, so a short budget cannot publish a partial book.
    const packs = await Promise.all(funcs.map((func) => cachedIndexerFuncTxs(pkg, func)));
    for (let fi = 0; fi < funcs.length; fi++) {
      const func = funcs[fi];
      const pack = packs[fi];
      if (!pack.ok) return { ok: false, byId };
      for (const tx of pack.rows) {
        let calls = 0;
        for (const msg of tx.messages || []) {
          const v = msg?.value || {};
          if (v.func === func && v.pkg_path === pkg) calls += 1;
        }
        let matched = 0;
        for (const ev of tx.response?.events || []) {
          if (!ev || ev.type !== func || ev.pkg_path !== pkg) continue;
          matched += 1;
          const id = eventAttr(ev.attrs, "id");
          if (!id) return { ok: false, byId };
          const book = ledgerBook(byId, id);
          let applied = false;
          if (func === "Buy" || func === "SwapBuy") {
            const tokens = parseWholeUgnot(eventAttr(ev.attrs, "tokens"));
            applied = tokens != null && ledgerAdd(book, eventAttr(ev.attrs, "buyer"), tokens);
          } else if (func === "Sell" || func === "SwapSell") {
            const tokens = parseWholeUgnot(eventAttr(ev.attrs, "tokens"));
            applied = tokens != null && ledgerAdd(book, eventAttr(ev.attrs, "seller"), -tokens);
          } else if (func === "Transfer" || func === "TransferFrom") {
            const amount = parseWholeUgnot(eventAttr(ev.attrs, "amount"));
            applied =
              amount != null &&
              ledgerAdd(book, eventAttr(ev.attrs, "from"), -amount) &&
              ledgerAdd(book, eventAttr(ev.attrs, "to"), amount);
          } else if (func === "ReleaseListSeed") {
            const tokens = parseWholeUgnot(eventAttr(ev.attrs, "tokens"));
            applied = tokens != null && ledgerAdd(book, eventAttr(ev.attrs, "to"), tokens);
          }
          if (!applied) return { ok: false, byId };
        }
        if (calls !== matched) return { ok: false, byId };
      }
    }
    return { ok: true, byId };
  })();
  ledgerInflight.set(pkg, job);
  try {
    const result = await job;
    cacheSet(cacheKey, result, result.ok ? 45_000 : 10_000);
    return result;
  } catch {
    return { ok: false, byId: {} };
  } finally {
    ledgerInflight.delete(pkg);
  }
}

/** Positive balances from the replay. Null when the sum is not RealSold. */
async function holdersFromLedger(RPC, PKG, id) {
  const ledger = await replayPadBalances(PKG);
  if (!ledger?.ok) return null;
  let info = "";
  try {
    info = String(
      await qeval(RPC, PKG, `${PKG}.LaunchInfo(${JSON.stringify(id)})`, 20_000),
    );
  } catch {
    return null;
  }
  const parts = info.split("|");
  if (parts[0] !== id) return null;
  const sold = Number(parts[5]);
  const buyers = Number(parts[6]);
  if (!Number.isSafeInteger(sold) || sold < 0) return null;
  const book = ledger.byId[id] || new Map();
  let sum = 0;
  const holders = [];
  for (const [addr, bal] of book) {
    if (!Number.isSafeInteger(bal) || bal < 0) return null;
    if (bal === 0) continue;
    sum += bal;
    if (!Number.isSafeInteger(sum)) return null;
    holders.push({ address: addr, balance: bal });
  }
  if (sum !== sold) return null;
  holders.sort((a, b) => b.balance - a.balance);
  const full = fullMetrics();
  return {
    id,
    pkg: PKG,
    holders,
    holdersActive: holders.length,
    holdersCapped: false,
    holdersSource: "indexer ledger",
    ...(full
      ? { fullMetrics: true, holdersNote: null, transferHoldersOmitted: false }
      : {}),
    holdersStats: {
      active: holders.length,
      buyersEver: Number.isFinite(buyers) ? buyers : null,
      capped: false,
      source: "indexer ledger",
    },
  };
}

/** Stamp holdersActive on market rows when the replay sum equals RealSold. */
async function attachLedgerHolderCounts(pkg, markets) {
  const ledger = await replayPadBalances(pkg);
  if (!ledger?.ok) return;
  for (const m of markets || []) {
    if (!m || m.pkg !== pkg || m.error) continue;
    const sold = Number(m.sold);
    if (!Number.isSafeInteger(sold) || sold < 0) continue;
    const book = ledger.byId[m.id] || new Map();
    let sum = 0;
    let active = 0;
    let bad = false;
    for (const bal of book.values()) {
      if (!Number.isSafeInteger(bal) || bal < 0) {
        bad = true;
        break;
      }
      if (bal > 0) {
        active += 1;
        sum += bal;
        if (!Number.isSafeInteger(sum)) {
          bad = true;
          break;
        }
      }
    }
    if (bad || sum !== sold) continue;
    m.holdersActive = active;
    m.holdersCapped = false;
    m.holdersSource = "indexer ledger";
  }
}

/** 5m–24h windows on list rows when the series is the full trade set. */
async function attachListStatWindows(RPC, markets) {
  const jobs = [];
  for (const m of markets || []) {
    if (!m || m.error || !m.tradeStats || m.tradeStats.volumeCapped === true) continue;
    if (m.tradeStats.volumeSource === "indexer") {
      const life = await curveTradePointsFromIndexer(m.pkg, m.id);
      const expect = Number(m.tradeStats.trades);
      const curveUg = Math.round(Number(m.tradeStats.volumeGnot) * UGNOT_PER_GNOT);
      if (!life || life.pts.length !== expect || Math.abs(life.ugnotSum - curveUg) > 1) continue;
      jobs.push({ m, pts: life.pts });
    } else {
      const pts = rememberedCurvePoints(m.pkg, m.id);
      if (!pts?.length) continue;
      const ringSides = pts.filter((p) => isVolumeTradeSide(p.side)).length;
      if (ringSides !== Number(m.tradeStats.trades)) continue;
      jobs.push({ m, pts });
    }
  }
  if (!jobs.length) return;
  try {
    await stampTradeTimes(RPC, jobs.flatMap((job) => job.pts));
  } catch {
    return;
  }
  for (const { m, pts } of jobs) {
    const priced = pts.map((p) => ({ ...p, priceGnot: volumePointPriceGnot(p) }));
    // Keep the card mark on priceGnot. The window spot is the last trade, same as the token page.
    const spot = Number(m.spotGnot) > 0 ? Number(m.spotGnot) : lastTradePriceGnot(priced) || 0;
    const stat = buildStatWindows(priced, spot);
    if (!stat) continue;
    m.statWindows = stat;
    const pct = stat.windows["24h"]?.pricePct;
    if (pct != null && Number.isFinite(pct)) m.p24h = pct;
  }
}

async function indexerPadCurveVolume(pkg) {
  const cacheKey = `curve-vol:${pkg}`;
  const hit = cacheGet(cacheKey);
  if (hit) return hit;
  const inflight = curveVolumeInflight.get(pkg);
  if (inflight) return inflight;
  const job = (async () => {
    try {
      return await scanIndexerCurveVolume(pkg);
    } catch {
      return { ok: false, byId: {} };
    }
  })();
  curveVolumeInflight.set(pkg, job);
  try {
    const result = await job;
    cacheSet(cacheKey, result, result.ok ? 180_000 : 15_000);
    return result;
  } finally {
    curveVolumeInflight.delete(pkg);
  }
}

/**
 * Replace the curve leg when indexer events cover every ugnot still in the ring.
 * A short or ambiguous scan leaves the ring total and volumeCapped.
 * extraStats is the already-loaded DEX/reported leg (detail chart only).
 */
async function maybeUpgradeCurveVolume(pkg, id, stats, curvePoints, extraStats) {
  // A full TradeHistory ring is 128 points and has already dropped older fills.
  // Replace it only when the indexer walk finishes and covers every ugnot still in the ring.
  if (!stats || stats.volumeCapped !== true || !pkg || !id) return;
  try {
    const table = await indexerPadCurveVolume(pkg);
    if (!table || table.ok !== true) return;
    const life = table.byId[id] || {
      volumeUgnot: 0,
      buyUgnot: 0,
      sellUgnot: 0,
      buyCount: 0,
      sellCount: 0,
      trades: 0,
    };
    const ring = curveRingUgnot(curvePoints);
    if (!ring) return;
    if (life.volumeUgnot < ring.volumeUgnot || life.trades < ring.trades) return;
    const extra = extraStats || {};
    stats.volumeGnot = life.volumeUgnot / UGNOT_PER_GNOT + (Number(extra.volumeGnot) || 0);
    stats.buyVolumeGnot = life.buyUgnot / UGNOT_PER_GNOT + (Number(extra.buyVolumeGnot) || 0);
    stats.sellVolumeGnot = life.sellUgnot / UGNOT_PER_GNOT + (Number(extra.sellVolumeGnot) || 0);
    stats.trades = life.trades + (Number(extra.trades) || 0);
    stats.buyCount = life.buyCount + (Number(extra.buyCount) || 0);
    stats.sellCount = life.sellCount + (Number(extra.sellCount) || 0);
    stats.volumeSource = "indexer";
    stats.volumeCapped = false;
    delete stats.volumeNote;
  } catch {
    // Keep the ring total and volumeCapped.
  }
}

/** Transfer, TransferFrom, and ReleaseListSeed parties for one launch. */
async function indexerTransferParties(pkg, id) {
  const found = [];
  const seen = new Set();
  let capped = false;
  for (const func of ["Transfer", "TransferFrom", "ReleaseListSeed"]) {
    const pack = await cachedIndexerFuncTxs(pkg, func);
    if (!pack?.ok) {
      capped = true;
      continue;
    }
    for (const tx of pack.rows) {
      for (const ev of tx.response?.events || []) {
        if (!ev || ev.type !== func || ev.pkg_path !== pkg) continue;
        if (eventAttr(ev.attrs, "id") !== id) continue;
        const keys = func === "ReleaseListSeed" ? ["to"] : ["from", "to"];
        for (const key of keys) {
          const addr = String(eventAttr(ev.attrs, key) || "");
          if (!HOLDER_G1.test(addr) || seen.has(addr)) continue;
          seen.add(addr);
          found.push(addr);
        }
      }
    }
  }
  return { addrs: found, capped };
}

/**
 * ListBuyers is capped at 100. Full metrics pages Buy/SwapBuy callers (max 20)
 * and unions Transfer recipients. holdersCapped stays set when a walk does not finish.
 */
async function resolveHolderAddrs(RPC, pkg, id, opts = {}) {
  const full = fullMetrics();
  const buyersRaw = await qeval(
    RPC,
    pkg,
    `${pkg}.ListBuyers(${JSON.stringify(id)})`,
    full ? 20_000 : 0,
  );
  const addrs = String(buyersRaw || "")
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => /^g1[a-z0-9]{38,}$/i.test(s))
    .slice(0, 100);
  let holdersSource = "ListBuyers";
  let holdersCapped = addrs.length >= 100;
  let indexerError = null;
  let pages = 0;
  if (full || holdersCapped) {
    try {
      let extra;
      if (!full && opts.raceMs > 0) {
        extra = await Promise.race([
          indexerPadBuyers(pkg, id),
          new Promise((resolve) => setTimeout(() => resolve(null), opts.raceMs)),
        ]);
      } else {
        extra = await indexerPadBuyers(pkg, id);
      }
      if (extra) {
        const seen = new Set(addrs);
        for (const addr of extra) {
          if (!seen.has(addr)) {
            seen.add(addr);
            addrs.push(addr);
          }
        }
        pages = Number(extra.pages) || 0;
        holdersSource = "ListBuyers+indexer";
        holdersCapped = full ? extra.capped === true : false;
      }
    } catch (e) {
      indexerError = String(e.message || e).slice(0, 180);
    }
  }
  if (full) {
    try {
      const xfer = await indexerTransferParties(pkg, id);
      const seen = new Set(addrs);
      for (const addr of xfer.addrs) {
        if (seen.has(addr)) continue;
        seen.add(addr);
        addrs.push(addr);
      }
      if (xfer.capped) holdersCapped = true;
      else if (xfer.addrs.length) holdersSource = `${holdersSource}+transfer`;
    } catch (e) {
      holdersCapped = true;
      if (!indexerError) indexerError = String(e.message || e).slice(0, 180);
    }
  }
  return { addrs, holdersSource, holdersCapped, indexerError, pages };
}

async function getMarket(RPC, PKG, id, meta = {}) {
  const callMs = fullMetrics() ? 20_000 : 0;
  // Holder replay shares the volume page cache. Start it while the detail qevals run.
  if (fullMetrics() && meta.holders !== true) {
    replayPadBalances(PKG).catch(() => {});
  }
  const [params, info, padAddrRaw, prefRaw, releasedRaw, histPack] = await Promise.all([
    getParams(RPC, PKG),
    qeval(RPC, PKG, `${PKG}.LaunchInfo("${id}")`, callMs),
    qeval(RPC, PKG, `${PKG}.PadAddress()`)
      .then((v) => String(v || "").replace(/^"|"$/g, ""))
      .catch(() => ""),
    qeval(RPC, PKG, `${PKG}.PreferredVenueOf(${JSON.stringify(id)})`)
      .then((v) => String(v || "").replace(/^"|"$/g, "").trim().toLowerCase())
      .catch(() => ""),
    qeval(RPC, PKG, `${PKG}.ListSeedReleasedOf(${JSON.stringify(id)})`)
      .then((v) => String(v || "").replace(/^"|"$/g, "").trim().toLowerCase())
      .catch(() => null),
    qeval(RPC, PKG, `${PKG}.TradeHistory(${JSON.stringify(id)})`, callMs)
      .then((hist) => ({ ok: true, hist }))
      .catch((error) => ({ ok: false, error })),
  ]);
  const supplyArg = params ? params.totalSupply : null;
  const gradArg = params ? params.graduation : 0;
  const m = parseLaunchInfo(String(info), supplyArg, gradArg);
  if (!m) throw new Error("bad LaunchInfo");
  if (m.status !== 1) {
    m.progressPct = progressPctFromRaise(
      m.status,
      m.raised,
      params ? params.graduation : 0,
    );
  }
  enrichPricing(m, supplyArg);
  if (params) {
    const rem = remainingRaiseUgnot(m, params.graduation);
    m.remainingRaiseUgnot = rem;
    m.remainingRaiseGnot = rem / UGNOT_PER_GNOT;
  } else {
    m.remainingRaiseUgnot = null;
    m.remainingRaiseGnot = null;
    m.warning = "ParamsInfo failed; graduation, fee bps, and supply were not substituted";
  }
  m.params = params || null;
  if (fullMetrics()) m.fullMetrics = true;
  m.pkg = PKG;
  m.sourceKey = meta.sourceKey || "";
  m.active = meta.active !== false && !meta.legacy;
  m.legacy = !!meta.legacy;
  m.padLabel = String(PKG).split("/").pop() || "pad";
  // padv14+: WUGNOT curve collateral (auto-list at graduate)
  m.collateral = /padv1[4-9]\b|padv[2-9]\d\b/i.test(String(PKG)) ? "wugnot" : "ugnot";
  if (/^g1[a-z0-9]+$/i.test(padAddrRaw)) m.padAddr = padAddrRaw;
  if (prefRaw) m.preferredVenue = prefRaw;
  m.listSeedReleased =
    releasedRaw === "true" || releasedRaw === "1" || releasedRaw === "True";
  let curveHistoryOk = true;
  let curveHistoryPts = [];
  if (histPack.ok) {
    curveHistoryPts = parseTradeHistory(histPack.hist).map((pt) => ({
      ...pt,
      // pad Price = ugnot_per_token * 1e6 → GNOT/token = price / 1e6 / 1e6
      priceGnot: Number(pt.price) / 1_000_000 / UGNOT_PER_GNOT,
      volumeGnot: (Number(pt.ugnot) || 0) / UGNOT_PER_GNOT,
    }));
    m.chart = curveHistoryPts;
  } else {
    curveHistoryOk = false;
    m.chart = [];
    if (fullMetrics()) {
      m.tradeStatsError = String(histPack.error?.message || histPack.error || "").slice(0, 180);
    }
  }
  // Inject Gnoswap list / Add-LP event when listed
  try {
    const lpEv = lpEventFromGnoswapNote(m);
    if (lpEv) {
      const exists = (m.chart || []).some(
        (pt) => Number(pt.side) === 3 && pt.source === "gnoswap",
      );
      if (!exists) {
        // Prefer height near last chart entry
        const lastH = (m.chart || []).reduce((mx, p) => Math.max(mx, Number(p.height) || 0), 0);
        if (!lpEv.height) lpEv.height = lastH || m.created || 0;
        m.chart = [...(m.chart || []), lpEv];
      }
    }
  } catch {
    /* non-fatal */
  }
  if (!m.chart.length && m.priceGnot > 0) {
    m.chart = [
      {
        height: m.created || 0,
        side: 2,
        sideLabel: "open",
        ugnot: 0,
        tokens: 0,
        price: m.spotScaled,
        priceGnot: m.priceGnot,
        volumeGnot: 0,
        source: "curve",
      },
    ];
  }
  // Stamp approximate wall-clock time from block height (trade ring only stores height)
  try {
    await stampTradeTimes(RPC, m.chart);
  } catch {
    /* non-fatal */
  }

  // After Gnoswap list: pad TradeHistory stops; keep chart alive via indexer
  // swaps + client-reported ExactIn fills (indexer often empty for Sapphire memes).
  const tokenKey = marketTokenKey(m);
  if (m.gnoswapListed) {
    try {
      if (tokenKey) {
        const dexPts = await fetchGnoswapSwapHistory(tokenKey, 80);
        if (dexPts.length) m.chart = mergeChartPoints(m.chart, dexPts);
      }
    } catch {
      /* non-fatal — UI still has curve history + local/reported trades */
    }
  }
  try {
    const reported = await getReportedTrades(tokenKey, m.gnoswapPoolPath);
    if (reported.length) m.chart = mergeChartPoints(m.chart, reported);
  } catch {
    /* non-fatal */
  }

  m.tradeStats = summarizeTradeStats(m.chart || []);
  if (curveHistoryOk) {
    markCurveRingLowerBound(m.tradeStats, curveHistoryPts.length);
    // Chart volume already includes loaded DEX/reported buys and sells.
    // Indexer replaces the curve leg only; those points stay added once.
    await maybeUpgradeCurveVolume(
      PKG,
      id,
      m.tradeStats,
      curveHistoryPts,
      chartOutsideCurve(m.chart),
    );
    if (m.tradeStats?.volumeSource === "indexer" && m.tradeStats.volumeCapped !== true) {
      const life = await curveTradePointsFromIndexer(PKG, id);
      const dex = dexLegOfChart(m.chart);
      const expectN = Number(m.tradeStats.trades) - dex.n;
      const curveUg = Math.round(Number(m.tradeStats.volumeGnot) * UGNOT_PER_GNOT - dex.ug);
      if (
        life &&
        life.pts.length === expectN &&
        life.pts.length > (curveHistoryPts || []).filter((p) => isVolumeTradeSide(p.side)).length &&
        Math.abs(life.ugnotSum - curveUg) <= 1
      ) {
        const keep = (m.chart || []).filter(
          (p) =>
            !isVolumeTradeSide(p.side) || p.source === "gnoswap" || p.source === "reported",
        );
        m.chart = [...keep, ...life.pts].sort(
          (a, b) => (Number(a.height) || 0) - (Number(b.height) || 0) || Number(a.side) - Number(b.side),
        );
        m.tradesComplete = true;
        try {
          await stampTradeTimes(RPC, life.pts);
        } catch {
          /* height stamps are optional */
        }
      }
    }
  }
  // Detail chart already merges loaded DEX swaps into tradeStats. Do not add them twice.
  if (curveHistoryOk && Number.isFinite(Number(m.tradeStats?.volumeGnot))) {
    m.volumeGnot = Number(m.tradeStats.volumeGnot);
  }
  // Real DEX swaps only (exclude injected list/LP rows that also use source=gnoswap)
  const dexSwapPts = (m.chart || []).filter(
    (p) =>
      (p.source === "gnoswap" || p.source === "reported") &&
      (Number(p.side) === 0 || Number(p.side) === 1),
  );
  const curvePts = (m.chart || []).filter(
    (p) => p.source === "curve" || p.source === "lp" || !p.source,
  );
  const restDexPts = (m.chart || []).filter(
    (p) => p.source === "gnoswap" && (Number(p.side) === 0 || Number(p.side) === 1),
  );
  const reportedPts = (m.chart || []).filter(
    (p) => p.source === "reported" && (Number(p.side) === 0 || Number(p.side) === 1),
  );
  m.chartSources = {
    curve: curvePts.length,
    gnoswap: restDexPts.length,
    reported: reportedPts.length,
  };
  m.dexHistoryEmpty = m.gnoswapListed ? restDexPts.length === 0 : null;
  m.volumeScope = !m.gnoswapListed
    ? "curve"
    : dexSwapPts.length > 0
      ? "curve_and_dex"
      : "curve_only";
  if (m.volumeScope === "curve_only" && m.gnoswapListed) {
    m.volumeNote =
      "Curve history only — Gnoswap public indexer has no swap history for this meme pool yet. Swaps done on gnomi.fun are recorded when reported.";
    m.volumeNoteVi =
      "Chỉ lịch sử curve — indexer Gnoswap chưa có swap history cho pool meme này. Swap trên gnomi.fun được ghi khi client report.";
  } else {
    m.volumeNote = m.volumeNote || null;
    m.volumeNoteVi = m.volumeNoteVi || null;
  }

  // Listed: live pool balances first (needed for pool-implied valuation spot)
  if (m.gnoswapListed) {
    try {
      await enrichLiveGnoswapLiquidity(RPC, m);
    } catch {
      /* keep seed/list-note fallback */
    }
  }

  // Entry: market VWAP of curve buys (shared basis for holders table / leaderboard)
  const lastDexPx =
    lastTradePriceGnot(m.chart, "gnoswap") ||
    lastTradePriceGnot(m.chart, "reported");
  const lastAnyPx = lastTradePriceGnot(m.chart);
  const lastCurvePx = lastTradePriceGnot(m.chart, "curve") || lastAnyPx;
  const supply = params ? Number(params.totalSupply) || 1_000_000_000 : null;
  const vwapBuy = marketVwapBuyGnot(m.chart);
  const openPriceGnot =
    vwapBuy ??
    (m.chart || []).find((pt) => Number(pt.side) === 0 && Number(pt.priceGnot) > 0)?.priceGnot ??
    lastCurvePx ??
    null;
  m.openPriceGnot = openPriceGnot;
  m.avgEntryGnot = vwapBuy;
  m.pnlBasis = vwapBuy != null ? "vwap_buy" : openPriceGnot != null ? "first_buy" : null;

  // Valuation spot for Price / MCap / PnL (never prefer pad dump mark when live pool exists)
  const valued = resolveValuationSpotGnot(m, {
    lastDexPx,
    lastCurvePx,
    vwap: vwapBuy,
    totalSupply: supply,
  });
  const poolPx = Number(m.priceGnot) || 0;
  applySpotPrice(
    m,
    valued.spot > 0 ? valued.spot : poolPx,
    supply,
    valued.source || (m.status === 1 ? "pool_mark" : "curve"),
  );

  // Chart mark: only align candles to spot when source is a live trade/pool read.
  // pool_mark after list (thin LP / empty DEX) must NOT invent a cliff candle.
  const src = String(m.priceSource || "");
  const reliableMark =
    src === "gnoswap_last_trade" ||
    src === "gnoswap_pool_spot" ||
    src === "last_trade" ||
    (src === "curve" && !m.gnoswapListed);
  m.markReliable = !!reliableMark;
  if (m.gnoswapListed && m.dexHistoryEmpty && !reportedPts.length && src === "pool_mark") {
    m.markReliable = false;
  }

  if (m.tradeStats && m.tradeStats.volumeCapped !== true) {
    const volSides = (m.chart || []).filter((p) => isVolumeTradeSide(p.side)).length;
    if (volSides === Number(m.tradeStats.trades)) {
      const stat = buildStatWindows(m.chart, m.spotGnot ?? m.priceGnot);
      if (stat) {
        m.statWindows = stat;
        const pct = stat.windows["24h"]?.pricePct;
        if (pct != null && Number.isFinite(pct)) m.p24h = pct;
      }
    }
  }

  m.topTrades = (m.chart || [])
    .filter((pt) => Number(pt.side) !== 2)
    .map((pt) => ({
      height: pt.height,
      side: pt.side,
      sideLabel: pt.sideLabel,
      volumeGnot: pt.volumeGnot || 0,
      tokens: pt.tokens || 0,
      priceGnot: pt.priceGnot || 0,
    }))
    .sort((a, b) => (b.volumeGnot || 0) - (a.volumeGnot || 0))
    .slice(0, 8);

  // Holders are a separate request. Doing them here blows the Netlify time limit.
  m.holders = [];
  m.holdersNote = null;
  if (meta.holders !== true) {
    m.holdersSource = null;
    m.holdersStats = null;
    return m;
  }
  if (fullMetrics()) {
    try {
      const replayed = await holdersFromLedger(RPC, PKG, id);
      if (replayed) {
        m.holders = replayed.holders;
        m.holdersActive = replayed.holdersActive;
        m.holdersCapped = false;
        m.holdersSource = replayed.holdersSource;
        m.holdersLabel = "Holders";
        m.holdersNote = null;
        m.transferHoldersOmitted = false;
        m.holdersStats = replayed.holdersStats;
        return m;
      }
    } catch {
      /* BalanceOf fallback */
    }
  }
  try {
    const resolved = await resolveHolderAddrs(RPC, PKG, id);
    const { addrs, holdersSource, holdersCapped, indexerError, pages } = resolved;
    const holders = [];
    const holderErrors = [];
    const heldSupply = params ? Number(params.totalSupply) || 1e9 : null;
    const px = Number(m.spotGnot || m.priceGnot) || 0;
    const entry = openPriceGnot;
    async function readHolder(addr) {
      try {
        const raw = await qeval(
          RPC,
          PKG,
          `${PKG}.BalanceOf(${JSON.stringify(id)}, ${JSON.stringify(addr)})`,
          fullMetrics() ? 20_000 : 0,
        );
        const bal = Number(String(raw).match(/-?\d+/)?.[0]);
        if (!Number.isFinite(bal)) throw new Error("bad BalanceOf");
        if (!(bal > 0)) return;
        const valueGnot = px > 0 ? bal * px : 0;
        let pnlGnot = null;
        let pnlPct = null;
        if (entry != null && entry > 0 && px > 0) {
          const cost = bal * entry;
          pnlGnot = valueGnot - cost;
          pnlPct = ((px - entry) / entry) * 100;
        }
        holders.push({
          address: addr,
          balance: bal,
          valueGnot,
          pctSupply: heldSupply > 0 ? (bal / heldSupply) * 100 : null,
          pnlGnot,
          pnlPct,
          entryGnot: entry,
          spotGnot: px,
        });
      } catch (e) {
        if (fullMetrics()) {
          holderErrors.push({ address: addr, error: String(e.message || e).slice(0, 160) });
        }
      }
    }
    await mapPool(addrs, fullMetrics() ? 12 : 16, readHolder);
    holders.sort((a, b) => (b.balance || 0) - (a.balance || 0));
    m.holders = holders;
    m.holdersActive = holders.length;
    m.holdersCapped = holdersCapped;
    m.holdersSource = holdersSource;
    m.holdersLabel = "Holders";
    if (fullMetrics()) {
      m.holdersNote = holdersCapped ? TRANSFER_HOLDERS_OMISSION : null;
      m.transferHoldersOmitted = !!holdersCapped;
      m.indexerPages = pages;
      if (indexerError) m.holdersIndexerError = indexerError;
      if (holderErrors.length) m.holderErrors = holderErrors;
    } else {
      m.holdersNote = null;
    }
    const heldBal = holders.reduce((s, h) => s + (Number(h.balance) || 0), 0);
    const top1 = holders[0] ? Number(holders[0].pctSupply) || 0 : 0;
    const top10 = holders
      .slice(0, 10)
      .reduce((s, h) => s + (Number(h.pctSupply) || 0), 0);
    m.holdersStats = {
      active: holders.length,
      buyersEver: Number(m.buyers) || addrs.length || holders.length,
      heldPct: heldSupply > 0 ? (heldBal / heldSupply) * 100 : null,
      top1Pct: top1,
      top10Pct: top10,
      capped: m.holdersCapped,
      source: holdersSource,
    };
  } catch {
    m.holdersNote = fullMetrics() ? TRANSFER_HOLDERS_OMISSION : null;
    if (fullMetrics()) m.transferHoldersOmitted = true;
    m.holdersSource = null;
    m.holdersStats = null;
  }

  return m;
}

// Block header times are immutable. A 2s-per-block guess stretches 24h to about 43h.
const blockHeaderMsCache = new Map();
const BLOCK_STAMP_FALLBACK_MS = 2000;

function parseBlockTime(raw) {
  const s = String(raw || "").trim();
  if (!s) return 0;
  const direct = Date.parse(s);
  if (Number.isFinite(direct)) return direct;
  const trimmed = Date.parse(s.replace(/(\.\d{3})\d+/, "$1"));
  return Number.isFinite(trimmed) ? trimmed : 0;
}

function applyBlockStamp(pt, timeMs) {
  pt.timeMs = timeMs;
  pt.time = new Date(timeMs).toISOString();
}

/** Header time for many heights. One RPC batch is 40 blocks. */
async function loadBlockHeaderTimes(RPC, heights) {
  const pending = [];
  const seen = new Set();
  for (const raw of heights) {
    const h = Math.floor(Number(raw));
    if (!(h > 0) || blockHeaderMsCache.has(h) || seen.has(h)) continue;
    seen.add(h);
    pending.push(h);
  }
  const groups = [];
  for (let i = 0; i < pending.length; i += 40) groups.push(pending.slice(i, i + 40));
  await mapPool(groups, 3, async (group) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12_000);
    try {
      const res = await fetch(RPC, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(
          group.map((h, i) => ({
            jsonrpc: "2.0",
            id: i + 1,
            method: "block",
            params: { height: String(h) },
          })),
        ),
        signal: ctrl.signal,
      });
      if (!res.ok) return;
      const rows = await res.json();
      const list = Array.isArray(rows) ? rows : [rows];
      for (const row of list) {
        const id = Number(row?.id) || 0;
        const h = group[id - 1];
        const t = parseBlockTime(row?.result?.block?.header?.time);
        if (h > 0 && t > 0) blockHeaderMsCache.set(h, t);
      }
    } catch {
      /* a retry pass fills the gaps */
    } finally {
      clearTimeout(timer);
    }
  });
}

/**
 * Stamp every curve height from its block header.
 * A missing header is interpolated between known headers so older trades keep
 * their place on the chart. A total outage falls back to a 2s block guess.
 */
async function stampTradeTimes(RPC, chart) {
  if (!chart?.length) return;
  let tipH = 0;
  let tipMs = Date.now();
  try {
    const st = await rpc(RPC, "status", {});
    tipH = Number(st?.sync_info?.latest_block_height || 0);
    const t = parseBlockTime(st?.sync_info?.latest_block_time);
    if (t > 0) tipMs = t;
  } catch {
    /* tip stays Date.now so the fallback stamp still orders the ring */
  }

  const needs = [];
  for (const pt of chart) {
    // Keep indexer / Gnoswap wall-clock times — never wipe or rewrite them
    if (pt.source === "gnoswap" && (Number(pt.timeMs) > 0 || pt.time)) {
      if (!(Number(pt.timeMs) > 0) && pt.time) {
        const p = Date.parse(pt.time);
        if (Number.isFinite(p)) pt.timeMs = p;
      }
      continue;
    }
    const h = Number(pt.height) || 0;
    if (!h) {
      if (!(Number(pt.timeMs) > 0) && pt.time) {
        const p = Date.parse(pt.time);
        if (Number.isFinite(p)) pt.timeMs = p;
      }
      continue;
    }
    needs.push(pt);
  }
  if (!needs.length) return;

  const fallback = () => {
    for (const pt of needs) {
      const h = Number(pt.height) || 0;
      const timeMs = tipH > 0 && h <= tipH ? tipMs - (tipH - h) * BLOCK_STAMP_FALLBACK_MS : tipMs;
      applyBlockStamp(pt, timeMs);
    }
  };
  if (!(tipH > 0)) {
    fallback();
    return;
  }
  if (!(blockHeaderMsCache.get(tipH) > 0)) blockHeaderMsCache.set(tipH, tipMs);

  const wanted = [];
  const seenH = new Set();
  for (const pt of needs) {
    const h = Math.floor(Number(pt.height) || 0);
    if (h > 0 && h < tipH && !seenH.has(h)) {
      seenH.add(h);
      wanted.push(h);
    }
  }
  await loadBlockHeaderTimes(RPC, wanted);
  const missing = wanted.filter((h) => !(blockHeaderMsCache.get(h) > 0));
  if (missing.length) await loadBlockHeaderTimes(RPC, missing);

  const known = [...blockHeaderMsCache.entries()]
    .filter(([h, t]) => h > 0 && h <= tipH && t > 0)
    .sort((a, b) => a[0] - b[0]);
  if (known.length < 2) {
    fallback();
    return;
  }

  const timeAt = (h) => {
    if (h >= tipH) return tipMs;
    const exact = blockHeaderMsCache.get(h);
    if (exact > 0) return exact;
    let lo = 0;
    let hi = known.length - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (known[mid][0] <= h) lo = mid;
      else hi = mid - 1;
    }
    const left = known[lo];
    const right = known[Math.min(known.length - 1, lo + 1)];
    if (!left || left[0] > h) {
      return left[1] - (left[0] - h) * BLOCK_STAMP_FALLBACK_MS;
    }
    if (!right || right[0] <= left[0] || h >= right[0]) return left[1];
    return Math.round(left[1] + ((right[1] - left[1]) * (h - left[0])) / (right[0] - left[0]));
  };

  for (const pt of needs) {
    const h = Math.floor(Number(pt.height) || 0);
    applyBlockStamp(pt, h > 0 ? timeAt(h) : tipMs);
  }
}

/** True buy/sell only — exclude open/LP markers (side 2/3/4). */
function isVolumeTradeSide(side) {
  const s = Number(side);
  return s === 0 || s === 1;
}

/** Aggregate trade-ring stats (volume in GNOT). Buy/sell only — not LP seed. */
function summarizeTradeStats(chart) {
  let volumeGnot = 0;
  let buyVolumeGnot = 0;
  let sellVolumeGnot = 0;
  let buyCount = 0;
  let sellCount = 0;
  let trades = 0;
  for (const pt of chart || []) {
    const side = Number(pt.side);
    // 2=open · 3=add_lp · 4=remove_lp — not trading volume
    if (!isVolumeTradeSide(side)) continue;
    const vol =
      Number(pt.volumeGnot != null ? pt.volumeGnot : (pt.ugnot || 0) / UGNOT_PER_GNOT) || 0;
    trades += 1;
    volumeGnot += vol;
    if (side === 0) {
      buyCount += 1;
      buyVolumeGnot += vol;
    } else if (side === 1) {
      sellCount += 1;
      sellVolumeGnot += vol;
    }
  }
  return {
    trades,
    buyCount,
    sellCount,
    volumeGnot,
    buyVolumeGnot,
    sellVolumeGnot,
  };
}

async function getMetaBatch(RPC, META, items) {
  const list = (items || []).slice(0, 32);
  const out = {};
  await Promise.all(
    list.map(async (item) => {
      const pkg = String(item.pkg || "").trim();
      const id = String(item.id || "").trim();
      if (!pkg || !id) return;
      const key = `${pkg}|${id}`;
      try {
        const raw = await qeval(
          RPC,
          META,
          `${META}.GetMeta(${JSON.stringify(pkg)}, ${JSON.stringify(id)})`,
        );
        out[key] = parseMeta(raw);
      } catch {
        out[key] = null;
      }
    }),
  );
  return out;
}

/** Holder balances only. Does not rebuild the token page. */
async function loadHolderBalances(RPC, PKG, id) {
  const full = fullMetrics();
  // Ledger is the full book, including transfers, only when its sum equals RealSold.
  // A mismatch returns null and the ListBuyers + BalanceOf path below keeps every balance it can read.
  try {
    const replayed = await holdersFromLedger(RPC, PKG, id);
    if (replayed) return replayed;
  } catch {
    /* BalanceOf fallback */
  }
  const [resolved, buyerCount] = await Promise.all([
    resolveHolderAddrs(RPC, PKG, id, { raceMs: 3000 }),
    (async () => {
      try {
        const info = String(
          await qeval(RPC, PKG, `${PKG}.LaunchInfo(${JSON.stringify(id)})`, full ? 20_000 : 0),
        );
        const parts = info.split("|");
        const n = Number(parts[6]);
        return parts[0] === id && Number.isFinite(n) ? n : null;
      } catch {
        return null;
      }
    })(),
  ]);
  const { addrs, holdersSource, holdersCapped, indexerError, pages } = resolved;
  const holders = [];
  const holderErrors = [];
  await mapPool(addrs, full ? 12 : 16, async (addr) => {
    try {
      const raw = await qeval(
        RPC,
        PKG,
        `${PKG}.BalanceOf(${JSON.stringify(id)}, ${JSON.stringify(addr)})`,
        full ? 20_000 : 0,
      );
      const bal = Number(String(raw).match(/-?\d+/)?.[0]);
      if (!Number.isFinite(bal)) throw new Error("bad BalanceOf");
      if (bal > 0) holders.push({ address: addr, balance: bal });
    } catch (e) {
      if (full) holderErrors.push({ address: addr, error: String(e.message || e).slice(0, 160) });
    }
  });
  holders.sort((a, b) => (b.balance || 0) - (a.balance || 0));
  const omitTransfers = full && holdersCapped;
  return {
    id,
    pkg: PKG,
    holders,
    holdersActive: holders.length,
    holdersCapped,
    holdersSource,
    ...(full
      ? {
          fullMetrics: true,
          holdersNote: omitTransfers ? TRANSFER_HOLDERS_OMISSION : null,
          transferHoldersOmitted: omitTransfers,
          indexerPages: pages,
          ...(indexerError ? { holdersIndexerError: indexerError } : {}),
          ...(holderErrors.length ? { errors: holderErrors } : {}),
        }
      : {}),
    holdersStats: {
      active: holders.length,
      buyersEver: buyerCount != null ? buyerCount : addrs.length,
      capped: holdersCapped,
      source: holdersSource,
    },
  };
}

/** Resolve which pad package owns launch id (try query pkg first, then sources). */
async function resolveMarketPkg(RPC, id, preferredPkg, sources, metaExtra = {}) {
  const tryList = [];
  if (preferredPkg) tryList.push(preferredPkg);
  for (const s of sources || []) {
    if (s.pkg && !tryList.includes(s.pkg)) tryList.push(s.pkg);
  }
  for (const pkg of tryList) {
    try {
      const src = (sources || []).find((s) => s.pkg === pkg) || {
        key: "pad",
        active: true,
        legacy: false,
      };
      const m = await getMarket(RPC, pkg, id, {
        sourceKey: src.key,
        active: src.active,
        legacy: src.legacy,
        holders: metaExtra.holders === true,
      });
      return m;
    } catch {
      /* try next pad */
    }
  }
  throw new Error(`Market ${id} not found on any pad`);
}

async function bankUgnot(RPC, address, timeoutMs) {
  let signal;
  let timer;
  if (timeoutMs > 0) {
    const ctrl = new AbortController();
    signal = ctrl.signal;
    timer = setTimeout(() => ctrl.abort(), timeoutMs);
  }
  try {
    const result = await rpc(RPC, "abci_query", {
      path: `bank/balances/${address}`,
      data: "",
      height: "0",
      prove: false,
    }, signal);
    const rb = result?.response?.ResponseBase;
    if (rb?.Error || !rb?.Data) return 0;
    const text = b64utf8(rb.Data);
    const m = text.match(/(\d+)\s*ugnot/i) || text.match(/"amount"\s*:\s*"(\d+)"/);
    if (m) return Number(m[1]) || 0;
    try {
      const j = JSON.parse(text);
      const arr = Array.isArray(j) ? j : j?.coins || j?.Coins || [];
      for (const c of arr) {
        if ((c.denom || c.Denom) === "ugnot") return Number(c.amount || c.Amount) || 0;
      }
    } catch {
      /* ignore */
    }
    return 0;
  } catch {
    return 0;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function tokenBalance(RPC, PKG, id, address) {
  try {
    const raw = await qeval(
      RPC,
      PKG,
      `${PKG}.BalanceOf(${JSON.stringify(id)}, ${JSON.stringify(address)})`,
    );
    return Number(String(raw).match(/-?\d+/)?.[0] || 0);
  } catch {
    return 0;
  }
}

async function getPortfolio(RPC, sources, SIGNER_ADDR, address) {
  if (!address || !/^g1[a-z0-9]{38,}$/i.test(address)) {
    throw new Error("invalid g1 address");
  }
  const { markets, params } = await getMarkets(RPC, sources, { lite: true });
  const holdings = [];
  const rowErrors = [];
  let memePositions = 0;
  const full = fullMetrics();
  // Speedup #2: parallel BalanceOf (was sequential — 16–22s class)
  const balRows = await mapPool(
    (markets || []).filter((m) => !m.error),
    full ? 12 : 8,
    async (m) => {
      const pkg = m.pkg || sources[0]?.pkg;
      if (!full) {
        const bal = await tokenBalance(RPC, pkg, m.id, address);
        return { m, pkg, bal };
      }
      try {
        const raw = await qeval(
          RPC,
          pkg,
          `${pkg}.BalanceOf(${JSON.stringify(m.id)}, ${JSON.stringify(address)})`,
          20_000,
        );
        const bal = Number(String(raw).match(/-?\d+/)?.[0]);
        if (!Number.isFinite(bal)) throw new Error("bad BalanceOf");
        return { m, pkg, bal };
      } catch (e) {
        return { m, pkg, error: String(e.message || e).slice(0, 180) };
      }
    },
  );
  for (const row of balRows) {
    if (!row) continue;
    if (row.error) {
      rowErrors.push({ id: row.m?.id, pkg: row.pkg, error: row.error });
      continue;
    }
    const { m, pkg, bal } = row;
    if (!(bal > 0)) continue;
    memePositions += 1;
    // Prefer live valuation spot from markets enrichment (DEX / pool), not pad dump reserves
    const spotGnot =
      Number(m.spotGnot) ||
      Number(m.priceGnot) ||
      Number(m.poolSpotGnot) ||
      0;
    let valueGnotApprox = spotGnot > 0 ? bal * spotGnot : 0;
    if (!(valueGnotApprox > 0)) {
      // Fallback: pad curve/pool reserves (pre-list or missing spot)
      valueGnotApprox = m.virtualToken
        ? (bal * m.virtualUgnot) / m.virtualToken / UGNOT_PER_GNOT
        : m.poolToken
          ? (bal * m.poolUgnot) / m.poolToken / UGNOT_PER_GNOT
          : 0;
    }
    const entryGnot = Number(m.avgEntryGnot || m.openPriceGnot) || 0;
    let pnlGnot = null;
    let pnlPct = null;
    if (entryGnot > 0 && spotGnot > 0) {
      const cost = bal * entryGnot;
      pnlGnot = valueGnotApprox - cost;
      pnlPct = ((spotGnot - entryGnot) / entryGnot) * 100;
    }
    holdings.push({
      id: m.id,
      name: m.name,
      symbol: m.symbol,
      status: m.status,
      statusLabel: m.statusLabel,
      gnoswapListed: !!m.gnoswapListed,
      tokenId: m.tokenId || "",
      pkg,
      legacy: !!m.legacy,
      padLabel: m.padLabel || String(pkg).split("/").pop(),
      balance: bal,
      spotGnot,
      entryGnot: entryGnot > 0 ? entryGnot : null,
      spotScaled: spotGnot > 0 ? Math.floor(spotGnot * UGNOT_PER_GNOT * 1e6) : 0,
      valueGnotApprox,
      valueUgnotApprox: valueGnotApprox * UGNOT_PER_GNOT,
      pnlGnot,
      pnlPct,
      priceGnot: spotGnot || m.priceGnot || 0,
      mcapGnot: m.mcapGnot == null ? (fullMetrics() ? null : 0) : m.mcapGnot,
      priceUsd: m.priceUsd || 0,
      mcapUsd: m.mcapUsd || 0,
      gnotUsd: m.gnotUsd || 0,
      priceSource: m.priceSource || null,
    });
  }
  for (const h of holdings) {
    const gnotUsd = Number(h.gnotUsd) || 0;
    h.valueUsdApprox =
      gnotUsd > 0 && h.valueGnotApprox > 0 ? h.valueGnotApprox * gnotUsd : 0;
    h.pnlUsd =
      gnotUsd > 0 && h.pnlGnot != null && Number.isFinite(h.pnlGnot)
        ? h.pnlGnot * gnotUsd
        : null;
  }
  const ugnot = await bankUgnot(RPC, address);
  let wugnot = 0;
  try {
    wugnot =
      Number(
        await qeval(
          RPC,
          "gno.land/r/gnoland/wugnot",
          `gno.land/r/gnoland/wugnot.BalanceOf(${JSON.stringify(address)})`,
        ),
      ) || 0;
  } catch {
    wugnot = 0;
  }
  const fx = await fetchGnoswapFx();
  const gnotUsd = fx.gnotUsd || 0;
  // Ensure holdings have USD even if market list path skipped fx
  for (const h of holdings) {
    if (!(h.gnotUsd > 0) && gnotUsd > 0) {
      h.gnotUsd = gnotUsd;
      h.priceUsd = (Number(h.priceGnot) || 0) * gnotUsd;
      h.mcapUsd = (Number(h.mcapGnot) || 0) * gnotUsd;
      h.valueUsdApprox = (Number(h.valueGnotApprox) || 0) * gnotUsd;
    }
  }
  return {
    address,
    ugnot,
    gnot: ugnot / UGNOT_PER_GNOT,
    wugnot,
    wugnotGnot: wugnot / UGNOT_PER_GNOT,
    gnotUsd,
    gnotUsdValue: gnotUsd > 0 ? (ugnot / UGNOT_PER_GNOT) * gnotUsd : 0,
    wugnotUsdValue: gnotUsd > 0 ? (wugnot / UGNOT_PER_GNOT) * gnotUsd : 0,
    holdings,
    memePositions,
    canSign: false, // Netlify / remote UI: no server gnokey
    params: params || null,
    ...(full
      ? {
          fullMetrics: true,
          ...(rowErrors.length ? { errors: rowErrors } : {}),
          ...(params ? {} : { warning: "ParamsInfo failed; graduation, fee bps, and supply were not substituted" }),
        }
      : {}),
  };
}

async function getCreatorDashboard(RPC, sources, SIGNER_ADDR, address) {
  if (!address || !/^g1[a-z0-9]{38,}$/i.test(address)) {
    throw new Error("invalid g1 address");
  }
  const { markets, params } = await getMarkets(RPC, sources);
  const mine = markets.filter((m) => !m.error && m.creator === address);
  let totalFees = 0;
  let totalRaised = 0;
  let graduated = 0;
  for (const m of mine) {
    totalFees += m.creatorFees || 0;
    totalRaised += m.raised || 0;
    if (m.status === 1) graduated += 1;
  }
  const creatorBadges = evaluateCreatorBadges(mine);
  return {
    address,
    launches: mine,
    count: mine.length,
    totalFees,
    totalFeesGnot: totalFees / UGNOT_PER_GNOT,
    totalRaised,
    totalRaisedGnot: totalRaised / UGNOT_PER_GNOT,
    graduated,
    badges: creatorBadges,
    wearBadges: wearBadges(creatorBadges, WEAR_LIMIT),
    canSign: false,
    params,
  };
}

/**
 * JSON response helper.
 * When maxAge > 0 and not private: set browser Cache-Control + Netlify durable CDN
 * so edge can serve without invoking the Function (credit saver).
 */
function json(statusCode, body, opts = {}) {
  const maxAge = Number(opts.maxAge) || 0;
  const scope = opts.private ? "private" : "public";
  const swr = Math.max(maxAge * 2, maxAge + 30);
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, X-Gnomi-Network",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  };
  if (maxAge > 0 && !opts.private) {
    headers["Cache-Control"] =
      `${scope}, max-age=${Math.min(maxAge, 30)}, s-maxage=${maxAge}, stale-while-revalidate=${swr}`;
    // Netlify-specific: durable shared cache → fewer Function GB-hours
    headers["Netlify-CDN-Cache-Control"] =
      `public, durable, s-maxage=${maxAge}, stale-while-revalidate=${swr}`;
    headers["Netlify-Vary"] =
      opts.varyQuery || "query=network|lite|refresh|nocache|chain";
    if (opts.cacheTag) {
      headers["Netlify-Cache-Tag"] = String(opts.cacheTag);
    }
  } else {
    headers["Cache-Control"] = "no-store";
  }
  Object.assign(headers, opts.headers || {});
  return {
    statusCode,
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  };
}

/**
 * Aggregate recent trades across pads:
 *  - on-chain TradeHistory (curve / pre-list)
 *  - Gnoswap swap history for listed markets (same source as Token Trades tab)
 * limit: max events returned (default 40).
 */
async function getActivity(RPC, sources, limit = 40, preloaded = null) {
  const full = fullMetrics();
  const cap = full
    ? Math.min(200, Math.max(5, Number(limit) || 40))
    : Math.min(80, Math.max(5, Number(limit) || 40));
  const { markets } = Array.isArray(preloaded)
    ? { markets: preloaded }
    : full
      ? await getMarkets(RPC, sources, { lite: true, tradeStats: false })
      : await getMarkets(RPC, sources);
  const events = [];
  const errors = [];
  // Prefer active markets first, then by recency of launch
  const sorted = [...markets]
    .filter((m) => !m.error)
    .sort((a, b) => {
      if (!!a.legacy !== !!b.legacy) return a.legacy ? 1 : -1;
      // Listed markets often have the only live volume post-grad — keep them near front
      if (!!a.gnoswapListed !== !!b.gnoswapListed) return a.gnoswapListed ? -1 : 1;
      return (Number(b.created) || 0) - (Number(a.created) || 0);
    })
    .slice(0, full ? 512 : 24);

  const run = async (m) => {
      // 1) Pad TradeHistory (curve + LP marks while ring still has data)
      try {
        let pts = rememberedCurvePoints(m.pkg, m.id);
        if (!pts) {
          const hist = await qeval(
            RPC,
            m.pkg,
            `${m.pkg}.TradeHistory(${JSON.stringify(m.id)})`,
            full ? 20_000 : 0,
          );
          pts = parseTradeHistory(hist).map((pt) => ({
            ...pt,
            volumeGnot: (Number(pt.ugnot) || 0) / UGNOT_PER_GNOT,
          }));
          rememberCurvePoints(m.pkg, m.id, pts);
        }
        for (const pt of pts) {
          // Only buy/sell for activity volume (skip open + LP seed ~500 GNOT)
          if (!isVolumeTradeSide(pt.side)) continue;
          events.push({
            height: pt.height,
            side: pt.side,
            sideLabel: pt.sideLabel,
            ugnot: pt.ugnot,
            tokens: pt.tokens,
            price: pt.price,
            priceGnot: Number(pt.price) / 1_000_000 / UGNOT_PER_GNOT,
            volumeGnot: (Number(pt.ugnot) || 0) / UGNOT_PER_GNOT,
            id: m.id,
            name: m.name,
            symbol: m.symbol,
            pkg: m.pkg,
            padLabel: m.padLabel,
            legacy: !!m.legacy,
            source: pt.source || "curve",
            gnoswapListed: !!m.gnoswapListed,
          });
        }
      } catch (e) {
        if (full) {
          errors.push({ id: m.id, pkg: m.pkg, error: String(e.message || e).slice(0, 180) });
        }
      }

      // 2) Gnoswap swaps after list (pad TradeHistory stops receiving fills)
      if (m.gnoswapListed || m.gnoswapPoolPath) {
        try {
          const tokenKey = marketTokenKey(m);
          if (!tokenKey) return;
          const dexPts = await fetchGnoswapSwapHistory(tokenKey, 40);
          for (const pt of dexPts) {
            if (Number(pt.side) !== 0 && Number(pt.side) !== 1) continue;
            events.push({
              height: Number(pt.height) || 0,
              side: pt.side,
              sideLabel: pt.sideLabel || (pt.side === 0 ? "buy" : "sell"),
              ugnot: pt.ugnot,
              tokens: pt.tokens,
              price: pt.price,
              priceGnot: Number(pt.priceGnot) || 0,
              volumeGnot:
                Number(pt.volumeGnot) ||
                (Number(pt.ugnot) || 0) / UGNOT_PER_GNOT,
              timeMs: Number(pt.timeMs) || 0,
              time: pt.time || null,
              hash: pt.hash || "",
              id: m.id,
              name: m.name,
              symbol: m.symbol,
              pkg: m.pkg,
              padLabel: m.padLabel,
              legacy: !!m.legacy,
              source: "gnoswap",
              gnoswapListed: true,
            });
          }
        } catch (e) {
          if (full) {
            errors.push({
              id: m.id,
              pkg: m.pkg,
              error: `dex: ${String(e.message || e).slice(0, 160)}`,
            });
          }
        }
      }
  };
  if (full) await mapPool(sorted, 12, run);
  else await Promise.all(sorted.map(run));

  // Prefer wall-clock time (Gnoswap + stamped curve); fall back to height
  events.sort((a, b) => {
    const tb = Number(b.timeMs) || 0;
    const ta = Number(a.timeMs) || 0;
    if (tb !== ta) return tb - ta;
    return (Number(b.height) || 0) - (Number(a.height) || 0);
  });

  // Dedupe: same hash, or same fingerprint
  const seen = new Set();
  const deduped = [];
  for (const e of events) {
    const k = e.hash
      ? `h:${e.hash}`
      : [
          e.source || "",
          e.pkg || "",
          e.id || "",
          e.side,
          e.ugnot,
          e.tokens,
          e.height || 0,
          Math.floor((Number(e.timeMs) || 0) / 1000),
        ].join("|");
    if (seen.has(k)) continue;
    seen.add(k);
    deduped.push(e);
  }

  const capped = deduped.slice(0, cap);
  try {
    await stampTradeTimes(RPC, capped);
  } catch {
    /* non-fatal */
  }
  let gnotUsd = 0;
  try {
    const fx = await fetchGnoswapFx();
    gnotUsd = Number(fx?.gnotUsd) || 0;
  } catch {
    gnotUsd = 0;
  }
  if (gnotUsd > 0) {
    for (const e of capped) {
      const vol = Number(e.volumeGnot) || 0;
      const px = Number(e.priceGnot) || 0;
      if (!(Number(e.volumeUsd) > 0) && vol > 0) e.volumeUsd = vol * gnotUsd;
      if (!(Number(e.priceUsd) > 0) && px > 0) e.priceUsd = px * gnotUsd;
    }
  }
  return {
    events: capped,
    gnotUsd,
    count: capped.length,
    scannedMarkets: sorted.length,
    sources: {
      curve: capped.filter((e) => e.source !== "gnoswap").length,
      gnoswap: capped.filter((e) => e.source === "gnoswap").length,
    },
    ...(full
      ? { fullMetrics: true, ...(errors.length ? { errors } : {}) }
      : {}),
  };
}

/**
 * Memepad leaderboard: top traders / PnL / creators / tokens by volume & mcap.
 * Built from markets + activity + ListBuyers on hottest launches (bounded).
 */
async function getMemepadLeaderboard(RPC, sources, POINTS) {
  const marketsRaw = await getMarkets(RPC, sources);
  const priced = await withUsdPricing({
    ...marketsRaw,
    markets: (marketsRaw.markets || []).filter(
      (m) => m && !m.error && !isRetiredPadVersion(m.pkg) && !isRetiredPadVersion(m.padLabel),
    ),
  });
  const markets = priced.markets || [];
  const gnotUsd = Number(priced.gnotUsd) || 0;
  const activity = await getActivity(RPC, sources, 80);
  const events = activity.events || [];

  // --- Token volume from recent activity ring ---
  const volByToken = new Map();
  for (const e of events) {
    if (Number(e.side) !== 0 && Number(e.side) !== 1) continue;
    const k = `${e.pkg || ""}|${e.id || ""}`;
    if (!volByToken.has(k)) {
      volByToken.set(k, {
        id: e.id,
        pkg: e.pkg,
        name: e.name,
        symbol: e.symbol,
        volumeGnot: 0,
        trades: 0,
        buyVol: 0,
        sellVol: 0,
      });
    }
    const row = volByToken.get(k);
    const v = Number(e.volumeGnot) || 0;
    row.volumeGnot += v;
    row.trades += 1;
    if (Number(e.side) === 0) row.buyVol += v;
    else row.sellVol += v;
  }

  // Enrich volume rows with mcap/price from markets
  const marketIndex = new Map(markets.map((m) => [`${m.pkg}|${m.id}`, m]));
  const topVolume = [...volByToken.values()]
    .map((r) => {
      const m = marketIndex.get(`${r.pkg}|${r.id}`);
      const volumeUsd = gnotUsd > 0 ? r.volumeGnot * gnotUsd : 0;
      return {
        ...r,
        mcapGnot: m?.mcapGnot || 0,
        mcapUsd: m?.mcapUsd || (gnotUsd > 0 ? (m?.mcapGnot || 0) * gnotUsd : 0),
        priceGnot: m?.priceGnot || 0,
        priceUsd: m?.priceUsd || 0,
        status: m?.status,
        gnoswapListed: !!m?.gnoswapListed,
        volumeUsd,
        buyers: m?.buyers || 0,
      };
    })
    .sort((a, b) => b.volumeGnot - a.volumeGnot || b.trades - a.trades)
    .slice(0, 25);

  // --- Top mcap tokens ---
  const topMcap = [...markets]
    .map((m) => ({
      id: m.id,
      pkg: m.pkg,
      name: m.name,
      symbol: m.symbol,
      mcapGnot: Number(m.mcapGnot) || 0,
      mcapUsd: Number(m.mcapUsd) || (gnotUsd > 0 ? (Number(m.mcapGnot) || 0) * gnotUsd : 0),
      priceGnot: Number(m.priceGnot) || 0,
      priceUsd: Number(m.priceUsd) || 0,
      raisedGnot: Number(m.raisedGnot) || (Number(m.raised) || 0) / UGNOT_PER_GNOT,
      status: m.status,
      gnoswapListed: !!m.gnoswapListed,
      buyers: Number(m.buyers) || 0,
      creator: m.creator || "",
    }))
    .filter((m) => m.mcapGnot > 0 || m.mcapUsd > 0)
    .sort((a, b) => b.mcapUsd - a.mcapUsd || b.mcapGnot - a.mcapGnot)
    .slice(0, 25);

  // --- Top creators ---
  const byCreator = new Map();
  for (const m of markets) {
    const c = String(m.creator || "").trim();
    if (!c || !/^g1/i.test(c)) continue;
    if (!byCreator.has(c)) {
      byCreator.set(c, {
        address: c,
        launches: 0,
        graduated: 0,
        listed: 0,
        totalRaisedGnot: 0,
        totalMcapGnot: 0,
        totalMcapUsd: 0,
        totalBuyers: 0,
        symbols: [],
      });
    }
    const row = byCreator.get(c);
    row.launches += 1;
    if (m.status === 1) row.graduated += 1;
    if (m.gnoswapListed) row.listed += 1;
    row.totalRaisedGnot += Number(m.raisedGnot) || (Number(m.raised) || 0) / UGNOT_PER_GNOT;
    row.totalMcapGnot += Number(m.mcapGnot) || 0;
    row.totalMcapUsd +=
      Number(m.mcapUsd) || (gnotUsd > 0 ? (Number(m.mcapGnot) || 0) * gnotUsd : 0);
    row.totalBuyers += Number(m.buyers) || 0;
    if (m.symbol && row.symbols.length < 6) row.symbols.push(m.symbol);
  }
  const topCreators = [...byCreator.values()]
    .map((r) => ({
      ...r,
      score:
        r.totalRaisedGnot * 2 +
        r.graduated * 50 +
        r.listed * 80 +
        r.launches * 5 +
        r.totalBuyers * 0.5,
    }))
    .sort((a, b) => b.score - a.score || b.totalRaisedGnot - a.totalRaisedGnot)
    .slice(0, 25);

  // --- Top traders / PnL from ListBuyers on hottest markets ---
  const hotMarkets = [...markets]
    .sort((a, b) => {
      const va = volByToken.get(`${a.pkg}|${a.id}`)?.volumeGnot || 0;
      const vb = volByToken.get(`${b.pkg}|${b.id}`)?.volumeGnot || 0;
      return vb - va || (b.buyers || 0) - (a.buyers || 0) || (b.mcapGnot || 0) - (a.mcapGnot || 0);
    })
    .slice(0, 10);

  const traderMap = new Map(); // address -> stats
  const pnlRows = [];

  await Promise.all(
    hotMarkets.map(async (m) => {
      try {
        const buyersRaw = await qeval(
          RPC,
          m.pkg,
          `${m.pkg}.ListBuyers(${JSON.stringify(m.id)})`,
        );
        const addrs = String(buyersRaw || "")
          .split("\n")
          .map((s) => s.trim())
          .filter((s) => /^g1[a-z0-9]{38,}$/i.test(s))
          .slice(0, 30);
        if (!addrs.length) return;

        // Spot for valuation
        let spot = Number(m.spotGnot || m.priceGnot) || 0;
        // Prefer richer market detail for open/vwap when cheap enough
        let openPx = Number(m.openPriceGnot) || 0;
        try {
          const detail = await getMarket(RPC, m.pkg, m.id, {
            sourceKey: m.sourceKey || "pad",
            active: !!m.active,
            legacy: !!m.legacy,
          });
          if (Number(detail.spotGnot || detail.priceGnot) > 0) {
            spot = Number(detail.spotGnot || detail.priceGnot);
          }
          if (Number(detail.openPriceGnot) > 0) openPx = Number(detail.openPriceGnot);
          if (Number(detail.avgEntryGnot) > 0) openPx = Number(detail.avgEntryGnot);
        } catch {
          /* use list spot */
        }

        await Promise.all(
          addrs.map(async (addr) => {
            const bal = await tokenBalance(RPC, m.pkg, m.id, addr);
            if (bal <= 0) return;
            const valueGnot = spot > 0 ? bal * spot : 0;
            const entry = openPx > 0 ? openPx : spot;
            const costGnot = entry > 0 ? bal * entry : 0;
            const pnlGnot = valueGnot - costGnot;
            const pnlPct = entry > 0 && spot > 0 ? ((spot - entry) / entry) * 100 : null;

            if (!traderMap.has(addr)) {
              traderMap.set(addr, {
                address: addr,
                markets: 0,
                totalValueGnot: 0,
                totalPnlGnot: 0,
                volumeProxyGnot: 0,
                tokens: [],
              });
            }
            const t = traderMap.get(addr);
            t.markets += 1;
            t.totalValueGnot += valueGnot;
            t.totalPnlGnot += pnlGnot;
            // proxy volume: value of current bags (not true historical volume)
            t.volumeProxyGnot += valueGnot;
            if (t.tokens.length < 8) {
              t.tokens.push({
                id: m.id,
                pkg: m.pkg,
                symbol: m.symbol,
                balance: bal,
                valueGnot,
                pnlGnot,
              });
            }

            pnlRows.push({
              address: addr,
              id: m.id,
              pkg: m.pkg,
              symbol: m.symbol,
              name: m.name,
              balance: bal,
              valueGnot,
              valueUsd: gnotUsd > 0 ? valueGnot * gnotUsd : 0,
              entryGnot: entry,
              spotGnot: spot,
              pnlGnot,
              pnlUsd: gnotUsd > 0 ? pnlGnot * gnotUsd : 0,
              pnlPct,
            });
          }),
        );
      } catch {
        /* skip market */
      }
    }),
  );

  const topTraders = [...traderMap.values()]
    .map((t) => ({
      ...t,
      totalValueUsd: gnotUsd > 0 ? t.totalValueGnot * gnotUsd : 0,
      totalPnlUsd: gnotUsd > 0 ? t.totalPnlGnot * gnotUsd : 0,
      score: t.markets * 10 + t.totalValueGnot * 0.5 + Math.max(0, t.totalPnlGnot),
    }))
    .sort(
      (a, b) =>
        b.score - a.score || b.totalValueGnot - a.totalValueGnot || b.markets - a.markets,
    )
    .slice(0, 25);

  const topPnl = pnlRows
    .filter((r) => Number.isFinite(r.pnlGnot))
    .sort((a, b) => b.pnlGnot - a.pnlGnot)
    .slice(0, 25);

  // Points board (optional)
  let pointsBoard = [];
  if (POINTS) {
    try {
      const lbRaw = await qeval(RPC, POINTS, `${POINTS}.Leaderboard(25)`);
      pointsBoard = parseLeaderboard(lbRaw).slice(0, 25);
    } catch {
      pointsBoard = [];
    }
  }

  return {
    gnotUsd,
    updatedAt: Date.now(),
    notes: {
      traders:
        "Ranked by participation across hottest launches + open bag value / estimated PnL (VWAP entry when available).",
      pnl: "Per-position estimated PnL vs market VWAP entry on top active launches (not realized fills).",
      volume: "Recent on-chain trade ring volume (activity feed sample).",
      mcap: "FDV from spot × total supply (GNOT/USD).",
      creators: "Ranked by raised capital, graduates, Gnoswap lists, and buyers.",
    },
    topTraders,
    topPnl,
    topCreators,
    topVolume,
    topMcap,
    pointsBoard,
    scanned: {
      markets: markets.length,
      activityEvents: events.length,
      hotMarkets: hotMarkets.length,
      traders: traderMap.size,
    },
  };
}

/** Ops dashboard: module liveness + counts (Phase 3F). */
async function getOps(RPC, cfg, hubInfo, padSources) {
  const modules = hubInfo.modules || {};
  const report = {
    ok: true,
    hub: hubInfo.hub,
    hubError: hubInfo.hubError || null,
    modules: {},
    pads: [],
    height: null,
    chainId: cfg.CHAIN_ID,
  };
  try {
    const st = await rpc(RPC, "status", {});
    report.height = String(st?.sync_info?.latest_block_height || "");
    report.chainId = st?.node_info?.network || cfg.CHAIN_ID;
  } catch (e) {
    report.ok = false;
    report.rpcError = String(e.message || e);
  }

  async function probe(name, path, kind) {
    const entry = { path, kind, ok: false };
    if (!path) {
      entry.error = "missing path";
      report.modules[name] = entry;
      return;
    }
    try {
      if (kind === "pad") {
        const n = Number(await qeval(RPC, path, `${path}.LaunchCount()`)) || 0;
        const params = await getParams(RPC, path);
        entry.ok = true;
        entry.launchCount = n;
        entry.params = params
          ? {
              graduationGnot: params.graduationGnot,
              createBondGnot: params.createBondGnot,
              feeBps: params.feeBps,
            }
          : null;
        if (!params) {
          entry.warning =
            "ParamsInfo failed; graduation, fee bps, and supply were not substituted";
        }
      } else if (kind === "profile") {
        entry.ok = true;
        entry.count = Number(await qeval(RPC, path, `${path}.ProfileCount()`)) || 0;
      } else if (kind === "meta") {
        entry.ok = true;
        entry.count = Number(await qeval(RPC, path, `${path}.MetaCount()`)) || 0;
      } else if (kind === "points") {
        entry.ok = true;
        // UserCount walks every points row and can exceed the function limit.
        entry.userCount = Number(await qeval(RPC, path, `${path}.UserCount()`, 4000)) || 0;
      } else if (kind === "hub") {
        entry.ok = true;
        try {
          entry.moduleCount = Number(await qeval(RPC, path, `${path}.ModuleCount()`));
        } catch {
          /* hub v1 has no ModuleCount */
        }
        try {
          entry.admins = String(await qeval(RPC, path, `${path}.ListAdmins()`))
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean);
        } catch {
          try {
            entry.admin = String(await qeval(RPC, path, `${path}.Admin()`)).replace(/^"|"$/g, "");
          } catch {
            /* ignore */
          }
        }
      } else {
        entry.ok = true;
      }
    } catch (e) {
      entry.ok = false;
      entry.error = String(e.message || e);
      report.ok = false;
    }
    report.modules[name] = entry;
  }

  if (hubInfo.hub) await probe("hub", hubInfo.hub, "hub");
  for (const s of padSources || []) {
    await probe(s.key, s.pkg, "pad");
    report.pads.push({
      key: s.key,
      pkg: s.pkg,
      active: s.active,
      legacy: s.legacy,
      launchCount: report.modules[s.key]?.launchCount,
    });
  }
  if (hubInfo.profile || cfg.PROFILE)
    await probe("profile", hubInfo.profile || cfg.PROFILE, "profile");
  if (hubInfo.meta || cfg.META) await probe("meta", hubInfo.meta || cfg.META, "meta");
  if (hubInfo.points || cfg.POINTS)
    await probe("points", hubInfo.points || cfg.POINTS, "points");

  // Active pad inventory for Gnoswap auto-list readiness (public read)
  try {
    const activePad = hubInfo.pad || cfg.PKG;
    if (activePad) {
      const snap = await readPadFeeSnapshot(RPC, activePad);
      const padAddr = snap?.padAddr || "";
      let wugnot = 0;
      let gns = 0;
      let bank = 0;
      if (padAddr && /^g1[a-z0-9]+$/i.test(padAddr)) {
        try {
          wugnot = Number(await qeval(RPC, "gno.land/r/gnoland/wugnot", `gno.land/r/gnoland/wugnot.BalanceOf("${padAddr}")`)) || 0;
        } catch {
          /* ignore */
        }
        try {
          gns = Number(await qeval(RPC, "gno.land/r/gnoswap/gns", `gno.land/r/gnoswap/gns.BalanceOf("${padAddr}")`)) || 0;
        } catch {
          /* ignore */
        }
        try {
          bank = await bankUgnot(RPC, padAddr);
        } catch {
          /* ignore */
        }
      }
      const params = await getParams(RPC, activePad).catch(() => null);
      const raiseNeed =
        params && Number.isFinite(Number(params.graduation)) && Number(params.graduation) > 0
          ? Number(params.graduation)
          : null;
      const feeGnsNeed = 100_000_000;
      report.inventory = {
        pkg: activePad,
        padLabel: String(activePad).split("/").pop(),
        padAddr,
        wugnot,
        wugnotGnot: wugnot / UGNOT_PER_GNOT,
        gns,
        gnsUnits: gns / 1e6,
        bankUgnot: bank,
        bankGnot: bank / UGNOT_PER_GNOT,
        raiseNeedUgnot: raiseNeed,
        raiseNeedGnot: raiseNeed == null ? null : raiseNeed / UGNOT_PER_GNOT,
        feeGnsNeed,
        lpReady: raiseNeed == null ? null : wugnot >= raiseNeed,
        feeReady: gns >= feeGnsNeed,
        listReady: raiseNeed == null ? null : wugnot >= raiseNeed && gns >= feeGnsNeed,
        ...(raiseNeed == null
          ? { warning: "ParamsInfo unavailable; graduation threshold was not substituted" }
          : {}),
      };
    }
  } catch {
    /* inventory optional */
  }

  return report;
}

/**
 * Read FeeInfo / AdminInfo for one pad package.
 * @returns {{ pkg, label, protocolAddr, pending, paid, reserved, padAddr, launchCount, pointsEnabled, inited } | null}
 */
async function readPadFeeSnapshot(RPC, pkgPath, timeoutMs) {
  if (!pkgPath) return null;
  const label = String(pkgPath).split("/").pop() || pkgPath;
  try {
    const raw = String(await qeval(RPC, pkgPath, `${pkgPath}.AdminInfo()`, timeoutMs) || "");
    const p = raw.split("|");
    if (p.length >= 3) {
      return {
        pkg: pkgPath,
        label,
        protocolAddr: p[0] || "",
        pending: Number(p[1]) || 0,
        paid: Number(p[2]) || 0,
        reserved: Number(p[3]) || 0,
        launchCount: Number(p[4]) || 0,
        pointsEnabled: p[5] === "1",
        inited: p[6] === "1" || p.length < 7,
        padAddr: p[7] || "",
      };
    }
  } catch (e) {
    const name = String(e?.name || "");
    const msg = String(e?.message || e || "");
    if (timeoutMs > 0 && (name === "AbortError" || /abort/i.test(msg))) return null;
  }
  try {
    const fi = String(await qeval(RPC, pkgPath, `${pkgPath}.FeeInfo()`, timeoutMs) || "");
    const fp = fi.split("|");
    if (fp.length >= 2) {
      return {
        pkg: pkgPath,
        label,
        protocolAddr: fp[0] || "",
        pending: Number(fp[1]) || 0,
        paid: Number(fp[2]) || 0,
        reserved: 0,
        launchCount: 0,
        pointsEnabled: false,
        inited: true,
        padAddr: "",
      };
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Admin dashboard (platform treasury). Caller must check wallet === protocolAddr
 * or SIGNER_ADDR on the client; this endpoint is public read-only.
 * Market counts come from LaunchInfo only. Trade history and the daily
 * revenue scan are not part of this response.
 */
function paramsFromInfoRaw(raw) {
  const p = String(raw || "").split("|");
  const totalSupply = Number(p[0]);
  const graduation = Number(p[3]);
  if (!Number.isFinite(totalSupply) || !Number.isFinite(graduation)) return null;
  const createBond = Number(p[5]);
  let listFeeGns = Number(p[6]);
  if (!Number.isFinite(listFeeGns) || listFeeGns < 0) listFeeGns = 0;
  const bond = Number.isFinite(createBond) ? createBond : 0;
  return {
    totalSupply,
    curveSupply: Number(p[1]) || 0,
    poolSeed: Number(p[2]) || 0,
    graduation,
    graduationGnot: graduation / UGNOT_PER_GNOT,
    feeBps: Number.isFinite(Number(p[4])) ? Number(p[4]) : 120,
    createBond: bond,
    createBondGnot: bond / UGNOT_PER_GNOT,
    listFeeGns,
    listFeeGnsUnits: listFeeGns / 1e6,
    ugnotPerGnot: UGNOT_PER_GNOT,
  };
}

async function getAdminDashboard(RPC, cfg, hubInfo, padSources, PKG) {
  // Fast path: each call aborted at 9s and ListIDs sliced at 64 (Netlify).
  // Full metrics: 20s, up to 512 ids. Never invent graduation when ParamsInfo fails.
  const full = fullMetrics();
  const stepMs = full ? 20_000 : 9000;
  const idCap = full ? 512 : 64;
  const started = Date.now();
  const warnings = [];
  const feePkgs = [];
  const seen = new Set();
  function addFeePkg(p) {
    if (!p || seen.has(p) || isRetiredPadVersion(p)) return;
    seen.add(p);
    feePkgs.push(p);
  }
  addFeePkg(PKG);
  for (const s of padSources || []) addFeePkg(s.pkg);

  const [paramsResult, idsResult, feeSnapsRaw] = await Promise.all([
    qeval(RPC, PKG, `${PKG}.ParamsInfo()`, stepMs).then(
      (raw) => ({ ok: true, raw }),
      (e) => ({ ok: false, error: String(e.message || e) }),
    ),
    qeval(RPC, PKG, `${PKG}.ListIDs()`, stepMs).then(
      (raw) => ({ ok: true, raw }),
      (e) => ({ ok: false, error: String(e.message || e) }),
    ),
    Promise.all(feePkgs.map((p) => readPadFeeSnapshot(RPC, p, stepMs))),
  ]);
  const params = paramsResult.ok ? paramsFromInfoRaw(paramsResult.raw) : null;
  if (!params) {
    warnings.push(
      paramsResult.ok
        ? "ParamsInfo returned no graduation or supply; those fields were not substituted"
        : `ParamsInfo failed; graduation, supply, and fee bps were not substituted (${paramsResult.error})`,
    );
  }
  if (!idsResult.ok) warnings.push(`ListIDs failed (${idsResult.error})`);
  const feeSnaps = feeSnapsRaw.filter(Boolean);

  const activeSnap =
    feeSnaps.find((s) => s.pkg === PKG) || feeSnaps[0] || null;

  let pending = activeSnap?.pending ?? 0;
  let paid = activeSnap?.paid ?? 0;
  // Aggregate across pads so deploy wallet sees full protocol revenue.
  let pendingAll = 0;
  let paidAll = 0;
  const byPad = feeSnaps
    .map((s) => {
      pendingAll += s.pending || 0;
      paidAll += s.paid || 0;
      return {
        pkg: s.pkg,
        label: s.label,
        active: s.pkg === PKG,
        pending: s.pending,
        pendingGnot: (s.pending || 0) / UGNOT_PER_GNOT,
        paid: s.paid,
        paidGnot: (s.paid || 0) / UGNOT_PER_GNOT,
        total: (s.pending || 0) + (s.paid || 0),
        totalGnot: ((s.pending || 0) + (s.paid || 0)) / UGNOT_PER_GNOT,
        padAddr: s.padAddr || "",
        launchCount: s.launchCount || 0,
      };
    })
    // Hide empty historical packages (no fees and no launches)
    .filter((row) => row.active || row.pending > 0 || row.paid > 0 || row.launchCount > 0)
    .sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
      return (b.pending || 0) - (a.pending || 0);
    });

  const proto = activeSnap?.protocolAddr || "";
  const padAddr = activeSnap?.padAddr || "";
  const padAddrOk = /^g1[a-z0-9]+$/i.test(padAddr);
  const idLines = idsResult.ok
    ? String(idsResult.raw || "")
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  const ids = idLines.slice(0, idCap);
  if (full && idLines.length > idCap) {
    warnings.push(`ListIDs ${idLines.length} exceeds detail cap ${idCap}`);
  }
  const supplyArg = params ? params.totalSupply : null;
  const gradArg = params ? params.graduation : 0;
  const [launchRows, bank, wrapped, gnsBal] = await Promise.all([
    mapPool(ids, 12, async (id) => {
      try {
        const info = await qeval(
          RPC,
          PKG,
          `${PKG}.LaunchInfo(${JSON.stringify(id)})`,
          stepMs,
        );
        const parsed = parseLaunchInfo(String(info), supplyArg, gradArg);
        if (!parsed) return { id, error: "parse_failed" };
        return parsed;
      } catch (e) {
        return { id, error: String(e.message || e).slice(0, 180) };
      }
    }),
    padAddrOk ? bankUgnot(RPC, padAddr, stepMs) : Promise.resolve(0),
    padAddrOk
      ? qeval(
          RPC,
          "gno.land/r/gnoland/wugnot",
          `gno.land/r/gnoland/wugnot.BalanceOf(${JSON.stringify(padAddr)})`,
          stepMs,
        ).catch(() => 0)
      : Promise.resolve(0),
    padAddrOk
      ? qeval(
          RPC,
          "gno.land/r/gnoswap/gns",
          `gno.land/r/gnoswap/gns.BalanceOf(${JSON.stringify(padAddr)})`,
          stepMs,
        ).catch(() => 0)
      : Promise.resolve(0),
  ]);
  const padBankUgnot = Number(bank) || 0;
  const wugnot = Number(wrapped) || 0;
  const gns = Number(gnsBal) || 0;
  const reserved = activeSnap?.reserved ?? 0;
  const freeUgnot = Math.max(0, padBankUgnot - reserved);

  let listed = 0;
  let graduated = 0;
  let curve = 0;
  let totalRaised = 0;
  let totalCreatorFees = 0;
  let marketTotal = 0;
  const detailErrors = [];
  const marketsList = [];
  for (const m of launchRows || []) {
    if (!m || m.error) {
      if (m?.error) detailErrors.push({ id: m.id, error: m.error });
      continue;
    }
    marketTotal += 1;
    if (m.status === 1) graduated += 1;
    else curve += 1;
    if (m.gnoswapListed) listed += 1;
    totalRaised += m.raised || 0;
    totalCreatorFees += m.creatorFees || 0;
    if (full) {
      const row = {
        id: m.id,
        name: m.name,
        symbol: m.symbol,
        status: m.status,
        raisedGnot: Number.isFinite(Number(m.raisedGnot)) ? Number(m.raisedGnot) : null,
        progress: m.progressPct == null ? null : m.progressPct,
        creatorFeesGnot: Number.isFinite(Number(m.creatorFeesGnot))
          ? Number(m.creatorFeesGnot)
          : null,
      };
      if (m.tradeStats && Number.isFinite(Number(m.tradeStats.volumeGnot))) {
        const dex =
          m.dexTradeStats && Number.isFinite(Number(m.dexTradeStats.volumeGnot))
            ? Number(m.dexTradeStats.volumeGnot)
            : 0;
        row.volumeGnot = Number(m.tradeStats.volumeGnot) + dex;
      }
      marketsList.push(row);
    }
  }
  const gradU =
    params && Number.isFinite(Number(params.graduation)) && Number(params.graduation) > 0
      ? Number(params.graduation)
      : null;

  const totalEarned = pending + paid;
  const totalEarnedAll = pendingAll + paidAll;

  return {
    ok: true,
    pkg: PKG,
    signerAddr: cfg.SIGNER_ADDR || DEFAULT_ADDR,
    protocolAddr: proto,
    padAddr,
    inited: activeSnap?.inited ?? !!proto,
    pointsEnabled: !!activeSnap?.pointsEnabled,
    fees: {
      // Active pad (Claim/Push target = current PKG)
      pending,
      pendingGnot: pending / UGNOT_PER_GNOT,
      paid,
      paidGnot: paid / UGNOT_PER_GNOT,
      totalEarned,
      totalEarnedGnot: totalEarned / UGNOT_PER_GNOT,
      // All pads (read-only overview)
      pendingAll,
      pendingAllGnot: pendingAll / UGNOT_PER_GNOT,
      paidAll,
      paidAllGnot: paidAll / UGNOT_PER_GNOT,
      totalEarnedAll,
      totalEarnedAllGnot: totalEarnedAll / UGNOT_PER_GNOT,
      byPad,
      // Trade fee model (for display)
      tradeFeeBps:
        params && Number.isFinite(Number(params.feeBps))
          ? Number(params.feeBps)
          : full
            ? null
            : 120,
      protocolShareBps: 4000, // 40% of fee → protocol. Not a ParamsInfo field.
    },
    capital: {
      padBankUgnot,
      padBankGnot: padBankUgnot / UGNOT_PER_GNOT,
      reservedUgnot: reserved,
      reservedGnot: reserved / UGNOT_PER_GNOT,
      freeUgnot,
      freeGnot: freeUgnot / UGNOT_PER_GNOT,
    },
    markets: {
      total: full ? (idsResult.ok ? idLines.length : null) : marketTotal,
      curve,
      graduated,
      gnoswapListed: listed,
      totalRaised,
      totalRaisedGnot: totalRaised / UGNOT_PER_GNOT,
      totalCreatorFees,
      totalCreatorFeesGnot: totalCreatorFees / UGNOT_PER_GNOT,
      ...(full
        ? { detailed: marketTotal, detailCap: idCap, detailTruncated: idLines.length > idCap }
        : {}),
    },
    ...(full ? { marketsList, ...(detailErrors.length ? { marketErrors: detailErrors } : {}) } : {}),
    ...(warnings.length ? { warnings } : {}),
    ...(full
      ? {
          fullMetrics: true,
          hub: hubInfo?.hub || null,
          padSources: (padSources || []).map((s) => ({
            key: s.key,
            pkg: s.pkg,
            active: !!s.active,
            legacy: !!s.legacy,
          })),
        }
      : {}),
    params: params || null,
    ops: {
      ok: true,
      inventory: {
        pkg: PKG,
        padLabel: String(PKG).split("/").pop(),
        padAddr,
        wugnot,
        wugnotGnot: wugnot / UGNOT_PER_GNOT,
        gns,
        gnsUnits: gns / 1e6,
        bankUgnot: padBankUgnot,
        bankGnot: padBankUgnot / UGNOT_PER_GNOT,
        raiseNeedUgnot: gradU,
        raiseNeedGnot: gradU == null ? null : gradU / UGNOT_PER_GNOT,
        feeGnsNeed: 100_000_000,
        lpReady: gradU == null ? null : wugnot >= gradU,
        feeReady: gns >= 100_000_000,
        listReady: gradU == null ? null : wugnot >= gradU && gns >= 100_000_000,
      },
    },
    actions: {
      claimProtocol: "ClaimProtocolFees",
      pushProtocol: "PushProtocolFees",
      withdrawFree: "WithdrawProtocolUgnot",
      transferProtocol: "TransferProtocol",
      setPoints: "SetPointsEnabled",
    },
    notes: [
      "Protocol fees stay on each pad until Claim (treasury EOA) or Push (anyone → treasury).",
      "Claim/Push only acts on the active pad (hub pad / PKG). Older pads need Claim on that pkg.",
      "Auto-list LP uses raised-sized WUGNOT only; fee needs pre-funded GNS or WUGNOT surplus above raised.",
      "CreatePool fee is fixed ~100 GNS (GNOT cost moves with market). Prefer ≥100 GNS on pad.",
      "WithdrawProtocolUgnot only free balance (above reserved markets/fees).",
    ],
    buildMs: Date.now() - started,
  };
}

const G1_ADDR_RE = /^g1[a-z0-9]{38,}$/i;

/**
 * Season 0 overlay: lifetime pointsv2 board + honest quest stubs.
 * Avoids full getPortfolio (Netlify timeout). Trade/streak quests stay
 * undone until a trader-tagged indexer exists (partial: true).
 */
async function buildSeason0(RPC, POINTS, padSources, address, opts = {}) {
  const networkId = opts.networkId || "sapphire";
  const seasonEnabled = networkId === "sapphire";
  const season = {
    id: "s0",
    name: "Season 0: Curve Camp",
    nameVi: "Season 0: Trại curve",
    network: "sapphire",
    enabled: seasonEnabled,
    startHeight: null,
    endHeight: null,
  };

  const addrOk = address && G1_ADDR_RE.test(address) ? address : "";
  if (address && !addrOk) {
    return {
      season,
      partial: true,
      error: "invalid address",
      params: {},
      pointsPkg: POINTS,
      me: null,
      board: [],
      quests: {},
      partialReasons: ["invalid_address"],
    };
  }

  if (!seasonEnabled) {
    return {
      season,
      partial: true,
      params: {},
      pointsPkg: POINTS,
      me: null,
      board: [],
      quests: {},
      partialReasons: ["sapphire_only"],
      message: "Season 0 runs on Sapphire only",
    };
  }

  let params = {};
  let lifetimePts = 0;
  let referrer = "";
  let board = [];
  const cacheKey = `season0:board:${networkId}`;
  try {
    const cached = cacheGet(cacheKey);
    if (cached?.board && cached?.params) {
      board = cached.board;
      params = cached.params;
    } else {
      const paramsRaw = await qeval(RPC, POINTS, `${POINTS}.ParamsInfo()`);
      const pp = String(paramsRaw).split("|");
      const isV2 = String(pp[pp.length - 1] || "").trim() === "v2" || pp.length >= 12;
      params = {
        referrerBonus: Number(pp[0]) || 50,
        refereeBonus: Number(pp[1]) || 25,
        checkIn: Number(pp[2]) || 5,
        checkInInterval: Number(pp[3]) || 100,
        version: isV2 ? 2 : 1,
        createBonus: isV2 ? Number(pp[4]) || 0 : 0,
        buyBase: isV2 ? Number(pp[5]) || 0 : 0,
        sellBase: isV2 ? Number(pp[6]) || 0 : 0,
        ptsPerGnotBuy: isV2 ? Number(pp[7]) || 0 : 0,
        ptsPerGnotSell: isV2 ? Number(pp[8]) || 0 : 0,
        maxPerHeight: isV2 ? Number(pp[9]) || 0 : 0,
      };
      const lbRaw = await qeval(RPC, POINTS, `${POINTS}.Leaderboard(25)`);
      board = parseLeaderboard(lbRaw).map((row) => ({
        address: row.address,
        // MVP board = lifetime pointsv2 (height window TBA)
        seasonScore: row.points,
        points: row.points,
      }));
      cacheSet(cacheKey, { board, params }, 20_000);
    }
    if (addrOk) {
      const meKey = `season0:me:${networkId}:${addrOk.toLowerCase()}`;
      const meHit = cacheGet(meKey);
      if (meHit && Number.isFinite(meHit.lifetimePts)) {
        lifetimePts = meHit.lifetimePts;
        referrer = meHit.referrer || "";
      } else {
        lifetimePts =
          Number(await qeval(RPC, POINTS, `${POINTS}.GetPoints(${JSON.stringify(addrOk)})`)) ||
          0;
        referrer = String(
          await qeval(RPC, POINTS, `${POINTS}.GetReferrer(${JSON.stringify(addrOk)})`),
        )
          .replace(/^"|"$/g, "")
          .trim();
        cacheSet(meKey, { lifetimePts, referrer }, 15_000);
      }
    }
  } catch (e) {
    return {
      season,
      partial: true,
      error: String(e.message || e),
      params,
      pointsPkg: POINTS,
      me: addrOk
        ? {
            address: addrOk,
            lifetimePts: 0,
            seasonScore: 0,
            rank: 0,
            streak: 0,
            uniqueMarkets: 0,
            quests: {},
            badges: [],
          }
        : null,
      board: [],
      quests: {},
      partialReasons: ["points_rpc_error"],
    };
  }

  // Fast path keeps honest stubs (portfolio scan was a Netlify timeout).
  // Full metrics reads balances. Trade quests stay unverified — no trade-caller log.
  const full = fullMetrics();
  let openBalances = null;
  let portfolioError = null;
  if (full && addrOk) {
    try {
      const port = await getPortfolio(RPC, padSources, "", addrOk);
      const n = Number(port?.memePositions);
      if (!Number.isFinite(n)) throw new Error("portfolio missing memePositions");
      openBalances = n;
    } catch (e) {
      portfolioError = String(e.message || e).slice(0, 180);
    }
  }
  const partial = true;
  const partialReasons = [
    "no_trade_log_indexer",
    "lifetime_board_until_height_window",
    "trade_quests_unverified",
  ];
  if (portfolioError) partialReasons.push("portfolio_read_failed");

  const unverified = { error: "no_trade_log_indexer" };
  const quests = full
    ? {
        wallet_wake: { current: addrOk ? 1 : 0, target: 1, done: !!addrOk },
        first_dip: unverified,
        two_way: unverified,
        first_5_markets: portfolioError ? { error: portfolioError } : unverified,
        check_in: unverified,
        streak_7: unverified,
        set_referrer: {
          current: referrer ? 1 : 0,
          target: 1,
          done: !!referrer,
        },
        curve_native: unverified,
        loop_scribe: unverified,
        adena_clip: unverified,
        lock_artist: unverified,
      }
    : {
        wallet_wake: { current: addrOk ? 1 : 0, target: 1, done: !!addrOk },
        first_dip: { current: 0, target: 1, done: false },
        two_way: { current: 0, target: 1, done: false },
        first_5_markets: { current: 0, target: 5, done: false },
        // Do not infer check-in from lifetime pts (false "Done" in UI).
        check_in: { current: 0, target: 1, done: false },
        streak_7: { current: 0, target: 7, done: false },
        set_referrer: {
          current: referrer ? 1 : 0,
          target: 1,
          done: !!referrer,
        },
        curve_native: { current: 0, target: 10, done: false },
        loop_scribe: { current: 0, target: 1, done: false },
        adena_clip: { current: 0, target: 1, done: false },
        lock_artist: { current: 0, target: 1, done: false },
      };

  // Keep me.seasonScore === board metric (lifetime) until verified quest bonuses ship.
  const seasonScore = lifetimePts;

  let rank = 0;
  if (addrOk && board.length) {
    const idx = board.findIndex(
      (r) => String(r.address || "").toLowerCase() === addrOk.toLowerCase(),
    );
    if (idx >= 0) rank = idx + 1;
  }

  const badges = [];
  if (addrOk) badges.push("curve_camper");
  if (quests.wallet_wake.done) badges.push("adena_awake");
  if (quests.set_referrer.done) badges.push("scout");
  if (rank > 0 && rank <= 20) badges.push("s0_top20");

  return {
    season,
    partial,
    partialReasons,
    params,
    pointsPkg: POINTS,
    me: addrOk
      ? {
          address: addrOk,
          lifetimePts,
          seasonScore,
          rank,
          streak: 0,
          uniqueMarkets: full ? null : 0,
          ...(full ? { openBalances, portfolioError } : {}),
          referrer: referrer || null,
          quests,
          badges,
        }
      : null,
    board,
    quests,
    ...(full ? { fullMetrics: true } : {}),
  };
}

/**
 * Handle /api/* routes (path without host).
 * @param {string} method
 * @param {string} pathname e.g. /api/markets
 * @param {URLSearchParams|Record} query
 * @param {string|null} bodyText
 * @param {Record<string,string>|null} headers
 */
function snapshotHasTradeStats(data) {
  if (!data) return false;
  if (data.tradeStats === true) return true;
  const rows = data.markets;
  if (!Array.isArray(rows) || !rows.length) return false;
  return rows.some((m) => m && m.tradeStats && Number.isFinite(Number(m.tradeStats.volumeGnot)));
}

/**
 * Build markets payload for a network (used by API + local snapshot worker).
 * opts.lite — skip Gnoswap enrich (#1). opts.useSnapshot — prefer fresh snapshot (#3).
 */
export async function buildNetworkMarketsPayload(networkId, opts = {}) {
  const lite = opts.lite !== false; // default lite for snapshot/worker
  const net = normalizeNetworkId(networkId);
  if (opts.useSnapshot && !opts.force) {
    const snap = await readMarketsSnapshot(net);
    if (snapshotFresh(snap) && snap.data) {
      return { ...snap.data, cached: true, snapshot: true, snapshotAgeMs: Date.now() - snap.at };
    }
  }
  const cfg = getConfig(net);
  const hubInfo = await getHubInfo(cfg.RPC, cfg);
  const padSources = listPadSources(hubInfo, cfg);
  // Warm the holder ledger beside the market build. Requests do not wait on it.
  for (const src of padSources) {
    if (src?.pkg) replayPadBalances(src.pkg).catch(() => {});
  }
  const t0 = Date.now();
  const raw = await getMarkets(cfg.RPC, padSources, {
    lite,
    tradeStats: opts.tradeStats !== false,
  });
  const markets = await withUsdPricing(raw);
  const buildMs = Date.now() - t0;
  const payload = {
    ...markets,
    network: net,
    buildMs,
    snapshot: false,
    lite: !!lite,
    tradeStats: opts.tradeStats !== false,
  };
  if (opts.writeSnapshot) {
    await writeMarketsSnapshot(net, payload, buildMs);
  }
  return payload;
}

export async function handleApi(method, pathname, query, bodyText, headers = null) {
  const q =
    query instanceof URLSearchParams
      ? query
      : new URLSearchParams(query || {});
  const hdrs = headers || {};
  const headerNet =
    hdrs["x-gnomi-network"] ||
    hdrs["X-Gnomi-Network"] ||
    hdrs["x-network"] ||
    "";
  const networkId = normalizeNetworkId(
    q.get("network") || q.get("chain") || headerNet || DEFAULT_NETWORK_ID,
  );
  const cfg = getConfig(networkId);
  const { RPC, CHAIN_ID, SIGNER_ADDR } = cfg;
  const noCache =
    q.get("refresh") === "1" ||
    q.get("nocache") === "1" ||
    String(q.get("_") || "") === "1";

  if (method === "OPTIONS") {
    return json(204, "");
  }

  // normalize path
  let p = pathname || "/";
  if (!p.startsWith("/")) p = "/" + p;
  // strip function prefix if present
  p = p.replace(/^\/\.netlify\/functions\/api/, "");
  if (!p.startsWith("/api")) {
    if (p === "/" || p === "") p = "/api/health";
    else p = "/api" + (p.startsWith("/") ? p : "/" + p);
  }

  // ── X OAuth (Ambassador verify) ───────────────────────────────────────
  if (method === "GET" && (p === "/api/auth/x/start" || p === "/api/auth/x/start/")) {
    if (!xOAuthConfigured()) {
      return json(503, {
        error: "x_oauth_not_configured",
        hint: "Set X_CLIENT_ID, X_CLIENT_SECRET, X_REDIRECT_URI on Netlify",
      });
    }
    const { clientId, redirectUri, scopes } = xOAuthConfig();
    const { verifier, challenge, state } = createPkcePair();
    const url = buildAuthorizeUrl({
      clientId,
      redirectUri,
      scopes,
      state,
      challenge,
    });
    const cookies = xOauthPendingCookies(state, verifier);
    return {
      statusCode: 302,
      headers: {
        Location: url,
        "Cache-Control": "no-store",
      },
      multiValueHeaders: {
        "Set-Cookie": cookies,
      },
      body: "",
    };
  }

  if (method === "GET" && (p === "/api/auth/x/callback" || p === "/api/auth/x/callback/")) {
    const site = "https://gnomi.fun";
    const fail = (msg) =>
      redirectResponse(
        `${site}/ambassadors?tab=apply&x_error=${encodeURIComponent(msg || "oauth_failed")}`,
        {},
        clearXOauthPendingCookies(),
      );
    try {
      if (!xOAuthConfigured()) return fail("not_configured");
      const err = q.get("error");
      if (err) return fail(String(err));
      const code = q.get("code");
      const state = q.get("state");
      if (!code || !state) return fail("missing_code");
      const cookies = parseCookieHeader(hdrs.cookie || hdrs.Cookie || "");
      if (!cookies.gnomi_x_oauth_state || cookies.gnomi_x_oauth_state !== String(state)) {
        return fail("invalid_state");
      }
      const verifier = cookies.gnomi_x_oauth_verifier;
      if (!verifier) return fail("missing_verifier");
      const { clientId, clientSecret, redirectUri } = xOAuthConfig();
      const token = await exchangeCodeForToken({
        clientId,
        clientSecret,
        redirectUri,
        code: String(code),
        verifier,
      });
      const me = await fetchXUserMe(token.access_token);
      const sess = createXSession(me);
      return {
        statusCode: 302,
        headers: {
          Location: `${site}/ambassadors?tab=apply&x_ok=1`,
          "Cache-Control": "no-store",
        },
        multiValueHeaders: {
          "Set-Cookie": [xSessionCookie(sess), ...clearXOauthPendingCookies()],
        },
        body: "",
      };
    } catch (e) {
      return fail(String(e.message || e).slice(0, 120));
    }
  }

  if (method === "GET" && (p === "/api/auth/x/me" || p === "/api/auth/x/me/")) {
    const cookies = parseCookieHeader(hdrs.cookie || hdrs.Cookie || "");
    const sess = getXSession(cookies.gnomi_x_sess);
    if (!sess) return json(200, { connected: false });
    return json(200, {
      connected: true,
      xUserId: sess.xUserId,
      username: sess.username,
      name: sess.name,
    });
  }

  if (method === "POST" && (p === "/api/auth/x/logout" || p === "/api/auth/x/logout/")) {
    const cookies = parseCookieHeader(hdrs.cookie || hdrs.Cookie || "");
    if (cookies.gnomi_x_sess) clearXSession(cookies.gnomi_x_sess);
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Set-Cookie": clearXSessionCookie(),
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({ ok: true }),
    };
  }

  // Network catalog (no RPC required)
  if (method === "GET" && (p === "/api/networks" || p === "/api/networks/")) {
    return json(
      200,
      {
        ok: true,
        defaultNetwork: DEFAULT_NETWORK_ID,
        selected: networkId,
        networks: listNetworks(),
        gnoswapPresent: false, // updated after mainnet Gnoswap deploy
      },
      { maxAge: 60 },
    );
  }

  // Badge catalog works even when pad is not deployed yet.
  if (
    method === "GET" &&
    (p === "/api/badges" || p === "/api/badges/") &&
    !(q.get("address") || "").trim()
  ) {
    return json(
      200,
      { ok: true, catalog: listCatalogPublic(), wearLimit: WEAR_LIMIT },
      { maxAge: 120 },
    );
  }

  // List venues — offline fallback so Create DEX picker works before pad deploy.
  if (method === "GET" && (p === "/api/list-venues" || p === "/api/list-venues/")) {
    if (!cfg.padReady || !cfg.PKG) {
      return json(200, listVenuesFallback(networkId, cfg.PKG || null), {
        maxAge: 30,
      });
    }
    // pad ready → fall through to live handler below
  }

  // Chain live but pad not deployed yet — allow /api/health RPC probe only.
  if (cfg.comingSoon || !cfg.enabled || !cfg.RPC) {
    return json(503, {
      ok: false,
      error: `${cfg.label || networkId} is not available yet`,
      network: networkId,
      comingSoon: true,
    });
  }

  if (!cfg.padReady || !cfg.PKG) {
    if (method === "GET" && p === "/api/health") {
      const hKey = `health:pending:${networkId}:${cfg.RPC}`;
      if (!noCache) {
        const hit = cacheGet(hKey);
        if (hit) {
          return json(200, { ...hit, cached: true }, {
            maxAge: 20,
            cacheTag: `health-${networkId}`,
          });
        }
      }
      try {
        const st = await rpc(cfg.RPC, "status", {});
        let fx = { gnotUsd: 0, source: "none", updatedAt: null };
        try {
          fx = await fetchGnoswapFx();
        } catch {
          /* health stays ok without FX */
        }
        const body = {
          ok: true,
          network: networkId,
          networkLabel: cfg.label,
          rpc: cfg.RPC,
          pkg: cfg.PKG || null,
          hub: cfg.HUB || null,
          profile: cfg.PROFILE || null,
          meta: cfg.META || null,
          points: cfg.POINTS || null,
          bond: cfg.BOND || null,
          modules: {},
          pads: [],
          networks: listNetworks(),
          height: String(st?.sync_info?.latest_block_height || ""),
          chainId: st?.node_info?.network || cfg.CHAIN_ID,
          gnoweb: cfg.GNOWEB || null,
          faucet: cfg.FAUCET || null,
          hosting: "netlify",
          signing: false,
          padReady: false,
          padPending: true,
          hint: "Mainnet RPC is live. Pad realms not deployed yet — awaiting human yes deploy.",
          gnotUsd: Number(fx?.gnotUsd) > 0 ? Number(fx.gnotUsd) : 0,
          fxSource: fx?.source || "none",
          fxUpdatedAt: fx?.updatedAt || null,
        };
        cacheSet(hKey, body, 20_000);
        return json(200, body, { maxAge: 20, cacheTag: `health-${networkId}` });
      } catch (e) {
        return json(503, {
          ok: false,
          network: networkId,
          padReady: false,
          padPending: true,
          error: String(e.message || e),
        });
      }
    }
    return json(503, {
      ok: false,
      error: "pad_pending_deploy",
      hint: `${cfg.label} chain is up; gnomemepad packages not live yet`,
      network: networkId,
      chainId: cfg.CHAIN_ID,
      rpc: cfg.RPC,
      intendedPkg: cfg.PKG || null,
      intendedHub: cfg.HUB || null,
      padReady: false,
      padPending: true,
    });
  }

  if (method === "GET" && p === "/api/admin") {
    if (q.get("ping") === "1") {
      return json(200, { ok: true, ping: "admin-slim-4" });
    }
    const adminPkg = cfg.PKG;
    const aKey = `admin:${adminPkg}`;
    if (!noCache) {
      const hit = cacheGet(aKey);
      if (hit) return json(200, { ...hit, cached: true }, { maxAge: 30 });
    }
    try {
      let hubForAdmin = null;
      let sourcesForAdmin = null;
      if (fullMetrics()) {
        hubForAdmin = await getHubInfo(RPC, cfg);
        sourcesForAdmin = listPadSources(hubForAdmin, cfg);
      }
      const admin = await getAdminDashboard(
        RPC,
        cfg,
        hubForAdmin,
        sourcesForAdmin,
        adminPkg,
      );
      cacheSet(aKey, admin, 60_000);
      return json(200, admin, { maxAge: 30 });
    } catch (e) {
      return json(200, {
        ok: false,
        error: String(e.message || e),
        pkg: adminPkg,
      });
    }
  }

  // Resolve active pad from hub (modular upgrades) — cached per network
  const hubCacheKey = `hub:${networkId}:${cfg.HUB || "none"}`;
  let hubInfo = !noCache ? cacheGet(hubCacheKey) : null;
  if (!hubInfo) {
    hubInfo = await getHubInfo(RPC, cfg);
    cacheSet(hubCacheKey, hubInfo, 30_000);
  }
  const PKG = hubInfo.pad || cfg.PKG;
  const PROFILE = hubInfo.profile || cfg.PROFILE;
  const META = hubInfo.meta || cfg.META;
  const POINTS = hubInfo.points || cfg.POINTS;
  const padSources = listPadSources(hubInfo, cfg);

  try {
    if (method === "GET" && p === "/api/health") {
      const hKey = `health:${networkId}:${PKG || "none"}`;
      if (!noCache) {
        const hit = cacheGet(hKey);
        if (hit) {
          return json(200, { ...hit, cached: true }, {
            maxAge: 20,
            cacheTag: `health-${networkId}`,
          });
        }
      }
      try {
        const st = await rpc(RPC, "status", {});
        // dualDexPad: PreferredVenueOf present (venue-aware Create fee / SetPreferredVenue).
        // Probe id "0" panics "pad: unknown launch" — that means the selector EXISTS.
        // Only treat VM "name … not declared" / undeclared as missing.
        let dualDexPad = false;
        if (PKG) {
          try {
            await qeval(RPC, PKG, `${PKG}.PreferredVenueOf("0")`);
            dualDexPad = true;
          } catch (e) {
            const msg = String(e?.message || e || "");
            if (/\bpad:\s/i.test(msg) || /unknown launch/i.test(msg)) {
              dualDexPad = true;
            } else {
              dualDexPad = !/undeclared|Name Error|name \w+ not declared|does not exist|no such (function|method|name)|unknown selector/i.test(
                msg,
              );
            }
          }
        }
        let fx = { gnotUsd: 0, source: "none", updatedAt: null };
        try {
          fx = await fetchGnoswapFx();
        } catch {
          /* health stays ok without FX */
        }
        const body = {
          ok: true,
          network: networkId,
          networkLabel: cfg.label,
          rpc: RPC,
          pkg: PKG,
          hub: hubInfo.hub,
          profile: PROFILE,
          meta: META,
          points: POINTS,
          bond: cfg.BOND || null,
          modules: hubInfo.modules || {},
          pads: padSources.map((s) => ({
            key: s.key,
            pkg: s.pkg,
            active: s.active,
            legacy: s.legacy,
            label: String(s.pkg).split("/").pop(),
          })),
          networks: listNetworks(),
          height: String(st?.sync_info?.latest_block_height || ""),
          chainId: st?.node_info?.network || CHAIN_ID,
          gnoweb: cfg.GNOWEB || null,
          faucet: cfg.FAUCET || null,
          hosting: "netlify",
          signing: false,
          padReady: true,
          dualDexPad,
          gnotUsd: Number(fx?.gnotUsd) > 0 ? Number(fx.gnotUsd) : 0,
          fxSource: fx?.source || "none",
          fxUpdatedAt: fx?.updatedAt || null,
        };
        cacheSet(hKey, body, 20_000);
        return json(200, body, { maxAge: 20, cacheTag: `health-${networkId}` });
      } catch (e) {
        return json(200, {
          ok: false,
          error: String(e.message || e),
          network: networkId,
          rpc: RPC,
          pkg: PKG,
          hub: hubInfo.hub,
          chainId: CHAIN_ID,
          hosting: "netlify",
          signing: false,
        });
      }
    }

    if (method === "GET" && p === "/api/modules") {
      return json(200, {
        hub: hubInfo.hub,
        modules: hubInfo.modules || {},
        pad: PKG,
        profile: PROFILE,
        meta: META,
        points: POINTS,
        pads: padSources,
        hubError: hubInfo.hubError || null,
      });
    }

    if (method === "GET" && p === "/api/activity") {
      const limit = Number(q.get("limit") || 40);
      const aKey = `activity:${padSources.map((s) => s.pkg).join(",")}:${limit}`;
      if (!noCache) {
        const hit = cacheGet(aKey);
        if (hit) return json(200, { ...hit, cached: true }, { maxAge: 20 });
      }
      let preloaded = null;
      if (!noCache) {
        const snap = await readMarketsSnapshot(networkId);
        if (snapshotUsable(snap) && Array.isArray(snap.data?.markets)) {
          preloaded = snap.data.markets;
        }
      }
      const act = await getActivity(RPC, padSources, limit, preloaded);
      cacheSet(aKey, act, 20_000);
      return json(200, act, { maxAge: 20, cacheTag: `activity-${networkId}` });
    }

    if (method === "GET" && p === "/api/leaderboard") {
      const lbKey = `leaderboard:${padSources.map((s) => s.pkg).join(",")}`;
      if (!noCache) {
        const hit = cacheGet(lbKey);
        if (hit) return json(200, { ...hit, cached: true }, { maxAge: 30 });
      }
      const board = await getMemepadLeaderboard(RPC, padSources, POINTS);
      cacheSet(lbKey, board, 45_000);
      return json(200, board, { maxAge: 30 });
    }

    if (method === "GET" && p === "/api/ops") {
      const oKey = `ops:${hubInfo.hub || ""}:${padSources.map((s) => s.pkg).join(",")}`;
      if (!noCache) {
        const hit = cacheGet(oKey);
        if (hit) return json(200, { ...hit, cached: true }, { maxAge: 20 });
      }
      const ops = await getOps(RPC, cfg, hubInfo, padSources);
      cacheSet(oKey, ops, 25_000);
      return json(200, ops, { maxAge: 20 });
    }

    // Gnoswap list funding wizard: ListNeed(id) → poolU|wHave|wNeed|gnsHave|gnsNeed|feeGns|feeWugnotBudget|padAddr
    // Auto-list uses temp wrap (EOA Deposit) + pad ugnot reimburses LP after success.
    // Pad WUGNOT free float (for push-pay Buy preflight): free|have|reserved
    if (method === "GET" && p === "/api/pad-wugnot") {
      let padPkg = String(q.get("pkg") || PKG || "").trim();
      if (!padPkg.startsWith("gno.land/")) padPkg = PKG;
      const WUGNOT = "gno.land/r/gnoland/wugnot";
      let padAddr = "";
      try {
        padAddr = String(await qeval(RPC, padPkg, `${padPkg}.PadAddress()`) || "").replace(
          /^"|"$/g,
          "",
        );
      } catch {
        /* ignore */
      }
      let have = 0;
      if (padAddr && /^g1[a-z0-9]+$/i.test(padAddr)) {
        try {
          have =
            Number(
              await qeval(RPC, WUGNOT, `${WUGNOT}.BalanceOf(${JSON.stringify(padAddr)})`),
            ) || 0;
        } catch {
          /* ignore */
        }
      }
      let free = null;
      let reserved = null;
      let source = "estimate";
      try {
        const raw = String(await qeval(RPC, padPkg, `${padPkg}.FreeWugnot()`) || "").replace(
          /^"|"$/g,
          "",
        );
        const parts = raw.split("|");
        if (parts.length >= 3) {
          // Keep free as reported (clamped ≥0 on-chain). Also expose raw gap.
          free = Number(parts[0]);
          if (!Number.isFinite(free)) free = 0;
          have = Number(parts[1]) || have;
          reserved = Number(parts[2]) || 0;
          source = "FreeWugnot";
        }
      } catch {
        // padv15 early: estimate reserved = sum raised+fees from markets if needed
        reserved = null;
        free = null;
      }
      const resN = reserved != null ? Number(reserved) : null;
      const trueFree =
        resN != null && Number.isFinite(resN) ? have - resN : free != null ? free : null;
      const deficit =
        trueFree != null && trueFree < 0 ? Math.abs(trueFree) : 0;
      return json(200, {
        pkg: padPkg,
        padAddr,
        have,
        free: free != null ? free : trueFree != null ? Math.max(0, trueFree) : null,
        reserved: resN,
        trueFree,
        deficit,
        source,
        haveGnot: have / UGNOT_PER_GNOT,
        freeGnot: free != null ? free / UGNOT_PER_GNOT : null,
        trueFreeGnot: trueFree != null ? trueFree / UGNOT_PER_GNOT : null,
        deficitGnot: deficit / UGNOT_PER_GNOT,
      });
    }

    // Create preflight (padv20+): bond ugnot + GNS list fee + free GNS on pad + padAddr
    // ?venue=zdex|gnoswap → ListFeeRequiredFor when dual-DEX SOURCE cut is live
    if (method === "GET" && p === "/api/create-need") {
      let padPkg = String(q.get("pkg") || PKG || "").trim();
      if (!padPkg.startsWith("gno.land/")) padPkg = PKG;
      const venueQ = String(q.get("venue") || "")
        .trim()
        .toLowerCase();
      const params = await getParams(RPC, padPkg);
      if (!params) {
        return json(200, {
          pkg: padPkg,
          params: null,
          warning: "ParamsInfo failed; graduation, fee bps, and supply were not substituted",
          ...(fullMetrics() ? { fullMetrics: true } : {}),
        });
      }
      let padAddr = "";
      try {
        padAddr = String(await qeval(RPC, padPkg, `${padPkg}.PadAddress()`) || "").replace(
          /^"|"$/g,
          "",
        );
      } catch {
        /* ignore */
      }
      let listFeeGns = Number(params.listFeeGns) || 0;
      let feeVenue = "";
      if (venueQ) {
        try {
          const lf = Number(
            await qeval(
              RPC,
              padPkg,
              `${padPkg}.ListFeeRequiredFor(${JSON.stringify(venueQ)})`,
            ),
          );
          if (Number.isFinite(lf) && lf >= 0) {
            listFeeGns = lf;
            feeVenue = venueQ;
          }
        } catch {
          /* older pad — fall through to ListFeeRequired */
        }
      }
      if (!feeVenue) {
        try {
          const lf = Number(await qeval(RPC, padPkg, `${padPkg}.ListFeeRequired()`));
          if (Number.isFinite(lf) && lf > 0) listFeeGns = lf;
        } catch {
          /* older pad */
        }
      }
      let freeGns = null;
      let haveGns = null;
      let reservedGns = null;
      try {
        const raw = String(await qeval(RPC, padPkg, `${padPkg}.FreeGns()`) || "").replace(
          /^"|"$/g,
          "",
        );
        const parts = raw.split("|");
        if (parts.length >= 3) {
          freeGns = Number(parts[0]) || 0;
          haveGns = Number(parts[1]) || 0;
          reservedGns = Number(parts[2]) || 0;
        }
      } catch {
        /* padv19 and older */
      }
      if (haveGns == null && padAddr) {
        try {
          haveGns =
            Number(
              await qeval(
                RPC,
                "gno.land/r/gnoswap/gns",
                `gno.land/r/gnoswap/gns.BalanceOf(${JSON.stringify(padAddr)})`,
              ),
            ) || 0;
          freeGns = haveGns;
          reservedGns = 0;
        } catch {
          haveGns = 0;
          freeGns = 0;
        }
      }
      const bondUgnot = Number(params.createBond) || 0;
      const gnsShort = Math.max(0, listFeeGns - (Number(freeGns) || 0));
      return json(200, {
        pkg: padPkg,
        padAddr,
        bondUgnot,
        bondGnot: bondUgnot / UGNOT_PER_GNOT,
        listFeeGns,
        listFeeGnsUnits: listFeeGns / 1e6,
        feeVenue: feeVenue || null,
        freeGns: freeGns != null ? freeGns : 0,
        freeGnsUnits: (Number(freeGns) || 0) / 1e6,
        haveGns: haveGns != null ? haveGns : 0,
        reservedGns: reservedGns != null ? reservedGns : 0,
        gnsShort,
        gnsShortUnits: gnsShort / 1e6,
        gnsReady: listFeeGns <= 0 || gnsShort <= 0,
        gnsPkg: "gno.land/r/gnoswap/gns",
        graduationGnot: params.graduationGnot,
      });
    }

    if (method === "GET" && (p === "/api/list-venues" || p === "/api/list-venues/")) {
      let padPkg = String(q.get("pkg") || PKG || "").trim();
      if (!padPkg.startsWith("gno.land/")) padPkg = PKG;
      const venuesFallback = listVenuesFallback(networkId, padPkg || null);
      /**
       * Probe upcoming dual-DEX pad APIs (protocol cut in parallel).
       * Missing selector → false; launch-not-found / other panic → function exists.
       */
      async function probePadFn(fn, expr) {
        try {
          await qeval(RPC, padPkg, expr, 6000);
          return true;
        } catch (e) {
          const msg = String(e?.message || e || "");
          if (e?.name === "AbortError" || /abort/i.test(msg)) return false;
          // Realm panics ("pad: unknown launch", must be EOA, …) ⇒ selector exists.
          if (/\bpad:\s/i.test(msg) || /unknown launch/i.test(msg)) {
            return true;
          }
          // Only VM missing-symbol errors ⇒ false.
          if (
            /undeclared|Name Error|name \w+ not declared|does not exist|no such (function|method|name)|unknown selector/i.test(
              msg,
            )
          ) {
            return false;
          }
          // Other runtime errors still mean the symbol exists.
          return true;
        }
      }
      async function probeDualDexFlags() {
        const [
          hasPreferredVenue,
          hasReleaseListSeed,
          hasConfirmZdexList,
          hasListSeedReleasedOf,
        ] = await Promise.all([
          probePadFn("PreferredVenueOf", `${padPkg}.PreferredVenueOf("0")`),
          probePadFn("ReleaseListSeed", `${padPkg}.ReleaseListSeed("0")`),
          probePadFn("ConfirmZdexList", `${padPkg}.ConfirmZdexList("0","ugnot|X")`),
          probePadFn("ListSeedReleasedOf", `${padPkg}.ListSeedReleasedOf("0")`),
        ]);
        // PreferredVenue cut (= CreateWithVenue in SOURCE) ⇒ venue-aware Create fee.
        // Release/Confirm/ListSeedReleasedOf may ship same cut — UI stubs try/catch.
        return {
          dualDexPad: !!hasPreferredVenue,
          hasPreferredVenue,
          hasReleaseListSeed,
          hasConfirmZdexList,
          hasListSeedReleasedOf,
          funcs: {
            PreferredVenueOf: hasPreferredVenue,
            SetPreferredVenue: hasPreferredVenue,
            CreateWithVenue: hasPreferredVenue,
            ReleaseListSeed: hasReleaseListSeed,
            ConfirmZdexList: hasConfirmZdexList,
            ListSeedReleasedOf: hasListSeedReleasedOf,
          },
        };
      }
      // Pearl: expose EOA CreatePool zdex (padv23 has no VenueZdex adapter).
      function withPearlZdexGap(venues, defaultVenue, dual = {}) {
        const list = Array.isArray(venues) ? venues.slice() : [];
        const dualReady = dual.dualDexPad === true || dual.hasPreferredVenue === true;
        const pearlZdex = {
          id: "zdex",
          label: "zdex",
          enabled: networkId === "pearl" || dualReady,
          feeAssetHint: "ugnot",
          note: dualReady
            ? "EOA CreatePool on g1n4pl5…/zdex/v3 after ReleaseListSeed · ConfirmZdexList"
            : networkId === "pearl"
              ? "EOA CreatePool on g1n4pl5…/zdex/v3 (AMM …/amm/v1) — padv23 has no VenueZdex; wallet must hold PoolUgnot+PoolToken"
              : "Not wired on this pad — EOA zdex CreatePool if hub is up",
          uiGap: !dualReady,
          eoaList: true,
        };
        const zi = list.findIndex((v) => String(v.id).toLowerCase() === "zdex");
        if (networkId === "pearl" || networkId === "sapphire" || dualReady) {
          if (zi < 0) list.push(pearlZdex);
          else {
            const onChainZdex = list[zi].onChain === true && list[zi].enabled === true;
            list[zi] = {
              ...list[zi],
              ...pearlZdex,
              onChain: list[zi].onChain,
              // On-chain VenueZdex registration clears uiGap even if Release not probed yet
              uiGap: dualReady || onChainZdex ? false : pearlZdex.uiGap,
              enabled:
                networkId === "pearl" || dualReady || onChainZdex
                  ? true
                  : list[zi].enabled === true
                    ? true
                    : false,
            };
          }
        }
        const chainDefault =
          networkId === "pearl" || networkId === "sapphire" ? "gnoswap" : "zdex";
        return {
          venues: list,
          defaultVenue: defaultVenue || chainDefault,
        };
      }
      if (!cfg.padReady || !padPkg) {
        return json(
          200,
          {
            ...venuesFallback,
            dualDexPad: false,
            hasPreferredVenue: false,
            hasReleaseListSeed: false,
            hasConfirmZdexList: false,
            hasListSeedReleasedOf: false,
          },
          { maxAge: 30 },
        );
      }
      const chainDefaultHint =
        networkId === "pearl" || networkId === "sapphire" ? "gnoswap" : "zdex";
      try {
        const raw = String(await qeval(RPC, padPkg, `${padPkg}.ListVenues()`) || "");
        const chainDefault = String(
          await qeval(RPC, padPkg, `${padPkg}.DefaultListVenue()`).catch(
            () => chainDefaultHint,
          ),
        )
          .replace(/^"|"$/g, "")
          .trim() || chainDefaultHint;
        const chainVenues = String(raw)
          .replace(/^"|"$/g, "")
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => {
            const [id, label, en, feeHint] = line.split("|");
            return {
              id: id || "",
              label: label || id || "",
              enabled: en === "1",
              feeAssetHint: feeHint || "",
              onChain: true,
            };
          })
          .filter((v) => v.id);
        const dualFlags = await probeDualDexFlags();
        const enriched = withPearlZdexGap(chainVenues, chainDefault, dualFlags);
        const zdexHub =
          networkId === "local"
            ? "gno.land/r/zdex/v2"
            : networkId === "pearl"
              ? "gno.land/r/g1n4pl5uc4yt5r96m9w6fmdznx3x0jyg8l6arhmt/zdex/v3"
              : networkId === "mainnet"
                ? "gno.land/r/g1n4pl5uc4yt5r96m9w6fmdznx3x0jyg8l6arhmt/zdex/v1"
                : null;
        const zdexAmm =
          networkId === "local"
            ? "gno.land/p/zdex/amm/v1"
            : networkId === "pearl" || networkId === "mainnet"
              ? "gno.land/p/g1n4pl5uc4yt5r96m9w6fmdznx3x0jyg8l6arhmt/zdex/amm/v1"
              : null;
        let zdexRealmAddr = null;
        if (zdexHub) {
          try {
            zdexRealmAddr = String(await qeval(RPC, zdexHub, `${zdexHub}.RealmAddr()`) || "")
              .replace(/^"|"$/g, "")
              .replace(/^\(/, "")
              .split(/\s|\./)[0]
              .trim();
            if (!/^g1[a-z0-9]+$/i.test(zdexRealmAddr || "")) zdexRealmAddr = null;
          } catch {
            zdexRealmAddr = null;
          }
        }
        // Pearl hub g1n4pl5…/zdex/v3 — known RealmAddr if qeval parse fails
        if (!zdexRealmAddr && networkId === "pearl") {
          zdexRealmAddr = "g1dme66padjqu5smytfcl2lq0ame7zymducpdrdu";
        }
        // Local gnodev zdex/v2 RealmAddr — fallback if qeval parse fails
        if (!zdexRealmAddr && networkId === "local") {
          zdexRealmAddr = "g1kz50j3x9jepk55unw8rrehxmcddpys48xpcj92";
        }
        return json(
          200,
          {
            ok: true,
            pkg: padPkg,
            network: networkId,
            raw: String(raw).replace(/^"|"$/g, ""),
            chainDefault,
            ...enriched,
            ...dualFlags,
            zdexHub,
            zdexAmm,
            zdexRealmAddr,
          },
          { maxAge: 30 },
        );
      } catch (e) {
        return json(200, {
          ...venuesFallback,
          dualDexPad: false,
          hasPreferredVenue: false,
          hasReleaseListSeed: false,
          hasConfirmZdexList: false,
          hasListSeedReleasedOf: false,
          legacy: true,
          error: String(e.message || e),
        });
      }
    }

    if (method === "GET" && p === "/api/list-need") {
      const id = String(q.get("id") || "").trim();
      if (!id) return json(400, { error: "id required" });
      let padPkg = String(q.get("pkg") || PKG || "").trim();
      if (!padPkg.startsWith("gno.land/")) padPkg = PKG;
      const venue = String(q.get("venue") || "gnoswap").trim().toLowerCase() || "gnoswap";
      try {
        let raw = "";
        try {
          raw = String(
            await qeval(
              RPC,
              padPkg,
              `${padPkg}.ListNeedFor(${JSON.stringify(id)},${JSON.stringify(venue)})`,
            ) || "",
          );
        } catch {
          raw = String(await qeval(RPC, padPkg, `${padPkg}.ListNeed(${JSON.stringify(id)})`) || "");
        }
        const parts = raw.replace(/^"|"$/g, "").split("|");
        const poolU = Number(parts[0]) || 0;
        const wHave = Number(parts[1]) || 0;
        const wNeedLp = Number(parts[2]) || 0;
        const gnsHave = Number(parts[3]) || 0;
        const gnsNeed = Number(parts[4]) || 0;
        const feeGns = Number(parts[5]) || 100_000_000;
        let feeWugnotBudget = Number(parts[6]) || 0;
        // Cap reported fee budget for UI (live padv13 may still return 5e9)
        const FEE_WRAP_CAP = 1_500_000_000;
        if (gnsNeed > 0 && feeWugnotBudget > FEE_WRAP_CAP) {
          feeWugnotBudget = FEE_WRAP_CAP;
        }
        if (gnsNeed <= 0) feeWugnotBudget = 0;
        const padAddr = String(parts[7] || "").trim();
        // Prefer GNS fee when possible: wrap only LP shortfall
        const wrapLpOnly = wNeedLp;
        const wrapWithFeeBudget = wNeedLp + feeWugnotBudget;
        let padUgnot = 0;
        if (padAddr && /^g1[a-z0-9]+$/i.test(padAddr)) {
          try {
            const balRaw = await rpc(RPC, "abci_query", {
              path: `bank/balances/${padAddr}`,
              data: "",
              height: "0",
              prove: false,
            });
            const coins = b64utf8(balRaw?.response?.ResponseBase?.Data || balRaw?.response?.value || "");
            const m = String(coins).match(/(\d+)ugnot/);
            if (m) padUgnot = Number(m[1]) || 0;
          } catch {
            /* optional */
          }
        }
        const reimburseOk = padUgnot >= wNeedLp && wNeedLp > 0;
        // Optional wallet balances for preflight (address=)
        const walletAddr = String(q.get("address") || "").trim();
        let walletUgnot = null;
        let walletGns = null;
        let walletWugnot = null;
        if (walletAddr && /^g1[a-z0-9]+$/i.test(walletAddr)) {
          try {
            const balRaw = await rpc(RPC, "abci_query", {
              path: `bank/balances/${walletAddr}`,
              data: "",
              height: "0",
              prove: false,
            });
            const coins = b64utf8(balRaw?.response?.ResponseBase?.Data || balRaw?.response?.value || "");
            const m = String(coins).match(/(\d+)ugnot/);
            if (m) walletUgnot = Number(m[1]) || 0;
          } catch {
            /* optional */
          }
          try {
            walletGns = Number(
              await qeval(RPC, "gno.land/r/gnoswap/gns", `gno.land/r/gnoswap/gns.BalanceOf(${JSON.stringify(walletAddr)})`),
            );
          } catch {
            walletGns = null;
          }
          try {
            walletWugnot = Number(
              await qeval(
                RPC,
                "gno.land/r/gnoland/wugnot",
                `gno.land/r/gnoland/wugnot.BalanceOf(${JSON.stringify(walletAddr)})`,
              ),
            );
          } catch {
            walletWugnot = null;
          }
        }
        // If wallet already has GNS for fee, recommended wrap is LP-only
        const walletHasGnsFee = walletGns != null && walletGns >= gnsNeed && gnsNeed > 0;
        const recommendedWrap = walletHasGnsFee ? wrapLpOnly : wrapWithFeeBudget;
        return json(
          200,
          {
            ok: true,
            id,
            pkg: padPkg,
            poolU,
            poolGnot: poolU / UGNOT_PER_GNOT,
            wHave,
            wNeedLp,
            wNeedLpGnot: wNeedLp / UGNOT_PER_GNOT,
            gnsHave,
            gnsNeed,
            feeGns,
            feeGnsUnits: feeGns / 1e6,
            feeWugnotBudget,
            feeWugnotBudgetGnot: feeWugnotBudget / UGNOT_PER_GNOT,
            wrapUgnot: recommendedWrap,
            wrapLpOnlyUgnot: wrapLpOnly,
            wrapWithFeeUgnot: wrapWithFeeBudget,
            wrapGnot: recommendedWrap / UGNOT_PER_GNOT,
            wrapLpOnlyGnot: wrapLpOnly / UGNOT_PER_GNOT,
            padAddr,
            padUgnot,
            padUgnotGnot: padUgnot / UGNOT_PER_GNOT,
            reimburseOk,
            walletUgnot,
            walletGns,
            walletWugnot,
            walletHasGnsFee,
            // LP wrap is temporary loan; pad pays back ugnot after list
            autoListHint:
              "Wrap is temporary (LP reimbursed from pad ugnot). Prefer ~100 GNS in wallet to avoid large fee WUGNOT budget. Deposit is EOA-only.",
            wugnotPkg: "gno.land/r/gnoland/wugnot",
            gnsPkg: "gno.land/r/gnoswap/gns",
            venue,
            ready: wNeedLp <= 0 && gnsNeed <= 0,
            raw,
          },
          { maxAge: 8 },
        );
      } catch (e) {
        return json(200, {
          ok: false,
          id,
          pkg: padPkg,
          venue,
          error: String(e.message || e),
          // Pre-padv13: no ListNeed — UI falls back to manual RetryList
          legacy: true,
        });
      }
    }

    if (method === "GET" && p === "/api/bond") {
      const bondPkg =
        (hubInfo.modules && hubInfo.modules.bond) ||
        cfg.BOND ||
        `gno.land/r/${DEFAULT_ADDR}/gnomemepad/bond`;
      try {
        const raw = String(await qeval(RPC, bondPkg, `${bondPkg}.BondInfo()`) || "").replace(
          /^"|"$/g,
          "",
        );
        const parts = raw.split("|");
        // status|current|normal|promo|endsAt|left|admin
        return json(200, {
          pkg: bondPkg,
          status: Number(parts[0]) || 0,
          statusLabel: Number(parts[0]) === 1 ? "promo" : "normal",
          currentUgnot: Number(parts[1]) || 0,
          currentGnot: (Number(parts[1]) || 0) / UGNOT_PER_GNOT,
          normalUgnot: Number(parts[2]) || 0,
          normalGnot: (Number(parts[2]) || 0) / UGNOT_PER_GNOT,
          promoUgnot: Number(parts[3]) || 0,
          promoGnot: (Number(parts[3]) || 0) / UGNOT_PER_GNOT,
          endsAt: Number(parts[4]) || 0,
          secondsLeft: Number(parts[5]) || 0,
          admin: parts[6] || "",
        });
      } catch (e) {
        return json(200, {
          pkg: bondPkg,
          error: String(e.message || e),
          status: 0,
          currentUgnot: 2_000_000,
          currentGnot: 2,
        });
      }
    }

    if (method === "GET" && p === "/api/meta/batch") {
      // items=pkg|id,pkg|id  (max 32)
      const rawItems = (q.get("items") || "").trim();
      const items = rawItems
        ? rawItems
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
            .map((s) => {
              const i = s.indexOf("|");
              if (i <= 0) return null;
              return { pkg: s.slice(0, i), id: s.slice(i + 1) };
            })
            .filter(Boolean)
        : [];
      if (!items.length) return json(400, { error: "items required (pkg|id,...)" });
      try {
        const metas = await getMetaBatch(RPC, META, items);
        return json(200, { metaPkg: META, metas, count: Object.keys(metas).length });
      } catch (e) {
        return json(200, { metaPkg: META, metas: {}, error: String(e.message || e) });
      }
    }

    if (method === "GET" && p === "/api/meta") {
      const padPkg = (q.get("pkg") || PKG).trim();
      const id = (q.get("id") || "").trim();
      if (!id) return json(400, { error: "id required" });
      try {
        const raw = await qeval(
          RPC,
          META,
          `${META}.GetMeta(${JSON.stringify(padPkg)}, ${JSON.stringify(id)})`,
        );
        return json(200, {
          pkg: padPkg,
          id,
          metaPkg: META,
          meta: parseMeta(raw),
        });
      } catch (e) {
        return json(200, {
          pkg: padPkg,
          id,
          metaPkg: META,
          meta: null,
          error: String(e.message || e),
        });
      }
    }

    // Public logo for tools: resolves meta.imageURI || launch.uri
    if (method === "GET" && p === "/api/token-media") {
      const id = (q.get("id") || "").trim();
      const padPkg = (q.get("pkg") || PKG).trim();
      const pathQ = (q.get("path") || q.get("token") || "").trim(); // …/padvXX.SYMBOL
      if (!id && !pathQ) {
        return json(400, { error: "id+pkg or path (…SYMBOL) required" });
      }
      try {
        let m = null;
        if (id) {
          m = await resolveMarketPkg(RPC, id, padPkg || null, padSources);
        } else if (pathQ) {
          // path ends with .SYMBOL — find matching market
          const sym = pathQ.includes(".") ? pathQ.split(".").pop() : "";
          const pkgGuess = pathQ.replace(/\.[^.]+$/, "");
          const { markets } = await getMarkets(RPC, padSources);
          m =
            markets.find(
              (x) =>
                !x.error &&
                (x.pkg === pkgGuess || pathQ.startsWith(String(x.pkg || ""))) &&
                String(x.symbol || "").toUpperCase() === String(sym).toUpperCase(),
            ) || null;
          if (!m && sym) {
            m =
              markets.find(
                (x) => !x.error && String(x.symbol || "").toUpperCase() === String(sym).toUpperCase(),
              ) || null;
          }
        }
        if (!m) return json(404, { error: "market not found" });
        let meta = null;
        try {
          const raw = await qeval(
            RPC,
            META,
            `${META}.GetMeta(${JSON.stringify(m.pkg)}, ${JSON.stringify(m.id)})`,
          );
          meta = parseMeta(raw);
        } catch {
          /* optional */
        }
        const imageURI = String(meta?.imageURI || m.uri || "").trim();
        let logoURI = imageURI;
        if (logoURI.startsWith("ipfs://")) {
          logoURI = `https://ipfs.io/ipfs/${logoURI.slice(7).replace(/^ipfs\//, "")}`;
        }
        return json(
          200,
          {
            id: m.id,
            pkg: m.pkg,
            symbol: m.symbol,
            name: m.name,
            tokenPath: pathQ || `${m.pkg}.${m.symbol}`,
            imageURI,
            logoURI: logoURI || null,
            website: meta?.website || "",
            twitter: meta?.twitter || "",
            telegram: meta?.telegram || "",
            description: meta?.description || "",
            gnoswapListed: !!m.gnoswapListed,
            note:
              "Gnoswap UI logos come from onbloc/gno-token-resource, not this endpoint. Use logoURI for gnomemepad / custom tools.",
          },
          { maxAge: 60 },
        );
      } catch (e) {
        return json(500, { error: String(e.message || e) });
      }
    }

    if (method === "GET" && p === "/api/points") {
      const address = (q.get("address") || "").trim();
      try {
        const paramsRaw = await qeval(RPC, POINTS, `${POINTS}.ParamsInfo()`);
        const pp = String(paramsRaw).split("|");
        // v1: ref|referee|checkIn|interval
        // v2: …|createBonus|buyBase|sellBase|ptsPerGnotBuy|ptsPerGnotSell|maxPerHeight|tradePts|createPts|v2
        const isV2 = String(pp[pp.length - 1] || "").trim() === "v2" || pp.length >= 12;
        const params = {
          referrerBonus: Number(pp[0]) || 50,
          refereeBonus: Number(pp[1]) || 25,
          checkIn: Number(pp[2]) || 5,
          checkInInterval: Number(pp[3]) || 100,
          version: isV2 ? 2 : 1,
          createBonus: isV2 ? Number(pp[4]) || 0 : 0,
          buyBase: isV2 ? Number(pp[5]) || 0 : 0,
          sellBase: isV2 ? Number(pp[6]) || 0 : 0,
          ptsPerGnotBuy: isV2 ? Number(pp[7]) || 0 : 0,
          ptsPerGnotSell: isV2 ? Number(pp[8]) || 0 : 0,
          maxPerHeight: isV2 ? Number(pp[9]) || 0 : 0,
          tradePtsTotal: isV2 ? Number(pp[10]) || 0 : 0,
          createPtsTotal: isV2 ? Number(pp[11]) || 0 : 0,
        };
        let myPoints = 0;
        let referrer = "";
        if (address) {
          myPoints = Number(
            await qeval(RPC, POINTS, `${POINTS}.GetPoints(${JSON.stringify(address)})`),
          ) || 0;
          referrer = String(
            await qeval(RPC, POINTS, `${POINTS}.GetReferrer(${JSON.stringify(address)})`),
          )
            .replace(/^"|"$/g, "")
            .trim();
        }
        const lbRaw = await qeval(RPC, POINTS, `${POINTS}.Leaderboard(15)`);
        return json(200, {
          pointsPkg: POINTS,
          params,
          address: address || null,
          points: myPoints,
          referrer: referrer || null,
          leaderboard: parseLeaderboard(lbRaw),
        });
      } catch (e) {
        return json(200, {
          pointsPkg: POINTS,
          error: String(e.message || e),
          leaderboard: [],
          points: 0,
        });
      }
    }

    // Season 0: Curve Camp — overlay on pointsv2 (honest stubs; no portfolio scan)
    if (method === "GET" && p === "/api/season0") {
      const address = (q.get("address") || "").trim();
      try {
        const out = await buildSeason0(RPC, POINTS, padSources, address, {
          networkId,
        });
        // Board is public/short TTL; per-address responses stay private.
        return json(200, out, address ? { maxAge: 10, private: true } : { maxAge: 15 });
      } catch (e) {
        return json(200, {
          season: {
            id: "s0",
            name: "Season 0: Curve Camp",
            network: "sapphire",
            enabled: networkId === "sapphire",
            startHeight: null,
            endHeight: null,
          },
          partial: true,
          error: String(e.message || e),
          me: null,
          board: [],
          quests: {},
        });
      }
    }

    // Gnoswap integration helpers (Sapphire live stack under gno.land/r/gnoswap/*)
    if (method === "GET" && p === "/api/gnoswap") {
      const WUGNOT = "gno.land/r/gnoland/wugnot";
      const ROUTER = "gno.land/r/gnoswap/router";
      const ROUTER_V1 = "gno.land/r/gnoswap/router/v1";
      const POOL = "gno.land/r/gnoswap/pool";
      const POOL_V1 = "gno.land/r/gnoswap/pool/v1";
      const POSITION = "gno.land/r/gnoswap/position";
      const APP = "https://beta.gnoswap.io";
      // Optional token package path for deep-link / dry-swap probe
      const tokenPath = (q.get("token") || q.get("tokenPath") || "").trim();
      const fee = Number(q.get("fee") || 3000); // 0.3% default for volatile meme
      const out = {
        network: process.env.CHAIN_ID || "sapphire-1",
        app: APP,
        paths: {
          router: ROUTER,
          routerV1: ROUTER_V1,
          pool: POOL,
          poolV1: POOL_V1,
          position: POSITION,
          wugnot: WUGNOT,
          ugnot: "ugnot",
        },
        feeTiers: [
          { fee: 100, label: "0.01%", tickSpacing: 1 },
          { fee: 500, label: "0.05%", tickSpacing: 10 },
          { fee: 3000, label: "0.3%", tickSpacing: 60 },
          { fee: 10000, label: "1%", tickSpacing: 200 },
        ],
        createPool: {
          package: POOL, // proxy → pool/v1
          func: "CreatePool",
          args: ["token0Path", "token1Path", "fee", "sqrtPriceX96"],
          feeNote: "100 GNS creation fee (poolCreationFee); tokens must be grc20-registered",
        },
        swap: {
          package: ROUTER,
          exactIn: "ExactInSwapRoute",
          exactInSingle: "ExactInSingleSwapRoute",
          dry: "DrySwapRoute",
          routeFormat: "TOKEN_IN:TOKEN_OUT:FEE  (use wugnot path in routes; ugnot only in inputToken/outputToken params)",
          nativeNote: "For GNOT: inputToken=ugnot, route uses gno.land/r/gnoland/wugnot",
        },
        listingSteps: [
          "Graduate memepad market (GnoswapReady)",
          "Ensure GRC20 registered (pad Create → grc20reg)",
          "Approve WUGNOT if using native GNOT",
          "CreatePool(wugnot, tokenPath, fee, sqrtPriceX96) via pool",
          "Mint concentrated LP via position",
          "Swap via router ExactInSwapRoute",
        ],
      };
      if (tokenPath) {
        // Normalize to grc20reg key: strip Token.ID trailing .seq (…SYMBOL.0000001)
        let regKey = String(tokenPath).trim();
        const seqStrip = regKey.match(/^(.*\.[A-Za-z][A-Za-z0-9]{0,11})\.\d+$/);
        if (seqStrip) regKey = seqStrip[1];
        const WUGNOT_KEY = `${WUGNOT}.wugnot`;
        // Canonical pool path helpers (alphabetical token order is pool-internal)
        const a = WUGNOT_KEY;
        const b = regKey;
        const [t0, t1] = a < b ? [a, b] : [b, a];
        out.token = regKey;
        out.adenaPath = regKey;
        if (regKey !== tokenPath) out.tokenIdRaw = tokenPath;
        out.suggestedRouteBuy = `${WUGNOT_KEY}:${regKey}:${fee}`;
        out.suggestedRouteSell = `${regKey}:${WUGNOT_KEY}:${fee}`;
        out.suggestedPoolKey = `${t0}:${t1}:${fee}`;
        // Deep-link: Gnoswap Swap uses from/to (not tokenA/tokenB on /swap)
        out.swapAppUrl = `${APP}/swap?from=ugnot&to=${encodeURIComponent(regKey)}`;
        out.swapAppUrlSell = `${APP}/swap?from=${encodeURIComponent(regKey)}&to=ugnot`;
        out.tokenPageUrl = `${APP}/token?path=${encodeURIComponent(regKey)}&tokenA=ugnot`;
        // Router ExactIn path (Sapphire)
        out.router = ROUTER;
        out.routerAddr = "g1vc883gshu5z7ytk5cdynhc8c2dh67pdp4cszkp";
        out.wugnotPkg = WUGNOT;
        out.wugnotKey = WUGNOT_KEY;
        // amount: ugnot (buy) or token units (sell); side=buy|sell
        // DrySwap input must be wugnot.wugnot key (NOT "ugnot", NOT bare package path)
        const side = String(q.get("side") || "buy").toLowerCase() === "sell" ? "sell" : "buy";
        const amountRaw = String(q.get("amount") || "1000000").replace(/[^\d]/g, "") || "1000000";
        out.quoteRequest = { side, amount: amountRaw, fee };
        const route = side === "sell" ? out.suggestedRouteSell : out.suggestedRouteBuy;
        const tokenIn = side === "sell" ? regKey : WUGNOT_KEY;
        const tokenOut = side === "sell" ? WUGNOT_KEY : regKey;
        // Probe DrySwapRoute (quote only) — returns (amountIn, amountOut, ok)
        try {
          const dryExpr = `${ROUTER}.DrySwapRoute(${JSON.stringify(tokenIn)}, ${JSON.stringify(tokenOut)}, ${JSON.stringify(amountRaw)}, ${JSON.stringify("EXACT_IN")}, ${JSON.stringify(route)}, ${JSON.stringify("100")}, ${JSON.stringify("1")})`;
          const dryRaw = await qeval(RPC, ROUTER, dryExpr);
          const raw = String(dryRaw || "");
          // qeval may return multi-value as separate lines or concatenated
          const nums = [...String(raw).matchAll(/(-?\d+)/g)].map((x) => x[1]);
          // Prefer second number as amountOut when (in, out, bool)
          let amountOut = null;
          if (nums.length >= 2) amountOut = Number(nums[1]);
          else if (nums.length === 1) amountOut = Number(nums[0]);
          const okFlag = !/false/i.test(raw.split("\n").pop() || "") && amountOut != null && amountOut > 0;
          out.drySwap = {
            raw,
            ok: okFlag,
            side,
            amountIn: amountRaw,
            amountOut: Number.isFinite(amountOut) ? amountOut : null,
            tokenIn,
            tokenOut,
            route,
            quoteArr: "100",
          };
        } catch (e) {
          out.drySwap = {
            ok: false,
            error: String(e.message || e),
            side,
            amountIn: amountRaw,
            tokenIn,
            tokenOut,
            route,
            quoteArr: "100",
          };
        }
      }
      return json(200, out, { maxAge: 8 });
    }

    if (method === "GET" && p === "/api/profile") {
      const address = (q.get("address") || "").trim();
      if (!address) return json(400, { error: "address required" });
      try {
        const raw = await qeval(
          RPC,
          PROFILE,
          `${PROFILE}.GetProfile(${JSON.stringify(address)})`,
        );
        return json(200, {
          address,
          profilePkg: PROFILE,
          profile: parseProfile(raw),
        });
      } catch (e) {
        return json(200, {
          address,
          profilePkg: PROFILE,
          profile: null,
          error: String(e.message || e),
        });
      }
    }

    if (method === "GET" && (p === "/api/markets" || p === "/api/markets-lite")) {
      const lite = p === "/api/markets-lite" || q.get("lite") === "1";
      const full = fullMetrics();
      const wantSnap = !noCache && q.get("nosnapshot") !== "1";
      // Speedup #3: serve snapshot (fresh or soft-stale) before live qeval.
      // Full metrics prefers a stats snapshot over a cold TradeHistory build.
      if (wantSnap) {
        const snap = await readMarketsSnapshot(networkId);
        const age = snap ? Date.now() - Number(snap.at || 0) : Infinity;
        const usable = snapshotFresh(snap) || snapshotUsable(snap);
        const statsOk = !full || !lite || snapshotHasTradeStats(snap?.data);
        const serveSnap =
          snap?.data && statsOk && (usable || (full && lite && age <= 30 * 60_000));
        if (serveSnap) {
          const data = {
            ...snap.data,
            cached: true,
            snapshot: true,
            snapshotAgeMs: age,
            snapshotStale: !snapshotFresh(snap),
            lite: snap.data.lite ?? lite,
            ...(full ? { fullMetrics: true } : {}),
          };
          // If caller wants full enrich but snap is lite, fall through to live full
          if (!(lite === false && data.lite === true)) {
            await decorateMarketsBadges(RPC, data);
            return json(200, data, {
              maxAge: snapshotFresh(snap) ? 20 : 12,
              cacheTag: `markets-${networkId}`,
            });
          }
        }
      }
      const mKey = `markets:${lite ? "lite:" : ""}${padSources.map((s) => s.pkg).join(",")}`;
      if (!noCache) {
        const hit = cacheGet(mKey);
        if (hit) {
          const out = { ...hit, markets: (hit.markets || []).map((m) => ({ ...m })), cached: true, snapshot: false };
          await decorateMarketsBadges(RPC, out);
          return json(200, out, {
            maxAge: 20,
            cacheTag: `markets-${networkId}`,
          });
        }
      }
      const t0 = Date.now();
      const withStats = full ? true : !lite;
      const markets = await withUsdPricing(
        await getMarkets(RPC, padSources, { lite, tradeStats: withStats }),
      );
      const buildMs = Date.now() - t0;
      const payload = {
        ...markets,
        network: networkId,
        buildMs,
        snapshot: false,
        lite: !!lite,
        tradeStats: withStats,
        ...(full ? { fullMetrics: true } : {}),
      };
      await decorateMarketsBadges(RPC, payload);
      cacheSet(mKey, payload, 25_000);
      // Keep snapshot warm for next callers (lite preferred for worker parity).
      // A lite request must not replace a worker snapshot that already enriched DEX volume.
      if (lite) {
        try {
          let write = !full;
          if (full) {
            const prev = await readMarketsSnapshot(networkId);
            const prevRich = prev?.data && prev.data.lite === false && snapshotHasTradeStats(prev.data);
            write = !prevRich;
          }
          if (write) await writeMarketsSnapshot(networkId, payload, buildMs);
        } catch {
          /* ignore */
        }
      }
      return json(200, payload, {
        maxAge: 20,
        cacheTag: `markets-${networkId}`,
      });
    }

    // Achievement badges catalog + wallet evaluation (pools.xyz-inspired)
    if (method === "GET" && (p === "/api/badges" || p === "/api/badges/")) {
      const address = (q.get("address") || "").trim();
      const catalog = listCatalogPublic();
      if (!address) {
        return json(200, { ok: true, catalog, wearLimit: WEAR_LIMIT }, { maxAge: 120 });
      }
      if (!/^g1[a-z0-9]{38,}$/i.test(address)) {
        return json(400, { error: "invalid g1 address" });
      }
      const bKey = `badges:${networkId}:${address}`;
      if (!noCache) {
        const hit = cacheGet(bKey);
        if (hit) return json(200, { ...hit, cached: true }, { maxAge: 20, private: true });
      }
      let creator = { launches: [], badges: [], wearBadges: [] };
      let trader = { badges: [], wearBadges: [] };
      let portfolio = null;
      try {
        creator = await getCreatorDashboard(RPC, padSources, SIGNER_ADDR, address);
      } catch (e) {
        creator = { launches: [], badges: [], error: String(e.message || e) };
      }
      try {
        portfolio = await getPortfolio(RPC, padSources, SIGNER_ADDR, address);
        const holds = Array.isArray(portfolio?.holdings) ? portfolio.holdings : [];
        const valueGnot = holds.reduce(
          (s, h) => s + (Number(h.valueGnotApprox) || Number(h.valueGnot) || 0),
          0,
        );
        const traderBadges = evaluateTraderBadges({
          holdings: holds.map((h) => ({
            ...h,
            balance: h.balance,
            valueGnot: Number(h.valueGnotApprox) || Number(h.valueGnot) || 0,
          })),
          totalValueGnot: valueGnot,
        });
        trader = {
          badges: traderBadges,
          wearBadges: wearBadges(traderBadges, WEAR_LIMIT),
          positions: Number(portfolio?.memePositions) || holds.length,
          valueGnot,
        };
      } catch (e) {
        trader = { badges: [], wearBadges: [], error: String(e.message || e) };
      }
      // Token badges for this creator's launches
      const tip = await tipHeightCached(RPC);
      const tokenBadgesById = {};
      for (const m of creator.launches || []) {
        attachTokenBadges([m], { tipHeight: tip });
        if (m.id) tokenBadgesById[`${m.pkg || ""}|${m.id}`] = m.badges || [];
      }
      const out = {
        ok: true,
        address,
        network: networkId,
        wearLimit: WEAR_LIMIT,
        catalog,
        creator: {
          count: creator.count || (creator.launches || []).length,
          graduated: creator.graduated || 0,
          badges: creator.badges || evaluateCreatorBadges(creator.launches || []),
          wearBadges:
            creator.wearBadges ||
            wearBadges(creator.badges || evaluateCreatorBadges(creator.launches || []), WEAR_LIMIT),
        },
        trader,
        tokens: tokenBadgesById,
      };
      cacheSet(bKey, out, 20_000);
      return json(200, out, { maxAge: 20, private: true });
    }

    // Snapshot health (local verify + ops) — no chain calls
    if (method === "GET" && (p === "/api/snapshot" || p === "/api/snapshot/")) {
      const snap = await readMarketsSnapshot(networkId);
      return json(
        200,
        {
          network: networkId,
          ttlMs: Number(process.env.MARKETS_SNAP_TTL_MS || 20_000),
          present: !!snap,
          fresh: snapshotFresh(snap),
          usable: snapshotUsable(snap),
          ageMs: snap ? Date.now() - snap.at : null,
          buildMs: snap?.buildMs ?? null,
          markets: snap?.data?.count ?? snap?.data?.markets?.length ?? null,
          lite: snap?.data?.lite ?? null,
          at: snap?.at ?? null,
        },
        { maxAge: 5 },
      );
    }

    // ── Gnoswap token-resource (canonical registry + auto-PR) ──
    if (method === "GET" && p === "/api/token-resource/spec") {
      return json(200, TOKEN_RESOURCE_SPEC, { maxAge: 300 });
    }

    if (method === "GET" && (p === "/api/token-resource" || p === "/api/token-resource/registry")) {
      const { markets } = await getMarkets(RPC, padSources);
      const list = (markets || []).filter((m) => !m.error && m.id);
      const metaItems = list.slice(0, 32).map((m) => ({ pkg: m.pkg, id: m.id }));
      let metaByKey = {};
      try {
        metaByKey = await getMetaBatch(RPC, META, metaItems);
      } catch {
        metaByKey = {};
      }
      const plan = await buildRegistrationPlan(list, metaByKey, {
        chainId: CHAIN_ID || networkId || "sapphire-1",
      });
      const format = String(q.get("format") || "plan").toLowerCase();
      if (format === "grc20" || format === "sapphire" || format === "gnoland-1") {
        return json(
          200,
          plan.items.map((x) => x.entry),
          { maxAge: 30 },
        );
      }
      return json(
        200,
        {
          ...plan,
          spec: TOKEN_RESOURCE_SPEC,
          syncConfigured: !!(
            process.env.TOKEN_RESOURCE_GITHUB_TOKEN || process.env.GITHUB_TOKEN
          ),
        },
        { maxAge: 30 },
      );
    }

    if (method === "GET" && p === "/api/token-resource/logo") {
      const pkg = (q.get("pkg") || "").trim();
      const id = (q.get("id") || "").trim();
      const tokenPath = (q.get("path") || q.get("token_path") || "").trim();
      let m = null;
      if (pkg && id) {
        try {
          m = await resolveMarketPkg(RPC, id, pkg, padSources);
        } catch {
          m = null;
        }
      } else if (tokenPath) {
        const { markets } = await getMarkets(RPC, padSources);
        m =
          (markets || []).find((x) => adenaTokenKey(x) === tokenPath) ||
          null;
      }
      if (!m) {
        const sym = (q.get("symbol") || "T").trim();
        const { svg } = await svgForMarket({ symbol: sym, name: sym });
        return {
          statusCode: 200,
          headers: {
            "Content-Type": "image/svg+xml; charset=utf-8",
            "Cache-Control": "public, max-age=120",
            "Access-Control-Allow-Origin": "*",
          },
          body: svg,
        };
      }
      let meta = null;
      try {
        const raw = await qeval(
          RPC,
          META,
          `${META}.GetMeta(${JSON.stringify(m.pkg)}, ${JSON.stringify(m.id)})`,
        );
        meta = parseMeta(raw);
      } catch {
        meta = null;
      }
      const { svg } = await svgForMarket(m, meta);
      return {
        statusCode: 200,
        headers: {
          "Content-Type": "image/svg+xml; charset=utf-8",
          "Cache-Control": "public, max-age=300, s-maxage=300",
          "Access-Control-Allow-Origin": "*",
        },
        body: svg,
      };
    }

    if (
      (method === "POST" || method === "GET") &&
      (p === "/api/token-resource/sync" || p === "/api/token-resource/register")
    ) {
      // GET allowed for cron; POST preferred. Optional TOKEN_RESOURCE_SYNC_SECRET
      const secret = process.env.TOKEN_RESOURCE_SYNC_SECRET || "";
      if (secret && (q.get("secret") || "") !== secret) {
        return json(401, { error: "unauthorized" });
      }
      const { markets } = await getMarkets(RPC, padSources);
      const list = (markets || []).filter((m) => !m.error && m.id);
      // Prefer listed first for PR priority
      list.sort((a, b) => Number(!!b.gnoswapListed) - Number(!!a.gnoswapListed));
      const metaItems = list.slice(0, 32).map((m) => ({ pkg: m.pkg, id: m.id }));
      let metaByKey = {};
      try {
        metaByKey = await getMetaBatch(RPC, META, metaItems);
      } catch {
        metaByKey = {};
      }
      const onlyPath = (q.get("path") || q.get("token_path") || "").trim();
      const onlyId = (q.get("id") || "").trim();
      const onlyPkg = (q.get("pkg") || "").trim();
      let filtered = list;
      if (onlyPath) filtered = list.filter((m) => adenaTokenKey(m) === onlyPath);
      else if (onlyId) {
        filtered = list.filter(
          (m) => m.id === onlyId && (!onlyPkg || m.pkg === onlyPkg),
        );
      }
      const plan = await buildRegistrationPlan(filtered, metaByKey, {
        chainId: CHAIN_ID || networkId || "sapphire-1",
      });
      const dry = q.get("dry") === "1" || q.get("dryRun") === "1";
      if (dry) {
        return json(200, { dryRun: true, plan: { ...plan, items: plan.missingItems } });
      }
      const result = await syncTokenResourcePr(plan);
      return json(result.ok ? 200 : 502, result);
    }

    if (method === "GET" && p === "/api/fx") {
      const fx = await fetchGnoswapFx();
      return json(
        200,
        {
          gnotUsd: fx.gnotUsd || 0,
          source: fx.source,
          updatedAt: fx.updatedAt,
        },
        { maxAge: 30 },
      );
    }

    if (method === "GET" && p.startsWith("/api/market/") && p.endsWith("/holders")) {
      const id = decodeURIComponent(
        p.slice("/api/market/".length, -"/holders".length).replace(/\/$/, ""),
      );
      const pkgQ = (q.get("pkg") || "").trim();
      const holdKey = `holders:${pkgQ || "auto"}:${id}`;
      const pkg =
        pkgQ ||
        (padSources.find((s) => s.active) || padSources[0] || {}).pkg ||
        PKG;
      const load = () =>
        singleflight(holdKey, async () => {
          const payload = await loadHolderBalances(RPC, pkg, id);
          if (payload && Array.isArray(payload.holders)) rememberFresh(holdKey, payload, 45_000);
          return payload;
        });
      if (!noCache) {
        const hit = readFreshOrStale(holdKey, 5 * 60_000);
        if (hit?.fresh) return json(200, hit.value, { maxAge: 15 });
        // Last complete list, including every address from that build. Refresh continues behind it.
        if (hit) {
          load().catch(() => {});
          return json(200, hit.value, { maxAge: 5 });
        }
      }
      const payload = await load();
      return json(200, payload, { maxAge: 15 });
    }

    if (method === "GET" && p.startsWith("/api/market/") && p.endsWith("/chart")) {
      const id = decodeURIComponent(p.slice("/api/market/".length, -"/chart".length).replace(/\/$/, ""));
      const pkgQ = (q.get("pkg") || "").trim();
      const m = await withUsdPricing(await resolveMarketPkg(RPC, id, pkgQ || null, padSources));
      return json(200, {
        id: m.id,
        symbol: m.symbol,
        name: m.name,
        pkg: m.pkg,
        legacy: m.legacy,
        spotScaled: m.spotScaled,
        gnotUsd: m.gnotUsd || 0,
        priceUsd: m.priceUsd || 0,
        points: m.chart || [],
        volumeScope: m.volumeScope || null,
        volumeNote: m.volumeNote || null,
        volumeNoteVi: m.volumeNoteVi || null,
        priceSource: m.priceSource || null,
        markReliable: m.markReliable !== false,
        dexHistoryEmpty: m.dexHistoryEmpty,
        chartSources: m.chartSources || null,
      });
    }

    // Alias: /api/trades?id=… → chart trade points (was 404)
    if (method === "GET" && (p === "/api/trades" || p === "/api/trades/")) {
      const id = (q.get("id") || "").trim();
      if (!id) return json(400, { error: "id required" });
      const pkgQ = (q.get("pkg") || "").trim();
      const limit = Math.min(200, Math.max(1, Number(q.get("limit") || 80)));
      const m = await withUsdPricing(await resolveMarketPkg(RPC, id, pkgQ || null, padSources));
      const trades = (m.chart || [])
        .filter((pt) => Number(pt.side) !== 2)
        .slice()
        .reverse()
        .slice(0, limit);
      return json(200, {
        id: m.id,
        symbol: m.symbol,
        pkg: m.pkg,
        priceSource: m.priceSource || null,
        volumeScope: m.volumeScope || null,
        volumeNote: m.volumeNote || null,
        markReliable: m.markReliable !== false,
        chartSources: m.chartSources || null,
        trades,
        count: trades.length,
      });
    }

    // Ambassador Season 1 — apply + content submit (open now; prizes after mainnet)
    if (
      method === "POST" &&
      (p === "/api/ambassadors/apply" ||
        p === "/api/ambassadors/apply/" ||
        p === "/api/ambassadors/submit" ||
        p === "/api/ambassadors/submit/")
    ) {
      const ip =
        hdrs["x-forwarded-for"]?.split(",")[0]?.trim() ||
        hdrs["client-ip"] ||
        hdrs["x-real-ip"] ||
        "unknown";
      if (!allowAmbassadorRequest(ip)) {
        return json(429, { error: "rate_limited" });
      }
      let body = {};
      try {
        body = bodyText ? JSON.parse(bodyText) : {};
      } catch {
        return json(400, { error: "invalid json" });
      }
      const isApply = p.includes("/apply");
      const g1 = String(body.g1 || "").trim();
      if (!/^g1[a-z0-9]{38,}$/i.test(g1)) {
        return json(400, { error: "invalid g1" });
      }
      const displayName = String(body.displayName || body.name || "").trim().slice(0, 80);
      if (!displayName) return json(400, { error: "displayName required" });

      if (isApply) {
        if (!body.ageOk || !body.rulesOk || !body.notInsider) {
          return json(400, { error: "required consents missing" });
        }
        let xHandle = String(body.xHandle || "")
          .trim()
          .replace(/^@/, "")
          .replace(/^https?:\/\/(www\.)?(twitter|x)\.com\//i, "")
          .split(/[/?#]/)[0]
          .trim()
          .slice(0, 15);
        const cookies = parseCookieHeader(hdrs.cookie || hdrs.Cookie || "");
        const xSess = getXSession(cookies.gnomi_x_sess);
        let xUserId = String(body.xUserId || "").trim();
        let xVerified = false;
        if (xSess?.username) {
          xHandle = xSess.username;
          xUserId = xSess.xUserId;
          xVerified = true;
        }
        if (!/^[A-Za-z0-9_]{1,15}$/.test(xHandle)) {
          return json(400, { error: "x account required — connect X first" });
        }
        if (xOAuthConfigured() && !xVerified) {
          return json(400, { error: "connect X via OAuth to verify account" });
        }
        const samples = Array.isArray(body.samples)
          ? body.samples.map((u) => String(u || "").trim()).filter(Boolean)
          : [];
        if (samples.length < 3) return json(400, { error: "three sample links required" });
        for (const u of samples) {
          try {
            const parsed = new URL(u);
            if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
              return json(400, { error: "invalid sample url" });
            }
          } catch {
            return json(400, { error: "invalid sample url" });
          }
        }
        const email = String(body.email || "").trim().slice(0, 120);
        if (!email || !email.includes("@")) return json(400, { error: "email required" });
        const row = {
          id: `app_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
          kind: "apply",
          at: Date.now(),
          displayName,
          email,
          xHandle,
          xUserId: xUserId || null,
          xVerified,
          g1,
          lang: String(body.lang || "en").slice(0, 16),
          samples: samples.slice(0, 5),
          why: String(body.why || "").trim().slice(0, 500),
          status: "pending",
        };
        const out = await pushAmbassadorRecord("apply", row);
        return json(200, {
          ok: true,
          id: row.id,
          stored: out.n,
          durable: out.durable,
          note: "Prizes settle after mainnet Month-1 (Option A).",
        });
      }

      // content submit
      const url = String(body.url || "").trim();
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          return json(400, { error: "invalid url" });
        }
      } catch {
        return json(400, { error: "invalid url" });
      }
      const title = String(body.title || "").trim().slice(0, 160);
      if (!title) return json(400, { error: "title required" });
      const xHandle = String(body.xHandle || "")
        .trim()
        .replace(/^@/, "")
        .replace(/^https?:\/\/(www\.)?(twitter|x)\.com\//i, "")
        .split(/[/?#]/)[0]
        .trim()
        .slice(0, 15);
      if (!/^[A-Za-z0-9_]{1,15}$/.test(xHandle)) {
        return json(400, { error: "x account required" });
      }
      const row = {
        id: `cnt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        kind: "content",
        at: Date.now(),
        displayName,
        g1,
        xHandle,
        title,
        url,
        lang: String(body.lang || "en").slice(0, 16),
        notes: String(body.notes || "").trim().slice(0, 400),
        status: "pending",
      };
      const out = await pushAmbassadorRecord("content", row);
      return json(200, {
        ok: true,
        id: row.id,
        stored: out.n,
        durable: out.durable,
        note: "Content accepted from today; prizes after mainnet.",
      });
    }

    if (method === "GET" && (p === "/api/ambassadors" || p === "/api/ambassadors/")) {
      return json(
        200,
        {
          season: "amb-s1",
          submitOpen: true,
          prizeTiming: "after_mainnet_month1",
          metric: "option_a_protocol_fee_accrued_10pct",
          split: [40, 25, 15, 10, 10],
          rubric: [
            { id: "content", pct: 50 },
            { id: "referrals", pct: 30 },
            { id: "volume", pct: 20 },
          ],
          counts: await ambassadorPublicCounts(),
        },
        { maxAge: 30 },
      );
    }

    if (
      method === "GET" &&
      (p === "/api/ambassadors/leaderboard" || p === "/api/ambassadors/leaderboard/")
    ) {
      const content = await loadAmbassadorList("content");
      const board = buildAmbassadorLeaderboard(content);
      return json(
        200,
        {
          season: "amb-s1",
          updatedAt: Date.now(),
          note: "MVP ranks by admin content scores (50%). Volume pillar (20%) is mainnet-only — Sapphire testnet volume does not count.",
          board,
        },
        { maxAge: 15 },
      );
    }

    if (
      method === "GET" &&
      (p === "/api/ambassadors/submissions" || p === "/api/ambassadors/submissions/")
    ) {
      const adminG1 = String(q.get("admin") || q.get("address") || "").trim().toLowerCase();
      const signer = String(SIGNER_ADDR || DEFAULT_ADDR).toLowerCase();
      if (!adminG1 || adminG1 !== signer) {
        return json(403, { error: "admin only" });
      }
      const content = await loadAmbassadorList("content");
      const apply = await loadAmbassadorList("apply");
      // newest first
      const submissions = content
        .slice()
        .sort((a, b) => (Number(b.at) || 0) - (Number(a.at) || 0));
      const applications = apply
        .slice()
        .sort((a, b) => (Number(b.at) || 0) - (Number(a.at) || 0));
      return json(200, {
        submissions,
        applications,
        applicationCount: applications.length,
        submissionCount: submissions.length,
        signerAddr: SIGNER_ADDR,
      });
    }

    if (
      method === "POST" &&
      (p === "/api/ambassadors/application-status" ||
        p === "/api/ambassadors/application-status/")
    ) {
      let body = {};
      try {
        body = bodyText ? JSON.parse(bodyText) : {};
      } catch {
        return json(400, { error: "invalid json" });
      }
      const adminG1 = String(body.adminG1 || body.address || "").trim().toLowerCase();
      const signer = String(SIGNER_ADDR || DEFAULT_ADDR).toLowerCase();
      if (!adminG1 || adminG1 !== signer) {
        return json(403, { error: "admin only" });
      }
      const id = String(body.id || "").trim();
      const status = String(body.status || "").trim().toLowerCase();
      if (!id) return json(400, { error: "id required" });
      if (!["pending", "approved", "rejected"].includes(status)) {
        return json(400, { error: "status must be pending|approved|rejected" });
      }
      const list = await loadAmbassadorList("apply");
      const idx = list.findIndex((r) => String(r.id) === id);
      if (idx < 0) return json(404, { error: "application not found" });
      const nextRow = {
        ...list[idx],
        status,
        statusAt: Date.now(),
        statusBy: adminG1,
      };
      const next = list.slice();
      next[idx] = nextRow;
      const saved = await saveAmbassadorList("apply", next);
      return json(200, { ok: true, application: nextRow, durable: saved.durable });
    }

    if (
      method === "POST" &&
      (p === "/api/ambassadors/score" || p === "/api/ambassadors/score/")
    ) {
      let body = {};
      try {
        body = bodyText ? JSON.parse(bodyText) : {};
      } catch {
        return json(400, { error: "invalid json" });
      }
      const adminG1 = String(body.adminG1 || body.address || "").trim().toLowerCase();
      const signer = String(SIGNER_ADDR || DEFAULT_ADDR).toLowerCase();
      if (!adminG1 || adminG1 !== signer) {
        return json(403, { error: "admin only" });
      }
      const id = String(body.id || "").trim();
      const score = Number(body.score);
      if (!id) return json(400, { error: "id required" });
      if (!Number.isFinite(score) || score < 0 || score > 100) {
        return json(400, { error: "score must be 0–100" });
      }
      const list = await loadAmbassadorList("content");
      const idx = list.findIndex((r) => String(r.id) === id);
      if (idx < 0) return json(404, { error: "submission not found" });
      const prev = list[idx];
      const nextRow = {
        ...prev,
        score: Math.round(score * 10) / 10,
        scoredAt: Date.now(),
        scoredBy: adminG1,
        scoreNote: String(body.note || body.scoreNote || "").trim().slice(0, 300),
        status: "scored",
      };
      const next = list.slice();
      next[idx] = nextRow;
      const saved = await saveAmbassadorList("content", next);
      return json(200, {
        ok: true,
        submission: nextRow,
        durable: saved.durable,
      });
    }

    // Client ExactIn success → shared chart points (Gnoswap indexer often empty for memes)
    if (method === "POST" && (p === "/api/trades/report" || p === "/api/trades/report/")) {
      const ip =
        hdrs["x-forwarded-for"]?.split(",")[0]?.trim() ||
        hdrs["client-ip"] ||
        hdrs["x-real-ip"] ||
        "unknown";
      if (!allowReportRequest(ip)) {
        return json(429, { error: "rate_limited" });
      }
      let body = {};
      try {
        body = bodyText ? JSON.parse(bodyText) : {};
      } catch {
        return json(400, { error: "invalid json" });
      }
      const id = String(body.id || "").trim();
      const pkgQ = String(body.pkg || "").trim();
      const poolPath = String(body.poolPath || body.gnoswapPoolPath || "").trim();
      const tokenKey = String(body.tokenKey || body.tokenPath || "").trim();
      const hash = String(body.hash || body.txHash || "").trim();
      const sideRaw = body.side;
      const side =
        sideRaw === 1 || sideRaw === "1" || sideRaw === "sell"
          ? 1
          : sideRaw === 0 || sideRaw === "0" || sideRaw === "buy"
            ? 0
            : -1;
      const ugnot = Math.floor(Number(body.ugnot) || 0);
      const tokens = Math.floor(Number(body.tokens) || 0);
      if (!id && !tokenKey && !poolPath) {
        return json(400, { error: "id or tokenKey required" });
      }
      if (side < 0 || ugnot <= 0 || tokens <= 0) {
        return json(400, { error: "side, ugnot, tokens required" });
      }
      if (hash && !/^[A-Za-z0-9+/=_-]{16,128}$/.test(hash)) {
        return json(400, { error: "invalid hash" });
      }
      let m = null;
      try {
        if (id) {
          m = await resolveMarketPkg(RPC, id, pkgQ || null, padSources);
        } else {
          const { markets } = await getMarkets(RPC, padSources);
          m =
            (markets || []).find(
              (x) =>
                (tokenKey && marketTokenKey(x) === tokenKey) ||
                (poolPath && x.gnoswapPoolPath === poolPath),
            ) || null;
        }
      } catch {
        m = null;
      }
      if (!m || m.error || !m.gnoswapListed) {
        return json(400, { error: "market not listed or not found" });
      }
      const tk = marketTokenKey(m) || tokenKey;
      const priceGnot = tokens > 0 ? ugnot / UGNOT_PER_GNOT / tokens : 0;
      const row = {
        height: Number(body.height) || 0,
        side,
        sideLabel: side === 0 ? "buy" : "sell",
        ugnot,
        tokens,
        price: Math.floor(priceGnot * UGNOT_PER_GNOT * 1_000_000),
        priceGnot,
        volumeGnot: ugnot / UGNOT_PER_GNOT,
        timeMs: Number(body.timeMs) || Date.now(),
        time: body.time || null,
        hash,
        source: "reported",
      };
      await pushReportedTrade(tk, m.gnoswapPoolPath || poolPath, row);
      const stored = (await getReportedTrades(tk, m.gnoswapPoolPath)).length;
      return json(200, {
        ok: true,
        tokenKey: tk,
        stored,
        durable: !!(await getReportedBlobStore()),
      });
    }

    if (method === "GET" && p.startsWith("/api/market/")) {
      const id = decodeURIComponent(p.slice("/api/market/".length));
      const pkgQ = (q.get("pkg") || "").trim();
      const detailKey = `market-detail:${networkId}:${pkgQ || "auto"}:${id}`;
      const loadDetail = () =>
        singleflight(detailKey, async () => {
          const m = await withUsdPricing(
            await resolveMarketPkg(RPC, id, pkgQ || null, padSources, {
              holders: false,
            }),
          );
          const tip = await tipHeightCached(RPC);
          if (m && !m.error) attachTokenBadges([m], { tipHeight: tip });
          if (m && !m.error) rememberFresh(detailKey, m, 15_000);
          return m;
        });
      if (!noCache) {
        const hit = readFreshOrStale(detailKey, 3 * 60_000);
        if (hit?.fresh) return json(200, hit.value, { maxAge: 12 });
        // Full last market, chart included. A live rebuild fills the next request.
        if (hit) {
          loadDetail().catch(() => {});
          return json(200, hit.value, { maxAge: 5 });
        }
      }
      const m = await loadDetail();
      return json(200, m, { maxAge: 12 });
    }

    if (method === "GET" && p === "/api/render") {
      const sub = q.get("path") || "";
      const md = await qrender(RPC, PKG, sub);
      return json(200, { markdown: md });
    }

    if (method === "GET" && p === "/api/params") {
      const params = await getParams(RPC, PKG);
      if (!params) {
        return json(200, {
          params: null,
          warning: "ParamsInfo failed; graduation, fee bps, and supply were not substituted",
          ...(fullMetrics() ? { fullMetrics: true } : {}),
        });
      }
      return json(200, fullMetrics() ? { ...params, fullMetrics: true } : params);
    }

    if (method === "GET" && p === "/api/wallets") {
      return json(200, {
        signerAddr: SIGNER_ADDR,
        pkg: PKG,
        chainId: CHAIN_ID,
        rpc: RPC,
        hosting: "netlify",
        signing: false,
        adena: true,
        demos: [],
      });
    }

    if (method === "GET" && p === "/api/portfolio") {
      const address = q.get("address") || "";
      return json(200, await getPortfolio(RPC, padSources, SIGNER_ADDR, address));
    }

    if (method === "GET" && p === "/api/creator") {
      const address = q.get("address") || "";
      return json(200, await getCreatorDashboard(RPC, padSources, SIGNER_ADDR, address));
    }

    if (method === "GET" && p === "/api/bank") {
      const address = q.get("address") || "";
      const ugnot = await bankUgnot(RPC, address);
      return json(200, {
        address,
        ugnot,
        gnot: ugnot / UGNOT_PER_GNOT,
        canSign: false,
      });
    }

    if (method === "GET" && p === "/api/balance") {
      const address = q.get("address") || "";
      const id = q.get("id") || "";
      const pkgQ = (q.get("pkg") || PKG).trim();
      const padAddrQ = (q.get("padAddr") || "").trim();
      if (!address || !id) return json(400, { error: "id and address required" });
      const ugnot = await bankUgnot(RPC, address);
      const tokens = await tokenBalance(RPC, pkgQ, id, address);
      // padv14+: wallet WUGNOT + allowance to pad (for Deposit/Approve/Buy preflight)
      let wugnot = 0;
      let wugnotAllowance = 0;
      let padAddr = padAddrQ;
      const WUGNOT = "gno.land/r/gnoland/wugnot";
      try {
        wugnot =
          Number(await qeval(RPC, WUGNOT, `${WUGNOT}.BalanceOf(${JSON.stringify(address)})`)) || 0;
      } catch {
        /* optional */
      }
      if (!padAddr || !/^g1[a-z0-9]+$/i.test(padAddr)) {
        try {
          padAddr = String(await qeval(RPC, pkgQ, `${pkgQ}.PadAddress()`) || "").replace(
            /^"|"$/g,
            "",
          );
        } catch {
          padAddr = "";
        }
      }
      if (padAddr && /^g1[a-z0-9]+$/i.test(padAddr)) {
        try {
          wugnotAllowance =
            Number(
              await qeval(
                RPC,
                WUGNOT,
                `${WUGNOT}.Allowance(${JSON.stringify(address)}, ${JSON.stringify(padAddr)})`,
              ),
            ) || 0;
        } catch {
          /* optional */
        }
      }
      // Self-allowance: TransferFrom spender sometimes resolves to EOA (not pad)
      let wugnotAllowanceSelf = 0;
      try {
        wugnotAllowanceSelf =
          Number(
            await qeval(
              RPC,
              WUGNOT,
              `${WUGNOT}.Allowance(${JSON.stringify(address)}, ${JSON.stringify(address)})`,
            ),
          ) || 0;
      } catch {
        /* optional */
      }
      // padv18+: claimable prepaid WUGNOT credit on pad (overpay / unspent)
      let prepaidWugnot = 0;
      try {
        prepaidWugnot =
          Number(
            await qeval(
              RPC,
              pkgQ,
              `${pkgQ}.PrepaidOf(${JSON.stringify(address)})`,
            ),
          ) || 0;
      } catch {
        /* padv17 and older */
      }
      return json(200, {
        id,
        address,
        pkg: pkgQ,
        tokens,
        ugnot,
        gnot: ugnot / UGNOT_PER_GNOT,
        wugnot,
        wugnotGnot: wugnot / UGNOT_PER_GNOT,
        wugnotAllowance,
        wugnotAllowanceSelf,
        prepaidWugnot,
        prepaidWugnotGnot: prepaidWugnot / UGNOT_PER_GNOT,
        padAddr: padAddr || "",
        canSign: false,
      });
    }

    if (method === "POST" && p.startsWith("/api/tx/")) {
      return json(501, {
        error:
          "Signing is not available on Netlify. Use local UI (scripts/start-ui-sapphire.ps1 + GNOKEY_PASS) or gnokey CLI against Sapphire.",
        pkg: PKG,
        chainId: CHAIN_ID,
        remote: RPC,
      });
    }

    return json(404, { error: `not found: ${method} ${p}` });
  } catch (e) {
    return json(500, { error: String(e.message || e) });
  }
}
