const RPC="https://rpc.sapphire.testnets.gno.land:443";
async function qeval(pkg, expr){
  const data=pkg+"."+expr;
  const body={jsonrpc:"2.0",id:1,method:"abci_query",params:{path:"vm/qeval",data:Buffer.from(data).toString("base64"),prove:false}};
  const r=await fetch(RPC,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
  const j=await r.json();
  const resp=j?.result?.response;
  if(!resp) return JSON.stringify(j).slice(0,400);
  if(resp.Error||(resp.ResponseBase&&resp.ResponseBase.Error)) return "ERR "+JSON.stringify(resp.Error||resp.ResponseBase.Error).slice(0,400);
  let v=resp.Value||resp.value;
  if(!v&&resp.ResponseBase&&resp.ResponseBase.Data) return Buffer.from(resp.ResponseBase.Data,"base64").toString("utf8");
  if(!v) return JSON.stringify(resp).slice(0,400);
  return Buffer.from(v,"base64").toString("utf8");
}
(async()=>{
  const w="gno.land/r/gnoland/wugnot.wugnot";
  const g="gno.land/r/gnoswap/gns.GNS";
  const route=w+":"+g+":3000";
  const cases=[
    ["EXACT_IN","50000000","1"],
    ["EXACT_OUT","100000000","200000000"],
  ];
  for (const [st,amt,lim] of cases){
    const expr="DrySwapRoute("+JSON.stringify(w)+","+JSON.stringify(g)+","+JSON.stringify(amt)+","+JSON.stringify(st)+","+JSON.stringify(route)+","+JSON.stringify("100")+","+JSON.stringify(lim)+")";
    console.log(st,amt, await qeval("gno.land/r/gnoswap/router", expr));
  }
  for (const inp of ["ugnot", w, "gno.land/r/gnoland/wugnot"]) {
    const expr="DrySwapRoute("+JSON.stringify(inp)+","+JSON.stringify(g)+","+JSON.stringify("50000000")+","+JSON.stringify("EXACT_IN")+","+JSON.stringify(route)+","+JSON.stringify("100")+","+JSON.stringify("1")+")";
    console.log("in",inp, await qeval("gno.land/r/gnoswap/router", expr));
  }
})();
