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

const state = {
  view: "home",
  markets: [],
  params: null,
  selectedId: null,
  tradeMode: "buy",
  wallet: null, // { address, label, canSign, type: 'adena'|'local'|'view' }
  walletsMeta: null,
  portfolio: null,
  creator: null,
  // from /api/health
  pkg: DEFAULT_NETWORK.pkg || null,
  chainId: DEFAULT_NETWORK.chainId,
  rpcUrl: DEFAULT_NETWORK.rpcUrl,
  readOnlyHost: false,
  hosting: null,
};

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
    state.walletsMeta?.pkg ||
    "gno.land/r/g1mv0052e7r6s09f5t9xsqf00nj3tqsgt9dg52jr/gnomemepad/pad"
  );
}

/**
 * Broadcast a realm call: Adena if connected as type=adena, else server gnokey API.
 */
async function broadcastRealm(func, args = [], send = "") {
  if (state.wallet?.type === "adena" && state.wallet.canSign) {
    return doContractCall({
      caller: state.wallet.address,
      pkgPath: pkgPath(),
      func,
      args,
      send: send || "",
      gasWanted: 50_000_000,
      gasFee: 1_000_000,
    });
  }
  // Local server path (legacy demo gnokey)
  const path =
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
  if (!path) throw new Error(`Unknown func ${func}`);
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
  return api(path, { method: "POST", body: JSON.stringify(body) });
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

async function api(path, opts) {
  const r = await fetch(path, {
    headers: { "content-type": "application/json", ...(opts?.headers || {}) },
    ...opts,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  if (j.error && j.ok === false) throw new Error(j.error);
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
    if (h.chainId) state.chainId = h.chainId;
    if (h.rpc) state.rpcUrl = h.rpc;
    if (h && h.signing === false) state.readOnlyHost = true;
    if (h && h.hosting === "netlify") state.hosting = "netlify";
    if (h.ok) {
      setNet(true, h.chainId || "online");
    } else setNet(false, "offline");
  } catch (e) {
    setNet(false, "offline");
  }
}

async function refreshMarkets() {
  const grid = $("#marketGrid");
  try {
    const data = await api("/api/markets");
    state.markets = data.markets || [];
    state.params = data.params;
    $("#statMarkets").textContent = String(data.count ?? state.markets.length);
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
  } catch (e) {
    grid.innerHTML = `<div class="empty">Failed to load markets</div>`;
  }
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderMarketGrid() {
  const q = ($("#search").value || "").trim().toLowerCase();
  let list = state.markets.filter((m) => !m.error);
  if (q) {
    list = list.filter(
      (m) =>
        m.name?.toLowerCase().includes(q) ||
        m.symbol?.toLowerCase().includes(q) ||
        m.id?.toLowerCase().includes(q),
    );
  }
  const grid = $("#marketGrid");
  if (!list.length) {
    grid.innerHTML = `<div class="empty">${state.markets.length ? "No results" : "No markets yet. Launch the first coin."}</div>`;
    return;
  }
  grid.innerHTML = list
    .map((m) => {
      const pct = m.progressPct ?? 0;
      const st = m.status === 1 ? "Live" : "Curve";
      return `
      <article class="card" data-id="${escapeHtml(m.id)}">
        <div class="card-top">
          <div>
            <div class="card-title">${escapeHtml(m.name)}</div>
            <div class="card-sym">$${escapeHtml(m.symbol)}</div>
          </div>
          <span class="badge ${m.status === 1 ? "graduated" : "curve"}">${st}</span>
        </div>
        <div class="card-meta">
          <div>Price<strong>${fmtPriceGnot(m.priceGnot)}</strong></div>
          <div>MCap<strong>${fmtMcap(m.mcapGnot)}</strong></div>
          <div>Raised<strong>${fmtGnot(m.raisedGnot ?? m.raised, { alreadyGnot: m.raisedGnot != null })}</strong></div>
          <div>Buyers<strong>${fmtNum(m.buyers)}</strong></div>
        </div>
        ${
          m.status === 1
            ? ""
            : `<div class="bar"><i style="width:${pct}%"></i></div>
        <div class="bar-label"><span>To graduate</span><span>${pct}%</span></div>`
        }
      </article>`;
    })
    .join("");
  $$(".card", grid).forEach((c) =>
    c.addEventListener("click", () => openToken(c.dataset.id)),
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
  if (name === "create") updateCreateHint();
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
    panel.innerHTML = `
      <div class="dash-head">
        <div>
          <h2 style="margin:0">Portfolio</h2>
          <div class="mono muted" style="font-size:0.85rem;margin-top:0.25rem">${escapeHtml(p.address)}</div>
          <div class="muted" style="font-size:0.8rem;margin-top:0.2rem">${p.canSign ? "Signer — can trade from this UI" : "View-only — balances visible, txs disabled"}</div>
        </div>
        <button type="button" class="btn sm" id="pfRefresh">Refresh</button>
      </div>
      <div class="stat-cards dash-stats">
        <div class="stat"><div class="stat-k">GNOT balance</div><div class="stat-v">${fmtGnot(p.gnot ?? p.ugnot / UGNOT_PER_GNOT, { alreadyGnot: true })}</div></div>
        <div class="stat"><div class="stat-k">Meme positions</div><div class="stat-v">${p.memePositions}</div></div>
        <div class="stat"><div class="stat-k">Est. meme value</div><div class="stat-v">${fmtGnot(totalMeme / UGNOT_PER_GNOT, { alreadyGnot: true })}</div></div>
        <div class="stat"><div class="stat-k">Mode</div><div class="stat-v" style="font-size:1rem">${p.canSign ? "Signer" : "View"}</div></div>
      </div>
      <div class="panel" style="margin-top:1rem">
        <h3 style="margin-top:0">Holdings</h3>
        ${
          rows.length
            ? `<table class="trade-table">
          <thead><tr><th>Token</th><th>Balance</th><th>Est. value</th><th></th></tr></thead>
          <tbody>
            ${rows
              .map(
                (h) => `<tr>
              <td><strong>${escapeHtml(h.name)}</strong> <span class="card-sym">$${escapeHtml(h.symbol)}</span>
                <div class="muted mono" style="font-size:0.7rem">${escapeHtml(h.id)}</div></td>
              <td class="mono">${fmtNum(h.balance)}</td>
              <td class="mono">${fmtGnot(h.valueGnotApprox ?? (h.valueUgnotApprox || 0) / UGNOT_PER_GNOT, { alreadyGnot: true })}</td>
              <td><button type="button" class="btn sm" data-open="${escapeHtml(h.id)}">Trade</button></td>
            </tr>`,
              )
              .join("")}
          </tbody>
        </table>`
            : `<div class="muted">No meme balances yet. Buy on the Markets page.</div>`
        }
      </div>`;
    $("#pfRefresh")?.addEventListener("click", refreshPortfolio);
    $$("[data-open]", panel).forEach((b) =>
      b.addEventListener("click", () => openToken(b.dataset.open)),
    );
  } catch (e) {
    panel.innerHTML = `<div class="empty">Portfolio error: ${escapeHtml(e.message)}</div>`;
  }
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
    panel.innerHTML = `
      <div class="dash-head">
        <div>
          <h2 style="margin:0">Creator hub</h2>
          <div class="mono muted" style="font-size:0.85rem;margin-top:0.25rem">${escapeHtml(c.address)}</div>
        </div>
        <div style="display:flex;gap:0.5rem;flex-wrap:wrap">
          <button type="button" class="btn sm" data-nav="create">+ New coin</button>
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
        <h3 style="margin-top:0">Your coins</h3>
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
                  <span class="badge ${m.status === 1 ? "graduated" : "curve"}">${escapeHtml(m.statusLabel)}</span>
                </div>
                <div class="card-meta">
                  <div>Price <strong>${fmtPriceGnot(m.priceGnot)}</strong></div>
                  <div>MCap <strong>${fmtMcap(m.mcapGnot)}</strong></div>
                  <div>Raised <strong>${fmtGnot(m.raisedGnot ?? m.raised, { alreadyGnot: m.raisedGnot != null })}</strong></div>
                  <div>Fees <strong>${fmtGnot(m.creatorFeesGnot ?? m.creatorFees, { alreadyGnot: m.creatorFeesGnot != null })}</strong></div>
                </div>
                <div class="bar"><i style="width:${m.progressPct || 0}%"></i></div>
                <div class="creator-actions">
                  <button type="button" class="btn sm" data-open="${escapeHtml(m.id)}">Open</button>
                  <button type="button" class="btn sm primary" data-claim="${escapeHtml(m.id)}" ${!c.canSign || !m.creatorFees ? "disabled" : ""}>
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
    $("#crRefresh")?.addEventListener("click", refreshCreator);
    $$("[data-nav]", panel).forEach((b) =>
      b.addEventListener("click", () => showView(b.dataset.nav)),
    );
    $$("[data-open]", panel).forEach((b) =>
      b.addEventListener("click", () => openToken(b.dataset.open)),
    );
    $$("[data-claim]", panel).forEach((b) =>
      b.addEventListener("click", async () => {
        if (!requireSigner("claim fees")) return;
        const log = $("#creatorLog");
        log.textContent = `Claiming ${b.dataset.claim}…`;
        try {
          const r = await broadcastRealm("ClaimCreatorFees", [b.dataset.claim], "");
          log.textContent = `Claimed\nheight ${r.height}\n${r.hash}`;
          toast("Claim submitted");
          refreshCreator();
          refreshMarkets();
        } catch (e) {
          log.textContent = String(e.message || e);
          toast(String(e.message || e), false);
        }
      }),
    );
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

async function openToken(id) {
  state.selectedId = id;
  showView("token");
  destroyTvChart();
  const panel = $("#tokenPanel");
  panel.innerHTML = `<div class="empty">Loading ${escapeHtml(id)}…</div>`;
  try {
    const m = await api(`/api/market/${encodeURIComponent(id)}`);
    state.tradeMode = m.status === 1 ? "buy" : "buy";
    panel.innerHTML = renderToken(m);
    wireToken(m);
    // Mount TradingView chart after DOM paint
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
  return `
    <div class="chart-wrap">
      <div class="chart-toolbar">
        <div class="chart-title">
          TradingView chart
          <span class="muted">(price in GNOT)</span>
        </div>
        <div class="chart-meta">
          <span class="mono" id="tvSpot">${fmtPriceGnot(priceGnot || lastP)}</span>
          <span class="${up ? "chg-up" : "chg-down"}">${up ? "+" : ""}${change}%</span>
          <span class="muted">${pts.length} pts</span>
        </div>
      </div>
      <div class="tv-mode-tabs" id="tvModeTabs">
        <button type="button" class="tv-mode active" data-mode="area">Area</button>
        <button type="button" class="tv-mode" data-mode="candles">Candles</button>
        <button type="button" class="tv-mode" data-mode="line">Line</button>
      </div>
      <div id="tvChart" class="tv-chart" role="img" aria-label="TradingView price chart"></div>
      <div class="chart-legend">
        <span><i class="lg buy"></i> buy vol (GNOT)</span>
        <span><i class="lg sell"></i> sell vol (GNOT)</span>
        <span class="muted">X = block height · Y = GNOT / token</span>
        <span class="muted">TradingView Lightweight Charts</span>
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
  const pts = normalizeChartPoints(m.chart || []);
  if (!pts.length) return;

  const w = Math.max(el.clientWidth || el.getBoundingClientRect().width || 600, 280);
  const chart = LightweightCharts.createChart(el, {
    width: w,
    height: 320,
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

function renderTradeTable(points) {
  const rows = (points || []).slice().reverse().slice(0, 24);
  if (!rows.length) return `<div class="muted" style="font-size:0.85rem">No trade history.</div>`;
  return `
    <div class="trade-table-wrap">
      <h4 class="trade-table-title">Recent trades</h4>
      <table class="trade-table">
        <thead><tr><th>Height</th><th>Side</th><th>Price (GNOT)</th><th>Volume (GNOT)</th><th>Tokens</th></tr></thead>
        <tbody>
          ${rows
            .map((p) => {
              const cls = p.side === 1 ? "sell" : p.side === 0 ? "buy" : "open";
              const pg =
                p.priceGnot != null
                  ? p.priceGnot
                  : Number(p.price) / UGNOT_PER_GNOT / 1_000_000;
              const vg =
                p.volumeGnot != null ? p.volumeGnot : (Number(p.ugnot) || 0) / UGNOT_PER_GNOT;
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
    </div>`;
}

function renderToken(m) {
  const isPool = m.status === 1;
  const buyLabel = isPool ? "Swap buy" : "Buy on curve";
  const sellLabel = isPool ? "Swap sell" : "Sell on curve";
  const chart = chartShell(m.chart || [], m.priceGnot);
  const trades = renderTradeTable(m.chart || []);
  return `
    <div class="panel">
      <div class="token-head">
        <div>
          <h2>${escapeHtml(m.name)} <span class="card-sym">$${escapeHtml(m.symbol)}</span></h2>
          <div class="mono muted" style="font-size:0.8rem;margin-top:0.25rem">id ${escapeHtml(m.id)}</div>
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
          </div>
        </div>
        <span class="badge ${isPool ? "graduated" : "curve"}">${isPool ? "Live" : "Curve"}</span>
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
        <div class="kv-row"><span>Creator fees</span><span>${fmtGnot(m.creatorFeesGnot ?? m.creatorFees, { alreadyGnot: m.creatorFeesGnot != null })}</span></div>
        <div class="kv-row"><span>Creator</span><span title="${escapeHtml(m.creator || "")}">${shortAddr(m.creator)}</span></div>
      </div>
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
          <button class="btn danger wide" type="submit">Sell</button>
        </form>
      </div>
      <pre class="tx-log" id="txLog" hidden></pre>
    </div>`;
}

/** Live balances for the open token panel */
const tradeBal = { tokens: 0, gnot: 0, id: null };

async function refreshTradeBalances(tokenId) {
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
    const b = await api(
      `/api/balance?id=${encodeURIComponent(tokenId)}&address=${encodeURIComponent(state.wallet.address)}`,
    );
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
  const log = (t) => {
    const el = $("#txLog");
    if (!el) return;
    el.hidden = !t;
    el.textContent = t || "";
  };
  refreshTradeBalances(m.id);

  $$(".trade-tabs button").forEach((b) => {
    b.addEventListener("click", () => {
      $$(".trade-tabs button").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      const mode = b.dataset.mode;
      $("#tradeBuy").classList.toggle("hidden", mode !== "buy");
      $("#tradeSell").classList.toggle("hidden", mode !== "sell");
    });
  });

  // Buy quick: fixed GNOT or % of wallet GNOT
  $$("#buyQuick button").forEach((b) => {
    b.addEventListener("click", () => {
      const input = $("#buyAmount") || $('#buyForm [name="amount"]');
      if (!input) return;
      if (b.dataset.pct) {
        const pct = Number(b.dataset.pct) / 100;
        const g = tradeBal.gnot * pct;
        // leave a tiny dust for gas if MAX
        const use = b.dataset.pct === "100" ? Math.max(0, tradeBal.gnot - 0.05) : g;
        input.value = use > 0 ? (Math.floor(use * 1e6) / 1e6).toString() : "0";
      } else {
        input.value = b.dataset.v;
      }
    });
  });

  // Sell quick: % of token balance
  $$("#sellQuick button").forEach((b) => {
    b.addEventListener("click", () => {
      const input = $("#sellAmount") || $('#sellForm [name="tokens"]');
      if (!input) return;
      const pct = Number(b.dataset.pct || 100) / 100;
      const amt = Math.floor(tradeBal.tokens * pct);
      input.value = String(amt > 0 ? amt : 0);
    });
  });

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
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    log(`Broadcasting buy ${amountGnot} GNOT…`);
    try {
      const func = m.status === 1 ? "SwapBuy" : "Buy";
      const r = await broadcastRealm(func, [m.id], `${amountUgnot}ugnot`);
      const got = r.result || "?";
      log(`OK height ${r.height}\nhash ${r.hash}\n+${got} tokens`);
      toast("Buy submitted");
      await refreshTradeBalances(m.id);
      // soft refresh market stats without full page wipe if possible
      try {
        const fresh = await api(`/api/market/${encodeURIComponent(m.id)}`);
        // update balance again after chain settles
        await refreshTradeBalances(m.id);
        log(
          `OK height ${r.height}\n+${got} tokens\nWallet now: ${fmtNum(tradeBal.tokens)} $${m.symbol} · ${fmtGnot(tradeBal.gnot, { alreadyGnot: true })}`,
        );
        // re-render chart/stats
        state.selectedId = m.id;
        const panel = $("#tokenPanel");
        const savedLog = log;
        panel.innerHTML = renderToken(fresh);
        wireToken(fresh);
        mountTradingViewChart(fresh);
        const tl = $("#txLog");
        if (tl) {
          tl.textContent = `OK height ${r.height}\nhash ${r.hash}\n+${got} tokens\nWallet: ${fmtNum(tradeBal.tokens)} $${m.symbol} · ${fmtGnot(tradeBal.gnot, { alreadyGnot: true })}`;
        }
      } catch {
        await openToken(m.id);
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
    log(`Broadcasting sell ${fmtNum(tokens)} tokens…`);
    try {
      const func = m.status === 1 ? "SwapSell" : "Sell";
      const r = await broadcastRealm(func, [m.id, String(tokens)], "");
      log(`OK height ${r.height}\nhash ${r.hash}\nout ${r.result != null ? fmtGnot(r.result) : "see tx"}`);
      toast("Sell submitted");
      await refreshTradeBalances(m.id);
      try {
        const fresh = await api(`/api/market/${encodeURIComponent(m.id)}`);
        $("#tokenPanel").innerHTML = renderToken(fresh);
        wireToken(fresh);
        mountTradingViewChart(fresh);
        const tl = $("#txLog");
        if (tl) {
          tl.textContent = `OK height ${r.height}\nout ${fmtGnot(r.result)}\nWallet: ${fmtNum(tradeBal.tokens)} $${m.symbol} · ${fmtGnot(tradeBal.gnot, { alreadyGnot: true })}`;
        }
      } catch {
        await openToken(m.id);
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

function wireGlobal() {
  $$("[data-nav]").forEach((el) => {
    el.addEventListener("click", () => {
      const v = el.dataset.nav;
      if (["home", "create", "portfolio", "creator"].includes(v)) showView(v);
    });
  });
  $("#btnRefresh")?.addEventListener("click", () => {
    refreshHealth();
    refreshMarkets();
  });
  $("#search")?.addEventListener("input", () => renderMarketGrid());
  $("#btnWallet")?.addEventListener("click", openWalletModal);
  $("#heroConnect")?.addEventListener("click", openWalletModal);
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
}

async function boot() {
  try {
    state.wallet = loadWallet();
    // stale local "signer" without type should not pretend canSign on Netlify
    if (state.wallet && state.wallet.type !== "adena" && state.wallet.type !== "local") {
      state.wallet.canSign = false;
      state.wallet.type = state.wallet.type || "view";
    }
    renderWalletChrome();
    wireGlobal();
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
