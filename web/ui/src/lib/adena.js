/**
 * Adena wallet helpers for gnomi (Gno.land).
 */
const ADENA_APP_NAME = "gnomi";

export const DEFAULT_NETWORK = {
  chainId: "gnoland-1",
  chainName: "Gno Mainnet",
  rpcUrl: "https://rpc.onbloc.xyz:443",
};

export function chainDisplayName(chainId) {
  const id = String(chainId || "");
  if (
    id === "gnoland-1" ||
    id === "gnoland1" ||
    id.includes("mainnet") ||
    id.includes("betanet") ||
    id.includes("gnoland")
  )
    return "Gno Mainnet";
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

function explainAdenaError(msg, res) {
  const raw = String(msg || "");
  const lower = raw.toLowerCase();
  // CheckTx auth — not a pad panic. Usually wrong Pearl RPC / stale network /
  // Adena signing against a different chain-id than the node.
  if (
    /unauthorizederror|signature is unauthorized|signature verification failed|unauthorized/i.test(
      raw,
    )
  ) {
    return (
      "Adena UnauthorizedError (signature rejected by node). " +
      "Local gnodev: prefer Adena built-in «Local» network (not a custom HTTPS RPC) — " +
      "RPC must be http://127.0.0.1:26657 (http, not https) · chainId=dev · " +
      "disconnect site → unlock → switch Local → reconnect. " +
      "Pearl: re-add pearl-1 + https://rpc.pearl.testnets.gno.land:443. " +
      "Or test with gnokey on the same chain."
    );
  }
  if (lower.includes("connection has not been established")) {
    return "Adena not connected — click Connect and approve the site.";
  }
  return raw || res?.type || "Adena error";
}

function ok(res) {
  if (!res) throw new Error("Empty response from Adena");
  if (res.code !== 0 && res.status !== "success") {
    const msg = explainAdenaError(res.message || res.type, res);
    const e = new Error(msg);
    e.code = res.code;
    e.raw = res;
    throw e;
  }
  return res;
}

function isLocalChainId(id) {
  return /^(dev|local|test|gnodev)$/i.test(String(id || "").trim());
}

function isRemoteDangerChainId(id) {
  const s = String(id || "").toLowerCase();
  return (
    s.includes("gnoland") ||
    s.includes("mainnet") ||
    s.includes("pearl") ||
    s.includes("sapphire") ||
    s.includes("staging")
  );
}

export async function ensureNetwork(network = DEFAULT_NETWORK) {
  const adena = assertAdena();
  const chainId = String(network.chainId || "").trim();
  let rpcUrl = String(network.rpcUrl || "").trim().replace(/\/$/, "");
  // Adena often upgrades http→https for custom nets; loopback must stay http.
  if (/^https:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(rpcUrl)) {
    rpcUrl = rpcUrl.replace(/^https:/i, "http:");
  }
  const isLocal =
    isLocalChainId(chainId) ||
    /127\.0\.0\.1|localhost/i.test(rpcUrl) ||
    /local|gnodev/i.test(String(network.chainName || network.id || ""));

  // Best-effort register custom net (built-in Adena "Local" may already exist
  // under another chainId — do not require AddNetwork/SwitchNetwork("dev")).
  if (!isLocal || chainId === "dev") {
    try {
      await adena.AddNetwork({
        chainId,
        chainName: network.chainName || (isLocal ? "Local gnodev" : chainId),
        rpcUrl,
      });
    } catch {
      /* already added */
    }
  }

  const tryIds = isLocal
    ? [...new Set([chainId, "dev", "local", "test"].filter(Boolean))]
    : [chainId];

  let switched = false;
  for (const id of tryIds) {
    // Older Adena: SwitchNetwork(chainId string). Newer SDK: { chainId }.
    for (const arg of [id, { chainId: id }]) {
      try {
        const sw = await adena.SwitchNetwork(arg);
        ok(sw);
        switched = true;
        break;
      } catch (e) {
        const msg = String(e?.message || e || "").toLowerCase();
        if (msg.includes("same")) {
          switched = true;
          break;
        }
      }
    }
    if (switched) break;
  }

  if (isLocal && !switched) {
    // User may already be on Adena built-in Local — verify via GetAccount.
    const live = await getAdenaChainId();
    if (live && isRemoteDangerChainId(live)) {
      const err = new Error(
        `Adena is on ${live}. Open Adena → Change Network → select built-in «Local» ` +
          `(gnodev), then Connect again on this page. Do not use Mainnet/Pearl for local test.`,
      );
      err.code = "WRONG_NETWORK";
      throw err;
    }
    // Unknown / already-local / null — continue; DoContract uses Adena's current net.
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
/**
 * Adena DoContract `gasFee` is a ugnot **number** (zdex + Adena TS types).
 * Some builds also accept "Nu gnot" coins strings — prefer number.
 */
function normalizeGasFeeAmount(gasFee) {
  if (gasFee == null || gasFee === "") return 2_000_000;
  if (typeof gasFee === "number" && Number.isFinite(gasFee)) {
    return Math.max(1, Math.floor(gasFee));
  }
  const s = String(gasFee).trim();
  const m = s.match(/^(\d+)/);
  if (m) return Math.max(1, Math.floor(Number(m[1])));
  return 2_000_000;
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

  const isLocalNet =
    String(network?.chainId || "") === "dev" ||
    /127\.0\.0\.1|localhost/i.test(String(network?.rpcUrl || ""));

  try {
    await ensureNetwork(network);
  } catch (e) {
    if (isLocalNet) throw e;
    /* remote: soft-continue if SwitchNetwork flaky */
  }
  const liveChain = await getAdenaChainId();
  if (liveChain && network?.chainId && liveChain !== network.chainId) {
    const liveOk = isLocalNet && isLocalChainId(liveChain);
    const remoteOnLocal = isLocalNet && isRemoteDangerChainId(liveChain);
    if (remoteOnLocal || (!isLocalNet && !liveOk)) {
      const err = new Error(
        remoteOnLocal
          ? `Adena is still on ${liveChain}. Switch to built-in «Local» in Adena, then reconnect.`
          : `Wrong network (${liveChain}). Switch Adena to ${network.chainId} before signing.`,
      );
      err.code = "WRONG_NETWORK";
      throw err;
    }
  }

  const feeAmt = normalizeGasFeeAmount(gasFee);
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
    // Number for modern Adena; local often needs coins string (avoids fee=0 / bad sign doc).
    gasFee: isLocalNet ? `${feeAmt}ugnot` : feeAmt,
    gasWanted: wanted,
    memo,
  };

  let res;
  try {
    res = await adena.DoContract(contractPayload);
  } catch (e) {
    const em = String(e?.message || e || "");
    if (em.includes("connection has not been established")) {
      await adena.AddEstablish(ADENA_APP_NAME);
      res = await adena.DoContract(contractPayload);
    } else if (
      isLocalNet &&
      /unauthorized|signature/i.test(em) &&
      typeof contractPayload.gasFee === "string"
    ) {
      // Retry once with numeric gasFee (Adena version variance)
      try {
        res = await adena.DoContract({ ...contractPayload, gasFee: feeAmt });
      } catch (e2) {
        const err = new Error(explainAdenaError(String(e2?.message || e2 || em), e2));
        err.code = e2?.code || e?.code;
        err.raw = e2;
        throw err;
      }
    } else {
      const err = new Error(explainAdenaError(em, e?.raw || e));
      err.code = e?.code;
      err.raw = e;
      throw err;
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
