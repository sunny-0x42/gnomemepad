/**
 * Local API for Vite React UI (web/ui).
 * Proxies /api/* via chain-api (same as Netlify function).
 *
 *   node web/api-dev.mjs
 *   cd web/ui && npm run dev   # proxies /api → :8787
 *
 * Speedup #3: starts a markets snapshot worker (Pearl by default —
 * Sapphire RPC DNS may be down).
 */
import http from "node:http";
import { buildNetworkMarketsPayload, handleApi } from "./lib/chain-api.mjs";
import { startMarketsSnapshotWorker } from "./lib/markets-snapshot.mjs";

const PORT = Number(process.env.API_PORT || 8787);
const SNAP_NETS = String(process.env.SNAPSHOT_NETWORKS || "pearl")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);
    let body = null;
    if (req.method === "POST" || req.method === "PUT") {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      body = Buffer.concat(chunks).toString("utf8");
    }
    const out = await handleApi(
      req.method,
      url.pathname,
      url.searchParams,
      body,
      req.headers || {},
    );
    const headers = { ...(out.headers || {}) };
    // Node http doesn't support multiValueHeaders — flatten Set-Cookie
    if (out.multiValueHeaders?.["Set-Cookie"]) {
      // Node 18+: setHeader accepts array
      res.setHeader("Set-Cookie", out.multiValueHeaders["Set-Cookie"]);
    }
    res.writeHead(out.statusCode || 200, headers);
    res.end(out.body ?? "");
  } catch (e) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: String(e.message || e) }));
  }
});

server.listen(PORT, () => {
  console.log(`gnomemepad API dev http://127.0.0.1:${PORT}`);
  console.log(`snapshot networks: ${SNAP_NETS.join(", ") || "(none)"}`);
  if (SNAP_NETS.length) {
    startMarketsSnapshotWorker({
      networkIds: SNAP_NETS,
      intervalMs: Number(process.env.MARKETS_SNAP_INTERVAL_MS || 20_000),
      buildFn: (id) =>
        buildNetworkMarketsPayload(id, { lite: true, writeSnapshot: true, force: true }),
    });
  }
});
