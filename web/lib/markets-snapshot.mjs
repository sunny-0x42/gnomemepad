/**
 * Speedup #3 — durable markets snapshot (Gnoswap-style read path).
 *
 * Backends (best → fallback):
 *   1. in-process memory (all runtimes)
 *   2. web/.cache/*.json (local api-dev; Netlify FS is ephemeral)
 *   3. Netlify Blobs store "gnomi-markets-snapshot" (prod durable)
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Netlify bundles functions as CJS — import.meta.url may be undefined.
const CACHE_DIR = (() => {
  try {
    const u = import.meta?.url;
    if (u) return path.join(path.dirname(fileURLToPath(u)), "..", ".cache");
  } catch {
    /* CJS / bundled */
  }
  return path.join(process.cwd(), "web", ".cache");
})();
const SNAP_TTL_MS = Number(process.env.MARKETS_SNAP_TTL_MS || 20_000);
const BLOB_STORE = "gnomi-markets-snapshot";
const memSnaps = new Map(); // networkId -> { at, data, buildMs }

let blobStorePromise = null;

export function snapshotTtlMs() {
  return SNAP_TTL_MS;
}

function snapPath(networkId) {
  const safe = String(networkId || "default").replace(/[^a-z0-9_-]/gi, "");
  return path.join(CACHE_DIR, `markets-${safe}.json`);
}

function blobKey(networkId) {
  const safe = String(networkId || "default").replace(/[^a-z0-9_-]/gi, "");
  return `markets-${safe}`;
}

async function getBlobStore() {
  if (blobStorePromise) return blobStorePromise;
  blobStorePromise = (async () => {
    try {
      const mod = await import("@netlify/blobs");
      const getStore = mod.getStore || mod.default?.getStore;
      if (typeof getStore !== "function") return null;
      return getStore(BLOB_STORE);
    } catch {
      return null;
    }
  })();
  return blobStorePromise;
}

function normalizeRow(parsed) {
  if (parsed?.data && parsed?.at) return parsed;
  return null;
}

export async function readMarketsSnapshot(networkId) {
  const key = String(networkId || "default");
  const mem = memSnaps.get(key);
  if (mem && Date.now() - mem.at <= SNAP_TTL_MS * 3) {
    return mem;
  }

  try {
    const raw = await fs.readFile(snapPath(key), "utf8");
    const parsed = normalizeRow(JSON.parse(raw));
    if (parsed) {
      memSnaps.set(key, parsed);
      return parsed;
    }
  } catch {
    /* miss */
  }

  try {
    const store = await getBlobStore();
    if (store) {
      const parsed = normalizeRow(await store.get(blobKey(key), { type: "json" }));
      if (parsed) {
        memSnaps.set(key, parsed);
        return parsed;
      }
    }
  } catch {
    /* miss */
  }

  return null;
}

export async function writeMarketsSnapshot(networkId, data, buildMs = 0) {
  const key = String(networkId || "default");
  const row = { at: Date.now(), buildMs, data };
  memSnaps.set(key, row);

  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(snapPath(key), JSON.stringify(row), "utf8");
  } catch {
    /* Netlify may be read-only FS — mem/blobs still work */
  }

  try {
    const store = await getBlobStore();
    if (store) {
      await store.setJSON(blobKey(key), row);
    }
  } catch {
    /* local without Blobs credentials — ok */
  }

  return row;
}

export function snapshotFresh(snap, ttlMs = SNAP_TTL_MS) {
  return !!(snap && Date.now() - Number(snap.at || 0) <= ttlMs);
}

/** Serve a snapshot for 5 minutes so a 1-minute cron covers the page request. */
export function snapshotUsable(snap, ttlMs = SNAP_TTL_MS) {
  return !!(snap && Date.now() - Number(snap.at || 0) <= Math.max(ttlMs * 3, 5 * 60_000));
}

/**
 * Background refresher for local api-dev (and optionally Netlify scheduled).
 * buildFn(networkId) => markets payload object
 */
export function startMarketsSnapshotWorker({
  networkIds = ["pearl"],
  intervalMs = 20_000,
  buildFn,
} = {}) {
  if (typeof buildFn !== "function") {
    throw new Error("buildFn required");
  }
  let stopped = false;
  let running = false;
  const nets = Array.isArray(networkIds) ? networkIds : [networkIds];

  async function tick() {
    if (running || stopped) return;
    running = true;
    try {
      for (const id of nets) {
        if (stopped) return;
        const t0 = Date.now();
        try {
          const data = await buildFn(id);
          await writeMarketsSnapshot(id, data, Date.now() - t0);
          console.log(
            `[snapshot] ${id} ok ${Date.now() - t0}ms markets=${data?.count ?? data?.markets?.length ?? "?"}`,
          );
        } catch (e) {
          console.warn(`[snapshot] ${id} fail`, String(e.message || e).slice(0, 160));
        }
      }
    } finally {
      running = false;
    }
  }

  tick();
  const timer = setInterval(tick, Math.max(5_000, intervalMs));
  if (typeof timer.unref === "function") timer.unref();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

/** One-shot refresh used by Netlify scheduled function. */
export async function refreshMarketsSnapshots(networkIds, buildFn) {
  const nets = Array.isArray(networkIds) ? networkIds : [networkIds];
  const results = [];
  for (const id of nets) {
    const t0 = Date.now();
    try {
      const data = await buildFn(id);
      const row = await writeMarketsSnapshot(id, data, Date.now() - t0);
      results.push({
        network: id,
        ok: true,
        buildMs: Date.now() - t0,
        markets: data?.count ?? data?.markets?.length ?? 0,
        at: row.at,
      });
    } catch (e) {
      results.push({
        network: id,
        ok: false,
        error: String(e.message || e).slice(0, 200),
        buildMs: Date.now() - t0,
      });
    }
  }
  return results;
}
