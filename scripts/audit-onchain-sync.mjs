/**
 * Compare live API markets/params vs raw on-chain ParamsInfo + LaunchInfo.
 */
import { createRequire } from "module";

const RPC =
  process.env.RPC_URL || "https://rpc.sapphire.testnets.gno.land:443";
const PKG =
  process.env.PKG ||
  "gno.land/r/g1mv0052e7r6s09f5t9xsqf00nj3tqsgt9dg52jr/gnomemepad/padv22";
const API =
  (process.env.API_BASE || "https://gnomemepad-sapphire.netlify.app").replace(
    /\/$/,
    "",
  );
const UGNOT = 1e6;

async function rpc(method, params) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = await res.json();
  if (j.error) throw new Error(JSON.stringify(j.error));
  return j.result;
}

async function qeval(expr) {
  // Match chain-api.mjs: base64-encoded expression for vm/qeval
  const data = Buffer.from(expr, "utf8").toString("base64");
  const result = await rpc("abci_query", {
    path: "vm/qeval",
    data,
    height: "0",
    prove: false,
  });
  const rb = result?.response?.ResponseBase;
  if (rb?.Error) {
    const err = typeof rb.Error === "string" ? rb.Error : JSON.stringify(rb.Error);
    throw new Error(err);
  }
  let text = rb?.Data ? Buffer.from(rb.Data, "base64").toString("utf8") : "";
  const m = text.match(/^\((.*)\)\s*$/s);
  if (m) {
    let inner = m[1].trim();
    const sm = inner.match(/^"(.*)"\s+string$/s);
    if (sm) return sm[1].replace(/\\n/g, "\n").replace(/\\"/g, '"');
    const nm = inner.match(/^(-?\d+)\s+\w+$/);
    if (nm) return nm[1];
    return inner;
  }
  return text;
}

function parseParams(raw) {
  const p = String(raw).split("|");
  return {
    totalSupply: Number(p[0]),
    curveSupply: Number(p[1]),
    poolSeed: Number(p[2]),
    graduation: Number(p[3]),
    graduationGnot: Number(p[3]) / UGNOT,
    feeBps: Number(p[4]),
    createBond: Number(p[5]),
    createBondGnot: Number(p[5]) / UGNOT,
    listFeeGns: Number(p[6]) || 0,
    listFeeGnsUnits: (Number(p[6]) || 0) / 1e6,
  };
}

function parseLaunch(raw) {
  const p = String(raw).split("|");
  return {
    id: p[0],
    name: p[1],
    symbol: p[2],
    status: Number(p[3]),
    raised: Number(p[4]),
    sold: Number(p[5]),
    buyers: Number(p[6]),
    creatorFees: Number(p[7]),
    poolUgnot: Number(p[8]),
    poolToken: Number(p[9]),
    uri: p[10],
    creator: p[11],
    virtualUgnot: Number(p[12]),
    virtualToken: Number(p[13]),
    created: Number(p[14]),
    tokenId: p[15] || "",
    gnoswapReady: p[16] === "1",
    gnoswapListed: p[17] === "1",
    gnoswapPoolPath: p[18] || "",
    gnoswapNote: p[19] || "",
  };
}

function eq(a, b) {
  if (typeof a === "number" && typeof b === "number") {
    if (!Number.isFinite(a) && !Number.isFinite(b)) return true;
    return Math.abs(a - b) < 1e-9 || Math.abs(a - b) / (Math.abs(b) || 1) < 1e-9;
  }
  return String(a ?? "") === String(b ?? "");
}

async function main() {
  const [chainParamsRaw, idsRaw, apiParams, apiMarkets] = await Promise.all([
    qeval(`${PKG}.ParamsInfo()`),
    qeval(`${PKG}.ListIDs()`),
    fetch(`${API}/api/params`).then((r) => r.json()),
    fetch(`${API}/api/markets?refresh=1`).then((r) => r.json()),
  ]);

  const chainParams = parseParams(chainParamsRaw);
  const ids = String(idsRaw)
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  const chainLaunches = {};
  for (const id of ids) {
    chainLaunches[id] = parseLaunch(
      await qeval(`${PKG}.LaunchInfo(${JSON.stringify(id)})`),
    );
  }

  const issues = [];
  const paramKeys = [
    "totalSupply",
    "curveSupply",
    "poolSeed",
    "graduation",
    "feeBps",
    "createBond",
    "listFeeGns",
  ];
  for (const k of paramKeys) {
    if (!eq(apiParams[k], chainParams[k])) {
      issues.push({
        kind: "params",
        field: k,
        api: apiParams[k],
        chain: chainParams[k],
      });
    }
  }

  const apiById = Object.fromEntries(
    (apiMarkets.markets || [])
      .filter((m) => !m.error)
      .map((m) => [m.id, m]),
  );

  for (const id of ids) {
    const c = chainLaunches[id];
    const a = apiById[id];
    if (!a) {
      issues.push({ kind: "market_missing_api", id, symbol: c.symbol });
      continue;
    }
    const fields = [
      "name",
      "symbol",
      "status",
      "raised",
      "sold",
      "buyers",
      "poolUgnot",
      "poolToken",
      "uri",
      "creator",
      "tokenId",
      "gnoswapListed",
      "gnoswapPoolPath",
    ];
    for (const f of fields) {
      const av = a[f];
      const cv = c[f];
      if (f === "gnoswapListed") {
        if (Boolean(av) !== Boolean(cv)) {
          issues.push({ kind: "market", id, symbol: c.symbol, field: f, api: av, chain: cv });
        }
        continue;
      }
      if (!eq(av, cv)) {
        issues.push({
          kind: "market",
          id,
          symbol: c.symbol,
          field: f,
          api: av,
          chain: cv,
        });
      }
    }
    // Derived: progress for graduated
    if (c.status === 1 && a.progressPct !== 100) {
      issues.push({
        kind: "derived",
        id,
        field: "progressPct",
        api: a.progressPct,
        expect: 100,
      });
    }
    // raisedGnot: raw LaunchInfo.RaisedUgnot is zeroed at graduate; API may
    // surface poolUgnot as raisedGnot (raisedSource=pool_at_grad) — intentional.
    const expectRaisedGnot =
      c.status === 1 && c.raised <= 0 && c.poolUgnot > 0
        ? c.poolUgnot / UGNOT
        : c.raised / UGNOT;
    if (!eq(a.raisedGnot, expectRaisedGnot)) {
      issues.push({
        kind: "derived",
        id,
        field: "raisedGnot",
        api: a.raisedGnot,
        expect: expectRaisedGnot,
        chainRaised: c.raised / UGNOT,
        raisedSource: a.raisedSource,
      });
    }
  }

  // API-only markets not on chain (stale)
  for (const id of Object.keys(apiById)) {
    if (!chainLaunches[id] && apiById[id].pkg === PKG) {
      issues.push({ kind: "stale_api", id, symbol: apiById[id].symbol });
    }
  }

  const report = {
    ok: issues.length === 0,
    pkg: PKG,
    api: API,
    chainParams,
    apiParams: Object.fromEntries(paramKeys.map((k) => [k, apiParams[k]])),
    markets: ids.map((id) => {
      const c = chainLaunches[id];
      const a = apiById[id] || null;
      return {
        id,
        symbol: c.symbol,
        chain: {
          status: c.status,
          raised: c.raised,
          sold: c.sold,
          buyers: c.buyers,
          listed: c.gnoswapListed,
          poolUgnot: c.poolUgnot,
          poolToken: c.poolToken,
          uri: c.uri,
        },
        api: a
          ? {
              status: a.status,
              raised: a.raised,
              sold: a.sold,
              buyers: a.buyers,
              listed: a.gnoswapListed,
              priceGnot: a.priceGnot,
              priceSource: a.priceSource,
              mcapGnot: a.mcapGnot,
            }
          : null,
      };
    }),
    issues,
  };

  console.log(JSON.stringify(report, null, 2));
  if (issues.length) process.exitCode = 2;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
