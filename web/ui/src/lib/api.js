/**
 * Fetch helper for /api/* (Netlify functions or Vite proxy).
 */
export async function api(path, opts = {}) {
  const url = path.startsWith("/") ? path : `/${path}`;
  const init = {
    method: opts.method || "GET",
    headers: { ...(opts.headers || {}) },
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
