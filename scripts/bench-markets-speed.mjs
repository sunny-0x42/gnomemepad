/**
 * Local benchmark for markets speedups (#1 lite, #2 parallel, #3 snapshot).
 *
 *   node web/api-dev.mjs          # DEFAULT_NETWORK=pearl SNAPSHOT_NETWORKS=pearl
 *   node scripts/bench-markets-speed.mjs
 */
const BASE = process.env.API_BASE || "http://127.0.0.1:8787";
const NET = process.env.BENCH_NETWORK || "pearl";

async function timed(label, url) {
  const times = [];
  let sample = null;
  for (let i = 0; i < 3; i++) {
    const t0 = Date.now();
    const r = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    const j = await r.json();
    times.push(Date.now() - t0);
    if (!sample) sample = j;
  }
  const avg = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
  console.log(
    `${label.padEnd(22)} avg=${String(avg).padStart(5)}ms  times=[${times.join(",")}]  ` +
      `count=${sample?.count ?? "?"} lite=${sample?.lite} snap=${sample?.snapshot} cached=${sample?.cached} buildMs=${sample?.buildMs ?? "-"}`,
  );
}

const bust = () => `_=${Date.now()}`;
console.log(`API ${BASE} network=${NET}\n`);
await timed("lite cold", `${BASE}/api/markets-lite?network=${NET}&nosnapshot=1&nocache=1&${bust()}`);
await timed("full cold", `${BASE}/api/markets?network=${NET}&nosnapshot=1&nocache=1&${bust()}`);
await timed("lite+snapshot", `${BASE}/api/markets-lite?network=${NET}&${bust()}`);
await timed("lite+snapshot warm", `${BASE}/api/markets-lite?network=${NET}`);
await timed("health", `${BASE}/api/health?network=${NET}`);
