import {
  hasAdena,
  connectAdena,
  doContractCall,
  onAccountChange,
  openInstallAdena,
  DEFAULT_NETWORK,
} from "./adena.js";

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

const LS_WALLET = "gnomemepad.wallet.v1";
const LS_WATCHLIST = "gnomemepad.watchlist.v1";
const LS_MARKET_SORT = "gnomemepad.marketSort.v1";
const LS_NOTIFY = "gnomemepad.notify.v1";

const state = {
  view: "home",
  markets: [],
  params: null,
  selectedId: null,
  selectedPkg: null,
  padSources: [],
  marketFilter: "all", // pad: all | active | legacy
  statusFilter: "all", // all | curve | graduated | watch
  marketSort: "hot", // hot | newest | almost | buyers | raised | mcap
  tradeMode: "buy",
  wallet: null, // { address, label, canSign, type: 'adena'|'local'|'view' }
  walletsMeta: null,
  portfolio: null,
  creator: null,
  // from /api/health
  pkg: DEFAULT_NETWORK.pkg || null,
  hub: null,
  profilePkg: null,
  metaPkg: null,
  pointsPkg: null,
  modules: {},
  chainId: DEFAULT_NETWORK.chainId,
  rpcUrl: DEFAULT_NETWORK.rpcUrl,
  readOnlyHost: false,
  hosting: null,
  /** address -> { name, bio, uri, updated } | null (fetched empty) */
  profileCache: {},
  /** `${pkg}|${id}` -> meta | null */
  metaCache: {},
  /** Set of `${pkg}|${id}` */
  watchlist: new Set(),
  /**
   * Recent volume from /api/activity (ring samples, not calendar 24h).
   * key -> { volumeGnot, trades, buyVol, sellVol }
   */
  recentVol: {},
  /** Chart window: "all" | "32" | "16" */
  chartRange: "all",
};

function marketKey(id, pkg) {
  return `${id || ""}|${pkg || ""}`;
}

function loadWatchlist() {
  try {
    const raw = localStorage.getItem(LS_WATCHLIST);
    const arr = raw ? JSON.parse(raw) : [];
    state.watchlist = new Set(Array.isArray(arr) ? arr.map(String) : []);
  } catch {
    state.watchlist = new Set();
  }
}

function saveWatchlist() {
  try {
    localStorage.setItem(LS_WATCHLIST, JSON.stringify([...state.watchlist]));
  } catch {
    /* ignore */
  }
}

function isWatched(id, pkg) {
  return state.watchlist.has(marketKey(id, pkg));
}

function toggleWatch(id, pkg) {
  const k = marketKey(id, pkg);
  if (state.watchlist.has(k)) state.watchlist.delete(k);
  else state.watchlist.add(k);
  saveWatchlist();
  return state.watchlist.has(k);
}

function loadMarketSort() {
  try {
    const s = localStorage.getItem(LS_MARKET_SORT);
    if (s && ["hot", "volume", "newest", "almost", "buyers", "raised", "mcap"].includes(s)) {
      state.marketSort = s;
    }
  } catch {
    /* ignore */
  }
}

function saveMarketSort(s) {
  state.marketSort = s;
  try {
    localStorage.setItem(LS_MARKET_SORT, s);
  } catch {
    /* ignore */
  }
}

function raisedGnotOf(m) {
  if (!m) return 0;
  if (m.raisedGnot != null) return Number(m.raisedGnot) || 0;
  return (Number(m.raised) || 0) / UGNOT_PER_GNOT;
}

/** Safe image URL for meta (http/https/ipfs only). */
function safeImageUri(uri) {
  const u = String(uri || "").trim();
  if (!u) return "";
  if (u.startsWith("https://") || u.startsWith("http://")) return u;
  if (u.startsWith("ipfs://")) {
    const path = u.slice("ipfs://".length).replace(/^ipfs\//, "");
    return `https://ipfs.io/ipfs/${path}`;
  }
  return "";
}

function isValidMetaUri(uri) {
  const u = String(uri || "").trim();
  if (!u) return true;
  return (
    u.startsWith("https://") ||
    u.startsWith("http://") ||
    u.startsWith("ipfs://")
  );
}

/** Resize local image for preview (max edge px). Returns data URL. */
function resizeImageFile(file, maxEdge = 512) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read image"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Invalid image data"));
      img.onload = () => {
        let { width, height } = img;
        const scale = Math.min(1, maxEdge / Math.max(width, height));
        width = Math.max(1, Math.round(width * scale));
        height = Math.max(1, Math.round(height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Canvas unsupported"));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function prefetchMarketMeta(markets, limit = 24) {
  const list = (markets || []).filter((m) => m && !m.error && m.id);
  const need = [];
  for (const m of list) {
    const k = marketKey(m.id, m.pkg || "");
    if (Object.prototype.hasOwnProperty.call(state.metaCache, k)) continue;
    need.push({ pkg: m.pkg || "", id: m.id, key: k });
    if (need.length >= limit) break;
  }
  if (!need.length) return;
  // mark pending so we don't re-fetch
  for (const n of need) state.metaCache[n.key] = state.metaCache[n.key] ?? undefined;
  try {
    const items = need.map((n) => `${n.pkg}|${n.id}`).join(",");
    const data = await api(`/api/meta/batch?items=${encodeURIComponent(items)}`);
    const metas = data.metas || {};
    for (const n of need) {
      state.metaCache[n.key] =
        metas[n.key] !== undefined ? metas[n.key] : metas[`${n.pkg}|${n.id}`] ?? null;
    }
  } catch {
    // fallback: leave missing as null so we don't hammer
    for (const n of need) {
      if (state.metaCache[n.key] === undefined) state.metaCache[n.key] = null;
    }
  }
}

function getCachedMeta(id, pkg) {
  const k = marketKey(id, pkg);
  return Object.prototype.hasOwnProperty.call(state.metaCache, k) ? state.metaCache[k] : null;
}

function networkForAdena() {
  return {
    chainId: state.chainId || DEFAULT_NETWORK.chainId,
    chainName: "Gno Sapphire",
    rpcUrl: state.rpcUrl || DEFAULT_NETWORK.rpcUrl,
  };
}

function pkgPath() {
  return (
    state.pkg ||
    state.modules?.pad ||
    state.walletsMeta?.pkg ||
    "gno.land/r/g1mv0052e7r6s09f5t9xsqf00nj3tqsgt9dg52jr/gnomemepad/padv5"
  );
}

function profilePkgPath() {
  return (
    state.profilePkg ||
    state.modules?.profile ||
    "gno.land/r/g1mv0052e7r6s09f5t9xsqf00nj3tqsgt9dg52jr/gnomemepad/profile"
  );
}

function metaPkgPath() {
  return (
    state.metaPkg ||
    state.modules?.meta ||
    "gno.land/r/g1mv0052e7r6s09f5t9xsqf00nj3tqsgt9dg52jr/gnomemepad/meta"
  );
}

function pointsPkgPath() {
  return (
    state.pointsPkg ||
    state.modules?.points ||
    "gno.land/r/g1mv0052e7r6s09f5t9xsqf00nj3tqsgt9dg52jr/gnomemepad/points"
  );
}

/** gnoweb profile deep-link on Sapphire. */
function profileGnowebUrl(addr) {
  const a = String(addr || "").trim();
  if (!a) return "";
  const realm = profilePkgPath().replace(/^gno\.land\//, "");
  return `https://sapphire.testnets.gno.land/${realm}:user/${encodeURIComponent(a)}`;
}

/**
 * Fetch + cache on-chain profile for address.
 * @returns {Promise<{name,bio,uri,updated}|null>}
 */
async function fetchProfile(addr) {
  const a = String(addr || "").trim();
  if (!a || !/^g1[a-z0-9]{38,}$/i.test(a)) return null;
  if (Object.prototype.hasOwnProperty.call(state.profileCache, a)) {
    return state.profileCache[a];
  }
  try {
    const data = await api(`/api/profile?address=${encodeURIComponent(a)}`);
    const p = data.profile || null;
    state.profileCache[a] = p;
    return p;
  } catch {
    state.profileCache[a] = null;
    return null;
  }
}

/** Prefetch many addresses (unique, capped). */
async function prefetchProfiles(addrs, limit = 24) {
  const uniq = [...new Set((addrs || []).map((x) => String(x || "").trim()).filter(Boolean))];
  const need = uniq
    .filter((a) => !Object.prototype.hasOwnProperty.call(state.profileCache, a))
    .slice(0, limit);
  await Promise.all(need.map((a) => fetchProfile(a)));
}

/** Display name or short address. */
function profileDisplayName(addr) {
  const a = String(addr || "").trim();
  const p = state.profileCache[a];
  if (p?.name) return p.name;
  return shortAddr(a);
}

/** HTML chip: name + short addr + optional link. */
function renderPersonChip(addr, { link = true } = {}) {
  const a = String(addr || "").trim();
  if (!a) return "—";
  const p = state.profileCache[a];
  const name = p?.name ? escapeHtml(p.name) : "";
  const short = escapeHtml(shortAddr(a));
  const title = escapeHtml(a);
  const body = name
    ? `<span class="person-name">${name}</span> <span class="mono muted person-addr">${short}</span>`
    : `<span class="mono person-addr">${short}</span>`;
  if (!link) return `<span class="person-chip" title="${title}">${body}</span>`;
  const href = profileGnowebUrl(a);
  return `<a class="person-chip" href="${escapeHtml(href)}" target="_blank" rel="noreferrer" title="${title}">${body}${
    p?.name ? `<span class="badge profile-on" title="On-chain profile">P</span>` : ""
  }</a>`;
}

/** Call any realm func via Adena (not only pad). */
async function broadcastPkg(pkg, func, args = [], send = "") {
  if (state.wallet?.type === "adena" && state.wallet.canSign) {
    return doContractCall({
      caller: state.wallet.address,
      pkgPath: pkg,
      func,
      args,
      send: send || "",
      gasWanted: 40_000_000,
      gasFee: 1_000_000,
    });
  }
  throw new Error("Connect Adena to sign (profile uses on-chain realm)");
}

/**
 * Broadcast a realm call: Adena if connected as type=adena, else server gnokey API.
 * @param {string} [pkgOverride] — market pad path (legacy or active); default active pad
 */
async function broadcastRealm(func, args = [], send = "", pkgOverride = "") {
  const realmPkg = (pkgOverride || pkgPath()).trim();
  if (state.wallet?.type === "adena" && state.wallet.canSign) {
    return doContractCall({
      caller: state.wallet.address,
      pkgPath: realmPkg,
      func,
      args,
      send: send || "",
      gasWanted: 50_000_000,
      gasFee: 1_000_000,
    });
  }
  // Local server path (legacy demo gnokey)
  const apiPath =
    func === "Create"
      ? "/api/tx/create"
      : func === "Buy"
        ? "/api/tx/buy"
        : func === "Sell"
          ? "/api/tx/sell"
          : func === "SwapBuy"
            ? "/api/tx/swap-buy"
            : func === "SwapSell"
              ? "/api/tx/swap-sell"
              : func === "ClaimCreatorFees"
                ? "/api/tx/claim-creator"
                : func === "ClaimProtocolFees"
                  ? "/api/tx/claim-protocol"
                  : func === "Init"
                    ? "/api/tx/init"
                    : null;
  if (!apiPath) throw new Error(`Unknown func ${func}`);
  let body = {};
  if (func === "Create") {
    body = { name: args[0], symbol: args[1], uri: args[2] || "", bond: send };
  } else if (func === "Buy" || func === "SwapBuy") {
    body = { id: args[0], amount: String(send).replace(/ugnot$/, "") };
  } else if (func === "Sell" || func === "SwapSell") {
    body = { id: args[0], tokens: String(args[1]) };
  } else if (func === "ClaimCreatorFees") {
    body = { id: args[0] };
  }
  return api(apiPath, { method: "POST", body: JSON.stringify(body) });
}

function loadWallet() {
  try {
    const raw = localStorage.getItem(LS_WALLET);
    if (!raw) return null;
    const w = JSON.parse(raw);
    if (w?.address) return w;
  } catch {
    /* ignore */
  }
  return null;
}

function saveWallet(w) {
  state.wallet = w;
  if (w) localStorage.setItem(LS_WALLET, JSON.stringify(w));
  else localStorage.removeItem(LS_WALLET);
  renderWalletChrome();
}

function isConnected() {
  return !!(state.wallet && state.wallet.address);
}

function canSign() {
  return !!(state.wallet && state.wallet.canSign);
}

function requireWallet(action = "continue") {
  if (!isConnected()) {
    toast(`Connect a wallet to ${action}`, false);
    openWalletModal();
    return false;
  }
  return true;
}

function requireSigner(action = "sign") {
  if (!requireWallet(action)) return false;
  if (!canSign()) {
    toast(`Connect Adena wallet to ${action} (view-only address cannot sign).`, false);
    openWalletModal();
    return false;
  }
  return true;
}

async function connectWithAdena() {
  if (!hasAdena()) {
    openInstallAdena();
    toast("Install Adena, then try again", false);
    return;
  }
  try {
    toast("Opening Adena…");
    const w = await connectAdena(networkForAdena());
    saveWallet(w);
    closeWalletModal();
    toast(`Adena connected: ${shortAddr(w.address)}`);
    if (state.view === "portfolio") refreshPortfolio();
    if (state.view === "creator") refreshCreator();
    updateCreateHint();
  } catch (e) {
    console.error(e);
    toast(String(e.message || e), false);
  }
}

/** Chain base unit → display. 1 GNOT = 1_000_000 ugnot. */
const UGNOT_PER_GNOT = 1_000_000;

/** Format ugnot integer as GNOT for UI. */
function fmtGnot(ugnotOrGnot, { alreadyGnot = false } = {}) {
  const g = alreadyGnot ? Number(ugnotOrGnot) || 0 : (Number(ugnotOrGnot) || 0) / UGNOT_PER_GNOT;
  if (!Number.isFinite(g)) return "—";
  const abs = Math.abs(g);
  if (abs >= 1_000_000) return `${(g / 1_000_000).toFixed(2)}M GNOT`;
  if (abs >= 1_000) return `${(g / 1_000).toFixed(2)}K GNOT`;
  if (abs >= 1) return `${g.toLocaleString("en-US", { maximumFractionDigits: 4 })} GNOT`;
  if (abs >= 0.0001) return `${g.toFixed(6)} GNOT`;
  if (abs === 0) return "0 GNOT";
  return `${g.toExponential(2)} GNOT`;
}

/** Token price in GNOT per 1 token. */
function fmtPriceGnot(priceGnot) {
  const p = Number(priceGnot) || 0;
  if (!Number.isFinite(p) || p <= 0) return "—";
  if (p >= 0.01) return `${p.toFixed(6)} GNOT`;
  if (p >= 1e-9) return `${p.toExponential(3)} GNOT`;
  return `${p.toExponential(2)} GNOT`;
}

/** Market cap in GNOT. */
function fmtMcap(mcapGnot) {
  const m = Number(mcapGnot) || 0;
  if (!Number.isFinite(m) || m <= 0) return "—";
  if (m >= 1_000_000) return `${(m / 1_000_000).toFixed(2)}M GNOT`;
  if (m >= 1_000) return `${(m / 1_000).toFixed(2)}K GNOT`;
  if (m >= 1) return `${m.toFixed(2)} GNOT`;
  return `${m.toFixed(4)} GNOT`;
}

function fmtNum(n) {
  const v = Number(n) || 0;
  return new Intl.NumberFormat("en-US").format(v);
}

/** Convert GNOT display amount → ugnot base for chain txs. */
function gnotToUgnot(gnot) {
  const g = Number(gnot);
  if (!Number.isFinite(g) || g < 0) return 0;
  return Math.round(g * UGNOT_PER_GNOT);
}

function shortAddr(a) {
  if (!a || a.length < 12) return a || "—";
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function toast(msg, ok = true) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.remove("hidden", "ok", "err");
  el.classList.add(ok ? "ok" : "err");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add("hidden"), 4200);
}

/** Copy text to clipboard; toast on success. */
async function copyText(text, label = "Copied") {
  const t = String(text || "").trim();
  if (!t) {
    toast("Nothing to copy", false);
    return false;
  }
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(t);
    } else {
      const ta = document.createElement("textarea");
      ta.value = t;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    toast(label);
    return true;
  } catch (e) {
    toast("Copy failed — select text manually", false);
    return false;
  }
}

function padPkgPath() {
  return (
    state.pkg ||
    state.walletsMeta?.pkg ||
    "gno.land/r/g1mv0052e7r6s09f5t9xsqf00nj3tqsgt9dg52jr/gnomemepad/padv5"
  );
}

/** Default fee split matches pad params (padv4). */
const FEE_CREATOR_SHARE_BPS = 4000;
const FEE_PROTOCOL_SHARE_BPS = 4000;
const LS_SLIPPAGE = "gnomemepad.slippage.v1";

function loadSlippagePct() {
  try {
    const v = Number(localStorage.getItem(LS_SLIPPAGE));
    if (Number.isFinite(v) && v >= 0 && v <= 50) return v;
  } catch {
    /* ignore */
  }
  return 1; // 1%
}

function saveSlippagePct(pct) {
  try {
    localStorage.setItem(LS_SLIPPAGE, String(pct));
  } catch {
    /* ignore */
  }
}

function feeBpsOf(m) {
  const p = m?.params || state.params;
  const b = Number(p?.feeBps);
  return Number.isFinite(b) && b >= 0 ? b : 120;
}

function applyFeeIn(gross, feeBps) {
  const fee = Math.floor((gross * feeBps) / 10000);
  const net = gross - fee;
  const creator = Math.floor((fee * FEE_CREATOR_SHARE_BPS) / 10000);
  const protocol = Math.floor((fee * FEE_PROTOCOL_SHARE_BPS) / 10000);
  const remainder = fee - creator - protocol;
  return { gross, fee, net, creator, protocol, remainder, netIn: net + remainder };
}

function applyFeeOut(grossOut, feeBps) {
  const fee = Math.floor((grossOut * feeBps) / 10000);
  const net = grossOut - fee;
  return { gross: grossOut, fee, net };
}

/** Curve remaining tokens that can still be bought (CurveSupply - sold). */
function curveRemainingTokens(m) {
  if (!m || m.status === 1) return 0;
  const curve = Number(m.params?.curveSupply ?? state.params?.curveSupply ?? 800_000_000);
  const sold = Number(m.sold) || 0;
  return Math.max(0, curve - sold);
}

/** Curve buy: tokens out for ugnotIn (base units). BigInt k to match chain. */
function quoteCurveBuy(vu, vt, ugnotIn, feeBps) {
  if (ugnotIn <= 0 || vu <= 0 || vt <= 0) return { ok: false, reason: "invalid" };
  const f = applyFeeIn(ugnotIn, feeBps);
  if (f.netIn <= 0) return { ok: false, reason: "fee" };
  try {
    const vuB = BigInt(vu);
    const vtB = BigInt(vt);
    const netB = BigInt(f.netIn);
    const newVU = vuB + netB;
    const k = vuB * vtB;
    const newVT = k / newVU;
    if (newVT <= 0n || newVT >= vtB) return { ok: false, reason: "zero-out" };
    const tokensOut = Number(vtB - newVT);
    if (!Number.isFinite(tokensOut) || tokensOut <= 0) return { ok: false, reason: "zero-out" };
    return { ok: true, tokensOut, netIn: f.netIn, fee: f.fee };
  } catch {
    return { ok: false, reason: "overflow" };
  }
}

/** Curve sell: net ugnot out for tokensIn. */
function quoteCurveSell(vu, vt, tokensIn, feeBps) {
  if (tokensIn <= 0 || vu <= 0 || vt <= 0) return { ok: false, reason: "invalid" };
  try {
    const vuB = BigInt(vu);
    const vtB = BigInt(vt);
    const tin = BigInt(tokensIn);
    const newVT = vtB + tin;
    const k = vuB * vtB;
    const newVU = k / newVT;
    if (newVU <= 0n || newVU >= vuB) return { ok: false, reason: "zero-out" };
    const gross = Number(vuB - newVU);
    if (!Number.isFinite(gross) || gross <= 0) return { ok: false, reason: "zero-out" };
    const f = applyFeeOut(gross, feeBps);
    if (f.net <= 0) return { ok: false, reason: "fee" };
    return { ok: true, ugnotOut: f.net, gross, fee: f.fee };
  } catch {
    return { ok: false, reason: "overflow" };
  }
}

/**
 * Max gross ugnot that still yields tokensOut <= remaining on the curve.
 * Binary search — pad panics if buy would exceed remaining (no partial fill).
 */
function maxUgnotForCurveRemaining(m) {
  const remaining = curveRemainingTokens(m);
  if (remaining <= 0) return 0;
  const vu = Number(m.virtualUgnot) || 0;
  const vt = Number(m.virtualToken) || 0;
  const feeBps = feeBpsOf(m);
  if (vu <= 0 || vt <= 0) return 0;
  // Upper bound: enough to nearly empty virtual tokens (very large) — clamp practically
  let lo = 0;
  let hi = 50_000_000_000; // 50k GNOT ugnot upper search
  // Expand hi until overshoot or cap
  while (hi < 1e15) {
    const q = quoteCurveBuy(vu, vt, hi, feeBps);
    if (!q.ok || q.tokensOut > remaining) break;
    lo = hi;
    hi *= 2;
  }
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    const q = quoteCurveBuy(vu, vt, mid, feeBps);
    if (q.ok && q.tokensOut <= remaining) lo = mid;
    else hi = mid - 1;
  }
  // Safety haircut 0.1% so chain rounding never exceeds remaining
  return Math.floor((lo * 999) / 1000);
}

