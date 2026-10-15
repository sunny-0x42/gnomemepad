/**
 * Network registry for Gnomi.fun.
 *
 * Production posture (2026-09): Mainnet `gnoland-1` (RPC OnBloc) + Pearl trial.
 * Sapphire / Pearl stay toggleable; pad on mainnet empty until MAINNET_PAD_READY=1.
 *
 * Mainnet deployer (gnokey `gnomi-mainnet-deploy`): g1n4pl5… — not the Pearl/Sapphire key.
 */

/** Pearl / legacy Sapphire package owner (padv22/padv23 already on testnets). */
export const LEGACY_DEPLOYER = "g1mv0052e7r6s09f5t9xsqf00nj3tqsgt9dg52jr";

/** Mainnet deploy key — gnokey name: gnomi-mainnet-deploy */
export const MAINNET_DEPLOYER = "g1n4pl5uc4yt5r96m9w6fmdznx3x0jyg8l6arhmt";

/** @deprecated use MAINNET_DEPLOYER or LEGACY_DEPLOYER explicitly */
export const DEPLOYER = MAINNET_DEPLOYER;

/** Mainnet package namespace (deploy under …/gnomi/…). */
export const MAINNET_NS = "gnomi";
/** Pearl / Sapphire already-live namespace — do not rename on-chain. */
export const LEGACY_NS = "gnomemepad";

function realm(name, owner = MAINNET_DEPLOYER, ns = MAINNET_NS) {
  return `gno.land/r/${owner}/${ns}/${name}`;
}

function pure(name, owner = MAINNET_DEPLOYER, ns = MAINNET_NS) {
  return `gno.land/p/${owner}/${ns}/${name}`;
}

function legacyRealm(name) {
  return realm(name, LEGACY_DEPLOYER, LEGACY_NS);
}

function legacyPure(name) {
  return pure(name, LEGACY_DEPLOYER, LEGACY_NS);
}

/** @typedef {{
 *  id: string,
 *  label: string,
 *  chainId: string,
 *  rpcUrl: string,
 *  gnoweb?: string,
 *  faucet?: string,
 *  pkg: string,
 *  hub: string,
 *  profile: string,
 *  meta: string,
 *  points: string,
 *  bond: string,
 *  ammmath?: string,
 *  signerAddr: string,
 *  enabled: boolean,
 *  comingSoon?: boolean,
 *  visible?: boolean,
 *  padReady?: boolean,
 * }} NetworkDef
 */

const SHOW_TESTNETS =
  String(process.env.SHOW_TESTNETS || "").toLowerCase() === "1" ||
  String(process.env.SHOW_TESTNETS || "").toLowerCase() === "true";

/** Pearl — set SHOW_PEARL=1 (local Pearl sync) or SHOW_TESTNETS=1. */
const SHOW_PEARL =
  SHOW_TESTNETS ||
  String(process.env.SHOW_PEARL || "0").toLowerCase() === "1" ||
  String(process.env.SHOW_PEARL || "").toLowerCase() === "true";

/**
 * Offline / RPC-fail payload for GET /api/list-venues.
 * Must match live pad posture per network — Pearl padv23 is Gnoswap-only + 100 GNS;
 * mainnet plan is zdex-default until Gnoswap lands.
 *
 * @param {string} networkId
 * @param {string|null} [pkg]
 */
