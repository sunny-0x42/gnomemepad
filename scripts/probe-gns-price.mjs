const RPC = "https://rpc.sapphire.testnets.gno.land:443";

async function qeval(pkg, expr) {
  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "abci_query",
    params: {
      path: "vm/qeval",
      data: Buffer.from(pkg + "." + expr).toString("base64"),
      prove: false,
    },
  };
  const r = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  const resp = j?.result?.response;
  if (!resp) return { err: JSON.stringify(j).slice(0, 200) };
  const err = resp.Error || resp.ResponseBase?.Error;
  if (err) return { err: typeof err === "string" ? err : JSON.stringify(err) };
  let v = resp.Value || resp.value || resp.ResponseBase?.Data;
  if (!v) return { raw: JSON.stringify(resp).slice(0, 200) };
  return { ok: Buffer.from(v, "base64").toString("utf8") };
}

function parseNums(s) {
  const m = [...String(s).matchAll(/"(\d+)"/g)].map((x) => x[1]);
  return m.map(Number);
}

const w = "gno.land/r/gnoland/wugnot.wugnot";
const g = "gno.land/r/gnoswap/gns.GNS";
const pool = `${w}:${g}:3000`;
const route = pool;

const fee = await qeval("gno.land/r/gnoswap/pool", "GetPoolCreationFee()");
const bal = await qeval("gno.land/r/gnoswap/pool", `GetBalances(${JSON.stringify(pool)})`);
const liq = await qeval("gno.land/r/gnoswap/pool", `GetLiquidity(${JSON.stringify(pool)})`);

console.log("=== Sapphire live quote ===");
console.log("poolCreationFee", fee.ok || fee.err);
console.log("WUGNOT/GNS pool balances", bal.ok || bal.err);
console.log("liquidity", liq.ok || liq.err);

console.log("\nEXACT_OUT: cost in WUGNOT for fixed GNS out");
for (const out of [1_000_000, 10_000_000, 50_000_000, 100_000_000, 200_000_000]) {
  const expr = `DrySwapRoute(${[
    w,
    g,
    String(out),
    "EXACT_OUT",
    route,
    "100",
    "50000000000",
  ]
    .map((x) => JSON.stringify(x))
    .join(",")})`;
  const r = await qeval("gno.land/r/gnoswap/router", expr);
  const s = r.ok || r.err || "";
  const [ain, aout] = parseNums(s);
  const ok = String(s).includes("true");
  console.log({
    gnsOut: out / 1e6,
    gnotIn: ain / 1e6,
    ugnotIn: ain,
    gnotPerGns: aout ? ain / aout : null,
    ok,
  });
}

console.log("\nEXACT_IN: GNS out for fixed WUGNOT in");
for (const inn of [1_000_000, 10_000_000, 100_000_000, 1_000_000_000, 2_000_000_000]) {
  const expr = `DrySwapRoute(${[
    w,
    g,
    String(inn),
    "EXACT_IN",
    route,
    "100",
    "1",
  ]
    .map((x) => JSON.stringify(x))
    .join(",")})`;
  const r = await qeval("gno.land/r/gnoswap/router", expr);
  const s = r.ok || r.err || "";
  const [ain, aout] = parseNums(s);
  console.log({
    gnotIn: ain / 1e6,
    gnsOut: aout / 1e6,
    gnotPerGns: aout ? ain / aout : null,
    ok: String(s).includes("true"),
  });
}

// Pad v9 logic simulation
const creationFeeGns = 100_000_000;
const maxFeeW = 5_000_000_000; // GnoswapMaxFeeWugnot
const raised = 100_000_000; // 100 GNOT graduation default on sapphire deploy
const maxSpend = Math.min(maxFeeW, Math.floor(raised / 2));
const cost100 = await qeval(
  "gno.land/r/gnoswap/router",
  `DrySwapRoute(${[
    w,
    g,
    String(creationFeeGns),
    "EXACT_OUT",
    route,
    "100",
    String(maxSpend),
  ]
    .map((x) => JSON.stringify(x))
    .join(",")})`,
);
console.log("\n=== Pad auto-list simulation (grad=100 GNOT, maxFee=min(5000, raised/2)=50 GNOT) ===");
console.log("ExactOut 100 GNS with maxIn=50 GNOT:", cost100.ok || cost100.err);
const costWith5k = await qeval(
  "gno.land/r/gnoswap/router",
  `DrySwapRoute(${[
    w,
    g,
    String(creationFeeGns),
    "EXACT_OUT",
    route,
    "100",
    String(maxFeeW),
  ]
    .map((x) => JSON.stringify(x))
    .join(",")})`,
);
console.log("ExactOut 100 GNS with maxIn=5000 GNOT:", costWith5k.ok || costWith5k.err);
const nums = parseNums(costWith5k.ok || "");
console.log(
  "=> need ~",
  nums[0] / 1e6,
  "GNOT inventory for fee alone (at current price + impact)",
);
console.log(
  "=> if GNS doubles vs GNOT, fee cost ~halves; if GNS halves, fee cost ~doubles (same GNS amount fixed)",
);