/** Pool swap buy. */
function quotePoolBuy(pu, pt, ugnotIn, feeBps) {
  if (ugnotIn <= 0 || pu <= 0 || pt <= 0) return { ok: false, reason: "invalid" };
  const f = applyFeeIn(ugnotIn, feeBps);
  if (f.net <= 0) return { ok: false, reason: "fee" };
  const tokensOut = Math.floor((pt * f.net) / (pu + f.net));
  if (tokensOut <= 0 || tokensOut >= pt) return { ok: false, reason: "zero-out" };
  return { ok: true, tokensOut, fee: f.fee };
}

/** Pool swap sell. */
function quotePoolSell(pu, pt, tokensIn, feeBps) {
  if (tokensIn <= 0 || pu <= 0 || pt <= 0) return { ok: false, reason: "invalid" };
  const gross = Math.floor((pu * tokensIn) / (pt + tokensIn));
  if (gross <= 0 || gross >= pu) return { ok: false, reason: "zero-out" };
  const f = applyFeeOut(gross, feeBps);
  if (f.net <= 0) return { ok: false, reason: "fee" };
  return { ok: true, ugnotOut: f.net, gross, fee: f.fee };
}

/**
 * Full quote for market m.
 * side: "buy" | "sell"
 * amount: buy = GNOT display; sell = token amount
 */
function quoteTrade(m, side, amount) {
  const feeBps = feeBpsOf(m);
  const isPool = m.status === 1;
  if (side === "buy") {
    const ugnotIn = gnotToUgnot(amount);
    if (ugnotIn <= 0) return { ok: false, reason: "amount" };
    const q = isPool
      ? quotePoolBuy(Number(m.poolUgnot) || 0, Number(m.poolToken) || 0, ugnotIn, feeBps)
      : quoteCurveBuy(Number(m.virtualUgnot) || 0, Number(m.virtualToken) || 0, ugnotIn, feeBps);
    if (!q.ok) return q;
    const remaining = isPool ? null : curveRemainingTokens(m);
    const exceeds =
      !isPool && remaining != null && remaining >= 0 && q.tokensOut > remaining;
    return {
      ok: !exceeds,
      reason: exceeds ? "exceeds-curve" : undefined,
      side: "buy",
      ugnotIn,
      expectedOut: q.tokensOut,
      remaining,
      exceedsCurve: !!exceeds,
      outUnit: "tokens",
      feeUgnot: q.fee,
      feeBps,
      // still expose quote numbers for UI even when exceeds
      tokensOut: q.tokensOut,
    };
  }
  const tokensIn = Math.floor(Number(amount) || 0);
  if (tokensIn <= 0) return { ok: false, reason: "amount" };
  const q = isPool
    ? quotePoolSell(Number(m.poolUgnot) || 0, Number(m.poolToken) || 0, tokensIn, feeBps)
    : quoteCurveSell(Number(m.virtualUgnot) || 0, Number(m.virtualToken) || 0, tokensIn, feeBps);
  if (!q.ok) return q;
  return {
    ok: true,
    side: "sell",
    tokensIn,
    expectedOut: q.ugnotOut,
    outUnit: "ugnot",
    feeUgnot: q.fee,
    feeBps,
  };
}

/** minOut after slippage% (0 = disabled). Integer floor. */
function minOutFromQuote(expectedOut, slipPct) {
  const exp = Math.floor(Number(expectedOut) || 0);
  if (exp <= 0) return 0;
  const slip = Number(slipPct);
  if (!Number.isFinite(slip) || slip <= 0) return 0; // 0% → no min (or exact)
  if (slip >= 100) return 0;
  // min = expected * (1 - slip/100)
  return Math.floor((exp * (10000 - Math.floor(slip * 100))) / 10000);
}

/** padv4+ has minOut args; padv3 / original pad do not. */
function padSupportsMinOut(pkg) {
  const p = String(pkg || "");
  if (!p) return true;
  if (p.includes("/padv3") || /\/pad$/.test(p)) return false;
  return true;
}

/**
 * Path for Adena “Add Custom Token” = grc20reg key packagePath.SYMBOL.
 * Adena ignores Token.ID (…SYMBOL.seq) and returns “Invalid path” if the token
 * is not registered in gno.land/r/demo/defi/grc20reg (padv3+ registers on Create).
 */
function adenaWalletPath(m) {
  const sym = String(m?.symbol || "").trim();
  if (!sym) return "";
  // Prefer stripping .seq from on-chain Token.ID when present
  const full = String(m?.tokenId || "").trim();
  if (full) {
    const marker = `.${sym}.`;
    const i = full.lastIndexOf(marker);
    if (i >= 0) return full.slice(0, i) + `.${sym}`;
    if (full.endsWith(`.${sym}`)) return full;
  }
  const base = (m?.pkg || padPkgPath()).trim();
  return `${base}.${sym}`;
}

function renderContractBox(m) {
  const walletPath = adenaWalletPath(m);
  if (!walletPath) return "";
  return `
    <div class="contract-box">
      <div class="contract-row">
        <div class="contract-meta">
          <span class="contract-label">Adena path</span>
          <code class="contract-value mono" title="${escapeHtml(walletPath)}">${escapeHtml(walletPath)}</code>
        </div>
        <button type="button" class="btn sm primary copy-btn" data-copy="${escapeHtml(walletPath)}" data-copy-label="Adena path copied">Copy</button>
      </div>
      <p class="contract-box-hint">Manage Tokens → + → Manual → paste</p>
    </div>`;
}

function wireCopyButtons(root = document) {
  $$(".copy-btn", root).forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      copyText(btn.dataset.copy || "", btn.dataset.copyLabel || "Copied");
    });
  });
}

/** Client GET cache — pairs with server TTL to skip redundant round-trips. */
const apiClientCache = new Map();
const API_CLIENT_TTL = {
  "/api/markets": 18_000,
  "/api/activity": 12_000,
  "/api/ops": 22_000,
  "/api/health": 8_000,
  "/api/points": 15_000,
};

function apiPathBase(path) {
  return String(path || "").split("?")[0];
}

function bustApiCache(prefix = "") {
  for (const k of [...apiClientCache.keys()]) {
    if (!prefix || k.startsWith(prefix) || apiPathBase(k) === prefix) {
      apiClientCache.delete(k);
    }
  }
}

/**
 * @param {string} path
 * @param {{ method?: string, force?: boolean, cache?: string, headers?: object, body?: any }} [opts]
 */
