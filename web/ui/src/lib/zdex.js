/**
 * Zdex list / swap helpers for Token page (EOA CreatePool path).
 *
 * Pearl (live, deployer g1n4pl5…):
 *   Hub  gno.land/r/g1n4pl5uc4yt5r96m9w6fmdznx3x0jyg8l6arhmt/zdex/v3
 *   AMM  gno.land/p/g1n4pl5uc4yt5r96m9w6fmdznx3x0jyg8l6arhmt/zdex/amm/v1
 * Mainnet (intended): same deployer …/zdex/v1 (+ amm/v1).
 *
 * CreatePool(cur, tokenKey, symbol, amountU, amountT, feeBps) string
 *   — EOA only; OriginSend amountU ugnot; Approve amountT to RealmAddr().
 * No separate router pkg — SwapExactIn / SwapRouteExactIn on hub.
 *
 * Pad gap (padv23): no VenueZdex — EOA CreatePool when wallet holds seed.
 */

import { adenaTokenKey } from "./gnoswap";
import { getNetwork, MAINNET_DEPLOYER } from "./networks";
import { zdexAppBase, zdexSwapUrl as venuesZdexSwapUrl } from "./venues";

export const ZDEX_MIN_LIST_UGNOT = 1_000_000; // 1 GNOT
export const ZDEX_DEFAULT_FEE_BPS = 30;
export const ZDEX_FEE_TIERS = [1, 5, 30, 100];
export const WUGNOT_PKG = "gno.land/r/gnoland/wugnot";

/** Pearl hub RealmAddr() — probed 2026-09-17 (Approve spender). */
export const ZDEX_REALM_ADDR_PEARL =
  "g1dme66padjqu5smytfcl2lq0ame7zymducpdrdu";

export const ZDEX_PEARL_HUB =
  `gno.land/r/${MAINNET_DEPLOYER}/zdex/v3`;
export const ZDEX_PEARL_AMM =
  `gno.land/p/${MAINNET_DEPLOYER}/zdex/amm/v1`;

export const ZDEX_BY_NETWORK = {
  local: {
    hub: "gno.land/r/zdex/v2",
    amm: "gno.land/p/zdex/amm/v1",
    realmAddr: "g1kz50j3x9jepk55unw8rrehxmcddpys48xpcj92",
    presentHub: true,
    presentAmm: true,
    router: null,
  },
  pearl: {
    hub: ZDEX_PEARL_HUB,
    amm: ZDEX_PEARL_AMM,
    realmAddr: ZDEX_REALM_ADDR_PEARL,
    presentHub: true,
    presentAmm: true,
    router: null,
  },
  sapphire: {
    hub: null,
    amm: null,
    realmAddr: null,
    presentHub: false,
    presentAmm: false,
    router: null,
  },
  mainnet: {
    hub: `gno.land/r/${MAINNET_DEPLOYER}/zdex/v1`,
    amm: `gno.land/p/${MAINNET_DEPLOYER}/zdex/amm/v1`,
    realmAddr: null,
    presentHub: false,
    presentAmm: true,
    router: null,
  },
};

export function zdexConfig(networkId) {
  const net = getNetwork(networkId);
  let id = net?.id || String(networkId || "").toLowerCase() || "mainnet";
  if (id === "dev" || id === "gnolocal") id = "local";
  return ZDEX_BY_NETWORK[id] || ZDEX_BY_NETWORK.mainnet;
}

export function zdexHubPkg(networkId) {
  return zdexConfig(networkId).hub || "";
}

export function zdexRealmAddr(networkId, override = "") {
  const o = String(override || "").trim();
  if (o && /^g1[a-z0-9]+$/i.test(o)) return o;
  return zdexConfig(networkId).realmAddr || "";
}

/** True when EOA CreatePool / ExactIn can resolve Approve spender. */
export function zdexHubReady(networkId, venuesMeta) {
  if (zdexRealmAddr(networkId, venuesMeta?.zdexRealmAddr)) return true;
  const cfg = zdexConfig(networkId);
  return !!(cfg.presentHub && cfg.realmAddr);
}

