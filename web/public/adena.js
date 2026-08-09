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