async function api(path, opts = {}) {
  const method = (opts.method || "GET").toUpperCase();
  const force = !!opts.force || opts.cache === "no-store";
  const base = apiPathBase(path);
  const ttl = API_CLIENT_TTL[base];
  if (method === "GET" && ttl && !force) {
    const hit = apiClientCache.get(path);
    if (hit && Date.now() - hit.at < ttl) return hit.data;
  }
  let url = path;
  if (method === "GET" && force) {
    url += (path.includes("?") ? "&" : "?") + "refresh=1";
  }
  const r = await fetch(url, {
    headers: { "content-type": "application/json", ...(opts.headers || {}) },
    ...opts,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  if (j.error && j.ok === false) throw new Error(j.error);
  if (method === "GET" && ttl) {
    apiClientCache.set(path, { at: Date.now(), data: j });
  }
  return j;
}

function setNet(ok, label) {
  const pill = $("#netStatus");
  pill.classList.toggle("ok", !!ok);
  pill.classList.toggle("bad", ok === false);
  $("#netLabel").textContent = label;
}

async function refreshHealth() {
  try {
    const h = await api("/api/health");
    if (h.pkg) state.pkg = h.pkg;
    if (h.hub) state.hub = h.hub;
    if (h.profile) state.profilePkg = h.profile;
    if (h.meta) state.metaPkg = h.meta;
    if (h.points) state.pointsPkg = h.points;
    if (h.modules) state.modules = h.modules;
    if (h.chainId) state.chainId = h.chainId;
    if (h.rpc) state.rpcUrl = h.rpc;
    if (h && h.signing === false) state.readOnlyHost = true;
    if (h && h.hosting === "netlify") state.hosting = "netlify";
    if (h.ok) {
      const tag = h.modules?.pad
        ? String(h.modules.pad).split("/").pop()
        : h.chainId || "online";
      setNet(true, tag);
    } else setNet(false, "offline");
  } catch (e) {
    setNet(false, "offline");
  }
}

function marketSkeletonHtml() {
  return `<div class="skeleton-grid" aria-hidden="true">
    <div class="skel-card"></div><div class="skel-card"></div><div class="skel-card"></div>
  </div>`;
}

async function refreshMarkets(opts = {}) {
  const grid = $("#marketGrid");
  if (grid && !state.markets.length) {
    grid.innerHTML = marketSkeletonHtml();
  }
  try {
    if (opts.force) {
      bustApiCache("/api/markets");
      bustApiCache("/api/activity");
    }
    const data = await api("/api/markets", { force: !!opts.force });
    state.markets = data.markets || [];
    state.params = data.params;
    state.padSources = data.sources || state.padSources || [];
    const nAll = state.markets.filter((m) => !m.error).length;
    const nLeg = state.markets.filter((m) => !m.error && m.legacy).length;
    $("#statMarkets").textContent =
      nLeg > 0 ? `${nAll} (${nAll - nLeg} active)` : String(data.count ?? nAll);
    $("#statFees").textContent = fmtGnot(data.protocolFeesGnot ?? data.protocolFees, {
      alreadyGnot: data.protocolFeesGnot != null,
    });
    if (data.params) {
      $("#statGrad").textContent = fmtGnot(
        data.params.graduationGnot ?? data.params.graduation / UGNOT_PER_GNOT,
        { alreadyGnot: true },
      );
      $("#statFeeBps").textContent = `${(data.params.feeBps / 100).toFixed(2)}%`;
    }
    renderMarketGrid();
    const creators = state.markets.map((m) => m.creator).filter(Boolean);
    await Promise.all([prefetchProfiles(creators), prefetchMarketMeta(state.markets)]);
    renderMarketGrid();
    checkAlmostGraduateAlerts(state.markets);
    // activity also fills recentVol + re-renders cards
    await refreshActivity();
  } catch (e) {
    if (grid) {
      grid.innerHTML = `<div class="empty empty-err">
        <strong>Could not load markets</strong>
        <p class="muted">${escapeHtml(e.message || e)}</p>
        <button type="button" class="btn sm" id="btnRetryMarkets">Retry</button>
      </div>`;
      $("#btnRetryMarkets")?.addEventListener("click", () => refreshMarkets());
    }
  }
}

function marketApiPath(id, pkg) {
  let u = `/api/market/${encodeURIComponent(id)}`;
  if (pkg) u += `?pkg=${encodeURIComponent(pkg)}`;
  return u;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function recentVolOf(m) {
  if (!m) return { volumeGnot: 0, trades: 0, buyVol: 0, sellVol: 0 };
  const v = state.recentVol[marketKey(m.id, m.pkg || "")];
  return v || { volumeGnot: 0, trades: 0, buyVol: 0, sellVol: 0 };
}

/** Heat score for curve (raising) markets — buyers + raised + recent trade vol. */
function marketHeatScore(m) {
  if (!m || m.error || m.status === 1) return 0;
  const raised = Number(m.raisedGnot != null ? m.raisedGnot : (m.raised || 0) / UGNOT_PER_GNOT) || 0;
  const buyers = Number(m.buyers) || 0;
  const pct = Number(m.progressPct) || 0;
  const rv = recentVolOf(m);
  // Buyers weight activity; raised is cumulative; recentVol from activity ring
  return raised * 3 + buyers * 8 + pct * 0.35 + (rv.volumeGnot || 0) * 12 + (rv.trades || 0) * 1.5;
}

/** Build recent volume map from activity events (client-side, no extra pad scans). */
function applyActivityVolume(events) {
  const map = {};
  for (const e of events || []) {
    const k = marketKey(e.id, e.pkg || "");
    if (!map[k]) map[k] = { volumeGnot: 0, trades: 0, buyVol: 0, sellVol: 0 };
    const vol = Number(e.volumeGnot) || 0;
    if (e.side === 2) continue;
    map[k].trades += 1;
    map[k].volumeGnot += vol;
    if (e.side === 0) map[k].buyVol += vol;
    else if (e.side === 1) map[k].sellVol += vol;
  }
  state.recentVol = map;
}

async function refreshRecentVolume() {
  try {
    const data = await api("/api/activity?limit=80");
    applyActivityVolume(data.events || []);
  } catch {
    /* keep previous */
  }
}

/**
 * Tier 0 none · 1 warm · 2 hot · 3 fire — relative to other raising tokens,
 * with absolute floors so empty launches stay quiet.
 */
function marketHeatTiers(list) {
  const tiers = new Map();
  const raising = list.filter((m) => !m.error && m.status !== 1);
  if (!raising.length) return tiers;

  const scored = raising.map((m) => ({
    key: `${m.id}|${m.pkg || ""}`,
    score: marketHeatScore(m),
    buyers: Number(m.buyers) || 0,
    raised: Number(m.raisedGnot != null ? m.raisedGnot : (m.raised || 0) / UGNOT_PER_GNOT) || 0,
  }));
  const max = Math.max(...scored.map((s) => s.score), 0.0001);

  for (const s of scored) {
    const active = s.buyers >= 1 || s.raised >= 0.5;
    if (!active) {
      tiers.set(s.key, 0);
      continue;
    }
    const rel = s.score / max;
    // Absolute floors + relative rank
    if ((s.buyers >= 5 || s.raised >= 8 || rel >= 0.85) && (s.buyers >= 2 || s.raised >= 2)) {
      tiers.set(s.key, 3);
    } else if (s.buyers >= 3 || s.raised >= 3 || rel >= 0.55) {
      tiers.set(s.key, 2);
    } else if (s.buyers >= 1 || s.raised >= 1 || rel >= 0.3) {
      tiers.set(s.key, 1);
    } else {
      tiers.set(s.key, 0);
    }
  }
  return tiers;
}

function heatBadgeHtml(tier) {
  if (tier >= 3) {
    return `<span class="badge heat-fire" title="Top volume / many buyers">🔥 Fire</span>`;
  }
  if (tier >= 2) {
    return `<span class="badge heat-hot" title="High buy activity">Hot</span>`;
  }
  if (tier >= 1) {
    return `<span class="badge heat-warm" title="Active buyers">Active</span>`;
  }
  return "";
}

function sortMarkets(list, sort, heat) {
  const arr = [...list];
  const keyOf = (m) => marketKey(m.id, m.pkg || "");
  arr.sort((a, b) => {
    // Always pin watchlist slightly when sorting hot
    const wa = isWatched(a.id, a.pkg) ? 1 : 0;
    const wb = isWatched(b.id, b.pkg) ? 1 : 0;

    if (sort === "newest") {
      return (b.created || 0) - (a.created || 0);
    }
    if (sort === "almost") {
      // curve first by progress, then raised
      const ca = a.status === 1 ? -1 : Number(a.progressPct) || 0;
      const cb = b.status === 1 ? -1 : Number(b.progressPct) || 0;
      if (cb !== ca) return cb - ca;
      return raisedGnotOf(b) - raisedGnotOf(a);
    }
    if (sort === "buyers") {
      return (Number(b.buyers) || 0) - (Number(a.buyers) || 0);
    }
    if (sort === "raised") {
      return raisedGnotOf(b) - raisedGnotOf(a);
    }
    if (sort === "mcap") {
      return (Number(b.mcapGnot) || 0) - (Number(a.mcapGnot) || 0);
    }
    if (sort === "volume") {
      return (recentVolOf(b).volumeGnot || 0) - (recentVolOf(a).volumeGnot || 0);
    }
    // hot (default): heat tier → score → watch → created
    const ta = heat.get(keyOf(a)) || 0;
    const tb = heat.get(keyOf(b)) || 0;
    if (tb !== ta) return tb - ta;
    const sa = marketHeatScore(a);
    const sb = marketHeatScore(b);
    if (sb !== sa) return sb - sa;
    if (wb !== wa) return wb - wa;
    if ((a.status === 1) !== (b.status === 1)) return a.status === 1 ? 1 : -1;
    return (b.created || 0) - (a.created || 0);
  });
  return arr;
}

function renderMarketGrid() {
  const q = ($("#search")?.value || "").trim().toLowerCase();
  const filter = state.marketFilter || "all";
  const status = state.statusFilter || "all";
  const sort = state.marketSort || "hot";
  let list = state.markets.filter((m) => !m.error);
  if (filter === "active") list = list.filter((m) => !m.legacy);
  if (filter === "legacy") list = list.filter((m) => m.legacy);
  if (status === "curve") list = list.filter((m) => m.status !== 1);
  if (status === "graduated") list = list.filter((m) => m.status === 1);
  if (status === "watch") list = list.filter((m) => isWatched(m.id, m.pkg));
  if (q) {
    list = list.filter(
      (m) =>
        m.name?.toLowerCase().includes(q) ||
        m.symbol?.toLowerCase().includes(q) ||
        m.id?.toLowerCase().includes(q) ||
        m.creator?.toLowerCase().includes(q) ||
        (state.profileCache[m.creator]?.name || "").toLowerCase().includes(q),
    );
  }

  const heat = marketHeatTiers(list);
  list = sortMarkets(list, sort, heat);

  const grid = $("#marketGrid");
  if (!grid) return;
  if (!list.length) {
    let msg = "No results for this search.";
    if (!state.markets.length) {
      msg = `No markets yet. <button type="button" class="btn sm primary" data-nav="create">Launch the first coin</button>`;
    } else if (status === "watch") {
      msg = "Watchlist empty — tap ★ on a market card to pin it here.";
    } else if (status === "curve") {
      msg = "No raising (curve) markets match.";
    } else if (status === "graduated") {
      msg = "No graduated markets match.";
    } else if (filter === "legacy") {
      msg = "No legacy markets match.";
    } else if (filter === "active") {
      msg = "No active-pad markets match. Try <em>All pads</em>.";
    }
    grid.innerHTML = `<div class="empty">${msg}</div>`;
    $$("[data-nav]", grid).forEach((b) =>
      b.addEventListener("click", () => showView(b.dataset.nav)),
    );
    return;
  }
  grid.innerHTML = list
    .map((m) => {
      const pct = m.progressPct ?? 0;
      const st = m.status === 1 ? "Live" : "Curve";
      const key = marketKey(m.id, m.pkg || "");
      const tier = heat.get(key) || 0;
      const heatClass =
        tier >= 3 ? "card-heat card-fire" : tier >= 2 ? "card-heat card-hot" : tier >= 1 ? "card-heat card-warm" : "";
      const watched = isWatched(m.id, m.pkg);
      const meta = getCachedMeta(m.id, m.pkg);
      const img = safeImageUri(meta?.imageURI);
      const padBadge = m.legacy
        ? `<span class="badge legacy" title="${escapeHtml(m.pkg || "")}">${escapeHtml(m.padLabel || "legacy")}</span>`
        : `<span class="badge active-pad" title="${escapeHtml(m.pkg || "")}">${escapeHtml(m.padLabel || "pad")}</span>`;
      const creatorLine = m.creator
        ? `<div class="card-creator">${renderPersonChip(m.creator)}</div>`
        : "";
      const buyers = Number(m.buyers) || 0;
      const raisedVal = m.raisedGnot ?? m.raised;
      const raisedAlready = m.raisedGnot != null;
      const rv = recentVolOf(m);
      const hasRv = (rv.volumeGnot || 0) > 0 || (rv.trades || 0) > 0;
      const buyPct =
        hasRv && rv.volumeGnot > 0
          ? Math.min(100, Math.round((rv.buyVol / rv.volumeGnot) * 100))
          : 50;
      const sym2 = escapeHtml(String(m.symbol || "?").slice(0, 2));
      const avatar = img
        ? `<img class="card-avatar" src="${escapeHtml(img)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-fallback="${sym2}" onerror="this.outerHTML='<div class=\\'card-avatar card-avatar-fallback\\'>'+this.dataset.fallback+'</div>'" />`
        : `<div class="card-avatar card-avatar-fallback">${sym2}</div>`;
      return `
      <article class="card ${heatClass}${watched ? " card-watched" : ""}" data-id="${escapeHtml(m.id)}" data-pkg="${escapeHtml(m.pkg || "")}" data-heat="${tier}">
        <button type="button" class="card-watch ${watched ? "on" : ""}" data-watch="${escapeHtml(m.id)}" data-pkg="${escapeHtml(m.pkg || "")}" title="${watched ? "Remove from watchlist" : "Add to watchlist"}" aria-label="Watchlist">${watched ? "★" : "☆"}</button>
        <div class="card-top">
          <div class="card-identity">
            ${avatar}
            <div>
              <div class="card-title">${escapeHtml(m.name)}</div>
              <div class="card-sym">$${escapeHtml(m.symbol)}</div>
              ${creatorLine}
            </div>
          </div>
          <div class="card-badges">
            ${heatBadgeHtml(tier)}
            <span class="badge ${m.status === 1 ? "graduated" : "curve"}">${st}</span>
            ${padBadge}
          </div>
        </div>
        <div class="card-meta">
          <div>Price<strong>${fmtPriceGnot(m.priceGnot)}</strong></div>
          <div>MCap<strong>${fmtMcap(m.mcapGnot)}</strong></div>
          <div class="${tier >= 2 ? "meta-glow" : ""}">Raised<strong>${fmtGnot(raisedVal, { alreadyGnot: raisedAlready })}</strong></div>
          <div class="${tier >= 1 && buyers > 0 ? "meta-glow buyers" : ""}">Buyers<strong>${fmtNum(buyers)}</strong></div>
          <div class="card-meta-span ${hasRv ? "meta-glow vol" : ""}">Recent vol<strong>${hasRv ? fmtGnot(rv.volumeGnot, { alreadyGnot: true }) + ` · ${fmtNum(rv.trades)} tx` : "—"}</strong></div>
        </div>
        ${
          hasRv
            ? `<div class="vol-split" title="Buy ${buyPct}% / Sell ${100 - buyPct}% of recent sample vol">
                <i class="buy" style="width:${buyPct}%"></i>
                <i class="sell" style="width:${100 - buyPct}%"></i>
              </div>`
            : ""
        }
        ${
          m.status === 1
            ? ""
            : `<div class="bar ${tier >= 2 ? "bar-heat" : ""}"><i style="width:${pct}%"></i></div>
        <div class="bar-label"><span>To graduate</span><span>${pct}%</span></div>`
        }
      </article>`;
    })
    .join("");
  $$(".card", grid).forEach((c) =>
    c.addEventListener("click", (e) => {
      // Don't open token when clicking profile / external links / watch
      if (e.target.closest("a, button")) return;
      openToken(c.dataset.id, c.dataset.pkg || "");
    }),
  );
  $$(".card-watch", grid).forEach((b) =>
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      const on = toggleWatch(b.dataset.watch, b.dataset.pkg || "");
      toast(on ? "Added to watchlist" : "Removed from watchlist");
      renderMarketGrid();
    }),
  );
}

function showView(name) {
  state.view = name;
  $$(".view").forEach((v) => v.classList.add("hidden"));
  const map = {
    home: "view-home",
    create: "view-create",
    token: "view-token",
    portfolio: "view-portfolio",
    creator: "view-creator",
    profile: "view-profile",
    rewards: "view-rewards",
    ops: "view-ops",
    docs: "view-docs",
  };
  $(`#${map[name] || "view-home"}`)?.classList.remove("hidden");
  $$(".nav-btn").forEach((b) =>
    b.classList.toggle(
      "active",
      b.dataset.nav === name || (name === "token" && b.dataset.nav === "home"),
    ),
  );
  if (name === "portfolio") refreshPortfolio();
  if (name === "creator") refreshCreator();
  if (name === "profile") refreshProfileView();
  if (name === "rewards") refreshRewardsView();
  if (name === "ops") refreshOpsView();
  if (name === "create") updateCreateHint();
  if (name === "docs") {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
}

/** Almost-graduate toast throttle (id|pkg -> last toast ms) */
const almostGradToastAt = new Map();
const largeTradeNotifyAt = new Map();

function loadNotifyPrefs() {
  try {
    const raw = localStorage.getItem(LS_NOTIFY);
    if (!raw) return { enabled: false, almostGrad: true, largeTrade: true };
    return { enabled: false, almostGrad: true, largeTrade: true, ...JSON.parse(raw) };
  } catch {
    return { enabled: false, almostGrad: true, largeTrade: true };
  }
}

function saveNotifyPrefs(p) {
  try {
    localStorage.setItem(LS_NOTIFY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

let notifyPrefs = loadNotifyPrefs();

function canNotify() {
  return (
    notifyPrefs.enabled &&
    typeof Notification !== "undefined" &&
    Notification.permission === "granted"
  );
}

function pushNotify(title, body, tag) {
  if (!canNotify()) return;
  try {
    const n = new Notification(title, {
      body: body || "",
      tag: tag || "gnomemepad",
      icon: "/icon.svg",
      badge: "/icon.svg",
    });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    /* ignore */
  }
}

function updateNotifyButton() {
  const btn = $("#btnNotify");
  if (!btn) return;
  const on = canNotify();
  btn.classList.toggle("on", on);
  btn.title = on
    ? "Notifications on — click to disable"
    : "Enable browser notifications";
  btn.setAttribute("aria-pressed", on ? "true" : "false");
}

async function toggleNotifications() {
  if (typeof Notification === "undefined") {
    toast("Notifications not supported in this browser", false);
    return;
  }
  if (canNotify()) {
    notifyPrefs.enabled = false;
    saveNotifyPrefs(notifyPrefs);
    updateNotifyButton();
    toast("Notifications off");
    return;
  }
  let perm = Notification.permission;
  if (perm === "default") {
    perm = await Notification.requestPermission();
  }
  if (perm !== "granted") {
    toast("Notification permission denied", false);
    notifyPrefs.enabled = false;
    saveNotifyPrefs(notifyPrefs);
    updateNotifyButton();
    return;
  }
  notifyPrefs.enabled = true;
  saveNotifyPrefs(notifyPrefs);
  updateNotifyButton();
  pushNotify("gnomemepad", "Alerts on for almost-graduate & large trades");
  toast("Notifications enabled");
}

function checkAlmostGraduateAlerts(markets) {
  const now = Date.now();
  for (const m of markets || []) {
    if (!m || m.error || m.status === 1) continue;
    const pct = Number(m.progressPct) || 0;
    if (pct < 80) continue;
    const k = marketKey(m.id, m.pkg);
    const last = almostGradToastAt.get(k) || 0;
    if (now - last < 10 * 60 * 1000) continue; // 10 min
    almostGradToastAt.set(k, now);
    const msg = `$${m.symbol || m.id} is ${pct}% to graduate`;
    toast(`🚀 ${msg}`, true);
    if (notifyPrefs.almostGrad) pushNotify("Almost graduate", msg, `grad-${k}`);
  }
}

function checkLargeTradeAlerts(events) {
  if (!notifyPrefs.largeTrade || !canNotify()) return;
  const now = Date.now();
  for (const e of events || []) {
    const vol = Number(e.volumeGnot) || 0;
    if (vol < 1) continue; // ≥ 1 GNOT sample
    const k = `${e.id}|${e.pkg || ""}|${e.height}|${e.side}`;
    if (largeTradeNotifyAt.has(k)) continue;
    largeTradeNotifyAt.set(k, now);
    // prune map
    if (largeTradeNotifyAt.size > 200) {
      const first = largeTradeNotifyAt.keys().next().value;
      largeTradeNotifyAt.delete(first);
    }
    const side = e.side === 1 ? "SELL" : e.side === 0 ? "BUY" : "TRADE";
    pushNotify(
      `${side} $${e.symbol || e.id}`,
      `${fmtGnot(vol, { alreadyGnot: true })} · h${e.height}`,
      `trade-${k}`,
    );
  }
}

/** PWA install prompt */
let deferredInstallPrompt = null;

function wirePwa() {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    $("#btnInstall")?.classList.remove("hidden");
  });
  $("#btnInstall")?.addEventListener("click", async () => {
    if (!deferredInstallPrompt) {
      toast("Install not available (already installed or unsupported)");
      return;
    }
    deferredInstallPrompt.prompt();
    try {
      await deferredInstallPrompt.userChoice;
    } catch {
      /* ignore */
    }
    deferredInstallPrompt = null;
    $("#btnInstall")?.classList.add("hidden");
  });
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
}

/** Canvas share card for a market (PNG download / Web Share). */
async function shareTokenCard(m) {
  const url = tokenShareUrl(m);
  const W = 1200;
  const H = 630;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    try {
      await navigator.clipboard.writeText(url);
      toast("Share link copied");
    } catch {
      prompt("Copy share link:", url);
    }
    return;
  }
  // background
  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, "#0a0b0f");
  grad.addColorStop(0.5, "#12141a");
  grad.addColorStop(1, "#1a1030");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  // accent bar
  ctx.fillStyle = "#6c5ce7";
  ctx.fillRect(0, 0, 12, H);
  ctx.fillStyle = "rgba(108,92,231,0.15)";
  ctx.beginPath();
  ctx.arc(W - 120, 100, 180, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#c4b5fd";
  ctx.font = "600 28px Inter, system-ui, sans-serif";
  ctx.fillText("gnomemepad · Sapphire", 64, 72);

  ctx.fillStyle = "#f4f5f7";
  ctx.font = "700 64px Inter, system-ui, sans-serif";
  const title = `${m.name || "Token"}`;
  ctx.fillText(title.length > 28 ? title.slice(0, 26) + "…" : title, 64, 180);

  ctx.fillStyle = "#2dd4bf";
  ctx.font = "600 40px JetBrains Mono, monospace";
  ctx.fillText(`$${m.symbol || "—"}`, 64, 240);

  ctx.fillStyle = "#8b90a0";
  ctx.font = "500 26px Inter, system-ui, sans-serif";
  const st = m.status === 1 ? "Graduated · Live pool" : `Curve · ${m.progressPct || 0}% to graduate`;
  ctx.fillText(st, 64, 300);

  ctx.fillStyle = "#f4f5f7";
  ctx.font = "600 32px JetBrains Mono, monospace";
  ctx.fillText(`Price  ${fmtPriceGnot(m.priceGnot)}`, 64, 380);
  ctx.fillText(`MCap   ${fmtMcap(m.mcapGnot)}`, 64, 430);
  ctx.fillText(
    `Raised ${fmtGnot(m.raisedGnot ?? m.raised, { alreadyGnot: m.raisedGnot != null })}`,
    64,
    480,
  );

  ctx.fillStyle = "#6c5ce7";
  ctx.font = "500 22px Inter, system-ui, sans-serif";
  ctx.fillText(url.replace(/^https?:\/\//, "").slice(0, 60), 64, H - 48);

  const blob = await new Promise((res) => canvas.toBlob(res, "image/png"));
  if (!blob) {
    try {
      await navigator.clipboard.writeText(url);
      toast("Share link copied");
    } catch {
      prompt("Copy:", url);
    }
    return;
  }
  const file = new File([blob], `gnomemepad-${m.symbol || m.id}.png`, {
    type: "image/png",
  });
  try {
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      await navigator.share({
        title: `$${m.symbol} on gnomemepad`,
        text: `${m.name} · ${fmtPriceGnot(m.priceGnot)}`,
        url,
        files: [file],
      });
      toast("Shared");
      return;
    }
  } catch (e) {
    if (e?.name === "AbortError") return;
  }
  // fallback: download image + copy link
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = file.name;
  a.click();
  URL.revokeObjectURL(a.href);
  try {
    await navigator.clipboard.writeText(url);
    toast("Card downloaded · link copied");
  } catch {
    toast("Share card downloaded");
  }
}

async function refreshOpsView() {
  const summary = $("#opsSummary");
  const grid = $("#opsGrid");
  if (!summary || !grid) return;
  summary.textContent = "Loading ops…";
  grid.innerHTML = "";
  try {
    const data = await api("/api/ops");
    const ok = !!data.ok;
    summary.className = `callout ${ok ? "ok" : ""}`;
    summary.innerHTML = `
      <strong>${ok ? "Stack healthy" : "Issues detected"}</strong>
      <div class="muted" style="font-size:0.78rem;margin-top:0.35rem">
        Height <code class="mono">${escapeHtml(String(data.height || "—"))}</code>
        · chain <code class="mono">${escapeHtml(String(data.chainId || "—"))}</code>
        · hub <code class="mono">${escapeHtml(String(data.hub || "—").split("/").pop() || "—")}</code>
        ${data.hubError ? ` · <span class="bad-uri">${escapeHtml(data.hubError)}</span>` : ""}
        ${data.rpcError ? ` · <span class="bad-uri">${escapeHtml(data.rpcError)}</span>` : ""}
      </div>`;
    const mods = data.modules || {};
    const cards = Object.entries(mods).map(([name, m]) => {
      const path = m?.path || "";
      const short = path.split("/").pop() || name;
      let body = "";
      if (m?.kind === "pad") {
        body = `Launches: <strong>${fmtNum(m.launchCount)}</strong>
          ${m.params ? `<div class="muted" style="font-size:0.72rem">bond ${escapeHtml(String(m.params.createBondGnot))} · grad ${escapeHtml(String(m.params.graduationGnot))} · fee ${(Number(m.params.feeBps) / 100).toFixed(2)}%</div>` : ""}`;
      } else if (m?.kind === "profile") {
        body = `Profiles: <strong>${fmtNum(m.count)}</strong>`;
      } else if (m?.kind === "meta") {
        body = `Entries: <strong>${fmtNum(m.count)}</strong>`;
      } else if (m?.kind === "points") {
        body = `Users: <strong>${fmtNum(m.userCount)}</strong>`;
      } else if (m?.kind === "hub") {
        body = `Modules: <strong>${fmtNum(m.moduleCount)}</strong>
          ${m.admins?.length ? `<div class="muted mono" style="font-size:0.7rem">${m.admins.map((a) => escapeHtml(shortAddr(a))).join(", ")}</div>` : m.admin ? `<div class="muted mono" style="font-size:0.7rem">${escapeHtml(shortAddr(m.admin))}</div>` : ""}`;
      } else {
        body = m?.ok ? "ok" : escapeHtml(m?.error || "—");
      }
      return `<div class="ops-card ${m?.ok ? "ok" : "err"}">
        <div class="ops-card-top">
          <strong>${escapeHtml(name)}</strong>
          <span class="badge ${m?.ok ? "graduated" : "curve"}">${m?.ok ? "ok" : "err"}</span>
        </div>
        <div class="mono muted" style="font-size:0.7rem;margin:0.25rem 0">${escapeHtml(short)}</div>
        <div style="font-size:0.82rem">${body}</div>
        ${m?.error ? `<div class="bad-uri" style="font-size:0.72rem;margin-top:0.25rem">${escapeHtml(m.error)}</div>` : ""}
      </div>`;
    });
    // pads summary strip
    const pads = (data.pads || [])
      .map(
        (p) =>
          `<span class="badge ${p.active ? "active-pad" : "legacy"}">${escapeHtml(p.key)} · ${fmtNum(p.launchCount)}</span>`,
      )
      .join(" ");
    grid.innerHTML =
      (pads ? `<div class="ops-pads">${pads}</div>` : "") + cards.join("");
  } catch (e) {
    summary.className = "callout";
    summary.innerHTML = `<strong>Ops unavailable</strong><div class="muted">${escapeHtml(e.message || e)}</div>`;
  }
}

function renderWalletChrome() {
  const label = $("#walletLabel");
  const btn = $("#btnWallet");
  if (!label || !btn) return;
  if (state.wallet?.address) {
    label.textContent = shortAddr(state.wallet.address);
    btn.classList.add("connected");
    btn.title = state.wallet.address;
  } else {
    label.textContent = "Connect";
    btn.classList.remove("connected");
    btn.title = "";
  }
}

function openWalletModal() {
  $("#walletModal")?.classList.remove("hidden");
  renderWalletDemoList();
}

function closeWalletModal() {
  $("#walletModal")?.classList.add("hidden");
}

function renderWalletDemoList() {
  const list = $("#walletDemoList");
  if (!list) return;
  const adenaInstalled = hasAdena();
  const demos = state.walletsMeta?.demos || [];

  let html = `
    <button type="button" class="wallet-option wallet-adena" id="btnConnectAdena">
      <div class="wo-top">
        <strong>Adena</strong>
        <span class="badge graduated">${adenaInstalled ? "Ready" : "Install"}</span>
      </div>
      <div class="muted" style="font-size:0.78rem;margin-top:0.25rem">
        ${adenaInstalled ? "Sign transactions on Sapphire" : "Open adena.app to install"}
      </div>
    </button>`;

  for (const d of demos) {
    if (!d.canSign) continue;
    html += `
    <button type="button" class="wallet-option" data-addr="${escapeHtml(d.address)}" data-sign="1" data-label="${escapeHtml(d.label)}" data-type="local">
      <div class="wo-top"><strong>${escapeHtml(d.label)}</strong><span class="badge curve">Local</span></div>
      <div class="mono wo-addr">${escapeHtml(d.address)}</div>
    </button>`;
  }

  list.innerHTML = html;
  $("#btnConnectAdena")?.addEventListener("click", () => connectWithAdena());
  $$(".wallet-option[data-addr]", list).forEach((b) => {
    b.addEventListener("click", () => {
      saveWallet({
        address: b.dataset.addr,
        label: b.dataset.label,
        canSign: true,
        type: b.dataset.type || "local",
      });
      closeWalletModal();
      toast("Local signer connected");
      if (state.view === "portfolio") refreshPortfolio();
      if (state.view === "creator") refreshCreator();
      updateCreateHint();
    });
  });
}

function updateCreateHint() {
  const el = $("#createWalletHint");
  const btn = $("#btnCreateSubmit");
  if (!el) return;
  if (!isConnected()) {
    el.className = "callout warn";
    el.innerHTML = `Connect <strong>Adena</strong> to create.`;
  } else if (!canSign()) {
    el.className = "callout warn";
    el.innerHTML = `<span class="mono">${shortAddr(state.wallet.address)}</span> is view-only. Connect Adena to sign.`;
  } else {
    el.className = "callout ok";
    el.innerHTML = `Creating as <span class="mono">${escapeHtml(shortAddr(state.wallet.address))}</span>`;
  }
  if (btn) btn.textContent = "Create";
}

async function refreshPortfolio() {
  const panel = $("#portfolioPanel");
  if (!panel) return;
  if (!isConnected()) {
    panel.innerHTML = `
      <div class="panel empty-panel">
        <h2>Portfolio</h2>
        <p class="muted">Connect to view holdings.</p>
        <button type="button" class="btn primary" id="pfConnect">Connect</button>
      </div>`;
    $("#pfConnect")?.addEventListener("click", openWalletModal);
    return;
  }
  panel.innerHTML = `<div class="empty">Loading portfolio…</div>`;
  try {
    const p = await api(`/api/portfolio?address=${encodeURIComponent(state.wallet.address)}`);
    state.portfolio = p;
    // enrich spot if missing from markets
    const rows = (p.holdings || [])
      .map((h) => {
        const m = state.markets.find((x) => x.id === h.id);
        let value = h.valueUgnotApprox || 0;
        if (m && !value) {
          if (m.status === 0 && m.virtualToken > 0)
            value = Math.floor((h.balance * m.virtualUgnot) / m.virtualToken);
          else if (m.poolToken > 0) value = Math.floor((h.balance * m.poolUgnot) / m.poolToken);
        }
        return { ...h, valueUgnotApprox: value, market: m };
      })
      .sort((a, b) => (b.valueUgnotApprox || 0) - (a.valueUgnotApprox || 0));
    const totalMeme = rows.reduce((s, h) => s + (h.valueUgnotApprox || 0), 0);
    await fetchProfile(p.address);
    const me = state.profileCache[p.address];
    let pts = null;
    try {
      const pd = await api(`/api/points?address=${encodeURIComponent(p.address)}`);
      if (!pd.error) pts = Number(pd.points) || 0;
    } catch {
      /* points optional */
    }
    panel.innerHTML = `
      <div class="dash-head">
        <div>
          <h2 style="margin:0">Portfolio</h2>
          <div style="margin-top:0.35rem">${renderPersonChip(p.address)}</div>
          ${
            me?.bio
              ? `<div class="muted" style="font-size:0.85rem;margin-top:0.35rem">${escapeHtml(me.bio)}</div>`
              : `<div class="muted" style="font-size:0.8rem;margin-top:0.35rem"><button type="button" class="btn sm" data-nav="profile">${me ? "Edit profile" : "Set on-chain profile"}</button></div>`
          }
          <div class="muted" style="font-size:0.8rem;margin-top:0.2rem">${p.canSign ? "Signer — can trade from this UI" : "View-only — balances visible, txs disabled"}</div>
        </div>
        <button type="button" class="btn sm" id="pfRefresh">Refresh</button>
      </div>
      <div class="stat-cards dash-stats">
        <div class="stat"><div class="stat-k">GNOT balance</div><div class="stat-v">${fmtGnot(p.gnot ?? p.ugnot / UGNOT_PER_GNOT, { alreadyGnot: true })}</div></div>
        <div class="stat"><div class="stat-k">Meme positions</div><div class="stat-v">${p.memePositions}</div></div>
        <div class="stat"><div class="stat-k">Est. meme value</div><div class="stat-v">${fmtGnot(totalMeme / UGNOT_PER_GNOT, { alreadyGnot: true })}</div></div>
        <div class="stat"><div class="stat-k">Points</div><div class="stat-v">${pts == null ? "—" : fmtNum(pts)}${pts != null ? ` <button type="button" class="btn sm" data-nav="rewards" style="margin-left:0.35rem;vertical-align:middle">Rewards</button>` : ""}</div></div>
      </div>
      <div class="panel" style="margin-top:1rem">
        <h3 style="margin-top:0">Holdings</h3>
        ${
          rows.length
            ? `<div class="table-scroll"><table class="trade-table">
          <thead><tr><th>Token</th><th>Balance</th><th>Est. value</th><th></th></tr></thead>
          <tbody>
            ${rows
              .map((h) => {
                const tid = adenaWalletPath(h.market || h) || adenaWalletPath(h);
                return `<tr>
              <td><strong>${escapeHtml(h.name)}</strong> <span class="card-sym">$${escapeHtml(h.symbol)}</span>
                ${h.legacy || h.padLabel ? `<span class="badge ${h.legacy ? "legacy" : "active-pad"}" style="margin-left:0.35rem">${escapeHtml(h.padLabel || "")}</span>` : ""}
                <div class="muted mono" style="font-size:0.7rem">launch ${escapeHtml(h.id)}</div>
                ${
                  tid
                    ? `<div class="pf-contract">
                  <code class="mono pf-tid" title="${escapeHtml(tid)}">${escapeHtml(tid.length > 36 ? tid.slice(0, 16) + "…" + tid.slice(-10) : tid)}</code>
                  <button type="button" class="btn sm primary copy-btn" data-copy="${escapeHtml(tid)}" data-copy-label="Adena path copied">Copy path</button>
                </div>`
                    : ""
                }
              </td>
              <td class="mono">${fmtNum(h.balance)}</td>
              <td class="mono">${fmtGnot(h.valueGnotApprox ?? (h.valueUgnotApprox || 0) / UGNOT_PER_GNOT, { alreadyGnot: true })}</td>
              <td><button type="button" class="btn sm" data-open="${escapeHtml(h.id)}" data-pkg="${escapeHtml(h.pkg || "")}">Trade</button></td>
            </tr>`;
              })
              .join("")}
          </tbody>
        </table></div>`
            : `<div class="muted">No meme balances yet. Buy on the Markets page.</div>`
        }
      </div>
      ${renderPortfolioWatchlist()}`;
    $("#pfRefresh")?.addEventListener("click", () => {
      bustApiCache("/api/portfolio");
      refreshPortfolio();
    });
    $$("[data-nav]", panel).forEach((b) =>
      b.addEventListener("click", () => showView(b.dataset.nav)),
    );
    $$("[data-open]", panel).forEach((b) =>
      b.addEventListener("click", () => openToken(b.dataset.open, b.dataset.pkg || "")),
    );
    wireCopyButtons(panel);
  } catch (e) {
    panel.innerHTML = `<div class="empty">Portfolio error: ${escapeHtml(e.message)}</div>`;
  }
}

function renderPortfolioWatchlist() {
  const watched = state.markets.filter((m) => !m.error && isWatched(m.id, m.pkg));
  if (!watched.length) {
    return `<div class="panel" style="margin-top:1rem">
      <h3 style="margin-top:0">Watchlist</h3>
      <p class="muted" style="font-size:0.85rem;margin:0">No starred markets. Tap ★ on a market card to pin it here.</p>
    </div>`;
  }
  return `<div class="panel" style="margin-top:1rem">
    <h3 style="margin-top:0">Watchlist <span class="muted" style="font-weight:400">(${watched.length})</span></h3>
    <div class="watch-strip">
      ${watched
        .map((m) => {
          const rv = recentVolOf(m);
          return `<button type="button" class="watch-chip" data-open="${escapeHtml(m.id)}" data-pkg="${escapeHtml(m.pkg || "")}">
            <span class="card-sym">$${escapeHtml(m.symbol)}</span>
            <span class="mono">${fmtPriceGnot(m.priceGnot)}</span>
            <span class="muted">${m.status === 1 ? "Live" : `${m.progressPct || 0}%`}</span>
            ${rv.volumeGnot ? `<span class="muted mono">vol ${fmtGnot(rv.volumeGnot, { alreadyGnot: true })}</span>` : ""}
          </button>`;
        })
        .join("")}
    </div>
  </div>`;
}

function exportCreatorCsv(launches) {
  const lines = ["id,name,symbol,status,raised_gnot,fees_gnot,buyers,progress_pct,pkg,pad"];
  for (const m of launches || []) {
    const raised = m.raisedGnot != null ? m.raisedGnot : (m.raised || 0) / UGNOT_PER_GNOT;
    const fees = m.creatorFeesGnot != null ? m.creatorFeesGnot : (m.creatorFees || 0) / UGNOT_PER_GNOT;
    lines.push(
      [
        m.id,
        JSON.stringify(m.name || ""),
        m.symbol,
        m.statusLabel || m.status,
        raised,
        fees,
        m.buyers || 0,
        m.progressPct || 0,
        m.pkg || "",
        m.padLabel || "",
      ].join(","),
    );
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "gnomemepad-creator-launches.csv";
  a.click();
  URL.revokeObjectURL(a.href);
  toast("Creator CSV downloaded");
}

async function refreshCreator() {
  const panel = $("#creatorPanel");
  if (!panel) return;
  if (!isConnected()) {
    panel.innerHTML = `
      <div class="panel empty-panel">
        <h2>Creator hub</h2>
        <p class="muted">Connect the wallet you used to launch coins to claim fees and track performance.</p>
        <button type="button" class="btn primary" id="crConnect">Connect wallet</button>
      </div>`;
    $("#crConnect")?.addEventListener("click", openWalletModal);
    return;
  }
  panel.innerHTML = `<div class="empty">Loading creator dashboard…</div>`;
  try {
    const c = await api(`/api/creator?address=${encodeURIComponent(state.wallet.address)}`);
    state.creator = c;
    await fetchProfile(c.address);
    await prefetchProfiles((c.launches || []).map((x) => x.creator).filter(Boolean));
    const me = state.profileCache[c.address];
    const claimable = (c.launches || []).filter((m) => (m.creatorFees || m.creatorFeesGnot) > 0);
    panel.innerHTML = `
      <div class="dash-head">
        <div>
          <h2 style="margin:0">Creator hub</h2>
          <div style="margin-top:0.35rem">${renderPersonChip(c.address)}</div>
          ${
            me?.bio
              ? `<div class="muted" style="font-size:0.85rem;margin-top:0.35rem">${escapeHtml(me.bio)}</div>`
              : `<div class="muted" style="font-size:0.8rem;margin-top:0.35rem"><button type="button" class="btn sm" data-nav="profile">${me ? "Edit profile" : "Set on-chain profile"}</button></div>`
          }
        </div>
        <div style="display:flex;gap:0.5rem;flex-wrap:wrap">
          <button type="button" class="btn sm" data-nav="create">+ New coin</button>
          <button type="button" class="btn sm" data-nav="profile">Profile</button>
          <button type="button" class="btn sm" id="crExport" ${c.launches?.length ? "" : "disabled"}>Export CSV</button>
          <button type="button" class="btn sm" id="crRefresh">Refresh</button>
        </div>
      </div>
      <div class="stat-cards dash-stats">
        <div class="stat"><div class="stat-k">Launches</div><div class="stat-v">${c.count}</div></div>
        <div class="stat"><div class="stat-k">Claimable fees</div><div class="stat-v">${fmtGnot(c.totalFeesGnot ?? c.totalFees, { alreadyGnot: c.totalFeesGnot != null })}</div></div>
        <div class="stat"><div class="stat-k">Total raised</div><div class="stat-v">${fmtGnot(c.totalRaisedGnot ?? c.totalRaised, { alreadyGnot: c.totalRaisedGnot != null })}</div></div>
        <div class="stat"><div class="stat-k">Graduated</div><div class="stat-v">${c.graduated}</div></div>
      </div>
      <div class="panel" style="margin-top:1rem">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem;flex-wrap:wrap;margin-bottom:0.65rem">
          <h3 style="margin:0">Your coins</h3>
          ${
            claimable.length
              ? `<button type="button" class="btn sm primary" id="crClaimAll" ${!isConnected() ? "disabled" : ""}>Claim all fees (${claimable.length})</button>`
              : ""
          }
        </div>
        ${
          c.launches?.length
            ? `<div class="creator-grid">
            ${c.launches
              .map(
                (m) => `
              <article class="card creator-card">
                <div class="card-top">
                  <div>
                    <div class="card-title">${escapeHtml(m.name)}</div>
                    <div class="card-sym">$${escapeHtml(m.symbol)}</div>
                  </div>
                  <div class="card-badges">
                    <span class="badge ${m.status === 1 ? "graduated" : "curve"}">${escapeHtml(m.statusLabel)}</span>
                    ${m.padLabel ? `<span class="badge ${m.legacy ? "legacy" : "active-pad"}">${escapeHtml(m.padLabel)}</span>` : ""}
                  </div>
                </div>
                <div class="card-meta">
                  <div>Price <strong>${fmtPriceGnot(m.priceGnot)}</strong></div>
                  <div>MCap <strong>${fmtMcap(m.mcapGnot)}</strong></div>
                  <div>Raised <strong>${fmtGnot(m.raisedGnot ?? m.raised, { alreadyGnot: m.raisedGnot != null })}</strong></div>
                  <div>Fees <strong>${fmtGnot(m.creatorFeesGnot ?? m.creatorFees, { alreadyGnot: m.creatorFeesGnot != null })}</strong></div>
                </div>
                <div class="bar"><i style="width:${m.progressPct || 0}%"></i></div>
                <div class="creator-actions">
                  <button type="button" class="btn sm" data-open="${escapeHtml(m.id)}" data-pkg="${escapeHtml(m.pkg || "")}">Open</button>
                  <button type="button" class="btn sm primary" data-claim="${escapeHtml(m.id)}" data-pkg="${escapeHtml(m.pkg || "")}" ${!(m.creatorFees || m.creatorFeesGnot) ? "disabled" : ""}>
                    Claim fees
                  </button>
                </div>
              </article>`,
              )
              .join("")}
          </div>`
            : `<div class="muted">No launches under this address yet. <button type="button" class="btn sm" data-nav="create">Create one</button></div>`
        }
        <pre class="log" id="creatorLog" style="margin-top:1rem"></pre>
      </div>
      ${
        c.canSign && c.address === state.walletsMeta?.signerAddr
          ? `<div class="panel" style="margin-top:1rem">
          <h3 style="margin-top:0">Protocol treasury</h3>
          <p class="muted" style="font-size:0.85rem">If you called <code>Init</code>, you can claim protocol fees too.</p>
          <button type="button" class="btn sm" id="btnClaimProtocol">Claim protocol fees</button>
        </div>`
          : ""
      }`;
    $("#crRefresh")?.addEventListener("click", () => {
      bustApiCache("/api/creator");
      refreshCreator();
    });
    $("#crExport")?.addEventListener("click", () => exportCreatorCsv(c.launches || []));
    $$("[data-nav]", panel).forEach((b) =>
      b.addEventListener("click", () => showView(b.dataset.nav)),
    );
    $$("[data-open]", panel).forEach((b) =>
      b.addEventListener("click", () => openToken(b.dataset.open, b.dataset.pkg || "")),
    );
    async function claimOne(id, pkg, log) {
      const r = await broadcastRealm("ClaimCreatorFees", [id], "", pkg || "");
      if (log) log.textContent += `\n${id}: ${r.hash || "ok"}`;
      return r;
    }
    $$("[data-claim]", panel).forEach((b) =>
      b.addEventListener("click", async () => {
        if (!requireSigner("claim fees")) return;
        const log = $("#creatorLog");
        if (log) log.textContent = `Claiming ${b.dataset.claim}…`;
        try {
          await claimOne(b.dataset.claim, b.dataset.pkg || "", log);
          toast("Claim submitted");
          refreshCreator();
          refreshMarkets({ force: true });
        } catch (e) {
          if (log) log.textContent = String(e.message || e);
          toast(String(e.message || e), false);
        }
      }),
    );
    $("#crClaimAll")?.addEventListener("click", async () => {
      if (!requireSigner("claim all fees")) return;
      const log = $("#creatorLog");
      const list = (c.launches || []).filter((m) => (m.creatorFees || m.creatorFeesGnot) > 0);
      if (!list.length) return;
      if (log) log.textContent = `Claiming ${list.length} launches…`;
      let ok = 0;
      for (const m of list) {
        try {
          await claimOne(m.id, m.pkg || "", log);
          ok += 1;
        } catch (e) {
          if (log) log.textContent += `\n${m.id} fail: ${e.message || e}`;
        }
      }
      toast(ok ? `Submitted ${ok}/${list.length} claims` : "No claims submitted", ok > 0);
      refreshCreator();
      refreshMarkets({ force: true });
    });
    $("#btnClaimProtocol")?.addEventListener("click", async () => {
      if (!requireSigner("claim protocol fees")) return;
      const log = $("#creatorLog");
      try {
        const r = await broadcastRealm("ClaimProtocolFees", [], "");
        log.textContent = `Protocol claim\n${r.hash}`;
        toast("Protocol claim submitted");
        refreshMarkets();
      } catch (e) {
        toast(String(e.message || e), false);
      }
    });
  } catch (e) {
    panel.innerHTML = `<div class="empty">Creator error: ${escapeHtml(e.message)}</div>`;
  }
}

/** Active TradingView Lightweight Charts instance (destroy on re-render). */
let tvChart = null;
let tvResizeObs = null;

function destroyTvChart() {
  if (tvResizeObs) {
    try {
      tvResizeObs.disconnect();
    } catch {
      /* ignore */
    }
    tvResizeObs = null;
  }
  if (tvChart) {
    try {
      tvChart.remove();
    } catch {
      /* ignore */
    }
    tvChart = null;
  }
}

async function openToken(id, pkg = "") {
  state.selectedId = id;
  state.selectedPkg = pkg || "";
  showView("token");
  destroyTvChart();
  const panel = $("#tokenPanel");
  panel.innerHTML = `<div class="empty">Loading ${escapeHtml(id)}…</div>`;
  try {
    const m = await api(marketApiPath(id, pkg));
    state.selectedPkg = m.pkg || pkg || "";
    state.tradeMode = m.status === 1 ? "buy" : "buy";
    if (m.creator) await fetchProfile(m.creator);
    panel.innerHTML = renderToken(m);
    wireToken(m);
    requestAnimationFrame(() => mountTradingViewChart(m));
  } catch (e) {
    panel.innerHTML = `<div class="empty">Failed: ${escapeHtml(e.message)}</div>`;
  }
}

/** Price is ugnot/token * 1e6 → display as ugnot per 1M tokens (readable) or scientific */
function fmtPrice(scaled) {
  const v = Number(scaled) || 0;
  const perM = v;
  if (perM >= 1e6) return `${(perM / 1e6).toFixed(3)} ugnot/token`;
  if (perM >= 1) return `${perM.toFixed(2)} ugnot / 1M tok`;
  return `${perM.toFixed(4)} (×1e6)`;
}

/** Normalize trade points → strictly increasing UTCTimestamp (we use block height). */
function normalizeChartPoints(points) {
  // Prefer priceGnot from API; fallback convert on-chain scaled price
  const pts = (Array.isArray(points) ? points : []).filter((p) => {
    const pg = p.priceGnot != null ? Number(p.priceGnot) : Number(p.price) / UGNOT_PER_GNOT / 1_000_000;
    return pg > 0;
  });
  let lastT = 0;
  return pts.map((p) => {
    let t = Number(p.height) || 0;
    if (t <= lastT) t = lastT + 1;
    lastT = t;
    const priceGnot =
      p.priceGnot != null
        ? Number(p.priceGnot)
        : Number(p.price) / UGNOT_PER_GNOT / 1_000_000;
    const volumeGnot =
      p.volumeGnot != null ? Number(p.volumeGnot) : (Number(p.ugnot) || 0) / UGNOT_PER_GNOT;
    return {
      time: t,
      price: priceGnot,
      priceGnot,
      ugnot: Number(p.ugnot) || 0,
      volumeGnot,
      tokens: Number(p.tokens) || 0,
      side: Number(p.side),
      sideLabel: p.sideLabel || "trade",
    };
  });
}

function toAreaSeries(pts) {
  return pts.map((p) => ({ time: p.time, value: p.priceGnot || p.price }));
}

function toCandleSeries(pts) {
  const map = new Map();
  for (const p of pts) {
    const price = p.priceGnot || p.price;
    if (!map.has(p.time)) {
      map.set(p.time, {
        time: p.time,
        open: price,
        high: price,
        low: price,
        close: price,
      });
    } else {
      const c = map.get(p.time);
      c.high = Math.max(c.high, price);
      c.low = Math.min(c.low, price);
      c.close = price;
    }
  }
  return [...map.values()].sort((a, b) => a.time - b.time);
}

function toVolumeSeries(pts) {
  return pts.map((p) => ({
    time: p.time,
    value: p.volumeGnot || (p.ugnot || 0) / UGNOT_PER_GNOT,
    color:
      p.side === 1
        ? "rgba(248,113,113,0.45)"
        : p.side === 0
          ? "rgba(52,211,153,0.45)"
          : "rgba(124,92,255,0.35)",
  }));
}

function sliceChartPoints(points, range) {
  const pts = normalizeChartPoints(points);
  if (!pts.length) return [];
  if (range === "16") return pts.slice(-16);
  if (range === "32") return pts.slice(-32);
  return pts;
}

function chartShell(points, priceGnot) {
  const pts = normalizeChartPoints(points);
  if (!pts.length) {
    return `<div class="chart-empty">No trades yet — chart fills as buys/sells land on-chain.</div>`;
  }
  const last = pts[pts.length - 1];
  const first = pts[0];
  const lastP = last.priceGnot || last.price;
  const firstP = first.priceGnot || first.price;
  const change = firstP > 0 ? (((lastP - firstP) / firstP) * 100).toFixed(2) : "0";
  const up = lastP >= firstP;
  const range = state.chartRange || "all";
  return `
    <div class="chart-wrap">
      <div class="chart-toolbar">
        <div class="chart-title">
          Price chart
          <span class="muted">(GNOT · height)</span>
        </div>
        <div class="chart-meta">
          <span class="mono" id="tvSpot">${fmtPriceGnot(priceGnot || lastP)}</span>
          <span class="${up ? "chg-up" : "chg-down"}" id="tvChg">${up ? "+" : ""}${change}%</span>
          <span class="muted" id="tvPts">${pts.length} pts</span>
        </div>
      </div>
      <div class="chart-controls">
        <div class="tv-mode-tabs" id="tvRangeTabs" role="group" aria-label="Chart range">
          <button type="button" class="tv-mode ${range === "all" ? "active" : ""}" data-range="all">All</button>
          <button type="button" class="tv-mode ${range === "32" ? "active" : ""}" data-range="32">Last 32</button>
          <button type="button" class="tv-mode ${range === "16" ? "active" : ""}" data-range="16">Last 16</button>
        </div>
        <div class="tv-mode-tabs" id="tvModeTabs" role="group" aria-label="Chart type">
          <button type="button" class="tv-mode active" data-mode="area">Area</button>
          <button type="button" class="tv-mode" data-mode="candles">Candles</button>
          <button type="button" class="tv-mode" data-mode="line">Line</button>
        </div>
      </div>
      <div id="tvChart" class="tv-chart" role="img" aria-label="TradingView price chart"></div>
      <div class="chart-legend">
        <span><i class="lg buy"></i> buy vol</span>
        <span><i class="lg sell"></i> sell vol</span>
        <span class="muted">X = block height</span>
      </div>
    </div>`;
}

function mountTradingViewChart(m, mode = "area") {
  destroyTvChart();
  const el = $("#tvChart");
  if (!el) return;
  if (typeof LightweightCharts === "undefined") {
    el.innerHTML = `<div class="chart-empty">TradingView library failed to load (check network / CDN).</div>`;
    return;
  }
  const range = state.chartRange || "all";
  const pts = sliceChartPoints(m.chart || [], range);
  if (!pts.length) return;

  // Update meta for selected range
  const last = pts[pts.length - 1];
  const first = pts[0];
  const lastP = last.priceGnot || last.price;
  const firstP = first.priceGnot || first.price;
  const change = firstP > 0 ? (((lastP - firstP) / firstP) * 100).toFixed(2) : "0";
  const up = lastP >= firstP;
  const chgEl = $("#tvChg");
  const ptsEl = $("#tvPts");
  if (chgEl) {
    chgEl.textContent = `${up ? "+" : ""}${change}%`;
    chgEl.className = up ? "chg-up" : "chg-down";
  }
  if (ptsEl) ptsEl.textContent = `${pts.length} pts`;

  const w = Math.max(el.clientWidth || el.getBoundingClientRect().width || 600, 280);
  const chartH = window.matchMedia("(max-width: 860px)").matches ? 260 : 320;
  const chart = LightweightCharts.createChart(el, {
    width: w,
    height: chartH,
    layout: {
      background: { color: "transparent" },
      textColor: "#8b95b0",
      fontFamily: "'JetBrains Mono', ui-monospace, monospace",
    },
    grid: {
      vertLines: { color: "rgba(255,255,255,0.05)" },
      horzLines: { color: "rgba(255,255,255,0.05)" },
    },
    crosshair: {
      mode: LightweightCharts.CrosshairMode.Normal,
      vertLine: { color: "rgba(167,139,250,0.4)", labelBackgroundColor: "#7c5cff" },
      horzLine: { color: "rgba(167,139,250,0.4)", labelBackgroundColor: "#7c5cff" },
    },
    rightPriceScale: {
      borderColor: "rgba(255,255,255,0.08)",
      scaleMargins: { top: 0.12, bottom: 0.22 },
    },
    timeScale: {
      borderColor: "rgba(255,255,255,0.08)",
      timeVisible: true,
      secondsVisible: false,
      tickMarkFormatter: (time) => `h${time}`,
    },
    localization: {
      timeFormatter: (time) => `height ${time}`,
      priceFormatter: (p) => {
        if (p >= 0.01) return p.toFixed(6);
        if (p > 0) return p.toExponential(2);
        return "0";
      },
    },
  });
  tvChart = chart;

  // Volume in GNOT
  const volSeries = chart.addHistogramSeries({
    priceFormat: { type: "volume" },
    priceScaleId: "vol",
  });
  chart.priceScale("vol").applyOptions({
    scaleMargins: { top: 0.8, bottom: 0 },
  });
  volSeries.setData(toVolumeSeries(pts));

  if (mode === "candles") {
    const candle = chart.addCandlestickSeries({
      upColor: "#34d399",
      downColor: "#f87171",
      borderUpColor: "#34d399",
      borderDownColor: "#f87171",
      wickUpColor: "#34d399",
      wickDownColor: "#f87171",
    });
    candle.setData(toCandleSeries(pts));
  } else if (mode === "line") {
    const line = chart.addLineSeries({
      color: "#a78bfa",
      lineWidth: 2,
      crosshairMarkerVisible: true,
    });
    line.setData(toAreaSeries(pts));
  } else {
    const area = chart.addAreaSeries({
      lineColor: "#a78bfa",
      topColor: "rgba(124,92,255,0.45)",
      bottomColor: "rgba(124,92,255,0.02)",
      lineWidth: 2,
    });
    area.setData(toAreaSeries(pts));
  }

  chart.timeScale().fitContent();

  // Range tabs
  $$("#tvRangeTabs .tv-mode").forEach((b) => {
    b.classList.toggle("active", b.dataset.range === range);
    b.onclick = () => {
      state.chartRange = b.dataset.range || "all";
      mountTradingViewChart(m, mode);
    };
  });

  // Mode tabs
  $$("#tvModeTabs .tv-mode").forEach((b) => {
    b.classList.toggle("active", b.dataset.mode === mode);
    b.onclick = () => mountTradingViewChart(m, b.dataset.mode);
  });

  // Resize
  if (typeof ResizeObserver !== "undefined") {
    tvResizeObs = new ResizeObserver(() => {
      if (!tvChart || !el) return;
      const { width, height } = el.getBoundingClientRect();
      if (width > 0 && height > 0) tvChart.applyOptions({ width, height });
    });
    tvResizeObs.observe(el);
  }
}

function tradeVolGnot(p) {
  return p.volumeGnot != null ? Number(p.volumeGnot) : (Number(p.ugnot) || 0) / UGNOT_PER_GNOT;
}

function renderLargestTrades(points, precomputed) {
  const trades =
    precomputed?.length
      ? precomputed.map((p) => ({
          ...p,
          vg: p.volumeGnot || 0,
          pg: p.priceGnot || 0,
        }))
      : (points || [])
          .filter((p) => Number(p.side) !== 2)
          .map((p) => ({
            ...p,
            vg: tradeVolGnot(p),
            pg:
              p.priceGnot != null
                ? Number(p.priceGnot)
                : Number(p.price) / UGNOT_PER_GNOT / 1_000_000,
          }))
          .filter((p) => p.vg > 0)
          .sort((a, b) => b.vg - a.vg)
          .slice(0, 5);
  if (!trades.length) return "";
  return `
    <div class="largest-trades">
      <h4 class="trade-table-title" style="margin:0 0 0.45rem">Largest trades <span class="muted" style="font-weight:400">(ring sample)</span></h4>
      <div class="largest-list">
        ${trades
          .slice(0, 5)
          .map((p) => {
            const side = p.side === 1 ? "sell" : "buy";
            return `<div class="largest-row ${side}">
              <span class="badge ${side === "buy" ? "graduated" : "curve"}">${side}</span>
              <span class="mono">${fmtGnot(p.vg, { alreadyGnot: true })}</span>
              <span class="muted mono">@ ${fmtPriceGnot(p.pg)}</span>
              <span class="muted mono">h${escapeHtml(String(p.height))}</span>
            </div>`;
          })
          .join("")}
      </div>
    </div>`;
}

function renderHoldersPanel(m) {
  const holders = m.holders || [];
  const note = m.holdersNote;
  const topTrades = m.topTrades || [];
  let body = "";
  if (holders.length) {
    body = `<div class="table-scroll"><table class="trade-table">
      <thead><tr><th>#</th><th>Buyer</th><th>Balance</th><th>Est. value</th></tr></thead>
      <tbody>
        ${holders
          .slice(0, 15)
          .map(
            (h, i) => `<tr>
            <td class="mono">${i + 1}</td>
            <td>${renderPersonChip(h.address)}</td>
            <td class="mono">${fmtNum(h.balance)}</td>
            <td class="mono">${fmtGnot(h.valueGnot || 0, { alreadyGnot: true })}</td>
          </tr>`,
          )
          .join("")}
      </tbody>
    </table></div>
    <p class="muted" style="font-size:0.72rem;margin:0.4rem 0 0">
      Unique buyers with balance &gt; 0 (from <code>ListBuyers</code>).
      ${m.holdersCapped ? " List capped — not full GRC20 transfer holders." : ""}
      Not a complete transfer-graph holder set.
    </p>`;
  } else {
    body = `<p class="muted" style="font-size:0.85rem;margin:0 0 0.5rem">${
      note
        ? escapeHtml(note)
        : "No buyer balances yet (or ListBuyers empty)."
    }</p>
    ${
      topTrades.length
        ? `<p class="muted" style="font-size:0.75rem;margin:0 0 0.35rem">Top trade sizes from history (addresses not in ring buffer):</p>
      ${renderLargestTrades(null, topTrades)}`
        : ""
    }`;
  }
  return `
    <div class="holders-panel">
      <h4 class="trade-table-title" style="margin:0 0 0.45rem">
        Holders / buyers
        <span class="muted" style="font-weight:400">
          (${holders.length ? holders.length : m.buyers != null ? `${fmtNum(m.buyers)} unique` : "—"})
        </span>
      </h4>
      ${body}
    </div>`;
}

function renderTradeTable(points, m) {
  const all = [...(points || [])].reverse();
  const rows = all.slice(0, 40);
  const stats = tradeStatsFromChart(points || []);
  const buyPct =
    stats.volumeGnot > 0
      ? Math.min(100, Math.round((stats.buyVolumeGnot / stats.volumeGnot) * 100))
      : 50;
  const historyBlock = !rows.length
    ? `<div class="muted" style="font-size:0.85rem">No trade history.</div>`
    : `
    ${renderLargestTrades(points, m?.topTrades)}
    <div class="trade-flow" style="margin:0.75rem 0 0.5rem">
      <div class="trade-flow-labels">
        <span class="chg-up">Buy ${fmtGnot(stats.buyVolumeGnot || 0, { alreadyGnot: true })} (${buyPct}%)</span>
        <span class="chg-down">Sell ${fmtGnot(stats.sellVolumeGnot || 0, { alreadyGnot: true })} (${100 - buyPct}%)</span>
      </div>
      <div class="vol-split tall">
        <i class="buy" style="width:${buyPct}%"></i>
        <i class="sell" style="width:${100 - buyPct}%"></i>
      </div>
    </div>
    <div class="trade-table-wrap">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem;flex-wrap:wrap;margin-bottom:0.45rem">
        <h4 class="trade-table-title" style="margin:0">Trade history <span class="muted" style="font-weight:400">(${all.length} samples)</span></h4>
        <button type="button" class="btn sm" id="btnExportTrades">Export CSV</button>
      </div>
      <div class="table-scroll">
      <table class="trade-table" id="tradeHistoryTable">
        <thead><tr><th>Height</th><th>Side</th><th>Price (GNOT)</th><th>Volume (GNOT)</th><th>Tokens</th></tr></thead>
        <tbody>
          ${rows
            .map((p) => {
              const cls = p.side === 1 ? "sell" : p.side === 0 ? "buy" : "open";
              const pg =
                p.priceGnot != null
                  ? p.priceGnot
                  : Number(p.price) / UGNOT_PER_GNOT / 1_000_000;
              const vg = tradeVolGnot(p);
              return `<tr class="${cls}">
                <td class="mono">${p.height}</td>
                <td>${escapeHtml(p.sideLabel)}</td>
                <td class="mono">${fmtPriceGnot(pg)}</td>
                <td class="mono">${fmtGnot(vg, { alreadyGnot: true })}</td>
                <td class="mono">${fmtNum(p.tokens)}</td>
              </tr>`;
            })
            .join("")}
        </tbody>
      </table>
      </div>
      ${all.length > 40 ? `<p class="muted" style="font-size:0.75rem;margin:0.4rem 0 0">Showing latest 40 of ${all.length}. Export CSV for full sample.</p>` : ""}
    </div>`;
  return `${m ? renderHoldersPanel(m) : ""}${historyBlock}`;
}

function exportTradesCsv(points, symbol) {
  const rows = [...(points || [])];
  const lines = ["height,side,price_gnot,volume_gnot,tokens,ugnot"];
  for (const p of rows) {
    const pg =
      p.priceGnot != null ? p.priceGnot : Number(p.price) / UGNOT_PER_GNOT / 1_000_000;
    const vg = p.volumeGnot != null ? p.volumeGnot : (Number(p.ugnot) || 0) / UGNOT_PER_GNOT;
    lines.push([p.height, p.sideLabel, pg, vg, p.tokens, p.ugnot].join(","));
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `gnomemepad-${symbol || "trades"}-history.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast("CSV downloaded");
}

function activityItemHtml(e) {
  const side = e.side === 0 ? "buy" : e.side === 1 ? "sell" : "open";
  const vol =
    e.side === 2
      ? "new"
      : e.side === 0
        ? fmtGnot(e.volumeGnot, { alreadyGnot: true })
        : `${fmtNum(e.tokens)} tok`;
  return `<button type="button" class="act-item act-${side}" data-open="${escapeHtml(e.id)}" data-pkg="${escapeHtml(e.pkg || "")}">
    <span class="act-side">${side}</span>
    <span class="act-sym">$${escapeHtml(e.symbol)}</span>
    <span class="act-vol mono">${escapeHtml(String(vol))}</span>
    <span class="act-pad muted">${escapeHtml(e.padLabel || "")}</span>
    <span class="act-h mono muted">h${escapeHtml(String(e.height))}</span>
  </button>`;
}

function bindActivityClicks(root) {
  $$(".act-item", root).forEach((b) =>
    b.addEventListener("click", () => openToken(b.dataset.open, b.dataset.pkg || "")),
  );
}

function setActivityMarquee(feed, sequenceHtml, sequenceLen) {
  // Two identical halves → seamless translateX(-50%) loop
  const n = Math.max(1, sequenceLen || 1);
  const track = document.createElement("div");
  track.className = "activity-track marquee";
  track.innerHTML = sequenceHtml + sequenceHtml;
  // ~2.1s per chip across one half; clamp for readability
  const secs = Math.min(56, Math.max(14, n * 2.1));
  track.style.animationDuration = `${secs}s`;
  feed.replaceChildren(track);
  bindActivityClicks(feed);
}

async function refreshActivity() {
  const feed = $("#activityFeed");
  const meta = $("#activityMeta");
  if (!feed) return;
  try {
    // Wider limit: marquee + recent-vol intel for market cards
    const data = await api("/api/activity?limit=80");
    const events = data.events || [];
    applyActivityVolume(events);
    checkLargeTradeAlerts(events);
    if (state.view === "home") renderMarketGrid();
    if (meta) meta.textContent = events.length ? `${events.length}` : "";
    if (!events.length) {
      feed.innerHTML = `<div class="activity-track activity-empty muted">No recent trades yet.</div>`;
      return;
    }
    // Marquee uses a subset so chips stay readable
    const marqueeEvents = events.slice(0, 28);
    let seq = marqueeEvents.slice();
    while (seq.length < 10) seq = seq.concat(marqueeEvents);
    const sequenceHtml = seq.map(activityItemHtml).join("");
    setActivityMarquee(feed, sequenceHtml, seq.length);
  } catch (e) {
    feed.innerHTML = `<div class="activity-track activity-empty muted">Activity unavailable: ${escapeHtml(e.message || e)}</div>`;
  }
}

function tradeStatsFromChart(chart) {
  if (chart && typeof chart === "object" && !Array.isArray(chart) && chart.volumeGnot != null) {
    return chart; // already stats object
  }
  let volumeGnot = 0;
  let buyVolumeGnot = 0;
  let sellVolumeGnot = 0;
  let buyCount = 0;
  let sellCount = 0;
  let trades = 0;
  for (const pt of chart || []) {
    const side = Number(pt.side);
    if (side === 2) continue;
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
  return { trades, buyCount, sellCount, volumeGnot, buyVolumeGnot, sellVolumeGnot };
}

function tokenShareUrl(m) {
  const u = new URL(window.location.href);
  u.hash = "";
  u.searchParams.set("token", m.id || "");
  if (m.pkg) u.searchParams.set("pkg", m.pkg);
  return u.toString();
}

function renderToken(m) {
  const isPool = m.status === 1;
  const buyLabel = isPool ? "Swap buy" : "Buy on curve";
  const sellLabel = isPool ? "Swap sell" : "Sell on curve";
  const chart = chartShell(m.chart || [], m.priceGnot);
  const trades = renderTradeTable(m.chart || [], m);
  const stats = m.tradeStats || tradeStatsFromChart(m.chart || []);
  const watched = isWatched(m.id, m.pkg);
  const cachedMeta = getCachedMeta(m.id, m.pkg);
  const headImg = safeImageUri(cachedMeta?.imageURI);
  const padBadge = m.legacy
    ? `<span class="badge legacy" title="${escapeHtml(m.pkg || "")}">${escapeHtml(m.padLabel || "legacy")}</span>`
    : `<span class="badge active-pad" title="${escapeHtml(m.pkg || "")}">${escapeHtml(m.padLabel || "pad")}</span>`;
  return `
    <div class="panel">
      <div class="token-head">
        <div class="token-head-main">
          ${
            headImg
              ? `<img class="token-avatar" id="tokenAvatar" src="${escapeHtml(headImg)}" alt="" loading="lazy" referrerpolicy="no-referrer" />`
              : `<div class="token-avatar token-avatar-fallback" id="tokenAvatarFallback">$${(m.symbol || "?").slice(0, 3)}</div>`
          }
          <div>
          <h2>${escapeHtml(m.name)} <span class="card-sym">$${escapeHtml(m.symbol)}</span></h2>
          <div class="mono muted" style="font-size:0.8rem;margin-top:0.25rem">launch ${escapeHtml(m.id)}</div>
          ${
            m.legacy
              ? `<div class="callout" style="margin-top:0.5rem;font-size:0.8rem">Legacy pad <code class="mono">${escapeHtml(m.padLabel || "")}</code> — trade still works; new launches use active pad.</div>`
              : ""
          }
          <div class="price-mcap-row">
            <div class="pm-block">
              <div class="pm-k">Price</div>
              <div class="pm-v">${fmtPriceGnot(m.priceGnot)}</div>
            </div>
            <div class="pm-block">
              <div class="pm-k">Market cap (FDV)</div>
              <div class="pm-v">${fmtMcap(m.mcapGnot)}</div>
            </div>
            <div class="pm-block">
              <div class="pm-k">Circ. mcap</div>
              <div class="pm-v">${fmtMcap(m.circMcapGnot)}</div>
            </div>
            <div class="pm-block">
              <div class="pm-k">Volume (history)</div>
              <div class="pm-v">${fmtGnot(stats.volumeGnot || 0, { alreadyGnot: true })}</div>
            </div>
          </div>
          </div>
        </div>
        <div class="card-badges token-actions">
          <button type="button" class="btn sm" id="btnShareToken" title="Share link + card image">Share</button>
          <button type="button" class="btn sm" id="btnShareCard" title="Download share card PNG">Card</button>
          <button type="button" class="btn sm card-watch-btn ${watched ? "on" : ""}" id="btnWatchToken">${watched ? "★ Watch" : "☆ Watch"}</button>
          <span class="badge ${isPool ? "graduated" : "curve"}">${isPool ? "Live" : "Curve"}</span>
          ${padBadge}
        </div>
      </div>
      ${chart}
      ${
        isPool
          ? ""
          : `<div class="bar"><i style="width:${m.progressPct || 0}%"></i></div>
      <div class="bar-label"><span>To graduate</span><span>${m.progressPct || 0}%</span></div>`
      }
      <div class="kv">
        <div class="kv-row"><span>Raised</span><span>${fmtGnot(m.raisedGnot ?? m.raised, { alreadyGnot: m.raisedGnot != null })}</span></div>
        <div class="kv-row"><span>Buyers</span><span>${fmtNum(m.buyers)}</span></div>
        <div class="kv-row"><span>Trades (ring)</span><span>${fmtNum(stats.trades || 0)} · buy ${fmtNum(stats.buyCount || 0)} / sell ${fmtNum(stats.sellCount || 0)}</span></div>
        <div class="kv-row"><span>Buy vol</span><span>${fmtGnot(stats.buyVolumeGnot || 0, { alreadyGnot: true })}</span></div>
        <div class="kv-row"><span>Sell vol</span><span>${fmtGnot(stats.sellVolumeGnot || 0, { alreadyGnot: true })}</span></div>
        <div class="kv-row"><span>Creator fees</span><span>${fmtGnot(m.creatorFeesGnot ?? m.creatorFees, { alreadyGnot: m.creatorFeesGnot != null })}</span></div>
        <div class="kv-row"><span>Creator</span><span>${renderPersonChip(m.creator)}</span></div>
        ${
          m.gnoswapReady || isPool
            ? `<div class="kv-row"><span>Gnoswap</span><span class="badge graduated">Ready to list</span></div>`
            : `<div class="kv-row"><span>Gnoswap</span><span class="muted">After graduation</span></div>`
        }
      </div>
      ${renderContractBox(m)}
      <div id="tokenMetaBox" class="meta-box" data-pkg="${escapeHtml(m.pkg || "")}" data-id="${escapeHtml(m.id || "")}">
        <div class="contract-box-title" style="font-weight:650;font-size:0.9rem;margin-bottom:0.35rem">Token info</div>
        <div id="tokenMetaView" class="muted" style="font-size:0.85rem">Loading metadata…</div>
        <details id="tokenMetaEdit" class="meta-edit" style="margin-top:0.65rem">
          <summary>Edit metadata (first writer owns)</summary>
          <form id="metaForm" class="form" style="margin-top:0.5rem">
            <label>Description<textarea name="description" maxlength="500" rows="2" placeholder="About this coin"></textarea></label>
            <label>Image URI
              <input name="imageURI" id="metaImageURI" placeholder="https://… or ipfs://" />
            </label>
            <div class="meta-image-tools">
              <label class="btn sm meta-file-btn">
                Pick image
                <input type="file" id="metaImageFile" accept="image/*" hidden />
              </label>
              <button type="button" class="btn sm" id="btnMetaHost" title="Open free image host to get a public URL">Get free URL</button>
            </div>
            <p class="muted" style="font-size:0.7rem;margin:0.25rem 0 0">On-chain meta needs a public <code>https://</code> or <code>ipfs://</code> URL. Pick image to preview &amp; resize (≤512px), then host it and paste the link.</p>
            <div id="metaImagePreview" class="meta-preview muted" hidden>Preview will appear for valid http(s)/ipfs URIs</div>
            <label>Website<input name="website" id="metaWebsite" placeholder="https://" /></label>
            <label>Twitter / X<input name="twitter" placeholder="handle" maxlength="64" /></label>
            <label>Telegram<input name="telegram" placeholder="handle or t.me/…" maxlength="64" /></label>
            <p class="muted" id="metaUriHint" style="font-size:0.72rem;margin:0">Image &amp; website must be <code>http(s)://</code> or <code>ipfs://</code>.</p>
            <button type="submit" class="btn sm primary">Save metadata</button>
          </form>
          <pre class="log" id="metaLog" hidden></pre>
        </details>
      </div>
      ${
        m.gnoswapReady || isPool
          ? `<div class="callout ok gnoswap-checklist" style="margin-top:0.75rem">
          <strong>GRC20 ready for Gnoswap</strong>
          <ol class="checklist">
            <li>Copy <strong>Token ID</strong> / Adena path above</li>
            <li>Open <a href="https://docs.gnoswap.io/references/onboarding-guide" target="_blank" rel="noreferrer">Gnoswap onboarding</a></li>
            <li>Create permissionless GNOT / $${escapeHtml(m.symbol)} pool</li>
            <li>Seed liquidity (holders/creator) — pad CPMM stays locked in parallel</li>
          </ol>
          <p class="muted" style="font-size:0.75rem;margin:0.4rem 0 0">Prices may diverge across venues; arbitrage is expected.</p>
        </div>`
          : ""
      }
      ${trades}
    </div>
    <div class="panel">
      <h3 style="margin:0 0 0.75rem">Trade</h3>
      <div class="wallet-balances" id="walletBalances">
        <div class="wb-row">
          <span class="wb-k">$${escapeHtml(m.symbol)}</span>
          <span class="wb-v mono" id="balTokens">—</span>
        </div>
        <div class="wb-row">
          <span class="wb-k">GNOT</span>
          <span class="wb-v mono" id="balGnot">—</span>
        </div>
        <div class="wb-hint muted" id="balHint"></div>
      </div>
      <div class="trade-tabs">
        <button type="button" class="tab-buy active" data-mode="buy">${buyLabel}</button>
        <button type="button" class="tab-sell" data-mode="sell">${sellLabel}</button>
      </div>
      <div class="slip-row" id="slipRow">
        <span class="slip-label">Slippage</span>
        <div class="slip-quick" id="slipQuick">
          <button type="button" data-slip="0.5">0.5%</button>
          <button type="button" data-slip="1" class="active">1%</button>
          <button type="button" data-slip="2">2%</button>
          <button type="button" data-slip="5">5%</button>
        </div>
        <label class="slip-custom">
          <input type="number" id="slipCustom" min="0" max="50" step="0.1" value="1" class="mono" />
          <span>%</span>
        </label>
      </div>
      <div id="tradeBuy">
        <form class="form" id="buyForm">
          <label>Amount (GNOT)
            <input name="amount" id="buyAmount" type="number" min="0.000001" step="any" value="0.3" class="mono" required />
          </label>
          <div class="quick" id="buyQuick">
            <button type="button" data-v="0.1">0.1</button>
            <button type="button" data-v="0.3">0.3</button>
            <button type="button" data-v="0.5">0.5</button>
            <button type="button" data-v="1">1</button>
            <button type="button" data-pct="25">25%</button>
            <button type="button" data-pct="50">50%</button>
            <button type="button" data-pct="75">75%</button>
            <button type="button" data-pct="100">MAX</button>
          </div>
          <div class="quote-box" id="buyQuote">
            <div class="quote-row"><span>Est. tokens</span><span class="mono" id="buyEst">—</span></div>
            <div class="quote-row"><span>Min received</span><span class="mono" id="buyMin">—</span></div>
            <div class="quote-row muted"><span>Fee (~${(feeBpsOf(m) / 100).toFixed(2)}%)</span><span class="mono" id="buyFee">—</span></div>
            <p class="quote-warn muted" id="buySlipWarn" hidden>0% slippage = no minOut protection on-chain.</p>
            <p class="quote-warn bad-uri" id="buyCurveWarn" hidden>Buy exceeds remaining curve supply.</p>
          </div>
          <button class="btn primary wide" type="submit">Buy</button>
        </form>
      </div>
      <div id="tradeSell" class="hidden">
        <form class="form" id="sellForm">
          <label>Tokens to sell
            <input name="tokens" id="sellAmount" type="number" min="1" step="1" value="0" class="mono" required />
          </label>
          <div class="quick" id="sellQuick">
            <button type="button" data-pct="25">25%</button>
            <button type="button" data-pct="50">50%</button>
            <button type="button" data-pct="75">75%</button>
            <button type="button" data-pct="100">MAX</button>
          </div>
          <div class="quote-box" id="sellQuote">
            <div class="quote-row"><span>Est. GNOT</span><span class="mono" id="sellEst">—</span></div>
            <div class="quote-row"><span>Min received</span><span class="mono" id="sellMin">—</span></div>
            <div class="quote-row muted"><span>Fee (~${(feeBpsOf(m) / 100).toFixed(2)}%)</span><span class="mono" id="sellFee">—</span></div>
          </div>
          <button class="btn danger wide" type="submit">Sell</button>
        </form>
      </div>
      <pre class="tx-log" id="txLog" hidden></pre>
    </div>`;
}

/** Live balances for the open token panel */
const tradeBal = { tokens: 0, gnot: 0, id: null, pkg: "" };

async function refreshTradeBalances(tokenId, pkg = "") {
  const tokEl = $("#balTokens");
  const gnotEl = $("#balGnot");
  const hint = $("#balHint");
  if (!tokEl || !gnotEl) return;
  if (!isConnected()) {
    tokEl.textContent = "—";
    gnotEl.textContent = "—";
    if (hint) hint.textContent = "Connect wallet to load balances";
    tradeBal.tokens = 0;
    tradeBal.gnot = 0;
    return;
  }
  if (hint) hint.textContent = "Loading…";
  try {
    const pkgQ = pkg || state.selectedPkg || "";
    let balUrl = `/api/balance?id=${encodeURIComponent(tokenId)}&address=${encodeURIComponent(state.wallet.address)}`;
    if (pkgQ) balUrl += `&pkg=${encodeURIComponent(pkgQ)}`;
    const b = await api(balUrl);
    tradeBal.tokens = Number(b.tokens) || 0;
    tradeBal.gnot = Number(b.gnot) || 0;
    tradeBal.id = tokenId;
    tokEl.textContent = fmtNum(tradeBal.tokens);
    gnotEl.textContent = fmtGnot(tradeBal.gnot, { alreadyGnot: true });
    if (hint) {
      hint.textContent = tradeBal.tokens
        ? `You hold ${fmtNum(tradeBal.tokens)} tokens`
        : "No tokens in this wallet yet — buy to start";
    }
    // Prefill sell amount if empty/zero
    const sellIn = $("#sellAmount");
    if (sellIn && (!sellIn.value || sellIn.value === "0") && tradeBal.tokens > 0) {
      sellIn.value = String(Math.floor(tradeBal.tokens * 0.25) || tradeBal.tokens);
    }
  } catch (e) {
    tokEl.textContent = "err";
    gnotEl.textContent = "err";
    if (hint) hint.textContent = String(e.message || e);
  }
}

function wireToken(m) {
  const root = $("#tokenPanel") || document;
  wireCopyButtons(root);
  const log = (t) => {
    const el = $("#txLog");
    if (!el) return;
    el.hidden = !t;
    el.textContent = t || "";
  };
  const marketPkg = m.pkg || state.selectedPkg || pkgPath();
  refreshTradeBalances(m.id, marketPkg);
  loadTokenMeta(marketPkg, m.id);

  $("#btnShareToken")?.addEventListener("click", async () => {
    const url = tokenShareUrl(m);
    try {
      if (navigator.share) {
        await navigator.share({
          title: `$${m.symbol} on gnomemepad`,
          text: `${m.name} · ${fmtPriceGnot(m.priceGnot)}`,
          url,
        });
        toast("Shared");
        return;
      }
    } catch (e) {
      if (e?.name === "AbortError") return;
    }
    try {
      await navigator.clipboard.writeText(url);
      toast("Share link copied");
    } catch {
      prompt("Copy share link:", url);
    }
  });
  $("#btnShareCard")?.addEventListener("click", () => shareTokenCard(m));
  $("#btnWatchToken")?.addEventListener("click", () => {
    const on = toggleWatch(m.id, marketPkg);
    const b = $("#btnWatchToken");
    if (b) {
      b.textContent = on ? "★ Watch" : "☆ Watch";
      b.classList.toggle("on", on);
    }
    toast(on ? "Added to watchlist" : "Removed from watchlist");
  });

  function refreshMetaImagePreview(localDataUrl) {
    const input = $("#metaImageURI");
    const box = $("#metaImagePreview");
    if (!input || !box) return;
    if (localDataUrl) {
      box.hidden = false;
      box.innerHTML = `<img class="meta-img preview" src="${localDataUrl}" alt="local preview" />
        <div class="muted" style="font-size:0.7rem;margin-top:0.3rem">Local preview only — host this image, paste the public URL above, then Save.</div>`;
      return;
    }
    const uri = String(input.value || "").trim();
    const safe = safeImageUri(uri);
    if (!uri) {
      box.hidden = true;
      box.innerHTML = "";
      return;
    }
    if (!safe) {
      box.hidden = false;
      box.innerHTML = `<span class="bad-uri">Invalid image URI — use http(s):// or ipfs://</span>`;
      return;
    }
    box.hidden = false;
    box.innerHTML = `<img class="meta-img preview" src="${escapeHtml(safe)}" alt="preview" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentElement.innerHTML='<span class=\\'bad-uri\\'>Image failed to load</span>'" />`;
  }
  $("#metaImageURI")?.addEventListener("input", () => refreshMetaImagePreview());
  $("#btnMetaHost")?.addEventListener("click", () => {
    window.open("https://postimages.org/", "_blank", "noopener,noreferrer");
    toast("Upload image → copy Direct link → paste into Image URI");
  });
  $("#metaImageFile")?.addEventListener("change", async (ev) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast("Choose an image file", false);
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      toast("Image too large (max ~4MB for preview)", false);
      return;
    }
    try {
      const dataUrl = await resizeImageFile(file, 512);
      refreshMetaImagePreview(dataUrl);
      toast("Preview ready — host online & paste URL to save on-chain");
    } catch (err) {
      toast(String(err.message || err), false);
    }
  });
  refreshMetaImagePreview();

  $("#btnExportTrades")?.addEventListener("click", () =>
    exportTradesCsv(m.chart || [], m.symbol),
  );
  $("#metaForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!requireSigner("save metadata")) return;
    const fd = new FormData(e.target);
    const imageURI = String(fd.get("imageURI") || "").trim();
    const website = String(fd.get("website") || "").trim();
    if (!isValidMetaUri(imageURI) || !isValidMetaUri(website)) {
      toast("Image & website must be http(s):// or ipfs://", false);
      return;
    }
    const log = $("#metaLog");
    if (log) {
      log.hidden = false;
      log.textContent = "Approve in Adena…";
    }
    try {
      const r = await broadcastPkg(
        metaPkgPath(),
        "SetMeta",
        [
          marketPkg,
          m.id,
          String(fd.get("description") || ""),
          imageURI,
          website,
          String(fd.get("twitter") || ""),
          String(fd.get("telegram") || ""),
        ],
        "",
      );
      if (log) log.textContent = r.hash ? `Submitted\n${r.hash}` : "Submitted";
      toast("Metadata saved");
      state.metaCache[marketKey(m.id, marketPkg)] = {
        ...(state.metaCache[marketKey(m.id, marketPkg)] || {}),
        description: String(fd.get("description") || ""),
        imageURI,
        website,
        twitter: String(fd.get("twitter") || ""),
        telegram: String(fd.get("telegram") || ""),
      };
      await new Promise((res) => setTimeout(res, 1500));
      loadTokenMeta(marketPkg, m.id);
    } catch (err) {
      if (log) log.textContent = String(err.message || err);
      toast(String(err.message || err), false);
    }
  });

  let slipPct = loadSlippagePct();
  const slipCustom = $("#slipCustom");
  if (slipCustom) slipCustom.value = String(slipPct);

  function setSlipActive(pct) {
    slipPct = pct;
    saveSlippagePct(pct);
    if (slipCustom) slipCustom.value = String(pct);
    $$("#slipQuick button").forEach((b) => {
      b.classList.toggle("active", Math.abs(Number(b.dataset.slip) - pct) < 0.001);
    });
    updateBuyQuote();
    updateSellQuote();
  }

  $$("#slipQuick button").forEach((b) => {
    b.classList.toggle("active", Math.abs(Number(b.dataset.slip) - slipPct) < 0.001);
    b.addEventListener("click", () => setSlipActive(Number(b.dataset.slip)));
  });
  slipCustom?.addEventListener("input", () => {
    const v = Number(slipCustom.value);
    if (!Number.isFinite(v) || v < 0) return;
    slipPct = Math.min(50, v);
    saveSlippagePct(slipPct);
    $$("#slipQuick button").forEach((b) => b.classList.remove("active"));
    updateBuyQuote();
    updateSellQuote();
  });

  function updateBuyQuote() {
    const amt = $("#buyAmount")?.value;
    const q = quoteTrade(m, "buy", amt);
    const estEl = $("#buyEst");
    const minEl = $("#buyMin");
    const feeEl = $("#buyFee");
    const warn = $("#buySlipWarn");
    const curveWarn = $("#buyCurveWarn");
    if (!q.ok && !q.exceedsCurve) {
      if (estEl) estEl.textContent = "—";
      if (minEl) minEl.textContent = "—";
      if (feeEl) feeEl.textContent = "—";
      if (curveWarn) curveWarn.hidden = true;
      if (warn) warn.hidden = true;
      return { minOut: 0, expected: 0, exceedsCurve: false };
    }
    const expected = q.expectedOut || q.tokensOut || 0;
    const minOut = minOutFromQuote(expected, slipPct);
    if (estEl) {
      estEl.textContent = fmtNum(expected);
      if (q.exceedsCurve && q.remaining != null) {
        estEl.textContent = `${fmtNum(expected)} (need ≤ ${fmtNum(q.remaining)} left on curve)`;
      }
    }
    if (minEl) {
      minEl.textContent = slipPct > 0 ? fmtNum(minOut) : "none (0% slip)";
      minEl.classList.toggle("warn-min", slipPct > 0 && minOut <= 0 && expected > 0);
    }
    if (feeEl) feeEl.textContent = fmtGnot(q.feeUgnot);
    if (warn) {
      warn.hidden = !(slipPct <= 0 && padSupportsMinOut(m.pkg || "") && !q.exceedsCurve);
    }
    if (curveWarn) {
      curveWarn.hidden = !q.exceedsCurve;
      if (q.exceedsCurve) {
        const maxU = maxUgnotForCurveRemaining(m);
        const maxG = maxU / UGNOT_PER_GNOT;
        curveWarn.textContent = `Buy too large for remaining curve supply (${fmtNum(q.remaining)} tokens left). Max ~${maxG > 0 ? maxG.toFixed(6) : "0"} GNOT — reduce amount or wait for graduate.`;
      }
    }
    return {
      minOut: q.exceedsCurve ? 0 : minOut,
      expected: q.exceedsCurve ? 0 : expected,
      exceedsCurve: !!q.exceedsCurve,
      remaining: q.remaining,
    };
  }

  function updateSellQuote() {
    const amt = $("#sellAmount")?.value;
    const q = quoteTrade(m, "sell", amt);
    const estEl = $("#sellEst");
    const minEl = $("#sellMin");
    const feeEl = $("#sellFee");
    if (!q.ok) {
      if (estEl) estEl.textContent = "—";
      if (minEl) minEl.textContent = "—";
      if (feeEl) feeEl.textContent = "—";
      return { minOut: 0, expected: 0 };
    }
    const minOut = minOutFromQuote(q.expectedOut, slipPct);
    if (estEl) estEl.textContent = fmtGnot(q.expectedOut);
    if (minEl) {
      minEl.textContent = slipPct > 0 ? fmtGnot(minOut) : "none (0% slip)";
      minEl.classList.toggle("warn-min", slipPct > 0 && minOut <= 0 && q.expectedOut > 0);
    }
    if (feeEl) feeEl.textContent = fmtGnot(q.feeUgnot);
    return { minOut, expected: q.expectedOut };
  }

  $$(".trade-tabs button").forEach((b) => {
    b.addEventListener("click", () => {
      $$(".trade-tabs button").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      const mode = b.dataset.mode;
      $("#tradeBuy").classList.toggle("hidden", mode !== "buy");
      $("#tradeSell").classList.toggle("hidden", mode !== "sell");
      if (mode === "buy") updateBuyQuote();
      else updateSellQuote();
    });
  });

  // Buy quick: fixed GNOT or % of wallet GNOT (capped by remaining curve supply)
  $$("#buyQuick button").forEach((b) => {
    b.addEventListener("click", () => {
      const input = $("#buyAmount") || $('#buyForm [name="amount"]');
      if (!input) return;
      if (b.dataset.pct) {
        const pct = Number(b.dataset.pct) / 100;
        const g = tradeBal.gnot * pct;
        // leave a tiny dust for gas if MAX
        let use = b.dataset.pct === "100" ? Math.max(0, tradeBal.gnot - 0.05) : g;
        // Cap by remaining curve tokens (Buy panics if tokensOut > remaining)
        if (m.status !== 1) {
          const maxU = maxUgnotForCurveRemaining(m);
          const maxG = maxU / UGNOT_PER_GNOT;
          if (maxG > 0 && use > maxG) use = maxG;
        }
        input.value = use > 0 ? (Math.floor(use * 1e6) / 1e6).toString() : "0";
      } else {
        input.value = b.dataset.v;
      }
      updateBuyQuote();
    });
  });
  $("#buyAmount")?.addEventListener("input", updateBuyQuote);

  // Sell quick: % of token balance
  $$("#sellQuick button").forEach((b) => {
    b.addEventListener("click", () => {
      const input = $("#sellAmount") || $('#sellForm [name="tokens"]');
      if (!input) return;
      const pct = Number(b.dataset.pct || 100) / 100;
      const amt = Math.floor(tradeBal.tokens * pct);
      input.value = String(amt > 0 ? amt : 0);
      updateSellQuote();
    });
  });
  $("#sellAmount")?.addEventListener("input", updateSellQuote);

  updateBuyQuote();
  updateSellQuote();

  $("#buyForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!requireSigner("buy")) return;
    const fd = new FormData(e.target);
    const amountGnot = fd.get("amount");
    const amountUgnot = gnotToUgnot(amountGnot);
    if (amountUgnot <= 0) {
      toast("Invalid GNOT amount", false);
      return;
    }
    const { minOut, expected, exceedsCurve, remaining } = updateBuyQuote();
    if (exceedsCurve) {
      const maxU = maxUgnotForCurveRemaining(m);
      const maxG = maxU / UGNOT_PER_GNOT;
      toast(
        `Buy exceeds remaining curve (${fmtNum(remaining)} tokens left). Max ~${maxG.toFixed(6)} GNOT`,
        false,
      );
      return;
    }
    if (expected <= 0) {
      toast("Cannot quote this buy (check amount / pool)", false);
      return;
    }
    // Double-check remaining right before send (fresh sold if available on m)
    if (m.status !== 1) {
      const rem = curveRemainingTokens(m);
      const qCheck = quoteCurveBuy(
        Number(m.virtualUgnot) || 0,
        Number(m.virtualToken) || 0,
        amountUgnot,
        feeBpsOf(m),
      );
      if (qCheck.ok && rem > 0 && qCheck.tokensOut > rem) {
        toast(`Would buy ${fmtNum(qCheck.tokensOut)} but only ${fmtNum(rem)} left on curve — reduce GNOT`, false);
        return;
      }
    }
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    log(
      `Broadcasting buy ${amountGnot} GNOT on ${m.padLabel || "pad"}…\nest ${fmtNum(expected)} tokens · min ${fmtNum(minOut)} (slip ${slipPct}%)`,
    );
    try {
      const func = m.status === 1 ? "SwapBuy" : "Buy";
      // padv4+: Buy/SwapBuy(id, minTokensOut). padv3: Buy/SwapBuy(id) only.
      const useMinOut = padSupportsMinOut(marketPkg);
      const r = await broadcastRealm(
        func,
        useMinOut ? [m.id, String(minOut)] : [m.id],
        `${amountUgnot}ugnot`,
        marketPkg,
      );
      const got = r.result || "?";
      log(`OK height ${r.height}\nhash ${r.hash}\n+${got} tokens`);
      toast("Buy submitted");
      await refreshTradeBalances(m.id, marketPkg);
      try {
        const fresh = await api(marketApiPath(m.id, marketPkg));
        await refreshTradeBalances(m.id, marketPkg);
        log(
          `OK height ${r.height}\n+${got} tokens\nWallet now: ${fmtNum(tradeBal.tokens)} $${m.symbol} · ${fmtGnot(tradeBal.gnot, { alreadyGnot: true })}`,
        );
        state.selectedId = m.id;
        state.selectedPkg = marketPkg;
        const panel = $("#tokenPanel");
        panel.innerHTML = renderToken(fresh);
        wireToken(fresh);
        mountTradingViewChart(fresh);
        const tl = $("#txLog");
        if (tl) {
          tl.textContent = `OK height ${r.height}\nhash ${r.hash}\n+${got} tokens\nWallet: ${fmtNum(tradeBal.tokens)} $${m.symbol} · ${fmtGnot(tradeBal.gnot, { alreadyGnot: true })}`;
        }
      } catch {
        await openToken(m.id, marketPkg);
      }
      refreshMarkets();
    } catch (err) {
      log(String(err.message || err));
      toast(String(err.message || err), false);
    } finally {
      btn.disabled = false;
    }
  });

  $("#sellForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!requireSigner("sell")) return;
    const fd = new FormData(e.target);
    const tokens = fd.get("tokens");
    if (!tokens || Number(tokens) <= 0) {
      toast("Enter tokens to sell (use % buttons)", false);
      return;
    }
    if (tradeBal.tokens > 0 && Number(tokens) > tradeBal.tokens) {
      toast(`Only ${fmtNum(tradeBal.tokens)} tokens in wallet`, false);
      return;
    }
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    const { minOut, expected } = updateSellQuote();
    if (expected <= 0) {
      toast("Cannot quote this sell (check amount / pool)", false);
      btn.disabled = false;
      return;
    }
    log(
      `Broadcasting sell ${fmtNum(tokens)} tokens…\nest ${fmtGnot(expected)} · min ${fmtGnot(minOut)} (slip ${slipPct}%)`,
    );
    try {
      const func = m.status === 1 ? "SwapSell" : "Sell";
      const useMinOut = padSupportsMinOut(marketPkg);
      const r = await broadcastRealm(
        func,
        useMinOut ? [m.id, String(tokens), String(minOut)] : [m.id, String(tokens)],
        "",
        marketPkg,
      );
      log(`OK height ${r.height}\nhash ${r.hash}\nout ${r.result != null ? fmtGnot(r.result) : "see tx"}`);
      toast("Sell submitted");
      await refreshTradeBalances(m.id, marketPkg);
      try {
        const fresh = await api(marketApiPath(m.id, marketPkg));
        $("#tokenPanel").innerHTML = renderToken(fresh);
        wireToken(fresh);
        mountTradingViewChart(fresh);
        const tl = $("#txLog");
        if (tl) {
          tl.textContent = `OK height ${r.height}\nout ${fmtGnot(r.result)}\nWallet: ${fmtNum(tradeBal.tokens)} $${m.symbol} · ${fmtGnot(tradeBal.gnot, { alreadyGnot: true })}`;
        }
      } catch {
        await openToken(m.id, marketPkg);
      }
      refreshMarkets();
    } catch (err) {
      log(String(err.message || err));
      toast(String(err.message || err), false);
    } finally {
      btn.disabled = false;
    }
  });
}

