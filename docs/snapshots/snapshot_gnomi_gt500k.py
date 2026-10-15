"""Snapshot padv3 GNOMI holders with balance > 500_000 tokens."""
from __future__ import annotations

import base64
import json
import re
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

RPC = "https://rpc.gno.land:443"
INDEXER = "https://indexer.gno.land/graphql/query"
PAD = "gno.land/r/g1n4pl5uc4yt5r96m9w6fmdznx3x0jyg8l6arhmt/gnomi/padv3"
THRESHOLD_TOKENS = 500_000
G1 = re.compile(r"g1[0-9a-z]{38,}")
INT = re.compile(r"(-?\d+)\s+\w+\s*$")
STR = re.compile(r'^"(.*)"\s+string\s*$', re.S)


def rpc(method: str, params: dict, timeout: int = 45) -> dict:
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    req = urllib.request.Request(RPC, data=body, headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        payload = json.loads(resp.read().decode())
    if payload.get("error"):
        raise RuntimeError(str(payload["error"]))
    return payload.get("result") or {}


def qeval(expr: str) -> str:
    data = base64.b64encode(f"{PAD}.{expr}".encode()).decode()
    result = rpc("abci_query", {"path": "vm/qeval", "data": data, "height": "0", "prove": False})
    response = result.get("response") or result
    base = response.get("ResponseBase") or {}
    err = base.get("Error") or response.get("Error")
    blob = base.get("Data") or response.get("Data") or ""
    if err:
        raise RuntimeError(str(err))
    if isinstance(blob, str) and blob:
        try:
            text = base64.b64decode(blob).decode("utf-8", "replace")
        except Exception:
            text = blob
    else:
        text = ""
    t = text.strip()
    m = re.match(r"^\((.*)\)\s*$", t, re.S)
    return m.group(1).strip() if m else t


def qeval_int(expr: str) -> int:
    inner = qeval(expr)
    m = INT.search(inner)
    if m:
        return int(m.group(1))
    return int(inner) if inner.lstrip("-").isdigit() else 0


def qeval_str(expr: str) -> str:
    inner = qeval(expr)
    m = STR.match(inner)
    if m:
        return m.group(1).replace('\\"', '"')
    if inner.endswith(" string"):
        inner = inner[: -len(" string")].strip()
        if inner.startswith('"') and inner.endswith('"'):
            return inner[1:-1]
    return inner


def graphql(query: str) -> dict:
    body = json.dumps({"query": query}).encode()
    req = urllib.request.Request(
        INDEXER,
        data=body,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=180) as resp:
        payload = json.loads(resp.read().decode())
    if payload.get("errors"):
        raise RuntimeError(str(payload["errors"]))
    return payload.get("data") or {}


def collect_addrs(launch_id: str) -> set[str]:
    addrs: set[str] = set()
    try:
        buyers = qeval_str(f'ListBuyers("{launch_id}")')
        addrs.update(G1.findall(buyers))
    except Exception as e:
        print("ListBuyers", e)
    pkg = PAD.replace("\\", "\\\\").replace('"', '\\"')
    query = f"""
{{
  getTransactions(
    where: {{
      success: {{ eq: true }}
      messages: {{ value: {{ MsgCall: {{ pkg_path: {{ eq: "{pkg}" }} }} }} }}
    }}
  ) {{
    block_height
    messages {{
      value {{
        __typename
        ... on MsgCall {{
          caller
          pkg_path
          func
          args
        }}
      }}
    }}
    response {{
      events {{
        __typename
        ... on GnoEvent {{
          type
          pkg_path
          attrs {{ key value }}
        }}
      }}
    }}
  }}
}}
"""
    try:
        txs = graphql(query).get("getTransactions") or []
    except Exception as e:
        print("indexer", e)
        txs = []
    for tx in txs:
        for msg in tx.get("messages") or []:
            v = msg.get("value") or {}
            if v.get("__typename") != "MsgCall":
                continue
            if v.get("pkg_path") != PAD:
                continue
            args = list(v.get("args") or [])
            if args and args[0] != launch_id and args[0] != "GNOMI":
                # still keep caller if func is Buy/Sell/Transfer on this pad
                pass
            related = False
            if args and (args[0] == launch_id or args[0].upper() == "GNOMI"):
                related = True
            if related or v.get("func") in ("Buy", "Sell", "Transfer", "TransferFrom", "Graduate"):
                if related or (args and args[0] == launch_id):
                    related = True
            if args and args[0] == launch_id:
                related = True
            if not related:
                continue
            caller = v.get("caller") or ""
            if G1.fullmatch(caller):
                addrs.add(caller)
            for a in args:
                addrs.update(G1.findall(str(a)))
        for ev in ((tx.get("response") or {}).get("events")) or []:
            for attr in ev.get("attrs") or []:
                addrs.update(G1.findall(str(attr.get("value") or "")))
    return addrs


def main() -> None:
    launch_id = qeval_str('ResolveSymbol("GNOMI")')
    if not launch_id:
        raise SystemExit("ResolveSymbol(GNOMI) empty")
    info = qeval_str(f'LaunchInfo("{launch_id}")')
    parts = info.split("|")
    symbol = parts[2] if len(parts) > 2 else "GNOMI"
    token_id = parts[15] if len(parts) > 15 else ""
    print("id", launch_id, "symbol", symbol, "token_id", token_id)
    print("LaunchInfo", info[:400])

    # padv3 BalanceOf / RealSold are whole GNOMI (not * 10^6).
    decimals = 0
    threshold_raw = THRESHOLD_TOKENS
    addrs = collect_addrs(launch_id)
    print("candidate addresses", len(addrs))

    balances: dict[str, int] = {}

    def one(addr: str) -> tuple[str, int | None]:
        try:
            n = qeval_int(f'BalanceOf("{launch_id}","{addr}")')
            return addr, n
        except Exception:
            return addr, None

    with ThreadPoolExecutor(max_workers=8) as pool:
        futs = [pool.submit(one, a) for a in sorted(addrs)]
        for fut in as_completed(futs):
            addr, bal = fut.result()
            if bal is not None:
                balances[addr] = bal

    holders = []
    for addr, raw in sorted(balances.items(), key=lambda kv: kv[1], reverse=True):
        tokens = raw / (10**decimals)
        if tokens > THRESHOLD_TOKENS:
            holders.append(
                {
                    "address": addr,
                    "raw": raw,
                    "gnomi": round(tokens, 6),
                }
            )

    height = 0
    try:
        sync = rpc("status", {}).get("sync_info") or {}
        height = int(sync.get("latest_block_height") or 0)
    except Exception:
        pass

    out = {
        "snapshot_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "chain_id": "gnoland-1",
        "height": height,
        "pad": PAD,
        "launch_id": launch_id,
        "symbol": symbol,
        "token_id": token_id,
        "decimals": decimals,
        "threshold_gnomi": THRESHOLD_TOKENS,
        "threshold_raw": threshold_raw,
        "candidates_queried": len(addrs),
        "balances_ok": len(balances),
        "holders_gt_threshold": len(holders),
        "note": "Balances via padv3.BalanceOf(launch_id, addr) treated as whole GNOMI. Candidates from ListBuyers (cap 100) + indexer MsgCall/events on the pad. Transfer-only holders never seen by indexer may be omitted.",
        "holders": holders,
    }

    dest = Path(__file__).resolve().parent
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%MZ")
    json_path = dest / f"gnomi-holders-gt500000-{stamp}.json"
    csv_path = dest / f"gnomi-holders-gt500000-{stamp}.csv"
    json_path.write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8")
    lines = ["rank,address,gnomi,raw"]
    for i, h in enumerate(holders, 1):
        lines.append(f"{i},{h['address']},{h['gnomi']},{h['raw']}")
    csv_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("wrote", json_path)
    print("wrote", csv_path)
    print("holders", len(holders))
    for h in holders[:20]:
        print(h["gnomi"], h["address"])


if __name__ == "__main__":
    t0 = time.time()
    main()
    print("elapsed_s", round(time.time() - t0, 1))