/** Pool id after CreatePool: ugnot|SYMBOL */
export function zdexPoolId(symbol) {
  const s = String(symbol || "").trim();
  return s ? `ugnot|${s}` : "";
}

export function zdexPoolIdOf(m) {
  if (!m) return "";
  const existing = String(m.zdexPoolId || m.gnoswapPoolPath || m.listPoolPath || "").trim();
  if (existing.includes("|") || existing.startsWith("ugnot|")) return existing;
  return zdexPoolId(m.symbol);
}

/**
 * Exact CreatePool arg mapping from pad Launch / market fields.
 *
 * | CreatePool arg | Launch / market field                                      |
 * |----------------|------------------------------------------------------------|
 * | tokenKey       | adenaKeyFromTokenID(TokenID, Symbol) → pkg.SYMBOL          |
 * | symbol         | Symbol                                                     |
 * | amountU        | PoolUgnot (raised / curve-spot LP ugnot)                   |
 * | amountT        | PoolToken (curve-spot sized; leftover stays pad)           |
 * | feeBps         | 30 default (or 0 for hub default / stable tier)            |
 */
export function createPoolArgsFromLaunch(m, { feeBps = ZDEX_DEFAULT_FEE_BPS } = {}) {
  if (!m) throw new Error("market required");
  const tokenKey = adenaTokenKey(m);
  const symbol = String(m.symbol || "").trim();
  const amountU = Math.trunc(
    Number(m.poolUgnot ?? m.PoolUgnot ?? m.raisedUgnot ?? 0) || 0,
  );
  const amountT = Math.trunc(Number(m.poolToken ?? m.PoolToken ?? 0) || 0);
  const fee = Math.trunc(Number(feeBps));
  if (!tokenKey) throw new Error("tokenKey unknown (need TokenID/pkg + Symbol)");
  if (!symbol) throw new Error("symbol required");
  if (amountU < ZDEX_MIN_LIST_UGNOT) {
    throw new Error(`amountU must be ≥ ${ZDEX_MIN_LIST_UGNOT} ugnot (1 GNOT)`);
  }
  if (amountT <= 0) throw new Error("amountT (PoolToken) must be > 0");
  if (fee !== 0 && !ZDEX_FEE_TIERS.includes(fee)) {
    throw new Error(`feeBps must be 0 or one of ${ZDEX_FEE_TIERS.join("/")}`);
  }
  return {
    tokenKey,
    symbol,
    amountU,
    amountT,
    feeBps: fee,
    poolId: zdexPoolId(symbol),
    launchId: String(m.id || "").trim(),
    padPkg: String(m.pkg || "").trim(),
  };
}

/**
 * Single CreatePool call shape for Token.jsx / Adena broadcast().
 * Compatible alias used by ensureZdexListed.
 */
export function buildZdexCreatePoolCall(m, opts = {}) {
  try {
    const built = buildCreatePoolMsgs(m, {
      ...opts,
      includeApprove: false,
      includeWithdraw: false,
    });
    return {
      pkgPath: built.call.pkgPath,
      func: "CreatePool",
      args: built.call.args,
      send: built.call.send,
      amountU: built.args.amountU,
      amountT: built.args.amountT,
      tokenKey: built.args.tokenKey,
      symbol: built.args.symbol,
      feeBps: built.args.feeBps,
      poolId: built.args.poolId,
      realmAddr: built.realmAddr,
      padPkg: built.args.padPkg,
      launchId: built.args.launchId,
    };
  } catch {
    return null;
  }
}

/**
 * Adena messages for EOA CreatePool.
 *
 * Pad GRC20 Approve is pad.Approve(launchId, spender, amount) — not
 * standard Approve(spender, amount) on a single-token package.
 *
 * opts:
 *   networkId, realmAddr, feeBps
 *   includeApprove (default true)
 *   includeWithdraw (default false) — wugnot.Withdraw(amountU) BEFORE create;
 *     prefer a separate broadcast: OriginSend on CreatePool is per-msg and
 *     Adena sim may not see mid-tx Withdraw proceeds.
 *   skipCreate — Approve-only prep
 */
