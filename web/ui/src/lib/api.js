/**
 * Fetch helper for /api/* (Netlify functions or Vite proxy).
 * Always attaches selected network so backend resolves the right pad/RPC.
 */
import {
  DEFAULT_NETWORK_ID,
  loadStoredNetworkId,
  normalizeNetworkId,
} from "./networks";

let _networkId = null;

export function getApiNetworkId() {
  if (_networkId) return _networkId;
  if (typeof window !== "undefined") {
    _networkId = loadStoredNetworkId();
  } else {
    _networkId = DEFAULT_NETWORK_ID;
  }
  return _networkId;
}

export function setApiNetworkId(networkId) {
  _networkId = normalizeNetworkId(networkId);
  return _networkId;
}

function withNetwork(path, networkId) {
  const net = normalizeNetworkId(networkId || getApiNetworkId());
  if (path.includes("network=")) return path;
  const join = path.includes("?") ? "&" : "?";
  return `${path}${join}network=${encodeURIComponent(net)}`;
}

export async function api(path, opts = {}) {
  const net = normalizeNetworkId(opts.network || getApiNetworkId());
  const url = withNetwork(path.startsWith("/") ? path : `/${path}`, net);
  const init = {
    method: opts.method || "GET",
    headers: {
      "X-Gnomi-Network": net,
      ...(opts.headers || {}),
    },
  };
  if (opts.body != null) {
    init.headers["Content-Type"] = "application/json";
    init.body = typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body);
  }
  const r = await fetch(url, init);
  const text = await r.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!r.ok) {
    const err = new Error(data.error || data.message || `HTTP ${r.status}`);
    err.status = r.status;
    err.data = data;
    throw err;
  }
  return data;
}

export function bustApiCache(prefix = "/api/") {
  // Client has no HTTP cache layer for fetches; reserved for future SWR keys.
  void prefix;
}