export function listVenuesFallback(networkId, pkg = null) {
  const id = String(networkId || "")
    .trim()
    .toLowerCase();
  const net = id.includes("pearl")
    ? "pearl"
    : id.includes("sapphire")
      ? "sapphire"
      : id === "mainnet" || id.includes("gnoland")
        ? "mainnet"
        : id || "mainnet";

  if (net === "local" || net === "dev" || net === "gnolocal") {
    return {
      ok: true,
      pkg: pkg || null,
      defaultVenue: "zdex",
      venues: [
        {
          id: "zdex",
          label: "zdex",
          enabled: true,
          uiGap: true,
          eoaList: true,
          feeAssetHint: "ugnot",
          note: "EOA CreatePool on gno.land/r/zdex/v2 (same gnodev as pad). Admin auto-list if signer is gnodevlocal.",
        },
      ],
      offline: true,
      network: "local",
      dualDexPad: false,
      hasPreferredVenue: false,
      hasReleaseListSeed: false,
      hasConfirmZdexList: false,
      hasListSeedReleasedOf: false,
      zdexHub: "gno.land/r/zdex/v2",
      zdexAmm: "gno.land/p/zdex/amm/v1",
      zdexRealmAddr: "g1kz50j3x9jepk55unw8rrehxmcddpys48xpcj92",
    };
  }

  if (net === "pearl" || net === "sapphire") {
    return {
      ok: true,
      pkg: pkg || null,
      defaultVenue: "gnoswap",
      venues: [
        {
          id: "gnoswap",
          label: "Gnoswap",
          enabled: true,
          feeAssetHint: "GNS",
        },
        {
          id: "zdex",
          label: "zdex",
          // Pearl: selectable EOA CreatePool (padv23 has no VenueZdex adapter).
          enabled: net === "pearl",
          uiGap: true,
          eoaList: true,
          feeAssetHint: "ugnot",
          note:
            net === "pearl"
              ? "EOA CreatePool on g1n4pl5…/zdex/v3 + amm/v1 — padv23 has no VenueZdex; wallet must hold PoolUgnot+PoolToken"
              : "Not wired on this pad — EOA zdex CreatePool if hub is up",
        },
      ],
      offline: true,
      network: net,
      dualDexPad: false,
      hasPreferredVenue: false,
      hasReleaseListSeed: false,
      hasConfirmZdexList: false,
      hasListSeedReleasedOf: false,
      zdexHub:
        net === "pearl"
          ? "gno.land/r/g1n4pl5uc4yt5r96m9w6fmdznx3x0jyg8l6arhmt/zdex/v3"
          : null,
      zdexAmm:
        net === "pearl"
          ? "gno.land/p/g1n4pl5uc4yt5r96m9w6fmdznx3x0jyg8l6arhmt/zdex/amm/v1"
          : null,
      zdexRealmAddr:
        net === "pearl" ? "g1dme66padjqu5smytfcl2lq0ame7zymducpdrdu" : null,
    };
  }

  // Match live mainnet gnomi/pad qeval (2026-09): both venues on; default zdex.
  return {
    ok: true,
    pkg: pkg || null,
    defaultVenue: "zdex",
    venues: [
      { id: "zdex", label: "zdex", enabled: true, feeAssetHint: "ugnot" },
      {
        id: "gnoswap",
        label: "Gnoswap",
        enabled: true,
        feeAssetHint: "GNS",
        note: "100 GNS Create escrow",
      },
    ],
    offline: true,
    network: "mainnet",
    dualDexPad: true,
    hasPreferredVenue: true,
    hasReleaseListSeed: true,
    hasConfirmZdexList: true,
    hasListSeedReleasedOf: true,
    zdexHub: "gno.land/r/g1n4pl5uc4yt5r96m9w6fmdznx3x0jyg8l6arhmt/zdex/v1",
    zdexRealmAddr: null,
  };
}

/** Intended mainnet package tree (deploy after human yes + gpao if required). */
export const MAINNET_INTENDED = {
  chainId: "gnoland-1",
  rpcUrl: "https://rpc.onbloc.xyz:443",
  gnoweb: "https://gno.land",
  deployer: MAINNET_DEPLOYER,
  namespace: MAINNET_NS,
  gnokeyName: "gnomi-mainnet-deploy",
  ammmath: pure("ammmathv2"),
  pkg: realm("padv3"),
  hub: realm("hubv2"),
  profile: realm("profile"),
  meta: realm("meta"),
  points: realm("pointsv2"),
  bond: realm("bond"),
  /** Confirmed on gnoland-1 (2026-09-17). demo grc20 absent — use nt. */
  wugnot: "gno.land/r/gnoland/wugnot",
  grc20: "gno.land/p/nt/grc20/v0",
  grc20reg: "gno.land/r/nt/grc20reg/v0",
  /** Gnoswap LIVE on mainnet (pool fee 100 GNS). Pures use /v1. */
  gnoswap: {
    pool: "gno.land/r/gnoswap/pool",
    position: "gno.land/r/gnoswap/position",
    router: "gno.land/r/gnoswap/router",
    gns: "gno.land/r/gnoswap/gns",
    consts: "gno.land/p/gnoswap/consts/v1",
    uint256: "gno.land/p/gnoswap/uint256/v1",
    present: true,
    poolCreationFeeGns: 100_000_000,
  },
  /** Zdex — AMM live; hub v1 may be GPAO-pending until EnablePackage. */
  zdex: {
    amm: "gno.land/p/g1n4pl5uc4yt5r96m9w6fmdznx3x0jyg8l6arhmt/zdex/amm/v1",
    hubPearl: "gno.land/r/g1n4pl5uc4yt5r96m9w6fmdznx3x0jyg8l6arhmt/zdex/v3",
    hub: "gno.land/r/g1n4pl5uc4yt5r96m9w6fmdznx3x0jyg8l6arhmt/zdex/v1",
    realmAddrPearl: "g1dme66padjqu5smytfcl2lq0ame7zymducpdrdu",
    presentAmm: true,
    presentHubPearl: true,
    presentHub: false,
  },
};