export function buildCreatePoolMsgs(m, opts = {}) {
  const args = createPoolArgsFromLaunch(m, { feeBps: opts.feeBps });
  const hub = zdexHubPkg(opts.networkId);
  if (!hub) throw new Error("Zdex hub path unknown for this network");
  const spender = zdexRealmAddr(opts.networkId, opts.realmAddr);
  if (!spender) {
    throw new Error(
      "Zdex realm address unknown — pass realmAddr (hub RealmAddr()) for Approve spender",
    );
  }
  const padPkg = args.padPkg || opts.padPkg || "";
  const launchId = args.launchId || opts.launchId || "";
  if (!padPkg || !launchId) {
    throw new Error("pad pkg + launch id required for pad.Approve");
  }

  const messages = [];
  if (opts.includeWithdraw) {
    messages.push({
      pkgPath: opts.wugnotPkg || WUGNOT_PKG,
      func: "Withdraw",
      args: [String(args.amountU)],
    });
  }
  if (opts.includeApprove !== false) {
    // Pearl/mainnet: Approve zdex RealmAddr (docs / TransferFrom as realm).
    messages.push({
      pkgPath: padPkg,
      func: "Approve",
      args: [launchId, spender, String(args.amountT)],
    });
    // Local gnodev grc20reg uses CallerTeller → spender = MsgCall EOA (Previous).
    // RealmAddr-only Approve then fails CreatePool with insufficient allowance.
    const net = String(opts.networkId || "").toLowerCase();
    const isLocal = net === "local" || net === "dev" || net === "gnolocal";
    const eoa = String(opts.ownerAddr || opts.walletAddr || "").trim();
    if (isLocal && /^g1[a-z0-9]+$/i.test(eoa) && eoa.toLowerCase() !== spender.toLowerCase()) {
      messages.push({
        pkgPath: padPkg,
        func: "Approve",
        args: [launchId, eoa, String(args.amountT)],
      });
    }
  }
  if (!opts.skipCreate) {
    messages.push({
      pkgPath: hub,
      func: "CreatePool",
      args: [
        args.tokenKey,
        args.symbol,
        String(args.amountU),
        String(args.amountT),
        String(args.feeBps),
      ],
      send: `${args.amountU}ugnot`,
    });
  }
  return {
    messages,
    args,
    hub,
    realmAddr: spender,
    call: {
      pkgPath: hub,
      func: "CreatePool",
      args: [
        args.tokenKey,
        args.symbol,
        String(args.amountU),
        String(args.amountT),
        String(args.feeBps),
      ],
      send: `${args.amountU}ugnot`,
    },
  };
}

/** Optional catalog gate: RequestListing (1 GNOT deposit) before non-admin CreatePool. */
export function buildRequestListingMsgs(m, opts = {}) {
  const tokenKey = adenaTokenKey(m);
  const symbol = String(m?.symbol || "").trim();
  const name = String(m?.name || symbol).trim() || symbol;
  const decimals = Math.trunc(Number(m?.decimals ?? 0) || 0);
  const logoURI = String(opts.logoURI || m?.imageURI || m?.uri || "").trim().slice(0, 200);
  const hub = zdexHubPkg(opts.networkId);
  if (!hub) throw new Error("Zdex hub path unknown");
  if (!tokenKey || !symbol) throw new Error("tokenKey + symbol required");
  return {
    messages: [
      {
        pkgPath: hub,
        func: "RequestListing",
        args: [tokenKey, symbol, name, String(decimals), logoURI],
        send: `${ZDEX_MIN_LIST_UGNOT}ugnot`,
      },
    ],
    hub,
  };
}

/** Unwrap WUGNOT → ugnot (EOA only). Separate tx before CreatePool. */
export function buildWithdrawWugnotMsg(amountU, wugnotPkg = WUGNOT_PKG) {
  const amt = Math.trunc(Number(amountU) || 0);
  if (amt <= 0) throw new Error("Withdraw amount must be > 0");
  return {
    pkgPath: wugnotPkg,
    func: "Withdraw",
    args: [String(amt)],
  };
}

