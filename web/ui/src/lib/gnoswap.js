/**
 * Gnoswap (Sapphire) deep-links + Adena / grc20reg path helpers.
 *
 * Path formats (do NOT mix them up):
 *
 *   Pad package (realm):
 *     gno.land/r/.../gnomemepad/padv20
 *
 *   Token.ID (GRC20 identity — NOT for Adena "Add custom token"):
 *     gno.land/r/.../gnomemepad/padv20.GNOMIES.0000001
 *
 *   Adena / grc20reg / Gnoswap pool token key (correct):
 *     gno.land/r/.../gnomemepad/padv20.GNOMIES
 *
 *   Pool path on-chain:
 *     <tokenKey>:<wugnotKey>:<fee>
 *     e.g. .../padv20.GNOMIES:gno.land/r/gnoland/wugnot.wugnot:3000
 */

export const GNOSWAP_APP = "https://beta.gnoswap.io";
export const WUGNOT_PKG = "gno.land/r/gnoland/wugnot";
export const WUGNOT_KEY = "gno.land/r/gnoland/wugnot.wugnot";
export const DEFAULT_FEE = 3000;

const WUGNOT_MARKERS = [
  "gno.land/r/gnoland/wugnot.wugnot",
  "gno.land/r/gnoland/wugnot",
  "wugnot",
  "ugnot",
];

function isWugnotKey(s) {
  const t = String(s || "").trim().toLowerCase();
  if (!t) return false;
  return WUGNOT_MARKERS.some((m) => t === m.toLowerCase() || t.endsWith("/wugnot") || t.endsWith(".wugnot"));
}

/**
 * Extract meme token key from gnoswapPoolPath (token0:token1:fee).
 * Prefers the non-WUGNOT side.
 */
export function tokenKeyFromPoolPath(poolPath) {
  const s = String(poolPath || "").trim();
  if (!s) return "";
  const parts = s.split(":").filter(Boolean);
  if (parts.length < 2) return "";
  // last segment may be fee
  const fee = Number(parts[parts.length - 1]);
  const tokens = Number.isFinite(fee) && fee > 0 ? parts.slice(0, -1) : parts;
  const meme = tokens.find((p) => !isWugnotKey(p));
  return meme || tokens[0] || "";
}

/**
 * Adena “Add Custom Token” + grc20reg + Gnoswap token path.
 * NEVER return Token.ID with trailing .seq (…SYMBOL.0000001).
 */
export function adenaTokenKey(m) {
  if (!m) return "";

  // 1) Prefer key embedded in pool path (authoritative after list)
  const fromPool = tokenKeyFromPoolPath(m.gnoswapPoolPath);
  if (fromPool) return fromPool;

  const sym = String(m.symbol || "").trim();
  const tid = String(m.tokenId || m.TokenID || m.tokenPath || "").trim();

  // 2) Strip .seq from Token.ID → packagePath.SYMBOL
  if (tid && sym) {
    const marker = `.${sym}.`;
    const i = tid.lastIndexOf(marker);
    if (i >= 0) return tid.slice(0, i) + `.${sym}`;
    // already packagePath.SYMBOL
    if (tid.endsWith(`.${sym}`) && !/\.\d+$/.test(tid.slice(tid.lastIndexOf(`.${sym}`) + sym.length + 1))) {
      return tid;
    }
    // Token.ID ends with .SYMBOL.digits
    const re = new RegExp(`\\.${sym.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.\\d+$`);
    if (re.test(tid)) return tid.replace(re, `.${sym}`);
  }

  // 3) Generic strip trailing .digits after last symbol-like segment
  if (tid && /\.\d+$/.test(tid)) {
    const stripped = tid.replace(/\.\d+$/, "");
    // only strip if looks like …SYMBOL.seq not a bare package ending in numbers
    if (stripped.includes(".")) return stripped;
  }

  // 4) pkg + SYMBOL
  const pkg = String(m.pkg || "").trim();
  if (pkg && sym) return `${pkg}.${sym}`;

  // 5) last resort: tid without seq, or pkg
  if (tid) return tid.replace(/\.\d+$/, "");
  return pkg;
}

/** Human-facing aliases */
export function adenaPath(m) {
  return adenaTokenKey(m);
}

/**
 * Stable SVG filename for gno-token-resource /grc20/images
 * (path-based like wugnot, avoids symbol collisions across pads).
 */
