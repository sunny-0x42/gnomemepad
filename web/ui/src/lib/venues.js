/**
 * Multi-DEX venues (zdex + gnoswap) for Create / Markets / Portfolio / Creator / Token.
 */
import { gnoswapSwapUrl, isGnoswapListed } from "./gnoswap";
import { getNetwork } from "./networks";

export const VENUE_ZDEX = "zdex";
export const VENUE_GNOSWAP = "gnoswap";
export const VENUE_IDS = [VENUE_ZDEX, VENUE_GNOSWAP];

const LS_PREF = "gnomi.preferredListVenue";
const LS_TOKEN_PREF = "gnomi.preferredListVenue.byToken";
const LS_LOCAL_LISTED = "gnomi.localListVenue.byToken";

export function normalizeVenue(id) {
  const s = String(id || "")
    .trim()
    .toLowerCase();
  if (s === "zdex" || s === "z") return VENUE_ZDEX;
  if (s === "gnoswap" || s === "gno" || s === "gs") return VENUE_GNOSWAP;
  return s;
}

/**
 * UI can prefer / list on this venue.
 * Pearl zdex is uiGap (pad lacks VenueZdex) but still selectable → EOA CreatePool.
 */
export function venueSelectable(v) {
  if (!v || !v.id) return false;
  if (v.enabled === true) return true;
  if (v.uiGap === true || v.eoaList === true) return true;
  return false;
}

/** Pad has on-chain adapter (SetPreferredVenue / RetryList). */
export function venuePadWired(v) {
  if (!v || !v.id) return false;
  return v.enabled === true && v.uiGap !== true && v.uiOnly !== true;
}

/**
 * Client mirror of web/lib/networks.mjs listVenuesFallback.
 * Pearl/Sapphire: Gnoswap pad-wired; zdex = uiGap EOA CreatePool (hub live).
 * Mainnet plan: zdex-first.
 */
export function offlineVenuesPayload(networkId) {
  const id = String(networkId || "")
    .trim()
    .toLowerCase();
  if (id === "local" || id === "dev" || id === "gnolocal") {
    return {
      defaultVenue: VENUE_ZDEX,
      venues: [
        {
          id: VENUE_ZDEX,
          label: "zdex",
          enabled: true,
          uiGap: true,
          eoaList: true,
          feeAssetHint: "ugnot",
          note: "EOA CreatePool on gno.land/r/zdex/v2",
        },
      ],
      offline: true,
      dualDexPad: false,
      hasPreferredVenue: false,
      hasReleaseListSeed: false,
      hasConfirmZdexList: false,
      hasListSeedReleasedOf: false,
    };
  }
  if (id === "pearl" || id === "sapphire" || id.includes("pearl") || id.includes("sapphire")) {
    return {
      defaultVenue: VENUE_GNOSWAP,
      venues: [
        { id: VENUE_GNOSWAP, label: "Gnoswap", enabled: true, feeAssetHint: "GNS" },
        {
          id: VENUE_ZDEX,
          label: "zdex",
          enabled: !id.includes("sapphire"),
          uiGap: true,
          eoaList: true,
          feeAssetHint: "ugnot",
          note:
            id.includes("sapphire")
              ? "Not wired on this pad — EOA zdex CreatePool if hub is up"
              : "EOA CreatePool on …/zdex/v3 — padv23 has no VenueZdex; wallet must hold PoolUgnot+PoolToken",
        },
      ],
      offline: true,
      dualDexPad: false,
      hasPreferredVenue: false,
      hasReleaseListSeed: false,
      hasConfirmZdexList: false,
      hasListSeedReleasedOf: false,
    };
  }
  // Match live mainnet gnomi/pad (DefaultListVenue=zdex; both venues enabled).
  return {
    defaultVenue: VENUE_ZDEX,
    venues: [
      { id: VENUE_ZDEX, label: "zdex", enabled: true, feeAssetHint: "ugnot" },
      {
        id: VENUE_GNOSWAP,
        label: "Gnoswap",
        enabled: true,
        feeAssetHint: "GNS",
        note: "100 GNS Create escrow",
      },
    ],
    offline: true,
    dualDexPad: true,
    hasPreferredVenue: true,
    hasReleaseListSeed: true,
    hasConfirmZdexList: true,
    hasListSeedReleasedOf: true,
  };
}

export function venueLabel(id, lang = "en") {
  const v = normalizeVenue(id);
  if (v === VENUE_ZDEX) return "zdex";
  if (v === VENUE_GNOSWAP) return lang === "vi" ? "Gnoswap" : "Gnoswap";
  return v || "—";
}

function tokenLsKey(pkg, id) {
  return `${pkg || ""}|${id || ""}`;
}

