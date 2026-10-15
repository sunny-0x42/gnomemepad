/** Audit holders + volume: on-chain ListBuyers/BalanceOf vs API. */
const RPC = process.env.RPC_URL || "https://rpc.sapphire.testnets.gno.land:443";
const PKG =
  process.env.PKG ||
  "gno.land/r/g1mv0052e7r6s09f5t9xsqf00nj3tqsgt9dg52jr/gnomemepad/padv22";
const API = (process.env.API_BASE || "https://gnomemepad-sapphire.netlify.app").replace(/\/$/, "");
const UGNOT = 1e6;

async function rpc(method, params) {
  const r = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = await r.json();
  if (j.error) throw new Error(JSON.stringify(j.error));
  return j.result;
}

async function qeval(expr) {
  const data = Buffer.from(expr, "utf8").toString("base64");
  const result = await rpc("abci_query", {
    path: "vm/qeval",
    data,
    height: "0",
    prove: false,
  });
  const rb = result?.response?.ResponseBase;
  if (rb?.Error) {
    throw new Error(typeof rb.Error === "string" ? rb.Error : JSON.stringify(rb.Error));
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

async function main() {
  const idsRaw = await qeval(`${PKG}.ListIDs()`);
  const ids = String(idsRaw)
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  const act = await fetch(`${API}/api/activity?limit=80`).then((r) => r.json());
  const markets = await fetch(`${API}/api/markets?refresh=1`).then((r) => r.json());

  const report = [];
  for (const id of ids) {
    const info = String(await qeval(`${PKG}.LaunchInfo(${JSON.stringify(id)})`));
    const p = info.split("|");
    const symbol = p[2];
    const buyers = Number(p[6]);
    const sold = Number(p[5]);
    const listed = p[17] === "1";

    let buyersRaw = "";
    try {
      buyersRaw = String(await qeval(`${PKG}.ListBuyers(${JSON.stringify(id)})`));
    } catch (e) {
      buyersRaw = `ERR ${e.message}`;
    }
    const addrs = buyersRaw
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => /^g1[a-z0-9]+$/i.test(s));

    const bals = [];
    let sumBal = 0;
    for (const a of addrs) {
      try {
        const bal = Number(
          await qeval(
            `${PKG}.BalanceOf(${JSON.stringify(id)}, ${JSON.stringify(a)})`,
          ),
        );
        bals.push({ address: a, balance: bal });
        if (bal > 0) sumBal += bal;
      } catch (e) {
        bals.push({ address: a, error: String(e.message || e) });
      }
    }

    const detail = await fetch(
      `${API}/api/market/${encodeURIComponent(id)}?pkg=${encodeURIComponent(PKG)}`,
    ).then((r) => r.json());

    // activity volume for this token
    let actVol = 0;
    let actN = 0;
    for (const e of act.events || []) {
      if (e.id !== id || Number(e.side) === 2) continue;
      actVol += Number(e.volumeGnot) || 0;
      actN += 1;
    }

    const apiM = (markets.markets || []).find((m) => m.id === id);

    report.push({
      id,
      symbol,
      listed,
      onchain: {
        buyers,
        sold,
        listBuyersAddrs: addrs.length,
        listBuyersWithBal: bals.filter((b) => b.balance > 0).length,
        sumBalanceOf: sumBal,
        soldVsSum: { sold, sumBal, gap: sold - sumBal },
        bals: bals.map((b) => ({
          a: (b.address || "").slice(0, 14),
          bal: b.balance,
          err: b.error,
        })),
      },
      api: {
        buyers: apiM?.buyers,
        holders: (detail.holders || []).length,
        holdersCapped: detail.holdersCapped,
        tradeStatsVol: detail.tradeStats?.volumeGnot,
        tradeStatsTx: detail.tradeStats?.trades,
        chartSources: detail.chartSources,
        activityVol: actVol,
        activityTx: actN,
      },
    });
  }

  console.log(JSON.stringify({ pkg: PKG, report }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