const mainnetPadReady =
  String(process.env.MAINNET_PAD_READY || "").toLowerCase() === "1" ||
  String(process.env.MAINNET_PAD_READY || "").toLowerCase() === "true";

const envDefault = String(process.env.DEFAULT_NETWORK || "")
  .trim()
  .toLowerCase();

/** gnodev / gnolocal — SHOW_LOCAL=1 or DEFAULT_NETWORK=local|dev|gnolocal */
const SHOW_LOCAL =
  String(process.env.SHOW_LOCAL || "").toLowerCase() === "1" ||
  String(process.env.SHOW_LOCAL || "").toLowerCase() === "true" ||
  envDefault === "local" ||
  envDefault === "dev" ||
  envDefault === "gnolocal";

/** @type {Record<string, NetworkDef>} */
export const NETWORKS = {
  pearl: {
    id: "pearl",
    label: "Pearl",
    chainId: "pearl-1",
    rpcUrl: "https://rpc.pearl.testnets.gno.land:443",
    gnoweb: "https://pearl.testnets.gno.land",
    faucet: "https://faucet.gno.land",
    // Dual-DEX cut (2026-09-17): g1n4pl5…/gnomi/pad — not legacy padv23
    pkg: realm("pad", MAINNET_DEPLOYER, MAINNET_NS),
    hub: realm("hubv2", MAINNET_DEPLOYER, MAINNET_NS),
    profile: realm("profile", MAINNET_DEPLOYER, MAINNET_NS),
    meta: realm("meta", MAINNET_DEPLOYER, MAINNET_NS),
    points: realm("pointsv2", MAINNET_DEPLOYER, MAINNET_NS),
    bond: realm("bond", MAINNET_DEPLOYER, MAINNET_NS),
    signerAddr: MAINNET_DEPLOYER,
    enabled: SHOW_PEARL,
    comingSoon: false,
    visible: SHOW_PEARL,
    padReady: SHOW_PEARL,
  },
  mainnet: {
    id: "mainnet",
    label: "Mainnet",
    chainId: process.env.MAINNET_CHAIN_ID || MAINNET_INTENDED.chainId,
    rpcUrl: (process.env.MAINNET_RPC_URL || MAINNET_INTENDED.rpcUrl).replace(
      /\/$/,
      "",
    ),
    gnoweb: process.env.MAINNET_GNOWEB || MAINNET_INTENDED.gnoweb,
    faucet: "",
    pkg: process.env.MAINNET_PKG || MAINNET_INTENDED.pkg,
    hub: process.env.MAINNET_HUB || MAINNET_INTENDED.hub,
    profile: process.env.MAINNET_PROFILE || MAINNET_INTENDED.profile,
    meta: process.env.MAINNET_META || MAINNET_INTENDED.meta,
    points: process.env.MAINNET_POINTS || MAINNET_INTENDED.points,
    bond: process.env.MAINNET_BOND || MAINNET_INTENDED.bond,
    ammmath: process.env.MAINNET_AMMMATH || MAINNET_INTENDED.ammmath,
    signerAddr: process.env.MAINNET_SIGNER || MAINNET_DEPLOYER,
    enabled: true,
    comingSoon: false,
    visible: true,
    padReady: mainnetPadReady,
  },
  // Emergency / debug only
  sapphire: {
    id: "sapphire",
    label: "Sapphire",
    chainId: "sapphire-1",
    rpcUrl: "https://rpc.sapphire.testnets.gno.land:443",
    gnoweb: "https://sapphire.testnets.gno.land",
    faucet: "https://faucet.gno.land",
    pkg: legacyRealm("padv22"),
    hub: legacyRealm("hubv2"),
    profile: legacyRealm("profile"),
    meta: legacyRealm("meta"),
    points: legacyRealm("pointsv2"),
    bond: legacyRealm("bond"),
    signerAddr: LEGACY_DEPLOYER,
    enabled: SHOW_TESTNETS,
    comingSoon: false,
    visible: SHOW_TESTNETS,
    padReady: SHOW_TESTNETS,
  },
  /** Local gnodev (scripts/local-review.ps1) — unsigned paths under gnomemepad/ */
  local: {
    id: "local",
    label: "Local (gnodev)",
    chainId: process.env.LOCAL_CHAIN_ID || "dev",
    rpcUrl: (process.env.LOCAL_RPC_URL || "http://127.0.0.1:26657").replace(
      /\/$/,
      "",
    ),
    gnoweb: process.env.LOCAL_GNOWEB || "http://127.0.0.1:8888",
    faucet: "",
    pkg: process.env.LOCAL_PKG || "gno.land/r/gnomemepad/pad",
    hub: process.env.LOCAL_HUB || "gno.land/r/gnomemepad/hubv2",
    profile: process.env.LOCAL_PROFILE || "gno.land/r/gnomemepad/profile",
    meta: process.env.LOCAL_META || "gno.land/r/gnomemepad/meta",
    points: process.env.LOCAL_POINTS || "gno.land/r/gnomemepad/pointsv2",
    bond: process.env.LOCAL_BOND || "gno.land/r/gnomemepad/bond",
    ammmath: process.env.LOCAL_AMMMATH || "gno.land/p/gnomemepad/ammmath",
    signerAddr:
      process.env.LOCAL_SIGNER || "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5",
    enabled: SHOW_LOCAL,
    comingSoon: false,
    visible: SHOW_LOCAL,
    padReady: SHOW_LOCAL,
  },
};

