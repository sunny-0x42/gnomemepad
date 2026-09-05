/**
 * Client-side network registry (mirrors web/lib/networks.mjs).
 * Keep in sync when adding chains / pad versions.
 */

export const DEPLOYER = "g1mv0052e7r6s09f5t9xsqf00nj3tqsgt9dg52jr";

function realm(name) {
  return `gno.land/r/${DEPLOYER}/gnomemepad/${name}`;
}

export const NETWORKS = {
  sapphire: {
    id: "sapphire",
    label: "Sapphire",
    chainId: "sapphire-1",
    rpcUrl: "https://rpc.sapphire.testnets.gno.land:443",
    gnoweb: "https://sapphire.testnets.gno.land",
    pkg: realm("padv22"),
    hub: realm("hubv2"),
    enabled: true,
  },
  pearl: {
    id: "pearl",
    label: "Pearl",
    chainId: "pearl-1",
    rpcUrl: "https://rpc.pearl.testnets.gno.land:443",
    gnoweb: "https://pearl.testnets.gno.land",
    pkg: realm("padv23"),
    hub: realm("hubv2"),
    enabled: true,
  },
  mainnet: {
    id: "mainnet",
    label: "Mainnet",
    chainId: "gnoland1",
    rpcUrl: "https://rpc.gno.land:443",
    gnoweb: "https://gno.land",
    pkg: "",
    hub: "",
    enabled: false,
    comingSoon: true,
  },
};

export const NETWORK_LS_KEY = "gnomemepad.network.v1";
export const DEFAULT_NETWORK_ID = "sapphire";

export function normalizeNetworkId(raw) {
  const s = String(raw || "")
    .trim()
    .toLowerCase();
  if (!s) return DEFAULT_NETWORK_ID;
  if (s === "sapphire" || s === "sapphire-1" || s.includes("sapphire")) return "sapphire";
  if (s === "pearl" || s === "pearl-1" || s.includes("pearl")) return "pearl";
  if (s === "mainnet" || s === "gnoland1" || s === "betanet" || s.includes("mainnet"))
    return "mainnet";
  if (NETWORKS[s]) return s;
  return DEFAULT_NETWORK_ID;
}

export function getNetwork(networkId) {
  const id = normalizeNetworkId(networkId);
  return NETWORKS[id] || NETWORKS.sapphire;
}

export function listClientNetworks() {
  return Object.values(NETWORKS);
}

export function loadStoredNetworkId() {
  try {
    const raw = localStorage.getItem(NETWORK_LS_KEY);
    if (!raw) return DEFAULT_NETWORK_ID;
    const id = normalizeNetworkId(raw);
    const net = NETWORKS[id];
    if (net && (net.enabled || net.comingSoon)) return id;
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
