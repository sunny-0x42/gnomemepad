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
  normalizeNetworkId,
  DEFAULT_NETWORK_ID,
} from "./networks.mjs";

const UGNOT_PER_GNOT = 1_000_000;

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
  // Soft cap — drop oldest if oversized
  if (memCache.size > 64) {
    const first = memCache.keys().next().value;
    if (first != null) memCache.delete(first);
  }
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
    const listRaw = await qeval(RPC, cfg.HUB, `${cfg.HUB}.ListModules()`);
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

async function rpc(RPC, method, params) {
  const r = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
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

async function qevalRaw(RPC, expr) {
  const data = Buffer.from(expr, "utf8").toString("base64");
  const result = await rpc(RPC, "abci_query", {
    path: "vm/qeval",
    data,
    height: "0",
    prove: false,
  });
  const rb = result?.response?.ResponseBase;
  if (rb?.Error) {
    const err = typeof rb.Error === "string" ? rb.Error : JSON.stringify(rb.Error);
    throw new Error(err);
  }
  return b64utf8(rb?.Data);
}

async function qeval(RPC, PKG, expr) {
  let text = await qevalRaw(RPC, expr);
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
  const mcapGnot = priceGnot * totalSupply;
  const circ = m.sold > 0 ? m.sold : 0;
  const circMcapGnot = priceGnot * circ;
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
  // Prefer pool-implied spot for TVL; fall back to last trade / pad only if needed
  const px =
    poolSpotGnot > 0
      ? poolSpotGnot
      : Number(m.spotGnot || m.priceGnot) > 0
        ? Number(m.spotGnot || m.priceGnot)
        : 0;
  const tokenGnot = px > 0 && bal.tokens > 0 ? bal.tokens * px : 0;

  m.liquidityWugnotGnot = wugnotGnot;
  m.liquidityTokenGnot = tokenGnot;
  // Both sides at pool mark → ≈ 2 × WUGNOT when reserves are priced consistently
  m.liquidityGnot = wugnotGnot + tokenGnot;
  m.liquiditySource = "gnoswap_pool_balances";
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
  const supply = Number(totalSupply) > 0 ? Number(totalSupply) : 1_000_000_000;
  m.priceGnot = px;
  m.spotGnot = px;
  m.priceUgnot = px * UGNOT_PER_GNOT;
  m.spotScaled = Math.floor(m.priceUgnot * 1_000_000);
  m.mcapGnot = px * supply;
  const circ = Number(m.sold) > 0 ? Number(m.sold) : 0;
  m.circMcapGnot = px * circ;
  m.priceSource = source;
  attachLiquidityTvl(m);
  return m;
}

/**
 * Gnoswap public price API (Sapphire / beta).
 * Returns GNOT USD (oracle TWAP) + optional per-token path map.
 * Cached ~60s to avoid rate pressure on list endpoints.
 */
const GNOSWAP_PRICES_URL =
  process.env.GNOSWAP_PRICES_URL || "https://beta.api.gnoswap.io/v1/tokens/prices";
const GNOSWAP_API_BASE =
  process.env.GNOSWAP_API_BASE || "https://beta.api.gnoswap.io/v1";
const WUGNOT_TOKEN_KEY = "gno.land/r/gnoland/wugnot.wugnot";
/** Fallback when Gnoswap leaves ugnot.usd empty (common on Sapphire indexer). */
const DEFAULT_GNOT_USD = Number(process.env.GNOT_USD) > 0 ? Number(process.env.GNOT_USD) : 235;

async function fetchGnoswapFx() {
  const hit = cacheGet("fx:gnoswap");
  if (hit) return hit;
  const empty = {
    gnotUsd: DEFAULT_GNOT_USD,
    byPath: {},
    source: "fallback",
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
        // Prefer ORACLE grade for ugnot
        if (!gnotUsd || grade === "ORACLE") {
          gnotUsd = usd;
          gnotSource = "gnoswap";
        }
      }
    }
    // Sapphire indexer often returns empty ugnot.usd — keep UI $ metrics alive
    if (!(gnotUsd > 0)) {
      gnotUsd = DEFAULT_GNOT_USD;
      gnotSource = "fallback";
    }
    const fx = {
      gnotUsd,
      byPath,
      source: gnotSource || "gnoswap",
      updatedAt: Date.now(),
    };
    cacheSet("fx:gnoswap", fx, 60_000);
    return fx;
  } catch {
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
  const mcapGnot = Number(m.mcapGnot) || 0;
  const raisedGnot = Number(m.raisedGnot) || 0;
  const circMcapGnot = Number(m.circMcapGnot) || 0;

  let priceUsd = gnotUsd > 0 && priceGnot > 0 ? priceGnot * gnotUsd : 0;
  let mcapUsd = gnotUsd > 0 && mcapGnot > 0 ? mcapGnot * gnotUsd : 0;
  let priceSource = priceUsd > 0 ? "gnot_fx" : null;

  const key = marketTokenKey(m);
  const direct = key && fx?.byPath?.[key];
  if (direct && direct.usd > 0 && direct.grade === "ORACLE") {
    priceUsd = direct.usd;
    priceSource = "gnoswap_oracle";
    // If indexer also has marketCap, prefer it for listed tokens
    if (direct.marketCap > 0) mcapUsd = direct.marketCap;
    else if (gnotUsd > 0 && mcapGnot > 0) mcapUsd = mcapGnot * gnotUsd;
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

function parseLaunchInfo(line, totalSupply = 1_000_000_000, gradUgnot = 50_000_000) {
  const p = line.split("|");
  if (p.length < 15) return null;
  const status = Number(p[3]);
  const raised = Number(p[4]);
  const sold = Number(p[5]);
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
    gnoswapPoolPath: p[18] || "",
    gnoswapNote: p[19] || "",
    // padv23+: listVenue (e.g. "gnoswap"); empty if unlisted / older pads
    listVenue: p[20] || (p[17] === "1" ? "gnoswap" : ""),
    progressPct: status === 1 ? 100 : Math.min(100, Math.floor((raised * 100) / gradUgnot)),
  };
  return enrichPricing(m, totalSupply);
}

async function getParams(RPC, PKG) {
  try {
    const raw = await qeval(RPC, PKG, `${PKG}.ParamsInfo()`);
    const p = String(raw).split("|");
    const graduation = Number(p[3]);
    const createBond = Number(p[5]);
    // padv20+: listFeeGns (Create-time GNS escrow). Older pads omit field.
    let listFeeGns = Number(p[6]);
    if (!Number.isFinite(listFeeGns) || listFeeGns < 0) listFeeGns = 0;
    return {
      totalSupply: Number(p[0]),
      curveSupply: Number(p[1]),
      poolSeed: Number(p[2]),
      graduation,
      graduationGnot: graduation / UGNOT_PER_GNOT,
      feeBps: Number(p[4]),
      createBond,
      createBondGnot: createBond / UGNOT_PER_GNOT,
      listFeeGns,
      listFeeGnsUnits: listFeeGns / 1e6,
      ugnotPerGnot: UGNOT_PER_GNOT,
    };
  } catch {
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
 * - Versioned pads with v < MIN_PUBLIC_PAD_VERSION
 * - Hub keys named legacy*
 */
function isRetiredPadVersion(pkgOrKey) {
  const s = String(pkgOrKey || "").toLowerCase();
  if (/(?:^|[/_.-])legacy(?:$|[/_.-])/.test(s) || s.startsWith("legacy")) return true;
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
  let idsRaw = "";
  try {
    idsRaw = await qeval(RPC, PKG, `${PKG}.ListIDs()`);
  } catch (e) {
    return {
      params,
      protocolFees: 0,
      markets: [],
      error: String(e.message || e),
      ...meta,
    };
  }
  const ids = String(idsRaw)
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const markets = [];
  for (const id of ids) {
    try {
      const info = await qeval(RPC, PKG, `${PKG}.LaunchInfo(${JSON.stringify(id)})`);
      const parsed = parseLaunchInfo(String(info), params.totalSupply, params.graduation);
      if (parsed) {
        if (parsed.status !== 1 && params.graduation > 0) {
          parsed.progressPct = Math.min(100, Math.floor((parsed.raised * 100) / params.graduation));
        }
        enrichPricing(parsed, params.totalSupply);
        parsed.pkg = PKG;
        parsed.sourceKey = meta.sourceKey || "pad";
        parsed.active = !!meta.active;
        parsed.legacy = !!meta.legacy;
        parsed.padLabel = String(PKG).split("/").pop() || "pad";
        // padv14+: WUGNOT collateral (list endpoint must expose this for UI buy path)
        parsed.collateral = /padv1[4-9]\b|padv[2-9]\d\b/i.test(String(PKG))
          ? "wugnot"
          : "ugnot";
        try {
          const pa = String(await qeval(RPC, PKG, `${PKG}.PadAddress()`) || "").replace(
            /^"|"$/g,
            "",
          );
          if (/^g1[a-z0-9]+$/i.test(pa)) parsed.padAddr = pa;
        } catch {
          /* optional */
        }
        const rem = remainingRaiseUgnot(parsed, params.graduation);
        parsed.remainingRaiseUgnot = rem;
        parsed.remainingRaiseGnot = rem / UGNOT_PER_GNOT;
        markets.push(parsed);
      }
    } catch (e) {
      markets.push({
        id,
        pkg: PKG,
        sourceKey: meta.sourceKey,
        active: !!meta.active,
        legacy: !!meta.legacy,
        error: String(e.message || e),
      });
    }
  }
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
    ...meta,
  };
}

/** Aggregate markets across active + legacy pads. */
async function getMarkets(RPC, sources) {
  if (!Array.isArray(sources) || sources.length === 0) {
    return { params: null, protocolFees: 0, protocolFeesGnot: 0, markets: [], count: 0, sources: [] };
  }
  const active = sources.find((s) => s.active) || sources[0];
  const parts = await Promise.all(
    sources.map((s) =>
      getMarketsOne(RPC, s.pkg, {
        sourceKey: s.key,
        active: s.active,
        legacy: s.legacy,
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

  // Listed tokens: pad poolUgnot/poolToken freezes at list time — refresh
  // spot from recent Gnoswap swaps so Markets cards match Token page.
  await enrichListedMarketsFromGnoswap(RPC, markets, parts);

  const params = (parts.find((p) => p.active) || parts[0])?.params || null;
  return {
    params,
    protocolFees,
    protocolFeesGnot: protocolFees / UGNOT_PER_GNOT,
    markets,
    count: markets.length,
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
 * For gnoswapListed markets, pull last swap mark (cached) and recompute mcap.
 * Volume on cards still comes from /api/activity (already merges DEX).
 */
async function enrichListedMarketsFromGnoswap(RPC, markets, parts = []) {
  const supplyByPkg = new Map();
  for (const part of parts || []) {
    const supply = Number(part?.params?.totalSupply) || 1_000_000_000;
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
            const supply = supplyByPkg.get(m.pkg) || 1_000_000_000;
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
      // Live on-chain Gnoswap pool TVL only (does not rewrite spot/chart mark)
      try {
        await enrichLiveGnoswapLiquidity(RPC, m);
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
 * Post-list swaps live on Gnoswap, not pad TradeHistory.
 * Fetch recent WUGNOT↔token swaps for chart continuity after listing.
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
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8_000);
    const res = await fetch(`${GNOSWAP_API_BASE}/swap/history?${qs}`, {
      signal: ctrl.signal,
      headers: { Accept: "application/json" },
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`swap history HTTP ${res.status}`);
    const body = await res.json();
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
    cacheSet(cacheKey, points, 25_000);
    return points;
  } catch {
    cacheSet(cacheKey, [], 10_000);
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

async function getMarket(RPC, PKG, id, meta = {}) {
  const params = await getParams(RPC, PKG);
  const info = await qeval(RPC, PKG, `${PKG}.LaunchInfo("${id}")`);
  const m = parseLaunchInfo(String(info), params.totalSupply, params.graduation);
  if (!m) throw new Error("bad LaunchInfo");
  if (m.status !== 1 && params.graduation > 0) {
    m.progressPct = Math.min(100, Math.floor((m.raised * 100) / params.graduation));
  }
  enrichPricing(m, params.totalSupply);
  {
    const rem = remainingRaiseUgnot(m, params.graduation);
    m.remainingRaiseUgnot = rem;
    m.remainingRaiseGnot = rem / UGNOT_PER_GNOT;
  }
  m.params = params;
  m.pkg = PKG;
  m.sourceKey = meta.sourceKey || "";
  m.active = meta.active !== false && !meta.legacy;
  m.legacy = !!meta.legacy;
  m.padLabel = String(PKG).split("/").pop() || "pad";
  // padv14+: WUGNOT curve collateral (auto-list at graduate)
  m.collateral = /padv1[4-9]\b|padv[2-9]\d\b/i.test(String(PKG)) ? "wugnot" : "ugnot";
  try {
    const pa = String(await qeval(RPC, PKG, `${PKG}.PadAddress()`) || "").replace(/^"|"$/g, "");
    if (/^g1[a-z0-9]+$/i.test(pa)) m.padAddr = pa;
  } catch {
    /* optional */
  }
  try {
    const hist = await qeval(RPC, PKG, `${PKG}.TradeHistory(${JSON.stringify(id)})`);
    m.chart = parseTradeHistory(hist).map((pt) => ({
      ...pt,
      // pad Price = ugnot_per_token * 1e6 → GNOT/token = price / 1e6 / 1e6
      priceGnot: Number(pt.price) / 1_000_000 / UGNOT_PER_GNOT,
      volumeGnot: (Number(pt.ugnot) || 0) / UGNOT_PER_GNOT,
    }));
  } catch {
    m.chart = [];
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

  // After Gnoswap list: pad TradeHistory stops; keep chart alive via indexer swaps
  if (m.gnoswapListed) {
    try {
      const tokenKey = marketTokenKey(m);
      if (tokenKey) {
        const dexPts = await fetchGnoswapSwapHistory(tokenKey, 80);
        if (dexPts.length) {
          m.chart = mergeChartPoints(m.chart, dexPts);
          m.chartSources = {
            curve: (m.chart || []).filter((p) => p.source === "curve" || p.source === "lp").length,
            gnoswap: (m.chart || []).filter((p) => p.source === "gnoswap").length,
          };
        }
      }
    } catch {
      /* non-fatal — UI still has curve history + local trades */
    }
  }

  m.tradeStats = summarizeTradeStats(m.chart || []);
  // Real DEX swaps only (exclude injected list/LP rows that also use source=gnoswap)
  const dexSwapPts = (m.chart || []).filter(
    (p) => p.source === "gnoswap" && (Number(p.side) === 0 || Number(p.side) === 1),
  );
  m.dexHistoryEmpty = m.gnoswapListed ? dexSwapPts.length === 0 : null;
  m.volumeScope = !m.gnoswapListed
    ? "curve"
    : dexSwapPts.length > 0
      ? "curve_and_dex"
      : "curve_only";
  if (m.volumeScope === "curve_only") {
    m.volumeNote =
      "Volume from bonding-curve trades only — Gnoswap swap history unavailable for this token.";
  }

  // Spot for valuation:
  //  - Listed + DEX history → last Gnoswap trade
  //  - Listed + no DEX history → frozen pool_mark (same as Markets cards)
  //  - On curve → last curve trade when useful
  const lastDexPx = lastTradePriceGnot(m.chart, "gnoswap");
  const lastAnyPx = lastTradePriceGnot(m.chart);
  const poolPx = Number(m.priceGnot) || 0;
  const supply = Number(params.totalSupply) || 1_000_000_000;
  let spotGnot = poolPx;
  let spotSource = m.priceSource || (m.status === 1 ? "pool_mark" : "curve");
  if (m.gnoswapListed && lastDexPx != null && lastDexPx > 0) {
    spotGnot = lastDexPx;
    spotSource = "gnoswap_last_trade";
  } else if (m.gnoswapListed) {
    spotGnot = poolPx > 0 ? poolPx : lastAnyPx;
    spotSource = poolPx > 0 ? "pool_mark" : "last_trade";
  } else if (lastAnyPx != null && lastAnyPx > 0 && (!poolPx || m.status !== 1)) {
    spotGnot = lastAnyPx;
    spotSource = "last_trade";
  }
  applySpotPrice(m, spotGnot > 0 ? spotGnot : poolPx, supply, spotSource);

  // Listed: live on-chain Gnoswap pool balances (total TVL), not raise/seed snapshot.
  // Does not rewrite spotGnot — chart mark stays on last trade / pad mark.
  if (m.gnoswapListed) {
    try {
      await enrichLiveGnoswapLiquidity(RPC, m);
    } catch {
      /* keep seed/list-note fallback */
    }
  }

  // Entry: market VWAP of all curve buys (shared cost basis — no per-wallet ledger)
  const vwapBuy = marketVwapBuyGnot(m.chart);
  const openPriceGnot =
    vwapBuy ??
    (m.chart || []).find((pt) => Number(pt.side) === 0 && Number(pt.priceGnot) > 0)?.priceGnot ??
    lastAnyPx ??
    null;
  m.openPriceGnot = openPriceGnot;
  m.avgEntryGnot = vwapBuy;
  m.pnlBasis = vwapBuy != null ? "vwap_buy" : openPriceGnot != null ? "first_buy" : null;

  // Holders / buyers (padv7+ ListBuyers; graceful on older pads)
  m.holders = [];
  m.holdersNote = null;
  try {
    const buyersRaw = await qeval(RPC, PKG, `${PKG}.ListBuyers(${JSON.stringify(id)})`);
    const addrs = String(buyersRaw || "")
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => /^g1[a-z0-9]{38,}$/i.test(s))
      .slice(0, 40);
    const holders = [];
    const supply = Number(params.totalSupply) || 1e9;
    const px = Number(m.spotGnot || m.priceGnot) || 0;
    const entry = openPriceGnot;
    // Parallel balance reads (capped)
    await Promise.all(
      addrs.map(async (addr) => {
        try {
          const bal = Number(
            await qeval(RPC, PKG, `${PKG}.BalanceOf(${JSON.stringify(id)}, ${JSON.stringify(addr)})`),
          );
          if (bal > 0) {
            const valueGnot = px > 0 ? bal * px : 0;
            // Unrealized PnL vs market VWAP entry (shared; not personal cost basis)
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
              pctSupply: supply > 0 ? (bal / supply) * 100 : 0,
              pnlGnot,
              pnlPct,
              entryGnot: entry,
              spotGnot: px,
            });
          }
        } catch {
          /* skip */
        }
      }),
    );
    holders.sort((a, b) => (b.balance || 0) - (a.balance || 0));
    m.holders = holders;
    m.holdersActive = holders.length;
    // Cap = ListBuyers query truncated (pad max 100), not "buyers > holders with bal"
    m.holdersCapped = addrs.length >= 40 || addrs.length >= 100;
    m.holdersSource = "ListBuyers";
    m.holdersLabel = m.gnoswapListed ? "Curve buyers" : "Holders";
    // UniqueBuyers = ever bought on pad curve — not full GRC20/DEX holders
    m.holdersNote = m.gnoswapListed
      ? "Showing curve buyers with balance > 0 (pad ListBuyers). Wallets that only bought on Gnoswap are not listed."
      : holders.length < (m.buyers || 0)
        ? "Some curve buyers sold to zero balance."
        : null;
  } catch {
    m.holdersNote =
      "Holder list needs pad ListBuyers (deploy padv7+). Showing trade-size leaders from history instead.";
    m.holdersSource = null;
  }

  // Top trades by size (always available from trade ring)
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

  return m;
}

/**
 * Attach approximate ISO/ms timestamps to trade points using chain tip height + time.
 * TradeHistory only stores block height; Sapphire ~2s blocks (fallback).
 */
async function stampTradeTimes(RPC, chart) {
  if (!chart?.length) return;
  let tipH = 0;
  let tipMs = Date.now();
  try {
    const st = await rpc(RPC, "status", {});
    tipH = Number(st?.sync_info?.latest_block_height || 0);
    const t = Date.parse(st?.sync_info?.latest_block_time || "");
    if (Number.isFinite(t)) tipMs = t;
  } catch {
    /* use Date.now */
  }
  const BLOCK_MS = 2000;
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
      // height-less curve marks: keep any existing stamp
      if (!(Number(pt.timeMs) > 0) && pt.time) {
        const p = Date.parse(pt.time);
        if (Number.isFinite(p)) pt.timeMs = p;
      }
      continue;
    }
    if (tipH > 0 && h <= tipH) {
      pt.timeMs = tipMs - (tipH - h) * BLOCK_MS;
    } else {
      pt.timeMs = tipMs;
    }
    pt.time = new Date(pt.timeMs).toISOString();
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

/** Resolve which pad package owns launch id (try query pkg first, then sources). */
async function resolveMarketPkg(RPC, id, preferredPkg, sources) {
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
      });
      return m;
    } catch {
      /* try next pad */
    }
  }
  throw new Error(`Market ${id} not found on any pad`);
}

async function bankUgnot(RPC, address) {
  try {
    const result = await rpc(RPC, "abci_query", {
      path: `bank/balances/${address}`,
      data: "",
      height: "0",
      prove: false,
    });
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
  const { markets, params } = await getMarkets(RPC, sources);
  const holdings = [];
  let memePositions = 0;
  for (const m of markets) {
    if (m.error) continue;
    const pkg = m.pkg || sources[0]?.pkg;
    const bal = await tokenBalance(RPC, pkg, m.id, address);
    if (bal <= 0) continue;
    memePositions += 1;
    holdings.push({
      id: m.id,
      name: m.name,
      symbol: m.symbol,
      status: m.status,
      statusLabel: m.statusLabel,
      tokenId: m.tokenId || "",
      pkg,
      legacy: !!m.legacy,
      padLabel: m.padLabel || String(pkg).split("/").pop(),
      balance: bal,
      spotScaled: m.virtualToken
        ? Math.floor((m.virtualUgnot * 1e6) / m.virtualToken)
        : m.poolToken
          ? Math.floor((m.poolUgnot * 1e6) / m.poolToken)
          : 0,
      valueUgnotApprox: m.virtualToken
        ? Math.floor((bal * m.virtualUgnot) / m.virtualToken)
        : m.poolToken
          ? Math.floor((bal * m.poolUgnot) / m.poolToken)
          : 0,
      priceGnot: m.priceGnot || 0,
      mcapGnot: m.mcapGnot || 0,
      priceUsd: m.priceUsd || 0,
      mcapUsd: m.mcapUsd || 0,
      gnotUsd: m.gnotUsd || 0,
    });
  }
  for (const h of holdings) {
    h.valueGnotApprox = (h.valueUgnotApprox || 0) / UGNOT_PER_GNOT;
    const gnotUsd = Number(h.gnotUsd) || 0;
    h.valueUsdApprox =
      gnotUsd > 0 && h.valueGnotApprox > 0 ? h.valueGnotApprox * gnotUsd : 0;
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
    params,
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
  return {
    address,
    launches: mine,
    count: mine.length,
    totalFees,
    totalFeesGnot: totalFees / UGNOT_PER_GNOT,
    totalRaised,
    totalRaisedGnot: totalRaised / UGNOT_PER_GNOT,
    graduated,
    canSign: false,
    params,
  };
}

function json(statusCode, body, opts = {}) {
  const maxAge = Number(opts.maxAge) || 0;
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Cache-Control":
        maxAge > 0
          ? `public, max-age=${maxAge}, s-maxage=${maxAge}, stale-while-revalidate=${maxAge * 2}`
          : "no-store",
      ...(opts.headers || {}),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  };
}

/**
 * Aggregate recent trades across pads:
 *  - on-chain TradeHistory (curve / pre-list)
 *  - Gnoswap swap history for listed markets (same source as Token Trades tab)
 * limit: max events returned (default 40).
 */
async function getActivity(RPC, sources, limit = 40) {
  const cap = Math.min(80, Math.max(5, Number(limit) || 40));
  const { markets } = await getMarkets(RPC, sources);
  const events = [];
  // Prefer active markets first, then by recency of launch
  const sorted = [...markets]
    .filter((m) => !m.error)
    .sort((a, b) => {
      if (!!a.legacy !== !!b.legacy) return a.legacy ? 1 : -1;
      // Listed markets often have the only live volume post-grad — keep them near front
      if (!!a.gnoswapListed !== !!b.gnoswapListed) return a.gnoswapListed ? -1 : 1;
      return (Number(b.created) || 0) - (Number(a.created) || 0);
    })
    .slice(0, 24);

  await Promise.all(
    sorted.map(async (m) => {
      // 1) Pad TradeHistory (curve + LP marks while ring still has data)
      try {
        const hist = await qeval(
          RPC,
          m.pkg,
          `${m.pkg}.TradeHistory(${JSON.stringify(m.id)})`,
        );
        const pts = parseTradeHistory(hist);
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
      } catch {
        /* skip curve history */
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
        } catch {
          /* skip dex history */
        }
      }
    }),
  );

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
  return {
    events: capped,
    count: capped.length,
    scannedMarkets: sorted.length,
    sources: {
      curve: capped.filter((e) => e.source !== "gnoswap").length,
      gnoswap: capped.filter((e) => e.source === "gnoswap").length,
    },
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
        entry.params = {
          graduationGnot: params.graduationGnot,
          createBondGnot: params.createBondGnot,
          feeBps: params.feeBps,
        };
      } else if (kind === "profile") {
        entry.ok = true;
        entry.count = Number(await qeval(RPC, path, `${path}.ProfileCount()`)) || 0;
      } else if (kind === "meta") {
        entry.ok = true;
        entry.count = Number(await qeval(RPC, path, `${path}.MetaCount()`)) || 0;
      } else if (kind === "points") {
        entry.ok = true;
        entry.userCount = Number(await qeval(RPC, path, `${path}.UserCount()`)) || 0;
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
      const raiseNeed = Number(params?.graduation) || 10_000_000_000;
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
        raiseNeedGnot: raiseNeed / UGNOT_PER_GNOT,
        feeGnsNeed,
        lpReady: wugnot >= raiseNeed,
        feeReady: gns >= feeGnsNeed,
        listReady: wugnot >= raiseNeed && gns >= feeGnsNeed,
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
async function readPadFeeSnapshot(RPC, pkgPath) {
  if (!pkgPath) return null;
  const label = String(pkgPath).split("/").pop() || pkgPath;
  try {
    const raw = String(await qeval(RPC, pkgPath, `${pkgPath}.AdminInfo()`) || "");
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
  } catch {
    /* try FeeInfo fallback */
  }
  try {
    const fi = String(await qeval(RPC, pkgPath, `${pkgPath}.FeeInfo()`) || "");
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
 */
async function getAdminDashboard(RPC, cfg, hubInfo, padSources, PKG) {
  const ops = await getOps(RPC, cfg, hubInfo, padSources);
  const { markets, params, protocolFees, protocolFeesPaid, protocolAddr } =
    await getMarketsOne(RPC, PKG, { sourceKey: "pad", active: true, legacy: false });

  // Active pad snapshot + fees across discovered pads and recent versioned pads
  // (hub often only registers legacy_padv3–6; padv8–11 still hold claimable fees).
  const feePkgs = [];
  const seen = new Set();
  function addFeePkg(p) {
    if (!p || seen.has(p) || isRetiredPadVersion(p)) return;
    seen.add(p);
    feePkgs.push(p);
  }
  addFeePkg(PKG);
  for (const s of padSources || []) addFeePkg(s.pkg);
  const addrMatch = String(PKG).match(/gno\.land\/r\/(g1[a-z0-9]+)\/gnomemepad\//i);
  const feeAddr = addrMatch?.[1] || DEFAULT_ADDR;
  for (let v = 8; v <= 20; v++) {
    addFeePkg(`gno.land/r/${feeAddr}/gnomemepad/padv${v}`);
  }

  const feeSnaps = (
    await Promise.all(feePkgs.map((p) => readPadFeeSnapshot(RPC, p)))
  ).filter(Boolean);

  const activeSnap =
    feeSnaps.find((s) => s.pkg === PKG) || feeSnaps[0] || null;

  let pending = activeSnap?.pending ?? protocolFees ?? 0;
  let paid = activeSnap?.paid ?? protocolFeesPaid ?? 0;
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

  const proto =
    activeSnap?.protocolAddr ||
    protocolAddr ||
    "";
  const padAddr = activeSnap?.padAddr || "";
  let padBankUgnot = 0;
  if (padAddr && /^g1[a-z0-9]+$/i.test(padAddr)) {
    try {
      padBankUgnot = await bankUgnot(RPC, padAddr);
    } catch {
      /* ignore */
    }
  }
  const reserved = activeSnap?.reserved ?? 0;
  const freeUgnot = Math.max(0, padBankUgnot - reserved);

  let listed = 0;
  let graduated = 0;
  let curve = 0;
  let totalRaised = 0;
  let totalCreatorFees = 0;
  for (const m of markets || []) {
    if (m.error) continue;
    if (m.status === 1) graduated += 1;
    else curve += 1;
    if (m.gnoswapListed) listed += 1;
    totalRaised += m.raised || 0;
    totalCreatorFees += m.creatorFees || 0;
  }

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
      tradeFeeBps: params?.feeBps ?? 120,
      protocolShareBps: 4000, // 40% of fee → protocol
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
      total: (markets || []).filter((m) => !m.error).length,
      curve,
      graduated,
      gnoswapListed: listed,
      totalRaised,
      totalRaisedGnot: totalRaised / UGNOT_PER_GNOT,
      totalCreatorFees,
      totalCreatorFeesGnot: totalCreatorFees / UGNOT_PER_GNOT,
    },
    params: params || null,
    ops,
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

  // Network catalog (no RPC required)
  if (method === "GET" && (p === "/api/networks" || p === "/api/networks/")) {
    return json(
      200,
      {
        ok: true,
        defaultNetwork: DEFAULT_NETWORK_ID,
        selected: networkId,
        networks: listNetworks(),
      },
      { maxAge: 60 },
    );
  }

  if (cfg.comingSoon || !cfg.enabled || !cfg.PKG || !cfg.RPC) {
    return json(503, {
      ok: false,
      error: `${cfg.label || networkId} is not available yet`,
      network: networkId,
      comingSoon: true,
    });
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
      try {
        const st = await rpc(RPC, "status", {});
        return json(200, {
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
        });
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
        if (hit) return json(200, { ...hit, cached: true }, { maxAge: 12 });
      }
      const act = await getActivity(RPC, padSources, limit);
      cacheSet(aKey, act, 15_000);
      return json(200, act, { maxAge: 12 });
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

    if (method === "GET" && p === "/api/admin") {
      // Public read; UI gates by wallet === protocolAddr | signerAddr
      const aKey = `admin:${PKG}`;
      if (!noCache) {
        const hit = cacheGet(aKey);
        if (hit) return json(200, { ...hit, cached: true }, { maxAge: 12 });
      }
      const admin = await getAdminDashboard(RPC, cfg, hubInfo, padSources, PKG);
      cacheSet(aKey, admin, 15_000);
      return json(200, admin, { maxAge: 12 });
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
    if (method === "GET" && p === "/api/create-need") {
      let padPkg = String(q.get("pkg") || PKG || "").trim();
      if (!padPkg.startsWith("gno.land/")) padPkg = PKG;
      const params = await getParams(RPC, padPkg);
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
      try {
        const lf = Number(await qeval(RPC, padPkg, `${padPkg}.ListFeeRequired()`));
        if (Number.isFinite(lf) && lf > 0) listFeeGns = lf;
      } catch {
        /* older pad */
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
      try {
        const raw = String(await qeval(RPC, padPkg, `${padPkg}.ListVenues()`) || "");
        const defaultVenue = String(
          await qeval(RPC, padPkg, `${padPkg}.DefaultListVenue()`).catch(() => "gnoswap"),
        )
          .replace(/^"|"$/g, "")
          .trim() || "gnoswap";
        const venues = String(raw)
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
            };
          })
          .filter((v) => v.id);
        return json(
          200,
          {
            ok: true,
            pkg: padPkg,
            defaultVenue,
            venues,
            raw: String(raw).replace(/^"|"$/g, ""),
          },
          { maxAge: 30 },
        );
      } catch (e) {
        // Older pads: only Gnoswap exists
        return json(200, {
          ok: true,
          pkg: padPkg,
          defaultVenue: "gnoswap",
          venues: [{ id: "gnoswap", label: "Gnoswap", enabled: true, feeAssetHint: "GNS" }],
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

    if (method === "GET" && p === "/api/markets") {
      const mKey = `markets:${padSources.map((s) => s.pkg).join(",")}`;
      if (!noCache) {
        const hit = cacheGet(mKey);
        if (hit) return json(200, { ...hit, cached: true }, { maxAge: 15 });
      }
      const markets = await withUsdPricing(await getMarkets(RPC, padSources));
      cacheSet(mKey, markets, 20_000);
      return json(200, markets, { maxAge: 15 });
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
        chainId: CHAIN_ID || "sapphire-1",
      });
      const format = String(q.get("format") || "plan").toLowerCase();
      if (format === "grc20" || format === "sapphire") {
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
        chainId: CHAIN_ID || "sapphire-1",
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
        priceSource: m.priceSource || null,
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
        trades,
        count: trades.length,
      });
    }

    if (method === "GET" && p.startsWith("/api/market/")) {
      const id = decodeURIComponent(p.slice("/api/market/".length));
      const pkgQ = (q.get("pkg") || "").trim();
      return json(
        200,
        await withUsdPricing(await resolveMarketPkg(RPC, id, pkgQ || null, padSources)),
      );
    }

    if (method === "GET" && p === "/api/render") {
      const sub = q.get("path") || "";
      const md = await qrender(RPC, PKG, sub);
      return json(200, { markdown: md });
    }

    if (method === "GET" && p === "/api/params") {
      return json(200, await getParams(RPC, PKG));
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