export const DEFAULT_NETWORK_ID =
  envDefault === "mainnet" ||
  envDefault === "pearl" ||
  envDefault === "sapphire" ||
  envDefault === "local" ||
  envDefault === "dev" ||
  envDefault === "gnolocal"
    ? envDefault === "dev" || envDefault === "gnolocal"
      ? "local"
      : envDefault
    : "mainnet";

export function normalizeNetworkId(raw) {
  const s = String(raw || "")
    .trim()
    .toLowerCase();
  if (!s) return DEFAULT_NETWORK_ID;
  if (s === "pearl" || s === "pearl-1" || s.includes("pearl")) {
    return SHOW_PEARL ? "pearl" : DEFAULT_NETWORK_ID;
  }
  if (
    s === "mainnet" ||
    s === "gnoland1" ||
    s === "gnoland-1" ||
    s === "betanet" ||
    s.includes("mainnet") ||
    s.includes("gnoland")
  )
    return "mainnet";
  if (
    s === "local" ||
    s === "dev" ||
    s === "gnolocal" ||
    s === "gnodev" ||
    s.includes("127.0.0.1")
  ) {
    return SHOW_LOCAL ? "local" : DEFAULT_NETWORK_ID;
  }
  if (s === "sapphire" || s === "sapphire-1" || s.includes("sapphire")) {
    return SHOW_TESTNETS ? "sapphire" : DEFAULT_NETWORK_ID;
  }
  if (NETWORKS[s]?.visible) return s;
  return DEFAULT_NETWORK_ID;
}

export function getNetwork(networkId) {
  const id = normalizeNetworkId(networkId);
  return NETWORKS[id] || NETWORKS.mainnet;
}

export function listNetworks() {
  return Object.values(NETWORKS)
    .filter((n) => n.visible !== false)
    .map((n) => ({
      id: n.id,
      label: n.label,
      chainId: n.chainId,
      enabled: !!n.enabled,
      comingSoon: !!n.comingSoon,
      padReady: !!n.padReady,
      pkg: n.pkg || null,
      rpcUrl: n.rpcUrl,
      gnoweb: n.gnoweb || null,
    }));
}

/** Build API config object for a network. */
export function configForNetwork(networkId) {
  const n = getNetwork(networkId);
  const padReady = n.padReady !== false && !!n.pkg;
  return {
    networkId: n.id,
    RPC: String(n.rpcUrl || "").replace(/\/$/, ""),
    CHAIN_ID: n.chainId,
    PKG: n.pkg || "",
    HUB: n.hub || "",
    PROFILE: n.profile || "",
    META: n.meta || "",
    POINTS: n.points || "",
    BOND: n.bond || "",
    AMMMATH: n.ammmath || "",
    SIGNER_ADDR: n.signerAddr || DEPLOYER,
    GNOWEB: n.gnoweb || "",
    FAUCET: n.faucet || "",
    enabled: !!n.enabled,
    comingSoon: !!n.comingSoon,
    padReady,
    label: n.label,
  };
}
