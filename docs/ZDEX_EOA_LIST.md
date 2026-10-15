# Zdex EOA list path — UI helpers

**Status:** UI libs live (`web/ui/src/lib/zdex.js` + Token branch).  
**Date:** 2026-09-18.

## Hub / router

| Network | Hub | RealmAddr (Approve spender) | Router |
|---------|-----|------------------------------|--------|
| Mainnet | Hub `gno.land/r/g1n4pl5…/zdex/v1` · AMM `…/p/…/zdex/amm/v1` | RealmAddr from hub | **None** — `SwapExactIn` / `SwapRouteExactIn` on hub |
| Pearl | Hub `gno.land/r/g1n4pl5…/zdex/v3` · AMM `…/p/…/zdex/amm/v1` | `g1dme66padjqu5smytfcl2lq0ame7zymducpdrdu` | **None** — same pattern |

## Exact CreatePool arg mapping (pad Launch → Zdex)

```text
CreatePool(cur, tokenKey, symbol, amountU, amountT, feeBps) string
```

| Arg | Pad Launch / market field | Notes |
|-----|---------------------------|-------|
| `tokenKey` | `adenaKeyFromTokenID(l.TokenID, l.Symbol)` → `pkg.SYMBOL` | Never Token.ID with `.seq` |
| `symbol` | `l.Symbol` | Must match grc20reg symbol |
| `amountU` | `l.PoolUgnot` | Raised / curve-spot LP ugnot; **min 1e6** (1 GNOT); OriginSend exact |
| `amountT` | `l.PoolToken` | Curve-spot sized; leftover stays pad accounting |
| `feeBps` | `30` default | Or `0` → hub default (30 mid / 1 stable). Tiers: 1/5/30/100 |

Returns pool id: `ugnot|SYMBOL`.

## Token.jsx branch

| Venue | Path |
|-------|------|
| **zdex** | EOA: optional `wugnot.Withdraw(amountU)` → `pad.Approve(id, realmAddr, amountT)` → `CreatePool` + `send=amountU ugnot`. Prefer `ReleaseListSeed` + `ConfirmZdexList` on dual-DEX pads (`padv2` / Pearl `gnomi/pad`). |
| **gnoswap** | Existing: Transfer WUGNOT(+GNS) → pad → `RetryList` / `RetryListGnoswap`. |

### Post-list trade (in-app)

- **zdex ExactIn** on Token page: hub `SwapExactIn` (minOut=0 until a Netlify zdex quote exists). Optional `pad.Allowance` / `Approve` before sell.
- **Gnoswap ExactIn:** router messages (unchanged).

### `pushToken` / RealmTeller

Zdex hub must move pad-registered GRC20 with **`RealmTeller`**, not `CallerTeller` — otherwise the previous frame is the EOA and TransferFrom/Transfer from the realm fails for pad tokens.

## Pad surface (mainnet `padv2` / Pearl `gnomi/pad`)

| API | Role |
|-----|------|
| `ReleaseListSeed` | Hand LP seed to creator for EOA CreatePool |
| `ConfirmZdexList` | Mark listed after pool id known |
| `Allowance(id, owner, spender)` | Read GRC20 allowance for ExactIn Approve UX |
| `RetryList(id,"zdex")` | Soft-fail stub → use EOA path above |

Legacy Pearl `padv23` (gnoswap-only) has **no** VenueZdex / Confirm path — UI Pearl points at `gnomi/pad`.

## JS surface

- `web/ui/src/lib/zdex.js` — pkg paths, `createPoolArgsFromLaunch`, `buildCreatePoolMsgs` / `buildZdexCreatePoolCall`, Withdraw / RequestListing helpers, `buildSwapExactInMsgs`, checklist notes.
- Token page: listed zdex → in-app ExactIn; listed gnoswap → router ExactIn.