function renderMetaHtml(meta) {
  if (!meta) {
    return `<div class="muted">No metadata yet — open <em>Edit metadata</em> to add description &amp; links.</div>`;
  }
  const links = [];
  if (meta.website) {
    links.push(
      `<a href="${escapeHtml(meta.website)}" target="_blank" rel="noreferrer">Website</a>`,
    );
  }
  if (meta.twitter) {
    const tw = meta.twitter.replace(/^@/, "");
    const href = meta.twitter.startsWith("http")
      ? meta.twitter
      : `https://x.com/${encodeURIComponent(tw)}`;
    links.push(`<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">X/@${escapeHtml(tw)}</a>`);
  }
  if (meta.telegram) {
    const tg = meta.telegram.replace(/^@/, "");
    const href = meta.telegram.startsWith("http")
      ? meta.telegram
      : `https://t.me/${encodeURIComponent(tg)}`;
    links.push(`<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">Telegram</a>`);
  }
  return `
    ${meta.imageURI ? `<div class="meta-img-wrap"><img class="meta-img" src="${escapeHtml(meta.imageURI)}" alt="" loading="lazy" referrerpolicy="no-referrer" /></div>` : ""}
    ${meta.description ? `<p class="meta-desc">${escapeHtml(meta.description)}</p>` : `<p class="muted">No description</p>`}
    ${links.length ? `<div class="meta-links">${links.join(" · ")}</div>` : ""}
    <div class="muted mono" style="font-size:0.7rem;margin-top:0.35rem">owner ${escapeHtml(shortAddr(meta.owner))} · h${escapeHtml(String(meta.updated || "—"))}</div>`;
}