/** Pad MsgCall: creator pulls reserved WUGNOT + PoolToken for EOA CreatePool. */
export function buildReleaseListSeedMsg(padPkg, launchId) {
  const pkgPath = String(padPkg || "").trim();
  const id = String(launchId || "").trim();
  if (!pkgPath || !id) throw new Error("ReleaseListSeed needs pad pkg + launch id");
  return { pkgPath, func: "ReleaseListSeed", args: [id] };
}

/** Pad MsgCall: mark ListVenue=zdex after EOA CreatePool (poolId = ugnot|SYMBOL). */
export function buildConfirmZdexListMsg(padPkg, launchId, poolId) {
  const pkgPath = String(padPkg || "").trim();
  const id = String(launchId || "").trim();
  const pool = String(poolId || "").trim();
  if (!pkgPath || !id || !pool) {
    throw new Error("ConfirmZdexList needs pad pkg + launch id + poolId");
  }
  return { pkgPath, func: "ConfirmZdexList", args: [id, pool] };
}

/**
 * Checklist for Token list wizard (EOA path).
 * padCanReleaseLp: true when /api/list-venues exposes ReleaseListSeed (dualDexPad cut).
 * PoolToken/WUGNOT otherwise stay pad-reserved until that cut.
 */
export function zdexListChecklist(
  m,
  {
    networkId,
    walletUgnot = 0,
    walletWugnot = 0,
    walletTokens = 0,
    padCanReleaseLp = false,
    padHasVenueZdex = false,
    hasConfirmZdexList = false,
  } = {},
) {
  let args = null;
  let err = "";
  try {
    args = createPoolArgsFromLaunch(m);
  } catch (e) {
    err = String(e?.message || e);
  }
  const cfg = zdexConfig(networkId);
  const needU = args?.amountU || 0;
  const needT = args?.amountT || 0;
  const ug = Math.floor(Number(walletUgnot) || 0);
  const wu = Math.floor(Number(walletWugnot) || 0);
  const tok = Math.floor(Number(walletTokens) || 0);
  const canWithdrawBridge = wu >= needU && needU > 0;
  const haveUgnot = ug >= needU;
  const haveTokens = tok >= needT && needT > 0;
  return {
    ok: !err && !!cfg.hub,
    error: err,
    hub: cfg.hub,
    realmAddr: cfg.realmAddr,
    router: cfg.router, // always null — swaps on hub
    presentHub: !!cfg.presentHub,
    args,
    needUgnot: needU,
    needTokens: needT,
    haveUgnot,
    haveTokens,
    canWithdrawBridge,
    padCanReleaseLp: !!padCanReleaseLp,
    padHasVenueZdex: !!padHasVenueZdex,
    hasConfirmZdexList: !!hasConfirmZdexList,
    readyToApproveAndCreate: !err && haveUgnot && haveTokens && !!cfg.realmAddr,
    notes: [
      "UI notes: ReleaseListSeed → WUGNOT Withdraw → pad.Approve → zdex CreatePool → ConfirmZdexList(id, ugnot|SYMBOL). Gnoswap stays RetryList.",
      "CreatePool is EOA-only on Zdex hub — never pad RetryList(venue=zdex) until VenueZdex adapter.",
      padCanReleaseLp
        ? "ReleaseListSeed available — creator pulls pad LP seed before CreatePool."
        : "No ReleaseListSeed yet — wallet must already hold PoolUgnot+PoolToken (pad reserved LP stays on pad).",
      "Bridge: wugnot.Withdraw(amountU) on EOA when wallet holds WUGNOT after release / self-fund.",
      hasConfirmZdexList
        ? "ConfirmZdexList marks on-chain ListVenue=zdex after CreatePool."
        : "ConfirmZdexList pending — after CreatePool UI stores localListVenue until pad cut.",
    ],
  };
}

