/**
 * Adena wallet helpers for gnomi (Gno.land).
 */
const ADENA_APP_NAME = "gnomi";

export const DEFAULT_NETWORK = {
  chainId: "pearl-1",
  chainName: "Gno Pearl",
  rpcUrl: "https://rpc.pearl.testnets.gno.land:443",
};

export function chainDisplayName(chainId) {
  const id = String(chainId || "");
  if (id.includes("pearl")) return "Gno Pearl";
  if (id.includes("sapphire")) return "Gno Sapphire";
  if (id.includes("staging")) return "Gno Staging";
  return id ? `Gno (${id})` : "Gno";
}

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

export async function ensureNetwork(network = DEFAULT_NETWORK) {
  const adena = assertAdena();
  try {
    await adena.AddNetwork({
      chainId: network.chainId,
      chainName: network.chainName || network.chainId,
      rpcUrl: network.rpcUrl,
    });
  } catch {
    /* already added */
  }
  try {
    const sw = await adena.SwitchNetwork(network.chainId);
    ok(sw);
  } catch (e) {
    if (!String(e?.message || e).toLowerCase().includes("same")) {
      /* soft fail */
    }
  }
}

/** Best-effort current chain id from Adena account. */
export async function getAdenaChainId() {
  if (!hasAdena()) return null;
  try {
    const acc = await window.adena.GetAccount();
    if (acc && (acc.code === 0 || acc.status === "success")) {
      return acc.data?.chainId || null;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Ensure Sapphire (or target) network is selected.
 * Returns { chainId, switched }.
 */
export async function ensureCorrectNetwork(network = DEFAULT_NETWORK) {
  await ensureNetwork(network);
  const chainId = await getAdenaChainId();
  if (chainId && chainId !== network.chainId) {
    const err = new Error(
      `Wrong network (${chainId}). Switch Adena to ${network.chainId} (${chainDisplayName(network.chainId)}).`,
    );
    err.code = "WRONG_NETWORK";
    err.chainId = chainId;
    err.expected = network.chainId;
    throw err;
  }
  return { chainId: chainId || network.chainId, ok: true };
}

async function ensureEstablished(adena) {
  try {
    const est = await adena.AddEstablish(ADENA_APP_NAME);
    if (est && est.code !== 0 && est.type !== "CONNECTION_SUCCESS") {
      if (!/already/i.test(est.message || "")) {
        if (est.code !== 4000 && est.code !== 4001) ok(est);
      }
    }
  } catch {
    /* ignore if already established */
  }
}

export async function connectAdena(network = DEFAULT_NETWORK) {
  const adena = assertAdena();
  await ensureEstablished(adena);
  await ensureNetwork(network);

  let accRaw;
  try {
    accRaw = await adena.GetAccount();
  } catch (e) {
    if (String(e?.message || e).includes("connection has not been established")) {
      await adena.AddEstablish(ADENA_APP_NAME);
      accRaw = await adena.GetAccount();
    } else {
      throw e;
    }
  }
  const acc = ok(accRaw);
  const d = acc.data || {};
  const address = d.address;
  if (!address || !/^g1/i.test(address)) {
    throw new Error("Adena did not return a g1 address");
  }
  const chainId = d.chainId || network.chainId;
  if (chainId && chainId !== network.chainId) {
    // try switch once more then re-check
    try {
      await ensureNetwork(network);
    } catch {
      /* ignore */
    }
    const again = (await getAdenaChainId()) || chainId;
    if (again !== network.chainId) {
      const err = new Error(
        `Connected but on ${again}. Switch Adena network to ${network.chainId}.`,
      );
      err.code = "WRONG_NETWORK";
      err.chainId = again;
      // still return wallet so UI can show banner; mark canSign false for safety
      return {
        address,
        coins: d.coins || "",
        chainId: again,
        accountNumber: d.account_number || d.accountNumber,
        sequence: d.sequence,
        label: "Adena",
        canSign: false,
        type: "adena",
        networkWarning: err.message,
      };
    }
  }
  return {
    address,
    coins: d.coins || "",
    chainId,
    accountNumber: d.account_number || d.accountNumber,
    sequence: d.sequence,
    label: "Adena",
    canSign: true,
    type: "adena",
  };
}

/**
 * One or more MsgCall in a single Adena DoContract (atomic multi-step).
 * messages: [{ pkgPath, func, args?, send? }]
 */
/** Adena expects gas fee as coins string, e.g. "2000000ugnot" (not a bare number → fee amount 0). */
function normalizeGasFee(gasFee) {
  if (gasFee == null || gasFee === "") return "2000000ugnot";
  if (typeof gasFee === "number" && Number.isFinite(gasFee)) {
    return `${Math.max(1, Math.floor(gasFee))}ugnot`;
  }
  const s = String(gasFee).trim();
  if (/^\d+$/.test(s)) return `${s}ugnot`;
  return s;
}

export async function doContractCalls({
  caller,
  messages,
  gasWanted = 50_000_000,
  gasFee = 2_000_000,
  memo = "gnomi",
  network = DEFAULT_NETWORK,
}) {
  const adena = assertAdena();
  if (!caller) throw new Error("caller address required");
  const msgs = Array.isArray(messages) ? messages : [];
  if (msgs.length === 0) throw new Error("messages required");

  await ensureEstablished(adena);

  try {
    await ensureNetwork(network);
  } catch {
    /* continue */
  }
  const liveChain = await getAdenaChainId();
  if (liveChain && network?.chainId && liveChain !== network.chainId) {
    const err = new Error(
      `Wrong network (${liveChain}). Switch Adena to ${network.chainId} before signing.`,
    );
    err.code = "WRONG_NETWORK";
    throw err;
  }

  const feeStr = normalizeGasFee(gasFee);
  const wanted = Math.max(1_000_000, Math.floor(Number(gasWanted) || 50_000_000));

  const contractPayload = {
    messages: msgs.map((m) => {
      if (!m?.pkgPath) throw new Error("pkgPath required on each message");
      if (!m?.func) throw new Error("func required on each message");
      return {
        type: "/vm.m_call",
        value: {
          caller,
          send: m.send || "",
          pkg_path: m.pkgPath,
          func: m.func,
          args: (m.args || []).map(String),
        },
      };
    }),
    gasFee: feeStr,
    gasWanted: wanted,
    memo,
  };

  let res;
  try {
    res = await adena.DoContract(contractPayload);
  } catch (e) {
    if (String(e?.message || e).includes("connection has not been established")) {
      await adena.AddEstablish(ADENA_APP_NAME);
      res = await adena.DoContract(contractPayload);
    } else {
      throw e;
    }
  }

  ok(res);
  const data = res.data || {};
  return {
    ok: true,
    hash: data.hash || "",
    height: data.height || "",
    raw: res,
  };
}

export async function doContractCall({
  caller,
  pkgPath,
  func,
  args = [],
  send = "",
  gasWanted = 50_000_000,
  gasFee = 2_000_000,
  memo = "gnomi",
  network = DEFAULT_NETWORK,
}) {
  return doContractCalls({
    caller,
    messages: [{ pkgPath, func, args, send }],
    gasWanted,
    gasFee,
    memo,
    network,
  });
}

export function onAccountChange(cb) {
  if (!hasAdena()) return () => {};
  try {
    window.adena.On("changedAccount", (address) => cb(address));
  } catch {
    /* older builds */
  }
  return () => {};
}

export function openInstallAdena() {
  window.open("https://adena.app/", "_blank", "noopener,noreferrer");
}
