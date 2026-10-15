# Design: Zdex as first mainnet list venue

**Status:** design only — no broadcast, no Zdex repo edits.  
**Audience:** parent / `gnomi-protocol` implementer.  
**Date:** 2026-09-15.

## On-chain facts (probed)

| Piece | Path / note |
|-------|-------------|
| AMM pure (mainnet live) | `gno.land/p/g1n4pl5uc4yt5r96m9w6fmdznx3x0jyg8l6arhmt/zdex/amm/v1` |
| Zdex hub (mainnet) | **Not deployed** under `r/g1n4pl5…/` yet. Packet target: `gno.land/r/g1n4pl5…/zdex/v1` (`deploy/mainnet` in Zdex repo) |
| Pearl reference hub | `gno.land/r/g1mv0052e7r6s09f5t9xsqf00nj3tqsgt9dg52jr/zdex/v2` |
| Gnoswap mainnet | Absent — stub OK |
| Pad mainnet namespace | `gno.land/r/g1n4pl5…/gnomi/pad` |

Source of truth for signatures: Zdex `gno.land/r/zdex/v2/pool.gno` + `deploy/mainnet/r-v1/pool.gno` (same API; mainnet uses `p/nt/grc20` + `r/nt/grc20reg/v0`).

---

## 1. Exact Zdex functions for graduation list

### Primary (seed pool = list)

```gno
// file: zdex …/pool.gno (v2 / mainnet r-v1)
func CreatePool(cur realm, tokenKey, symbol string, amountU, amountT, feeBps int64) string
```

| Arg | Pad meaning |
|-----|-------------|
| `tokenKey` | Adena / grc20reg key = `adenaKeyFromTokenID(l.TokenID, l.Symbol)` → `pkg.SYMBOL` |
| `symbol` | `l.Symbol` |
| `amountU` | `l.PoolUgnot` (raised, curve-spot LP ugnot) |
| `amountT` | `l.PoolToken` (curve-spot sized; leftover stays pad) |
| `feeBps` | `30` (default mid tier) or `0` to let Zdex pick default/`stable` |

Returns pool id: `ugnot|<SYMBOL>`.

**Caller must:**

1. Be **EOA** today: `require(Previous.IsUserCall(), "zdex: EOA only")`.
2. `OriginSend` **exact** `amountU` ugnot (`takeUgnot`).
3. Hold `amountT` tokens and have **approved Zdex realm** (spender = Zdex package address) so `grc20reg.TransferFrom` succeeds.
4. If caller ≠ Zdex admin: symbol must pass `requireListed` (`RequestListing` + admin `ApproveListing`), **or** admin creates the pool (auto-upserts listing).

**Do not use for pad graduate list:**

- `Launch(...)` — legacy one-sided launch; AGENTS: listing is `CreatePool` only.
- `SeedListedPool` — mints **internal** Zdex GRC20; pad tokens are external.
- `CreateTokenPool` — GRC20/GRC20, no ugnot quote.

### Secondary (post-list top-up only)

```gno
func AddLiquidity(cur realm, poolID string, amountU, maxToken, minLP int64) int64
```

Not needed for first graduation list — `CreatePool` already seeds both sides + min-liquidity lock. Keep for ops/UI later.

### Related (gate / inventory)

| Fn | File | Role |
|----|------|------|
| `RequestListing(cur, tokenKey, symbol, name, decimals, logoURI)` | `listing.gno` | 1 GNOT deposit; pending catalog |
| `ApproveListing(cur, symbol)` | `listing.gno` | Zdex owner |
| `SetFarm(cur, addr, on)` / `NotifyFarmPay(cur, amount)` | `admin.gno` | Realm prepaid ugnot for `takeUgnot` when Previous is a farm — **but CreatePool still EOA-gated** |
| `PoolInfo` / `PositionOf` | `pool.gno` | Confirm after list |
| `SwapExactIn` | `swap.gno` | Post-list trade (UI), not pad |

Pure AMM math import for pad is **not** required for list (Zdex hub owns CPMM). Pad keeps `ammmath` for curve.

---

## 2. Minimal adapter vs `gnoswap_list_full.gno`

### What Gnoswap full does (drop for Zdex)

- Imports: `gnoswap/pool`, `position`, `router`, `gns`, `wugnot`, `uint256`
- Fee asset: **GNS** (`GetPoolCreationFee`, escrow `ListFeeGns`)
- LP asset: **WUGNOT** Approve + `CreatePool` + `position.Mint` (CL, sqrtPrice, ticks)
- Sort token0/token1, under-deposit checks

### Zdex adapter sketch (`zdex_list.gno` + `case VenueZdex`)

```gno
const VenueZdex = "zdex"

// Fee asset: ugnot (OriginSend / farm prepaid) — NOT GNS.
// registerListVenue(VenueZdex, "Zdex", true, "ugnot")
// defaultListVenue = VenueZdex on mainnet cut

import (
  zdex "gno.land/r/g1n4pl5…/zdex/v1" // freeze path at deploy
  // NO gns, NO gnoswap/*
)

func tryListOnZdex(cur realm, l *Launch, raisedUgnot, remainingTokens int64) bool {
  // Soft-fail pattern like Gnoswap stub/full.
  // BLOCKED until Zdex allows realm/farm CreatePool OR we use EOA two-step (below).
}
```

**Preferred single-tx path (needs Zdex change — ask zdex-protocol):**

