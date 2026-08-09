/**
 * Adena wallet helpers for gnomemepad (Gno.land).
 * Docs: https://docs.adena.app/integrations/
 */

const ADENA_APP_NAME = "gnomemepad";

/** Sapphire defaults — overridden by /api/health when available */
export const DEFAULT_NETWORK = {
  chainId: "sapphire-1",
  chainName: "Gno Sapphire",
  rpcUrl: "https://rpc.sapphire.testnets.gno.land:443",
};

export function hasAdena() {
  return typeof window !== "undefined" && !!window.adena;
}

function assertAdena() {
  if (!hasAdena()) {
    const err = new Error("Adena wallet not found. Install from https://adena.app/");
    err.code = "NO_ADENA";
    throw err;
  }
  return window.adena;
}

function ok(res) {
  if (!res) throw new Error("Empty response from Adena");
  if (res.code !== 0 && res.status !== "success") {
    const msg = res.message || res.type || `Adena error code ${res.code}`;
    const e = new Error(msg);
    e.code = res.code;
    e.raw = res;
    throw e;
  }
  return res;
}

/** Ensure Sapphire (or configured) network is available and selected. */
export async function ensureNetwork(network = DEFAULT_NETWORK) {
  const adena = assertAdena();
  try {
    await adena.AddNetwork({
      chainId: network.chainId,
      chainName: network.chainName || network.chainId,
      rpcUrl: network.rpcUrl,
    });
  } catch {
    // already added or user rejected add — try switch anyway
  }
  try {
    const sw = await adena.SwitchNetwork(network.chainId);
    ok(sw);
  } catch (e) {
    // Some versions return error if already on network
    if (!String(e?.message || e).toLowerCase().includes("same")) {
      // ignore soft failures; GetAccount will reveal wrong chain
    }
  }
}

/**
 * Connect Adena: establish + account.
 * @returns {{ address, coins, chainId, accountNumber, sequence, label, canSign, type }}
 */
export async function connectAdena(network = DEFAULT_NETWORK) {
  const adena = assertAdena();
  const est = await adena.AddEstablish(ADENA_APP_NAME);
  // code 0 success; some versions return already connected
  if (est && est.code !== 0 && est.type !== "CONNECTION_SUCCESS" && !/already/i.test(est.message || "")) {
    // 4000 series sometimes = already connected
    if (est.code !== 4000 && est.code !== 4001) {
      ok(est);
    }
  }
  await ensureNetwork(network);
  const acc = ok(await adena.GetAccount());
  const d = acc.data || {};
  const address = d.address;
  if (!address || !/^g1/i.test(address)) {
    throw new Error("Adena did not return a g1 address");
  }
  return {
    address,
    coins: d.coins || "",
    chainId: d.chainId || network.chainId,
    accountNumber: d.account_number || d.accountNumber,
    sequence: d.sequence,
    label: "Adena",
    canSign: true,
    type: "adena",
  };
}

export async function getAdenaAccount() {
  const adena = assertAdena();
  const acc = ok(await adena.GetAccount());
  return acc.data || {};
}

/**
 * Call a realm function via /vm.m_call (user signs in Adena popup).
 * @param {object} opts
 * @param {string} opts.caller - g1 address
 * @param {string} opts.pkgPath - e.g. gno.land/r/.../pad
 * @param {string} opts.func - Create | Buy | Sell | ...
 * @param {string[]} [opts.args]
 * @param {string} [opts.send] - e.g. "1000000ugnot"
 * @param {number} [opts.gasWanted]
 * @param {number} [opts.gasFee] - ugnot amount for gas fee field
 */
export async function doContractCall({
  caller,
  pkgPath,
  func,
  args = [],
  send = "",
  gasWanted = 50_000_000,
  gasFee = 1_000_000,
  memo = "gnomemepad",
}) {
  const adena = assertAdena();
  if (!caller) throw new Error("caller address required");
  if (!pkgPath) throw new Error("pkgPath required");
  if (!func) throw new Error("func required");

  const res = await adena.DoContract({
    messages: [
      {
        type: "/vm.m_call",
        value: {
          caller,
          send: send || "",
          pkg_path: pkgPath,
          func,
          args: (args || []).map(String),
        },
      },
    ],
    gasFee,
    gasWanted,
    memo,
  });
  ok(res);
  const data = res.data || {};
  return {
    ok: true,
    hash: data.hash || "",
    height: data.height || "",
    raw: res,
  };
}

