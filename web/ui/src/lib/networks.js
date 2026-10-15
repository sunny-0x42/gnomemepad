/**
 * Client-side network registry (mirrors web/lib/networks.mjs).
 * Production: Mainnet only (`gnoland1`). Testnets hidden unless VITE_SHOW_TESTNETS=1.
 */

export const LEGACY_DEPLOYER = "g1mv0052e7r6s09f5t9xsqf00nj3tqsgt9dg52jr";
export const MAINNET_DEPLOYER = "g1n4pl5uc4yt5r96m9w6fmdznx3x0jyg8l6arhmt";
/** @deprecated prefer MAINNET_DEPLOYER / LEGACY_DEPLOYER */
export const DEPLOYER = MAINNET_DEPLOYER;

export const MAINNET_NS = "gnomi";
export const LEGACY_NS = "gnomemepad";

function realm(name, owner = MAINNET_DEPLOYER, ns = MAINNET_NS) {
  return `gno.land/r/${owner}/${ns}/${name}`;
}

function legacyRealm(name) {
  return realm(name, LEGACY_DEPLOYER, LEGACY_NS);
}

const SHOW_TESTNETS =
  String(import.meta.env?.VITE_SHOW_TESTNETS || "").toLowerCase() === "1" ||
  String(import.meta.env?.VITE_SHOW_TESTNETS || "").toLowerCase() === "true";

/** Pearl testnet — off by default (mainnet review). Set VITE_SHOW_PEARL=1 to show. */
const SHOW_PEARL =
  SHOW_TESTNETS ||
  String(import.meta.env?.VITE_SHOW_PEARL || "0").toLowerCase() === "1" ||
  String(import.meta.env?.VITE_SHOW_PEARL || "").toLowerCase() === "true";

/** Intended mainnet paths — live after deploy + MAINNET_PAD_READY. */
export const MAINNET_INTENDED = {
  chainId: "gnoland-1",
  rpcUrl: "https://rpc.onbloc.xyz:443",
  gnoweb: "https://gno.land",
  // Live gnoland-1 hub pad (2026-09): …/gnomi/padv3 — not bare /pad.
  pkg: realm("padv3"),
  hub: realm("hubv2"),
  profile: realm("profile"),
  meta: realm("meta"),
  points: realm("pointsv2"),
  bond: realm("bond"),
  wugnot: "gno.land/r/gnoland/wugnot",
};

const mainnetPadReady =
  String(import.meta.env?.VITE_MAINNET_PAD_READY || "").toLowerCase() === "1" ||
  String(import.meta.env?.VITE_MAINNET_PAD_READY || "").toLowerCase() === "true";

const envDefault = String(import.meta.env?.VITE_DEFAULT_NETWORK || "")
  .trim()
  .toLowerCase();

/** gnodev — VITE_SHOW_LOCAL=1 or VITE_DEFAULT_NETWORK=local|dev|gnolocal */
const SHOW_LOCAL =
  String(import.meta.env?.VITE_SHOW_LOCAL || "").toLowerCase() === "1" ||
  String(import.meta.env?.VITE_SHOW_LOCAL || "").toLowerCase() === "true" ||
  envDefault === "local" ||
  envDefault === "dev" ||
  envDefault === "gnolocal";

export const NETWORKS = {
  pearl: {
    id: "pearl",
    label: "Pearl",
    chainId: "pearl-1",
    rpcUrl: "https://rpc.pearl.testnets.gno.land:443",
    gnoweb: "https://pearl.testnets.gno.land",
    // Dual-DEX cut live: g1n4pl5…/gnomi/pad
    pkg: realm("pad"),
    hub: realm("hubv2"),
    profile: realm("profile"),
    meta: realm("meta"),
    points: realm("pointsv2"),
    bond: realm("bond"),
    signerAddr: MAINNET_DEPLOYER,
    enabled: SHOW_PEARL,
    visible: SHOW_PEARL,
    padReady: SHOW_PEARL,
  },
  mainnet: {
    id: "mainnet",
    label: "Mainnet",
    chainId: "gnoland-1",
    rpcUrl: "https://rpc.onbloc.xyz:443",
    gnoweb: "https://gno.land",
    pkg: MAINNET_INTENDED.pkg,
    hub: MAINNET_INTENDED.hub,
    profile: MAINNET_INTENDED.profile,
    meta: MAINNET_INTENDED.meta,
    points: MAINNET_INTENDED.points,
    bond: MAINNET_INTENDED.bond,
    signerAddr: MAINNET_DEPLOYER,
    enabled: true,
    comingSoon: false,
    visible: true,
    padReady: mainnetPadReady,
  },
  sapphire: {
    id: "sapphire",
    label: "Sapphire",
    chainId: "sapphire-1",
    rpcUrl: "https://rpc.sapphire.testnets.gno.land:443",
    gnoweb: "https://sapphire.testnets.gno.land",
    pkg: legacyRealm("padv22"),
    hub: legacyRealm("hubv2"),
    enabled: SHOW_TESTNETS,
    visible: SHOW_TESTNETS,
    padReady: SHOW_TESTNETS,
  },
  local: {
    id: "local",
    label: "Local (gnodev)",
    chainId: "dev",
    rpcUrl: "http://127.0.0.1:26657",
    gnoweb: "http://127.0.0.1:8888",
    pkg: "gno.land/r/gnomemepad/pad",
    hub: "gno.land/r/gnomemepad/hubv2",
    profile: "gno.land/r/gnomemepad/profile",
    meta: "gno.land/r/gnomemepad/meta",
    points: "gno.land/r/gnomemepad/pointsv2",
    bond: "gno.land/r/gnomemepad/bond",
    signerAddr: "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5",
    enabled: SHOW_LOCAL,
    comingSoon: false,
    visible: SHOW_LOCAL,
    padReady: SHOW_LOCAL,
  },
};

export const NETWORK_LS_KEY = "gnomemepad.network.v1";
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

export function listClientNetworks() {
  return Object.values(NETWORKS).filter((n) => n.visible !== false);
}

export function loadStoredNetworkId() {
  try {
    const raw = localStorage.getItem(NETWORK_LS_KEY);
    if (!raw) return DEFAULT_NETWORK_ID;
    const id = normalizeNetworkId(raw);
    const net = NETWORKS[id];
    if (net && net.visible !== false && (net.enabled || net.comingSoon)) return id;
  } catch {
    /* ignore */
  }
  return DEFAULT_NETWORK_ID;
}

export function storeNetworkId(networkId) {
  const id = normalizeNetworkId(networkId);
  try {
    localStorage.setItem(NETWORK_LS_KEY, id);
  } catch {
    /* ignore */
  }
  return id;
}

export function networkToAdena(net) {
  const n = typeof net === "string" ? getNetwork(net) : net;
  return {
    chainId: n.chainId,
    chainName: n.label.startsWith("Gno") ? n.label : `Gno ${n.label}`,
    rpcUrl: n.rpcUrl,
  };
}