async function loadTokenMeta(pkg, id) {
  const view = $("#tokenMetaView");
  const form = $("#metaForm");
  if (!view) return;
  try {
    const data = await api(
      `/api/meta?pkg=${encodeURIComponent(pkg)}&id=${encodeURIComponent(id)}`,
    );
    const meta = data.meta;
    state.metaCache[marketKey(id, pkg)] = meta;
    view.innerHTML = renderMetaHtml(meta);
    if (meta && form) {
      if (form.description) form.description.value = meta.description || "";
      if (form.imageURI) form.imageURI.value = meta.imageURI || "";
      if (form.website) form.website.value = meta.website || "";
      if (form.twitter) form.twitter.value = meta.twitter || "";
      if (form.telegram) form.telegram.value = meta.telegram || "";
    }
    // Update token header avatar if present
    const safe = safeImageUri(meta?.imageURI);
    const av = $("#tokenAvatar");
    const fb = $("#tokenAvatarFallback");
    if (safe && av) av.src = safe;
    if (safe && fb) {
      const img = document.createElement("img");
      img.className = "token-avatar";
      img.id = "tokenAvatar";
      img.src = safe;
      img.alt = "";
      img.loading = "lazy";
      img.referrerPolicy = "no-referrer";
      fb.replaceWith(img);
    }
    const prev = $("#metaImagePreview");
    if (prev && form?.imageURI?.value) {
      const s = safeImageUri(form.imageURI.value);
      if (s) {
        prev.hidden = false;
        prev.innerHTML = `<img class="meta-img preview" src="${escapeHtml(s)}" alt="preview" loading="lazy" referrerpolicy="no-referrer" />`;
      }
    }
  } catch (e) {
    view.innerHTML = `<div class="muted">Metadata unavailable (deploy meta realm?). ${escapeHtml(e.message || e)}</div>`;
  }
}