1. Zdex: allow `CreatePool` when `Previous` is `IsFarm(pad)` (same prepaid path as `takeUgnot`).
2. Zdex: skip or auto-`upsertApprovedListing` for farm callers (else every meme needs manual `ApproveListing`).
3. Pad `RetryList(id,"zdex")` EOA:
   - Ensure pad bank has **ugnot** ≥ `PoolUgnot` (see WUGNOT risk below), `RealmSend` → Zdex, `NotifyFarmPay`.
   - Mint `PoolToken` (+ leftover) to pad; `ledger.Approve(pad, zdexAddr, amountT)`.
   - `zdex.CreatePool(cross(cur), tokenKey, symbol, amountU, amountT, 30)`.
   - Set `l.GnoswapListed=true` (compat flag) or rename later; `l.ListVenue=VenueZdex`; `l.GnoswapPoolPath=poolID`.

**Fee asset:** **ugnot** only. Set `ListFeeGns=0` / skip GNS escrow when `PreferredVenue==zdex`. `FeeAssetHint="ugnot"`.

**Stub for local tests:** mirror `gnoswap_list.gno` — `testForceZdexList` sets pool path `ugnot|SYMBOL`, no imports.

---

## 3. Create-time preferred venue

**Field name:** `PreferredVenue string` on `Launch` (not `ListVenue` — that stays “venue that succeeded”).

| When | Behavior |
|------|----------|
| `Create` | New arg or trailing: `Create(cur, name, symbol, uri, venueId string)`; store `normalizeVenueID(venueId)` if enabled, else `DefaultListVenue()`. Emit in `Created`. |
| `RetryList(id, venueId)` | If `venueId==""` → use `l.PreferredVenue` if set, else `DefaultListVenue()`. If `venueId` non-empty → honor override (ops) **or** lock to Preferred only (stricter; recommend allow override for protocol). |
| `graduate` | Still **no** auto-list (keep Buy safe). Note string can say `RetryList preferred=<PreferredVenue>`. |
| Compat | `ListVenue` / `GnoswapListed` unchanged for indexers until a later rename pass. |

UI: venue picker on Create; Markets/Guide copy “lists to Zdex after graduate”.

---

## 4. Gas / surface lean for first mainnet cut

**ON (needed for Markets / Create / Portfolio / Creator / Guide / Admin):**

- `pad` (curve, graduate, internal CPMM, RetryList + **Zdex adapter**, stub Gnoswap)
- `hubv2` + `bond`
- `profile` (Creator / Portfolio headers)
- `meta` (token info — small; keep)
- `ammmath` pure
- `wugnot` / `grc20` / `grc20reg` (stdlib deps)

**OFF / stub / defer:**

| Piece | Why |
|-------|-----|
| `pointsv2` | Init OFF; no OnCreate/OnTrade wiring cost in UX |
| Full `gnoswap_list_full.gno` | No Gnoswap on mainnet; keep stub |
| GNS `ListFeeGns` escrow | Zdex fee = ugnot; set 0 when default=zdex |
| Zdex `Launch` / book / incentives / oracle | Not pad’s list path |
| Ambassador / activity heavy | Off-chain / later |
| Auto-list inside `graduate` | Keep off (revert risk) |
| Approach B `listrouter` | Defer |

Compile-time: mainnet prepare copies **zdex adapter** + **gnoswap stub**, not full Gnoswap template.

---

## 5. Open risks

1. **`CreatePool` is EOA-only** — pad cannot call it today. Farm prepaid exists for `takeUgnot` but CreatePool does not use it. **Needs Zdex vN** or awkward multi-tx EOA flow.
2. **`requireListed`** — non-admin CreatePool needs Zdex admin `ApproveListing` per symbol (or admin-created pools). High friction for permissionless memes unless farm path auto-lists.
3. **WUGNOT vs ugnot** — pad raise is WUGNOT; Zdex wants native `OriginSend` ugnot. Both `wugnot.Deposit` and `Withdraw` are `AssertOriginCall` → **pad cannot unwrap**. List tx needs EOA Withdraw bridge and/or pad ugnot bank funded separately + farm RealmSend.
4. **Zdex hub not on mainnet yet** — only AMM pure live. Pad list blocked until `…/zdex/v1` (or agreed path) lands.
5. **GRC20 Approve spender** — must be Zdex **realm address**, not deployer; pad-owned token Approve via `l.ledger.Approve`.
6. **Registry key** — `pkg.SYMBOL` must match `grc20reg` on mainnet (`r/nt/grc20reg/v0` in Zdex mainnet packet vs demo paths on Pearl).
7. **Symbol collision** — Zdex pool id `ugnot|SYMBOL` global; pad `bySymbol` is pad-local. Two pads / external listings can clash.
8. **LP ownership** — CreatePool credits LP to **caller**. If farm/pad is caller, pad owns LP (good lock). If EOA lists, LP sits on EOA unless transferred — product/security gap.
9. **Compat flags** — `GnoswapListed` / `GnoswapNote` / `ListFeeGns` naming will confuse UI until generalized (`Listed` / `ListNote` already partially exist).
10. **No broadcast / hub switch** without human yes; do not edit Zdex from this repo — file change request to `zdex-protocol`.

---

## Recommended sequence

1. Agree with Zdex: **farm-callable CreatePool** + auto-listing for farm + document mainnet hub path.
2. Deploy Zdex `v1` hub on `gnoland-1` (human yes on Zdex side).
3. Pad cut: `PreferredVenue`, `VenueZdex`, adapter, default venue zdex, GNS fee 0, gnoswap stub.
4. `gno test` + simulate RetryList; then human yes for pad addpkg / hub `SetModule`.
