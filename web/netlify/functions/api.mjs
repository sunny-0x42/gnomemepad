import { handleApi } from "../../lib/chain-api.mjs";

/**
 * Netlify function: handles rewritten /api/* traffic.
 * Redirect: /api/:splat → /.netlify/functions/api/:splat
 */
export async function handler(event) {
  const method = event.httpMethod || event.requestContext?.http?.method || "GET";

  let rawPath =
    event.path ||
    event.rawPath ||
    event.requestContext?.http?.path ||
    "/";

  // Examples:
  //   /.netlify/functions/api/markets
  //   /.netlify/functions/api
  //   /api/markets  (local netlify dev)
  let pathname = rawPath;
  const fnPrefix = "/.netlify/functions/api";
  if (pathname.startsWith(fnPrefix)) {
    const rest = pathname.slice(fnPrefix.length) || "";
    pathname = "/api" + (rest.startsWith("/") ? rest : rest ? "/" + rest : "/health");
  } else if (!pathname.startsWith("/api")) {
    pathname = "/api" + (pathname.startsWith("/") ? pathname : "/" + pathname);
  }
  if (pathname === "/api" || pathname === "/api/") {
    pathname = "/api/health";
  }

  const qs = event.queryStringParameters || {};
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(qs)) {
    if (v != null) query.set(k, Array.isArray(v) ? v[0] : String(v));
  }

  const bodyText = event.body
    ? event.isBase64Encoded
      ? Buffer.from(event.body, "base64").toString("utf8")
      : event.body
    : null;

  return handleApi(method, pathname, query, bodyText);
}