export function storeLocalListVenue(pkg, id, venue) {
  const v = normalizeVenue(venue);
  if (!id || !v) return;
  try {
    const raw = localStorage.getItem(LS_LOCAL_LISTED);
    const map = raw ? JSON.parse(raw) : {};
    map[tokenLsKey(pkg, id)] = v;
    localStorage.setItem(LS_LOCAL_LISTED, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

export function loadLocalListVenue(pkg, id) {
  try {
    const raw = localStorage.getItem(LS_LOCAL_LISTED);
    const map = raw ? JSON.parse(raw) : {};
    return normalizeVenue(map[tokenLsKey(pkg, id)] || "") || "";
  } catch {
    return "";
  }
}

export function isListed(m) {
  if (!m) return false;
  if (m.listVenue || m.ListVenue || isGnoswapListed(m) || m.gnoswapListed) return true;
  const local = loadLocalListVenue(m.pkg, m.id);
  if (!local) return false;
  // LS after EOA CreatePool only counts when pad LP left (ReleaseListSeed).
  // Otherwise raise capital is still on pad CPMM — do not hide List / redirect trades.
  return !!(m.listSeedReleased || m.ListSeedReleased);
}

/** Local zdex CreatePool recorded but pad ListVenue still empty (Confirm pending). */
export function zdexConfirmPending(m) {
  if (!m) return false;
  if (m.listVenue || m.ListVenue || isGnoswapListed(m) || m.gnoswapListed) return false;
  if (loadLocalListVenue(m.pkg, m.id) !== VENUE_ZDEX) return false;
  return !!(m.listSeedReleased || m.ListSeedReleased);
}

/** Prefer on-chain listVenue (after ConfirmZdexList / RetryList); LS fallback for EOA-only. */
export function venueOf(m) {
  if (!m) return "";
  const v = normalizeVenue(m.listVenue || m.ListVenue || "");
  // Only trust known venue ids (mis-parsed LaunchInfo can put note text in listVenue).
  if (v === VENUE_ZDEX || v === VENUE_GNOSWAP) return v;
  const pool = String(m.gnoswapPoolPath || m.zdexPoolId || m.listPoolPath || "");
  // ConfirmZdexList stores poolId "ugnot|SYMBOL" (Gnoswap uses ":" paths).
  if (/^ugnot\|/i.test(pool) || (pool.includes("|") && !pool.includes(":"))) {
    return VENUE_ZDEX;
  }
  if (isGnoswapListed(m) || m.gnoswapListed) return VENUE_GNOSWAP;
  return loadLocalListVenue(m.pkg, m.id) || "";
}

export function preferredOf(m) {
  if (!m) return "";
  return normalizeVenue(m.preferredVenue || m.PreferredVenue || "");
}

/**
 * Caps from /api/list-venues (or health) for dual-DEX pad SOURCE cut.
 * Live Pearl padv23: all false until probe. PreferredVenueOf ⇒ dualDexPad
 * (venue-aware Create fee / CreateWithVenue) — Release/Confirm may ship same cut.
 */
export function dualDexFromVenuesApi(api) {
  if (!api || typeof api !== "object") {
    return {
      dualDexPad: false,
      hasPreferredVenue: false,
      hasReleaseListSeed: false,
      hasConfirmZdexList: false,
      hasListSeedReleasedOf: false,
    };
  }
  const hasPreferredVenue =
    api.hasPreferredVenue === true ||
    api.dualDexPad === true ||
    api.funcs?.PreferredVenueOf === true ||
    api.funcs?.SetPreferredVenue === true ||
    api.funcs?.CreateWithVenue === true;
  const hasReleaseListSeed =
    api.hasReleaseListSeed === true || api.funcs?.ReleaseListSeed === true;
  const hasConfirmZdexList =
    api.hasConfirmZdexList === true || api.funcs?.ConfirmZdexList === true;
  const hasListSeedReleasedOf =
    api.hasListSeedReleasedOf === true || api.funcs?.ListSeedReleasedOf === true;
  // Match chain-api: PreferredVenue cut ⇒ dualDexPad (feeGns=0 for zdex Create).
  const dualDexPad = api.dualDexPad === true || hasPreferredVenue;
  return {
    dualDexPad,
    hasPreferredVenue,
    hasReleaseListSeed,
    hasConfirmZdexList,
    hasListSeedReleasedOf,
  };
}

/**
 * Create-time GNS escrow.
 * zdex → 0 when pad dualDexPad / PreferredVenue / CreateWithVenue cut.
 * Pearl live padv23 still lockListFeeEscrow(100 GNS) — keep fee so Create does not panic.
 *
 * opts: { dualDexPad, hasPreferredVenue, padLacksPreferredVenue, networkId, zdexListFeeZero }
 */
export function createListFeeGns(
  preferredVenue,
  listFeeGnsFromApi,
  fallbackGns = 0,
  opts = {},
) {
  const n = Number(listFeeGnsFromApi);
  const gnsFee =
    Number.isFinite(n) && n > 0
      ? Math.floor(n)
      : Math.max(0, Math.floor(Number(fallbackGns) || 0));
  if (normalizeVenue(preferredVenue) !== VENUE_ZDEX) return gnsFee;

  // SOURCE CreateWithVenue / PreferredVenue: zdex skips GNS escrow
  if (
    opts.zdexListFeeZero === true ||
    opts.dualDexPad === true ||
    opts.hasPreferredVenue === true
  ) {
    return 0;
  }
  if (opts.padLacksPreferredVenue === true || opts.dualDexPad === false) {
    return gnsFee;
  }
  const net = String(opts.networkId || "").toLowerCase();
  // Pearl/Sapphire without dualDex signal → pad still takes 100 GNS
  if (net.includes("pearl") || net.includes("sapphire")) return gnsFee;
  // Mainnet plan / dual-ready unknown: zdex skips GNS
  return 0;
}

/** Pick default Create preference from /api/list-venues payload. */
export function defaultPreferredVenue(apiVenues, networkId) {
  const list = Array.isArray(apiVenues?.venues) ? apiVenues.venues : [];
  const pickable = list.filter((v) => venueSelectable(v));
  const def = normalizeVenue(apiVenues?.defaultVenue);
  if (def && pickable.some((v) => normalizeVenue(v.id) === def)) return def;
  // Prefer pad-wired default when present
  const wired = pickable.filter((v) => venuePadWired(v));
  const wiredDef = wired.find((v) => normalizeVenue(v.id) === def);
  if (wiredDef) return normalizeVenue(wiredDef.id);
  if (wired[0]) return normalizeVenue(wired[0].id);
  const z = pickable.find((v) => normalizeVenue(v.id) === VENUE_ZDEX);
  if (z) return VENUE_ZDEX;
  const g = pickable.find((v) => normalizeVenue(v.id) === VENUE_GNOSWAP);
  if (g) return VENUE_GNOSWAP;
  const net = String(networkId || "").toLowerCase();
  if (net.includes("pearl") || net.includes("sapphire")) return VENUE_GNOSWAP;
  return VENUE_ZDEX;
}

export function loadSessionPreferredVenue() {
  try {
    return normalizeVenue(localStorage.getItem(LS_PREF) || "") || "";
  } catch {
    return "";
  }
}

export function storeSessionPreferredVenue(id) {
  const v = normalizeVenue(id);
  try {
    if (v) localStorage.setItem(LS_PREF, v);
  } catch {
    /* ignore */
  }
  return v;
}

export function storeTokenPreferredVenue(pkg, id, venue) {
  try {
    const raw = localStorage.getItem(LS_TOKEN_PREF);
    const map = raw ? JSON.parse(raw) : {};
    map[tokenLsKey(pkg, id)] = normalizeVenue(venue);
    localStorage.setItem(LS_TOKEN_PREF, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

export function loadTokenPreferredVenue(pkg, id) {
  try {
    const raw = localStorage.getItem(LS_TOKEN_PREF);
    const map = raw ? JSON.parse(raw) : {};
    return normalizeVenue(map[tokenLsKey(pkg, id)] || "") || "";
  } catch {
    return "";
  }
}

/** Zdex app origin (local Pearl Vite :5173 · mainnet Netlify). */
export function zdexAppBase(networkId) {
  const id = typeof networkId === "string" ? networkId : getNetwork(networkId)?.id;
  const strip = (u) => String(u || "").replace(/\/$/, "");
  if (id === "pearl") {
    return strip(import.meta.env?.VITE_ZDEX_APP_PEARL || "http://127.0.0.1:5173");
  }
  if (id === "mainnet") {
    return strip(
      import.meta.env?.VITE_ZDEX_APP_MAINNET || "https://zdex.gnomi.fun",
    );
  }
  return strip(import.meta.env?.VITE_ZDEX_APP_PEARL || "http://127.0.0.1:5173");
}

export function zdexSwapUrl(m, networkId) {
  const net = getNetwork(networkId);
  const base = zdexAppBase(net?.id || networkId);
  const pool =
    m?.zdexPoolId ||
    (m?.symbol ? `ugnot|${String(m.symbol).toUpperCase()}` : "") ||
    m?.gnoswapPoolPath ||
    "";
  const q = new URLSearchParams();
  q.set("net", net?.id === "mainnet" ? "mainnet" : "pearl");
  q.set("tab", "swap");
  if (pool) q.set("pool", pool);
  return `${base}/?${q.toString()}`;
}

export function dexTradeUrl(m, networkId) {
  const v = venueOf(m);
  if (v === VENUE_ZDEX) return zdexSwapUrl(m, networkId);
  if (v === VENUE_GNOSWAP || isGnoswapListed(m)) return gnoswapSwapUrl(m);
  return null;
}
