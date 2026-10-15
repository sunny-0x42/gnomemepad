const RPC = "https://rpc.sapphire.testnets.gno.land:443";
async function qeval(pkg, expr) {
  const data = pkg + "." + expr;
  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "abci_query",
    params: {
      path: "vm/qeval",
      data: Buffer.from(data).toString("base64"),
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
  if (!resp) return JSON.stringify(j).slice(0, 400);
  if (resp.Error || (resp.ResponseBase && resp.ResponseBase.Error)) {
    const err = resp.Error || resp.ResponseBase.Error;
    return "ERR " + JSON.stringify(err).slice(0, 300);
  }
  // value may be in Value or ResponseBase.Data
  let v = resp.Value || resp.value;
  if (!v && resp.ResponseBase?.Data) {
    return Buffer.from(resp.ResponseBase.Data, "base64").toString("utf8");
  }
  if (!v) return JSON.stringify(resp).slice(0, 400);
  return Buffer.from(v, "base64").toString("utf8");
}
(async () => {
  for (const fee of [100, 500, 3000, 10000]) {
    const route = `gno.land/r/gnoland/wugnot:gno.land/r/gnoswap/gns:${fee}`;
    const expr =
      "DrySwapRoute(" +
      [JSON.stringify("gno.land/r/gnoland/wugnot"), JSON.stringify("gno.land/r/gnoswap/gns"), JSON.stringify("100000000"), JSON.stringify("EXACT_IN"), JSON.stringify(route), JSON.stringify("100"), JSON.stringify("1")].join(",") +
      ")";
    console.log("wugnot->gns fee", fee, await qeval("gno.land/r/gnoswap/router", expr));
  }
  console.log("poolCreationFee", await qeval("gno.land/r/gnoswap/pool", "GetPoolCreationFee()"));
  console.log("poolCreationFee v1", await qeval("gno.land/r/gnoswap/pool/v1", "GetPoolCreationFee()"));
})();