/** Subscribe to account changes (best-effort). */
export function onAccountChange(cb) {
  if (!hasAdena()) return () => {};
  try {
    window.adena.On("changedAccount", (address) => {
      cb(address);
    });
  } catch {
    /* older builds */
  }
  return () => {};
}

export function openInstallAdena() {
  window.open("https://adena.app/", "_blank", "noopener,noreferrer");
}

/** Chrome Web Store ID for Adena (desktop extension). */
const ADENA_CHROME_ID = "oefglhbffgfkcpboeackfgdagmlnihnh";

/** Best-effort open Adena extension popup (may be blocked by browser). */
export function openAdenaExtension() {
  const urls = [
    `chrome-extension://${ADENA_CHROME_ID}/popup.html`,
    `chrome-extension://${ADENA_CHROME_ID}/index.html`,
    `chrome-extension://${ADENA_CHROME_ID}/popup.html#/wallet`,
  ];
  for (const u of urls) {
    try {
      const w = window.open(u, "_blank", "noopener,noreferrer");
      if (w) return true;
    } catch {
      /* try next */
    }
  }
  return false;
}

/**
 * Ask Adena to add a GRC20 custom token (best-effort).
 *
 * Official inject API does not document AddToken yet; we probe common method
 * names. If none work: copy Token.ID and open Adena so user can paste into
 * Manage Tokens → Add Custom Token → search by path.
 *
 * @param {object} t
 * @param {string} t.tokenPath - GRC20 Token.ID (path)
 * @param {string} [t.name]
 * @param {string} [t.symbol]
 * @param {number} [t.decimals]
 * @param {object} [t.network]
 * @returns {Promise<{ok:boolean, mode:'api'|'fallback', method?:string, path:string}>}
 */
export async function addTokenToAdena(t, network = DEFAULT_NETWORK) {
  const tokenPath = String(t?.tokenPath || t?.path || "").trim();
  if (!tokenPath) throw new Error("Token path (Token.ID) is required");

  const name = t.name || t.symbol || "Token";
  const symbol = t.symbol || "TKN";
  const decimals = Number.isFinite(Number(t.decimals)) ? Number(t.decimals) : 0;

  const adena = assertAdena();

  // Connect + network first (same flow as trading)
  try {
    await adena.AddEstablish(ADENA_APP_NAME);
  } catch {
    /* already connected */
  }
  await ensureNetwork(network || DEFAULT_NETWORK);

  const payloads = [
    { path: tokenPath, name, symbol, decimals },
    { tokenPath, name, symbol, decimals },
    { pkgPath: tokenPath, name, symbol, decimals },
    { tokenPath, tokenName: name, tokenSymbol: symbol, decimals },
    { grc20Path: tokenPath, name, symbol, decimals },
    { token: { path: tokenPath, name, symbol, decimals } },
    // Some builds accept the path string alone
    tokenPath,
  ];

  // Probe inject methods (forward-compatible if Adena adds one later)
  const methodNames = [
    "AddToken",
    "AddGRC20Token",
    "AddCustomToken",
    "AddGRC20",
    "addToken",
    "addGRC20Token",
    "AddTokenMetainfo",
  ];

  for (const method of methodNames) {
    const fn = adena[method];
    if (typeof fn !== "function") continue;
    for (const payload of payloads) {
      try {
        const res = await fn.call(adena, payload);
        if (!res) continue;
        if (
          res.code === 0 ||
          res.status === "success" ||
          /SUCCESS|ADDED|TOKEN/i.test(String(res.type || "")) ||
          /already/i.test(String(res.message || ""))
        ) {
          return { ok: true, mode: "api", method, path: tokenPath, res };
        }
      } catch {
        /* try next payload / method */
      }
    }
  }

  // Fallback: clipboard + open wallet for manual add (search by path)
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(tokenPath);
    }
  } catch {
    /* ignore */
  }
  openAdenaExtension();

  return {
    ok: false,
    mode: "fallback",
    path: tokenPath,
    message:
      "Token ID copied. In Adena: Manage Tokens → + → search/paste the path → Add.",
  };
}
