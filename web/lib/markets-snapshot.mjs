/**
 * Speedup #3 — local/durable markets snapshot (Gnoswap-style read path).
 * File cache under web/.cache/ for local api-dev; mem fallback for Netlify.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, "..", ".cache");
const SNAP_TTL_MS = Number(process.env.MARKETS_SNAP_TTL_MS || 20_000);
const memSnaps = new Map(); // networkId -> { at, data, buildMs }

export function snapshotTtlMs() {
  return SNAP_TTL_MS;
}

function snapPath(networkId) {
  const safe = String(networkId || "default").replace(/[^a-z0-9_-]/gi, "");
  return path.join(CACHE_DIR, `markets-${safe}.json`);
}

export async function readMarketsSnapshot(networkId) {
  const key = String(networkId || "default");
  const mem = memSnaps.get(key);
  if (mem && Date.now() - mem.at <= SNAP_TTL_MS * 3) {
    return mem;
  }
  try {
    const raw = await fs.readFile(snapPath(key), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed?.data && parsed?.at) {
      memSnaps.set(key, parsed);
      return parsed;
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
    /* Netlify may be read-only FS — mem still works in-process */
  }
  return row;
}

export function snapshotFresh(snap, ttlMs = SNAP_TTL_MS) {
  return !!(snap && Date.now() - Number(snap.at || 0) <= ttlMs);
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
  const nets = Array.isArray(networkIds) ? networkIds : [networkIds];

  async function tick() {
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
  }

  tick();
  const timer = setInterval(tick, Math.max(5_000, intervalMs));
  if (typeof timer.unref === "function") timer.unref();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