export function zdexSwapUrl(m, networkId) {
  return venuesZdexSwapUrl(m, networkId);
}

export function zdexAppUrl(networkId, { tab = "swap", pool = "" } = {}) {
  const base = zdexAppBase(networkId);
  const net = getNetwork(networkId);
  const q = new URLSearchParams();
  q.set("net", net?.id === "mainnet" ? "mainnet" : "pearl");
  if (tab) q.set("tab", tab);
  if (pool) q.set("pool", pool);
  return `${base}/?${q.toString()}`;
}

/**
 * Hub SwapExactIn messages (no separate router).
 * Buy: tokenIn=ugnot + OriginSend.
 * Sell: optional pad.Approve(launchId, realmAddr, amount) then SwapExactIn(symbol).
 *
 * opts:
 *   networkId, side, amountIn, minOut, maxHeight
 *   includeApprove (default true on sell) — pad GRC20 TransferFrom needs realm spender
 *   padPkg, launchId, realmAddr, ownerAddr (local dual-Approve like CreatePool)
 *   approveMax — large allowance once (same order as Gnoswap ExactIn)
 */
export function buildSwapExactInMsgs(
  m,
  {
    networkId,
    side = "buy",
    amountIn,
    minOut = 0,
    maxHeight = 0,
    includeApprove = true,
    padPkg = "",
    launchId = "",
    realmAddr = "",
    ownerAddr = "",
    approveMax = true,
  } = {},
) {
  const hub = zdexHubPkg(networkId);
  if (!hub) throw new Error("Zdex hub unknown");
  const poolID = zdexPoolIdOf(m);
  if (!poolID) throw new Error("pool id unknown");
  const amt = Math.trunc(Number(amountIn) || 0);
  const min = Math.trunc(Math.max(0, Number(minOut) || 0));
  const dead = Math.trunc(Number(maxHeight) || 0);
  if (amt <= 0) throw new Error("amountIn required");

  /** ~1e15 — enough for many sells without re-approve each time */
  const APPROVE_MAX = "1000000000000000";

  if (side === "sell") {
    const messages = [];
    if (includeApprove !== false) {
      const spender = zdexRealmAddr(networkId, realmAddr);
      if (!spender) {
        throw new Error(
          "Zdex realm address unknown — pass realmAddr (hub RealmAddr()) for Approve spender",
        );
      }
      const pkg = String(padPkg || m?.pkg || "").trim();
      const id = String(launchId || m?.id || "").trim();
      if (!pkg || !id) {
        throw new Error("pad pkg + launch id required for sell Approve");
      }
      const allow = approveMax ? APPROVE_MAX : String(amt);
      messages.push({
        pkgPath: pkg,
        func: "Approve",
        args: [id, spender, allow],
      });
      // Local gnodev grc20reg may pull via CallerTeller → spender = MsgCall EOA.
      const net = String(networkId || "").toLowerCase();
      const isLocal = net === "local" || net === "dev" || net === "gnolocal";
      const eoa = String(ownerAddr || "").trim();
      if (isLocal && /^g1[a-z0-9]+$/i.test(eoa) && eoa.toLowerCase() !== spender.toLowerCase()) {
        messages.push({
          pkgPath: pkg,
          func: "Approve",
          args: [id, eoa, allow],
        });
      }
    }
    messages.push({
      pkgPath: hub,
      func: "SwapExactIn",
      args: [poolID, String(m.symbol || "").trim(), String(amt), String(min), String(dead)],
    });
    return { messages, hub, poolID, approveMax };
  }

  return {
    messages: [
      {
        pkgPath: hub,
        func: "SwapExactIn",
        args: [poolID, "ugnot", String(amt), String(min), String(dead)],
        send: `${amt}ugnot`,
      },
    ],
    hub,
    poolID,
    approveMax: false,
  };
}

/** localStorage: wallet already set large pad token allowance for zdex realm */
export function zdexTokenApproveKey(address, launchId) {
  return `gnomemepad.zdexApprove.${String(address || "").toLowerCase()}.${String(launchId || "")}`;
}