export function gnoTokenResourceImageName(m) {
  const path = adenaTokenKey(m) || String(m?.symbol || "token");
  const slug = path
    .replace(/^gno\.land\//, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  return `${slug || "token"}.svg`;
}

/**
 * Snippet for onbloc/gno-token-resource PR (Gnoswap reads logos from there).
 * Gnoswap does NOT use memepad meta/uri — only this registry after merge.
 * image field must be a relative path to an SVG under /grc20/images (not https).
 * Pad GRC20 uses decimals=0 (whole tokens).
 */
export function gnoTokenResourceEntry(m, { imageUrl = "", chainId = "sapphire-1" } = {}) {
  const path = adenaTokenKey(m);
  const sym = String(m?.symbol || "").trim().toUpperCase() || "TOKEN";
  const name = String(m?.name || sym).trim();
  const pkgPath = String(m?.pkg || path.replace(/\.[^.]+$/, "")).trim();
  const svgName = gnoTokenResourceImageName(m);
  // Registry schema: relative SVG only. Remote memepad URL is notes-only.
  const imageField = `/grc20/images/${svgName}`;
  return {
    name,
    token_path: path,
    pkg_path: pkgPath,
    symbol: sym,
    decimals: 0,
    chain_id: chainId,
    description: String(m?.description || `${name} ($${sym}) launched on Gnomi.fun.`).slice(0, 1500),
    website_url: "",
    twitter_url: "",
    discord_url: "",
    docs_url: "",
    image: imageField,
    // Not part of onbloc schema — stripped when submitting PR; used in copy-kit notes
    _gnomemepad_image: imageUrl || "",
  };
}

export function gnoTokenResourceJson(m, opts = {}) {
  return JSON.stringify(gnoTokenResourceEntry(m, opts), null, 2);
}

export const GNO_TOKEN_RESOURCE_URL =
  "https://github.com/onbloc/gno-token-resource#how-to-add-your-token";
export const GNO_TOKEN_RESOURCE_GRC20 =
  "https://github.com/onbloc/gno-token-resource/tree/main/grc20";

/** Full Token.ID (with .seq) — for display only, not Adena add-token. */
export function tokenIdFull(m) {
  return String(m?.tokenId || m?.TokenID || "").trim();
}

/** Parse fee tier from gnoswapPoolPath (last :segment). */
export function feeFromPoolPath(poolPath) {
  const s = String(poolPath || "").trim();
  if (!s) return DEFAULT_FEE;
  const parts = s.split(":");
  const last = parts[parts.length - 1];
  const n = Number(last);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_FEE;
}

/**
 * Deep-link to Gnoswap Swap page with tokens pre-selected.
 *
 * Official beta.gnoswap.io format (see SwapContainer + copyURL):
 *   /swap?from=<tokenA.path>&to=<tokenB.path>
 * Optional: token_a_amount / token_b_amount
 *
 * NOTE: Gnoswap only auto-selects if the token path exists in their token list API.
 * Custom memes may need one-time “import” in the token picker after landing.
 * Path must be grc20reg key (…/padvXX.SYMBOL), never Token.ID.seq and never pad package.
 */
export function gnoswapSwapUrl(m, { side = "buy", amount = "" } = {}) {
  const key = adenaTokenKey(m);
  if (!key) return `${GNOSWAP_APP}/swap`;

  // from = pay (tokenA), to = receive (tokenB) — matches Gnoswap copyURL
  const params = new URLSearchParams();
  if (side === "sell") {
    params.set("from", key);
    params.set("to", "ugnot");
  } else {
    params.set("from", "ugnot");
    params.set("to", key);
  }
  // Optional prefill amount (display units, Gnoswap reads token_a_amount)
  const amt = String(amount || "").trim();
  if (amt && Number(amt) > 0) {
    params.set("token_a_amount", amt);
  }
  return `${GNOSWAP_APP}/swap?${params.toString()}`;
}

/**
 * Token detail page on Gnoswap (path= meme, tokenA= ugnot).
 * Useful when /swap?to=… does not resolve because token is not in their list yet.
 */
export function gnoswapTokenPageUrl(m) {
  const key = adenaTokenKey(m);
  if (!key) return GNOSWAP_APP;
  const params = new URLSearchParams();
  params.set("path", key);
  params.set("tokenA", "ugnot");
  return `${GNOSWAP_APP}/token?${params.toString()}`;
}

/** Pool page deep-link (best-effort). */
export function gnoswapPoolUrl(m) {
  const path = String(m?.gnoswapPoolPath || "").trim();
  if (path) {
    // Earn pool often uses poolPath query
    return `${GNOSWAP_APP}/earn?poolPath=${encodeURIComponent(path)}`;
  }
  return `${GNOSWAP_APP}/earn`;
}

export function isGnoswapListed(m) {
  return !!(m && (m.gnoswapListed === true || m.gnoswapListed === 1 || m.gnoswapListed === "1"));
}

/** Sapphire Gnoswap router realm + bech32 (spender for Approve). */
export const ROUTER_PKG = "gno.land/r/gnoswap/router";
export const ROUTER_ADDR = "g1vc883gshu5z7ytk5cdynhc8c2dh67pdp4cszkp";
export const WUGNOT_PKG_PATH = "gno.land/r/gnoland/wugnot";

/** localStorage key: wallet already set large WUGNOT allowance for Gnoswap router */
export function gnoswapWugnotApproveKey(address) {
  return `gnomemepad.wugnotApproveRouter.${String(address || "").toLowerCase()}`;
}

/**
 * Build Adena multi-msg for ExactIn swap via Gnoswap router (one DoContract popup).
 * Buy: [Deposit?] + [Approve WUGNOT?] + ExactInSwapRoute
 * Sell: pad.Approve(token, router) + ExactInSwapRoute (output WUGNOT)
 *
 * opts:
 *   skipDeposit — wallet already has enough WUGNOT
 *   skipApprove — already approved router for large amount (local cache / known allowance)
 *   approveMax  — approve a large allowance once (reduces future Approve msgs)
 */
export function buildGnoswapExactInMessages(m, {
  side = "buy",
  amountIn,
  minOut = 0,
  padPkg = "",
  launchId = "",
  deadlineSec = 600,
  skipDeposit = false,
  skipApprove = false,
  approveMax = true,
} = {}) {
  const tokenKey = adenaTokenKey(m);
  if (!tokenKey) throw new Error("Token registry path unknown");
  const fee = feeFromPoolPath(m?.gnoswapPoolPath) || DEFAULT_FEE;
  const amtN = Math.trunc(Number(amountIn) || 0);
  const amt = String(amtN);
  const min = String(Math.trunc(Math.max(0, Number(minOut) || 0)));
  if (!amt || amt === "0") throw new Error("amountIn required");
  const deadline = String(Math.floor(Date.now() / 1000) + deadlineSec);
  // ~1e15 base units — enough for many swaps without re-approve each time
  const APPROVE_MAX = "1000000000000000";
  const msgs = [];

  if (side === "sell") {
    const route = `${tokenKey}:${WUGNOT_KEY}:${fee}`;
    const pkg = padPkg || m.pkg;
    const id = launchId || m.id;
    if (!pkg || !id) throw new Error("pad pkg + launch id required for sell Approve");
    msgs.push({
      pkgPath: pkg,
      func: "Approve",
      args: [String(id), ROUTER_ADDR, amt],
    });
    msgs.push({
      pkgPath: ROUTER_PKG,
      func: "ExactInSwapRoute",
      args: [tokenKey, WUGNOT_KEY, amt, route, "100", min, deadline, ""],
    });
  } else {
    const route = `${WUGNOT_KEY}:${tokenKey}:${fee}`;
    if (!skipDeposit) {
      msgs.push({
        pkgPath: WUGNOT_PKG_PATH,
        func: "Deposit",
        args: [],
        send: `${amt}ugnot`,
      });
    }
    if (!skipApprove) {
      msgs.push({
        pkgPath: WUGNOT_PKG_PATH,
        func: "Approve",
        args: [ROUTER_ADDR, approveMax ? APPROVE_MAX : amt],
      });
    }
    msgs.push({
      pkgPath: ROUTER_PKG,
      func: "ExactInSwapRoute",
      args: [WUGNOT_KEY, tokenKey, amt, route, "100", min, deadline, ""],
    });
  }
  return { messages: msgs, tokenKey, fee, approveMax };
}

/** Persist Gnoswap trades done in this browser (no public indexer). */
const LS_TRADES = "gnomemepad.gnoswapTrades.v1";

/** Normalize tx hash for dedupe (base64 / hex / 0x). */
export function normalizeTradeHash(h) {
  let s = String(h || "").trim();
  if (!s) return "";
  if (s.startsWith("0x") || s.startsWith("0X")) s = s.slice(2);
  // URL-safe base64 variants
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  return s.toLowerCase();
}

/**
 * Stable fingerprint for trade rows when hash missing.
 * Used to merge localStorage optimistic rows with indexer/API rows.
 * Note: local rows often use DrySwap quote as tokens-out while indexer has fill
 * amounts — so fingerprint is side + ugnot (notional) + time bucket, not exact tokens.
 */
export function tradeDedupeKey(t) {
  const hash = normalizeTradeHash(t?.hash || t?.txHash || t?.tx_hash);
  if (hash) return `h:${hash}`;
  const side = Number(t?.side);
  const ug = Math.round(Number(t?.ugnot) || 0);
  const tok = Math.round(Number(t?.tokens) || 0);
  const h = Number(t?.height) || 0;
  // Bucket time to 3 minutes so local Date.now() vs indexer wall-clock still match
  const tb = Math.floor((Number(t?.timeMs) || 0) / 180_000);
  // Gnoswap / amount-in based (buy ugnot in, sell tokens in as ugnot out on local)
  if (ug > 0 && (String(t?.source || "").includes("gnoswap") || !h)) {
    return `u:${side}|${ug}|${tb}`;
  }
  return `f:${side}|${ug}|${tok}|${h}|${tb}`;
}

/** Prefer API/indexer row over optimistic local (has hash, real tokens out, etc.). */
function preferTradeRow(a, b) {
  const score = (t) => {
    let s = 0;
    if (normalizeTradeHash(t?.hash || t?.txHash)) s += 4;
    if (Number(t?.tokens) > 0) s += 2;
    if (Number(t?.ugnot) > 0) s += 1;
    if (Number(t?.timeMs) > 0 && Number(t.timeMs) < Date.now() - 5_000) s += 1; // settled
    if (t?.source === "gnoswap" && t?.hash) s += 1;
    return s;
  };
  return score(a) >= score(b) ? a : b;
}

/**
 * Merge curve chart + local/API gnoswap rows without double-counting one tx.
 * One buy → one row even if both localStorage and indexer list it.
 */
export function mergeTradeRows(...lists) {
  const map = new Map();
  for (const list of lists) {
    for (const t of list || []) {
      if (!t) continue;
      const k = tradeDedupeKey(t);
      if (!k) continue;
      if (!map.has(k)) map.set(k, t);
      else map.set(k, preferTradeRow(map.get(k), t));
    }
  }
  return [...map.values()].sort((a, b) => {
    const tb = Number(b.timeMs) || 0;
    const ta = Number(a.timeMs) || 0;
    if (tb !== ta) return tb - ta;
    return (Number(b.height) || 0) - (Number(a.height) || 0);
  });
}

export function loadLocalGnoswapTrades(poolOrTokenKey) {
  try {
    const all = JSON.parse(localStorage.getItem(LS_TRADES) || "{}");
    const k = String(poolOrTokenKey || "");
    const list = Array.isArray(all[k]) ? all[k] : [];
    return list;
  } catch {
    return [];
  }
}

export function appendLocalGnoswapTrade(poolOrTokenKey, trade) {
  try {
    const all = JSON.parse(localStorage.getItem(LS_TRADES) || "{}");
    const k = String(poolOrTokenKey || "unknown");
    const list = Array.isArray(all[k]) ? all[k] : [];
    const key = tradeDedupeKey(trade);
    const next = key
      ? list.filter((t) => tradeDedupeKey(t) !== key)
      : list;
    next.unshift(trade);
    all[k] = next.slice(0, 100);
    localStorage.setItem(LS_TRADES, JSON.stringify(all));
  } catch {
    /* ignore quota */
  }
}

/** Map a local/API swap into TradesList row shape. */
export function toTradeRow({
  side = "buy",
  ugnot = 0,
  tokens = 0,
  height = 0,
  timeMs = Date.now(),
  source = "gnoswap",
  hash = "",
} = {}) {
  const u = Math.floor(Number(ugnot) || 0);
  const t = Math.floor(Number(tokens) || 0);
  const priceScaled =
    t > 0 ? Math.floor((u * 1_000_000) / t) : 0; // matches pad Trade.Price scale loosely
  return {
    height: Number(height) || 0,
    side: side === "sell" ? 1 : 0,
    sideLabel: side === "sell" ? "sell" : "buy",
    ugnot: u,
    tokens: t,
    price: priceScaled,
    priceGnot: t > 0 ? u / 1e6 / t : 0,
    volumeGnot: u / 1e6,
    timeMs: Number(timeMs) || Date.now(),
    source,
    hash: hash || "",
  };
}

/** Route string for docs/copy (matches on-chain pool order loosely). */
export function gnoswapRouteBuy(m) {
  const key = adenaTokenKey(m);
  const fee = feeFromPoolPath(m?.gnoswapPoolPath);
  return `${WUGNOT_KEY}:${key}:${fee}`;
}

export function gnoswapRouteSell(m) {
  const key = adenaTokenKey(m);
  const fee = feeFromPoolPath(m?.gnoswapPoolPath);
  return `${key}:${WUGNOT_KEY}:${fee}`;
}
