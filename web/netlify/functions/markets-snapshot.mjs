/**
 * Scheduled: rebuild lite markets snapshot into Blobs / mem.
 * Cron: every 1 minute (see netlify.toml [functions."markets-snapshot"]).
 *
 * Manual invoke (ops):
 *   GET /.netlify/functions/markets-snapshot
 *   or POST with ?network=pearl,sapphire
 */
import {
  buildNetworkMarketsPayload,
} from "../../lib/chain-api.mjs";
import { refreshMarketsSnapshots } from "../../lib/markets-snapshot.mjs";

function networksFromEnv(event) {
  const q = event?.queryStringParameters || {};
  const fromQ = String(q.network || q.networks || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (fromQ.length) return fromQ;
  return String(process.env.SNAPSHOT_NETWORKS || "mainnet")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function handler(event) {
  const nets = networksFromEnv(event);
  const results = await refreshMarketsSnapshots(nets, (id) =>
    buildNetworkMarketsPayload(id, {
      lite: true,
      writeSnapshot: true,
      force: true,
    }),
  );
  const ok = results.every((r) => r.ok);
  return {
    statusCode: ok ? 200 : 207,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify({
      ok,
      at: Date.now(),
      results,
    }),
  };
}