async function refreshRewardsView() {
  const hint = $("#rewardsHint");
  const lb = $("#rewardsLeaderboard");
  const log = $("#rewardsLog");
  try {
    const addr = state.wallet?.address || "";
    const q = addr ? `?address=${encodeURIComponent(addr)}` : "";
    const data = await api(`/api/points${q}`);
    if (data.error && !data.leaderboard?.length) {
      if (hint) {
        hint.innerHTML = `Points realm not ready — deploy with <code>deploy-sapphire-meta-points.ps1</code>. <span class="muted">${escapeHtml(data.error)}</span>`;
      }
      if (lb) lb.textContent = "—";
      return;
    }
    const p = data.params || {};
    $("#rwPoints").textContent = addr ? fmtNum(data.points || 0) : "—";
    $("#rwRefBonus").textContent = `+${p.referrerBonus ?? 50}`;
    $("#rwCheckIn").textContent = `+${p.checkIn ?? 5}`;
    const v2box = $("#rewardsV2Stats");
    const v2note = $("#rewardsV2Note");
    if (p.version === 2) {
      v2box?.classList.remove("hidden");
      v2note?.classList.remove("hidden");
      if ($("#rwCreate")) $("#rwCreate").textContent = `+${p.createBonus ?? 30}`;
      if ($("#rwBuyPts"))
        $("#rwBuyPts").textContent = `+${p.buyBase ?? 2} +${p.ptsPerGnotBuy ?? 10}/GNOT`;
      if ($("#rwSellPts"))
        $("#rwSellPts").textContent = `+${p.sellBase ?? 1} +${p.ptsPerGnotSell ?? 3}/GNOT`;
      if (v2note) {
        v2note.innerHTML = `Trade/create points are awarded <strong>on-chain via pad</strong> (pointsv2 allowlist). Cap ${escapeHtml(String(p.maxPerHeight || 200))} pts/height.
          Issued: trade <strong>${fmtNum(p.tradePtsTotal)}</strong> · create <strong>${fmtNum(p.createPtsTotal)}</strong>.
          Needs <code class="mono">padv6.SetPointsEnabled(true)</code> + <code class="mono">AllowPad</code>.`;
      }
    } else {
      v2box?.classList.add("hidden");
      v2note?.classList.add("hidden");
    }
    if (hint) {
      if (!isConnected()) {
        hint.innerHTML = `Connect <strong>Adena</strong> to set a referrer and check in. Realm: <code class="mono">${escapeHtml(pointsPkgPath())}</code>${p.version === 2 ? " · <span class='badge heat-hot'>v2</span>" : ""}`;
      } else {
        const ref = data.referrer
          ? `Referrer: ${renderPersonChip(data.referrer)}`
          : "No referrer set yet (once only).";
        hint.innerHTML = `Signed in as ${renderPersonChip(addr, { link: false })} · ${ref}
          <div class="muted" style="font-size:0.75rem;margin-top:0.35rem">Check-in every ~${escapeHtml(String(p.checkInInterval || 100))} heights · <code class="mono">${escapeHtml(pointsPkgPath())}</code></div>`;
      }
    }
    const rows = data.leaderboard || [];
    if (lb) {
      if (!rows.length) {
        lb.innerHTML = `<div class="muted">No scores yet — be first to check in.</div>`;
      } else {
        await prefetchProfiles(rows.map((r) => r.address));
        lb.innerHTML = `<table class="trade-table"><thead><tr><th>#</th><th>User</th><th>Points</th></tr></thead><tbody>
          ${rows
            .map(
              (r, i) => `<tr>
              <td class="mono">${i + 1}</td>
              <td>${renderPersonChip(r.address)}</td>
              <td class="mono">${fmtNum(r.points)}</td>
            </tr>`,
            )
            .join("")}
        </tbody></table>`;
      }
    }
    if (log) log.hidden = true;
  } catch (e) {
    if (hint) hint.textContent = String(e.message || e);
  }
}

