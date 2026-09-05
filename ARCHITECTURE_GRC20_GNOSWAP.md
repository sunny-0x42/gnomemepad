# GRC20 + Gnoswap architecture (gnomemepad)

## Goal

- Every Create produces a **real GRC20** token.
- **padv14+**: curve raise is **WUGNOT** (user Deposit+Approve+Buy). Raised WUGNOT sits on pad.
- At **graduation**, remaining tokens + raised WUGNOT fund Gnoswap LP (**auto-list** when GNS fee available).
- CreatePool fee: pad GNS inventory or ExactOut surplus WUGNOT→GNS.
- Fallback: locked internal CPMM if list soft-fails (e.g. no GNS / thin fee swap).

## Token lifecycle

```
Create
  → grc20.NewToken + grc20reg.Register
  → no pre-mint

Buy / Sell (curve)
  → mint / burn GRC20

Graduate (threshold or sold-out)
  → remaining = TotalSupply - RealSold  (all unsold, not only PoolSeed)
  → raised = net curve collateral
  → try Gnoswap auto-list:
       need WUGNOT inventory on pad ≥ raised
       if GNS < poolCreationFee (100e6): ExactOut WUGNOT→GNS
       mint remaining GRC20 to pad
       CreatePool(wugnot, tokenKey, 3000, sqrtPriceX96)
       position.Mint full-range → NFT to pad (locked)
  → else internal CPMM reserves (PoolUgnot=raised, PoolToken=remaining)
  → later: RetryListGnoswap(id)  [padv13+: auto TransferFrom caller WUGNOT/GNS;
           wrap via wugnot.Deposit + Approve(pad); LP ugnot reimbursed]

Trade after list
  → Gnoswap router (pad SwapBuy/Sell disabled when GnoswapListed)
```

## Why WUGNOT inventory?

`gno.land/r/gnoland/wugnot.Deposit` uses `AssertOriginCall` — **realms cannot wrap** ugnot in a graduate tx.

### Automatic list pipeline (product)

Because the pad realm cannot call `Deposit`, full auto-list is implemented as:

1. Raised capital remains **ugnot on pad bank** (reimburse source).
2. UI / multi-msg (after last buy graduate, Graduate button, or List button):
   - `wugnot.Deposit` (EOA) for LP shortfall + optional fee budget  
   - `wugnot.Approve(pad)` (+ optional `gns.Approve`)  
   - `RetryListGnoswap` → TransferFrom → CreatePool + Mint  
3. On success: **LP WUGNOT reimbursed as ugnot** from pad; fee (GNS or ExactOut) is the real cost.

So ugnot→WUGNOT is automatic from the **user wallet as a temporary bridge**, not an illegal realm self-wrap.

### padv13 economics (Sapphire)

| Param | Value |
|-------|--------|
| GraduationThreshold | **10_000 GNOT** |
| VirtualUgnot0 | **3_500 GNOT** |
| VirtualToken0 | **1_073_000_191** |
| R_max (full curve) | ~**10_255 GNOT** (> threshold) |
| At grad (typical) | ~**795M** sold / ~**205M** LP tokens + **10k GNOT** |

### padv13+ auto-list (two paths)

**A. Protocol inventory (true auto at graduate)**  
1. EOA: `wugnot.Deposit` ≥ **10_000 GNOT** per expected listing  
2. Transfer WUGNOT → pad package address  
3. Transfer ≥ **100 GNS** → pad (CreatePool fee)  
4. When raise hits 10k → `listOnGnoswapWithFunding` succeeds without caller pull  

**B. Caller-funded (Token UI “List on Gnoswap”)**  
1. `wugnot.Deposit` + `Approve(pad)` for LP shortfall (+ fee budget if no GNS)  
2. `RetryListGnoswap` → TransferFrom → CreatePool+Mint  
3. LP WUGNOT pulled is **reimbursed in ugnot**; fee is not  

CreatePool fee is fixed **GNS**; GNOT cost moves with market. LP size stays = raised
(token side sized to curve spot for seamless graduate — see `graduate()` / `LeftoverTokens`).

### Multi-venue listing (future)

List path is Gnoswap-only today (`tryListOnGnoswap`). To add another DEX later
(e.g. ZDEX when live on the target chain):

- Keep seamless LP sizing in `graduate()` (pad-owned).
- Extract each DEX into a **list adapter** (`List(raised, liqTokens, tokenKey)`).
- Optional `ListVenue` registry so UI can pick venue without hardcoding imports in the pad monolith.

Pearl (2026-09): Gnoswap router/pool/position/GNS/WUGNOT are live; no alternate DEX packages found.  
Re-quote: `node scripts/probe-gns-price.mjs`

## Sapphire Gnoswap stack

| Role | Path |
|------|------|
| Router | `gno.land/r/gnoswap/router` |
| Pool | `gno.land/r/gnoswap/pool` |
| Position | `gno.land/r/gnoswap/position` |
| WUGNOT | `gno.land/r/gnoland/wugnot` (key `….wugnot.wugnot`) |
| GNS | `gno.land/r/gnoswap/gns` (key `….gns.GNS`) |
| App | https://beta.gnoswap.io |

Token keys for routes/pools: **registry keys** `pkg.SYMBOL`, not package path alone.

## Packages

| Piece | Path |
|-------|------|
| Pad source | `gno.land/r/gnomemepad/pad` |
| Sapphire deploy | `…/padv14` (WUGNOT curve + auto-list); legacy `…/padv13` ugnot curve |
| Stub (local tests) | `pad/gnoswap_list.gno` |
| Full list code | `deploy/templates/gnoswap_list_full.gno` |

## Deploy

```powershell
.\scripts\deploy-sapphire-v9.ps1
# then fund pad WUGNOT; set Netlify PKG to padv9 (or hub SetModule pad)
```

Testnet: **legacy pads not required** — hub `pad` → padv9 only.

## Admin UI

Nav **Admin** appears only when connected wallet equals `ProtocolAddress()` (Init caller)
or `SIGNER_ADDR` env. Console: claim/push protocol fees, free ugnot withdraw, points toggle,
treasury transfer, Gnoswap inventory checklist.
