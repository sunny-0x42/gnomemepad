/**
 * Multi-network registry for Gnomi.fun.
 * UI + Netlify API both resolve packages from here (not only process.env),
 * so users can switch Sapphire ↔ Pearl without redeploying env.
 */

export const DEPLOYER = "g1mv0052e7r6s09f5t9xsqf00nj3tqsgt9dg52jr";

function realm(name) {
  return `gno.land/r/${DEPLOYER}/gnomemepad/${name}`;
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
 *  signerAddr: string,
 *  enabled: boolean,
 *  comingSoon?: boolean,
 * }} NetworkDef
 */

/** @type {Record<string, NetworkDef>} */
export const NETWORKS = {
  sapphire: {
    id: "sapphire",
    label: "Sapphire",
    chainId: "sapphire-1",
    rpcUrl: "https://rpc.sapphire.testnets.gno.land:443",
    gnoweb: "https://sapphire.testnets.gno.land",
    faucet: "https://faucet.gno.land",
    pkg: realm("padv22"),
    hub: realm("hubv2"),
    profile: realm("profile"),
    meta: realm("meta"),
    points: realm("pointsv2"),
    bond: realm("bond"),
    signerAddr: DEPLOYER,
    enabled: true,
  },
  pearl: {
    id: "pearl",
    label: "Pearl",
    chainId: "pearl-1",
    rpcUrl: "https://rpc.pearl.testnets.gno.land:443",
    gnoweb: "https://pearl.testnets.gno.land",
    faucet: "https://faucet.gno.land",
    pkg: realm("padv23"),
    hub: realm("hubv2"),
    profile: realm("profile"),
    meta: realm("meta"),
    points: realm("pointsv2"),
    bond: realm("bond"),
    signerAddr: DEPLOYER,
    enabled: true,
  },
  mainnet: {
    id: "mainnet",
    label: "Mainnet",
    chainId: process.env.MAINNET_CHAIN_ID || "gnoland1",
    rpcUrl: (process.env.MAINNET_RPC_URL || "https://rpc.gno.land:443").replace(/\/$/, ""),
    gnoweb: process.env.MAINNET_GNOWEB || "https://gno.land",
    faucet: "",
    pkg: process.env.MAINNET_PKG || "",
    hub: process.env.MAINNET_HUB || "",
    profile: process.env.MAINNET_PROFILE || "",
    meta: process.env.MAINNET_META || "",
    points: process.env.MAINNET_POINTS || "",
    bond: process.env.MAINNET_BOND || "",
    signerAddr: process.env.MAINNET_SIGNER || DEPLOYER,
    // Enabled only when MAINNET_PKG is configured (post-deploy).
    enabled: !!(process.env.MAINNET_PKG && process.env.MAINNET_RPC_URL),
    comingSoon: !(process.env.MAINNET_PKG && process.env.MAINNET_RPC_URL),
  },
};

export const DEFAULT_NETWORK_ID =
  String(process.env.DEFAULT_NETWORK || process.env.CHAIN_ID || "")
    .toLowerCase()
    .includes("pearl")
    ? "pearl"
    : String(process.env.DEFAULT_NETWORK || "").toLowerCase() === "mainnet"
      ? "mainnet"
      : "sapphire";

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

export function listNetworks() {
  return Object.values(NETWORKS).map((n) => ({
    id: n.id,
    label: n.label,
    chainId: n.chainId,
    enabled: !!n.enabled,
    comingSoon: !!n.comingSoon,
    pkg: n.pkg || null,
    rpcUrl: n.rpcUrl,
  }));
}

/** Build API config object for a network (overrides process.env PKG/RPC). */
export function configForNetwork(networkId) {
  const n = getNetwork(networkId);
  if (!n.enabled && n.comingSoon) {
    // Still return stub so UI can show "coming soon"; API should 400.
    return {
      networkId: n.id,
      RPC: n.rpcUrl,
      CHAIN_ID: n.chainId,
      PKG: n.pkg || "",
      HUB: n.hub || "",
      PROFILE: n.profile || "",
      META: n.meta || "",
      POINTS: n.points || "",
      BOND: n.bond || "",
      SIGNER_ADDR: n.signerAddr || DEPLOYER,
      GNOWEB: n.gnoweb || "",
      FAUCET: n.faucet || "",
      enabled: false,
      comingSoon: true,
      label: n.label,
    };
  }
  return {
    networkId: n.id,
    RPC: n.rpcUrl.replace(/\/$/, ""),
    CHAIN_ID: n.chainId,
    PKG: n.pkg,
    HUB: n.hub,
    PROFILE: n.profile,
    META: n.meta,
    POINTS: n.points,
    BOND: n.bond,
    SIGNER_ADDR: n.signerAddr || DEPLOYER,
    GNOWEB: n.gnoweb || "",
    FAUCET: n.faucet || "",
    enabled: true,
    comingSoon: false,
    label: n.label,
  };
}