async function refreshProfileView() {
  const hint = $("#profileWalletHint");
  const prev = $("#profilePreview");
  const form = $("#profileForm");
  if (!isConnected()) {
    if (hint) hint.innerHTML = `Connect <strong>Adena</strong> to edit your on-chain profile.`;
    if (prev) prev.textContent = "";
    return;
  }
  if (hint) {
    const gw = profileGnowebUrl(state.wallet.address);
    hint.innerHTML = `Editing as ${renderPersonChip(state.wallet.address, { link: false })}
      <div class="muted" style="font-size:0.75rem;margin-top:0.35rem">Realm: <code class="mono">${escapeHtml(profilePkgPath())}</code>
      · <a href="${escapeHtml(gw)}" target="_blank" rel="noreferrer">View on gnoweb</a></div>`;
  }
  try {
    const data = await api(`/api/profile?address=${encodeURIComponent(state.wallet.address)}`);
    const p = data.profile;
    if (p && form) {
      if (form.name) form.name.value = p.name || "";
      if (form.bio) form.bio.value = p.bio || "";
      if (form.uri) form.uri.value = p.uri || "";
    }
    if (prev) {
      if (p) {
        prev.innerHTML = `<strong>${escapeHtml(p.name)}</strong>
          ${p.bio ? `<div>${escapeHtml(p.bio)}</div>` : ""}
          ${p.uri ? `<div class="mono muted">${escapeHtml(p.uri)}</div>` : ""}
          <div class="muted">Updated height ${escapeHtml(String(p.updated || "—"))}</div>`;
      } else {
        prev.textContent = "No profile on-chain yet — fill the form and save.";
      }
    }
  } catch (e) {
    if (prev) prev.textContent = String(e.message || e);
  }
}

function wireGlobal() {
  $$("[data-nav]").forEach((el) => {
    el.addEventListener("click", () => {
      const v = el.dataset.nav;
      if (["home", "create", "portfolio", "creator", "profile", "rewards", "ops", "docs"].includes(v))
        showView(v);
    });
  });
  $("#btnRewardsRefresh")?.addEventListener("click", () => refreshRewardsView());
  $("#btnOpsRefresh")?.addEventListener("click", () => refreshOpsView());
  $("#btnSetReferrer")?.addEventListener("click", async () => {
    if (!requireSigner("set referrer")) return;
    const ref = ($("#rwReferrer")?.value || "").trim();
    if (!/^g1[a-z0-9]{38,}$/i.test(ref)) {
      toast("Invalid referrer g1 address", false);
      return;
    }
    const log = $("#rewardsLog");
    if (log) {
      log.hidden = false;
      log.textContent = "Approve SetReferrer…";
    }
    try {
      const r = await broadcastPkg(pointsPkgPath(), "SetReferrer", [ref], "");
      if (log) log.textContent = r.hash ? `OK\n${r.hash}` : "OK";
      toast("Referrer set");
      await new Promise((res) => setTimeout(res, 1500));
      refreshRewardsView();
    } catch (e) {
      if (log) log.textContent = String(e.message || e);
      toast(String(e.message || e), false);
    }
  });
  $("#btnCheckIn")?.addEventListener("click", async () => {
    if (!requireSigner("check in")) return;
    const log = $("#rewardsLog");
    if (log) {
      log.hidden = false;
      log.textContent = "Approve CheckIn…";
    }
    try {
      const r = await broadcastPkg(pointsPkgPath(), "CheckIn", [], "");
      if (log) log.textContent = r.hash ? `OK\n${r.hash}` : "OK";
      toast("Check-in submitted");
      await new Promise((res) => setTimeout(res, 1500));
      refreshRewardsView();
    } catch (e) {
      if (log) log.textContent = String(e.message || e);
      toast(String(e.message || e), false);
    }
  });
  $("#btnRefresh")?.addEventListener("click", () => {
    bustApiCache();
    refreshHealth();
    refreshMarkets({ force: true });
  });
  $("#btnNotify")?.addEventListener("click", () => toggleNotifications());
  updateNotifyButton();
  wirePwa();
  $("#search")?.addEventListener("input", () => renderMarketGrid());
  $$("#padFilter .filter-btn").forEach((b) => {
    b.addEventListener("click", () => {
      state.marketFilter = b.dataset.filter || "all";
      $$("#padFilter .filter-btn").forEach((x) =>
        x.classList.toggle("active", x.dataset.filter === state.marketFilter),
      );
      renderMarketGrid();
    });
  });
  $$("#statusFilter .filter-btn").forEach((b) => {
    b.addEventListener("click", () => {
      state.statusFilter = b.dataset.status || "all";
      $$("#statusFilter .filter-btn").forEach((x) =>
        x.classList.toggle("active", x.dataset.status === state.statusFilter),
      );
      renderMarketGrid();
    });
  });
  const sortEl = $("#marketSort");
  if (sortEl) {
    sortEl.value = state.marketSort || "hot";
    sortEl.addEventListener("change", () => {
      saveMarketSort(sortEl.value || "hot");
      renderMarketGrid();
    });
  }
  $("#btnWallet")?.addEventListener("click", openWalletModal);
  $("#heroConnect")?.addEventListener("click", openWalletModal);
  $("#docsConnect")?.addEventListener("click", () => connectWithAdena());
  // In-page docs anchors
  $$('#view-docs a[href^="#"]').forEach((a) => {
    a.addEventListener("click", (e) => {
      const id = a.getAttribute("href")?.slice(1);
      const target = id && document.getElementById(id);
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  });
  $$("[data-close-modal]").forEach((el) => el.addEventListener("click", closeWalletModal));
  $("#btnWalletPaste")?.addEventListener("click", () => {
    const addr = ($("#walletPaste")?.value || "").trim();
    if (!/^g1[a-z0-9]{38,}$/i.test(addr)) {
      toast("Invalid g1 address", false);
      return;
    }
    saveWallet({
      address: addr,
      label: "View-only",
      canSign: false,
      type: "view",
    });
    closeWalletModal();
    toast("View-only mode");
    if (state.view === "portfolio") refreshPortfolio();
    if (state.view === "creator") refreshCreator();
    updateCreateHint();
  });
  $("#btnWalletDisconnect")?.addEventListener("click", () => {
    saveWallet(null);
    closeWalletModal();
    toast("Disconnected");
    if (state.view === "portfolio") refreshPortfolio();
    if (state.view === "creator") refreshCreator();
    updateCreateHint();
  });
  $("#createForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!requireSigner("create a coin")) return;
    const fd = new FormData(e.target);
    const name = fd.get("name");
    const symbol = String(fd.get("symbol") || "").toUpperCase();
    const uri = fd.get("uri") || "";
    const bond = `${gnotToUgnot(fd.get("bond") || 1)}ugnot`;
    const log = $("#createLog");
    if (log) {
      log.hidden = false;
      log.textContent = "Approve in wallet…";
    }
    try {
      const r = await broadcastRealm("Create", [name, symbol, uri], bond);
      if (log) log.textContent = r.hash ? `Submitted\n${r.hash}` : "Submitted";
      toast(`$${symbol} created`);
      await new Promise((res) => setTimeout(res, 2000));
      await refreshMarkets();
      refreshCreator();
      if (r.result) openToken(r.result);
      else showView("home");
    } catch (err) {
      if (log) log.textContent = String(err.message || err);
      toast(String(err.message || err), false);
    }
  });
  $("#profileForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!requireSigner("save profile")) return;
    const fd = new FormData(e.target);
    const name = String(fd.get("name") || "").trim();
    const bio = String(fd.get("bio") || "").trim();
    const uri = String(fd.get("uri") || "").trim();
    const log = $("#profileLog");
    if (log) {
      log.hidden = false;
      log.textContent = "Approve in Adena…";
    }
    try {
      const r = await broadcastPkg(profilePkgPath(), "SetProfile", [name, bio, uri], "");
      if (log) log.textContent = r.hash ? `Submitted\n${r.hash}` : "Submitted";
      toast("Profile saved");
      await new Promise((res) => setTimeout(res, 1500));
      refreshProfileView();
    } catch (err) {
      if (log) log.textContent = String(err.message || err);
      toast(String(err.message || err), false);
    }
  });
}

async function boot() {
  try {
    loadWatchlist();
    loadMarketSort();
    state.wallet = loadWallet();
    // stale local "signer" without type should not pretend canSign on Netlify
    if (state.wallet && state.wallet.type !== "adena" && state.wallet.type !== "local") {
      state.wallet.canSign = false;
      state.wallet.type = state.wallet.type || "view";
    }
    renderWalletChrome();
    wireGlobal();
    // restore sort select after wire
    const sortEl = $("#marketSort");
    if (sortEl) sortEl.value = state.marketSort || "hot";
    try {
      state.walletsMeta = await api("/api/wallets");
    } catch {
      state.walletsMeta = { demos: [] };
    }
    onAccountChange((address) => {
      if (state.wallet?.type === "adena" && address) {
        saveWallet({ ...state.wallet, address });
        toast(`Adena account: ${shortAddr(address)}`);
        if (state.view === "portfolio") refreshPortfolio();
        if (state.view === "creator") refreshCreator();
      }
    });
    await refreshHealth();
    await refreshMarkets();
    updateCreateHint();
    // Deep link: ?token=ID&pkg=...
    try {
      const sp = new URLSearchParams(window.location.search);
      const tok = sp.get("token");
      if (tok) openToken(tok, sp.get("pkg") || "");
    } catch {
      /* ignore */
    }
    setInterval(refreshHealth, 8000);
  } catch (e) {
    console.error(e);
    const main = document.querySelector("main");
    if (main) {
      main.innerHTML = `<div class="panel" style="margin:2rem auto;max-width:520px">
        <h2>UI failed to start</h2>
        <p class="muted">${String(e.message || e)}</p>
        <p class="muted">Ensure server is running: <code>cd web && node server.mjs</code></p>
        <p class="muted">Then open <a href="http://127.0.0.1:5173">http://127.0.0.1:5173</a></p>
      </div>`;
    }
  }
}

boot();
