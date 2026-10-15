# Dual-DEX readiness — zdex + Gnoswap

**Date:** 2026-09-18  
**Mainnet:** dual-DEX pad **live** at `g1n4pl5…/gnomi/padv2` (hub `SetModule` pad→padv2). Math: `ammmathv2`.  
**Pearl:** dual-DEX at `g1n4pl5…/gnomi/pad` (hub wired). Legacy `padv23` under `g1mv0052…` unused by UI.  
**Source:** `gno.land/r/gnomemepad/pad/`.  
**No Netlify / no further hub flips without human yes.** Snapshot: `docs/MAINNET_STATUS.md`.

---

## Source API surface (this cut)

| API | Role |
|-----|------|
| `PreferredVenue` field + `PreferredVenueOf(id)` | Create-time / set target DEX |
| `CreateWithVenue(cur, name, symbol, uri, venueId)` | Create + preferred in one MsgCall |
| `Create(...)` | Compat wrapper → `CreateWithVenue(..., "")` → `DefaultListVenue()` |
| `SetPreferredVenue(cur, id, venueId)` | Creator/protocol; syncs GNS escrow |
| `ListFeeRequired()` | Global Gnoswap Create fee (100 GNS default) |
| `ListFeeRequiredFor(venueId)` | **zdex → 0**; **gnoswap → ListFeeRequired** |
| `VenueZdex` + `tryListOnZdex` | Registered + stub (EOA CreatePool guidance) |
| `VenueGnoswap` + `RetryList` / `RetryListGnoswap` | Unchanged list path (enable via `SetListVenue`) |
| `ReleaseListSeed(cur, id)` | Creator/protocol: mint `PoolToken` GRC20 + Transfer `PoolUgnot` WUGNOT → **creator** |
| `ConfirmZdexList(cur, id, poolId)` | Creator/protocol: mark `ListVenue=zdex`, `GnoswapListed=true`, `GnoswapPoolPath=poolId` |
| `ListSeedReleasedOf(id)` | Query flag after ReleaseListSeed |
| `Allowance(id, owner, spender)` | Pad GRC20 allowance (Approve / ExactIn prep) |
| `DefaultListVenue()` | Default = **`zdex`** |

### Create fee behavior

- `PreferredVenue == "gnoswap"` → `lockListFeeEscrow(ListFeeRequired)` (fail-closed if free GNS short).
- `PreferredVenue == "zdex"` (or other non-gnoswap) → `lockListFeeEscrow(0)` / skip GNS.
- `SetPreferredVenue` syncs escrow: zdex→gnoswap locks; gnoswap→zdex unlocks + refunds GNS to creator.
- Create **bond** is a **platform fee** (`creditBondFee` / `protocolBondFees`), not list-venue escrow — see `docs/BOND_AND_RAISE.md`.

### ReleaseListSeed mechanics

1. Require graduated, not listed, not already released; caller = creator or protocol.
2. Set `ListSeedReleased=true` (drops `reservedWugnot` for this pool).
3. `payWugnotOut(creator, PoolUgnot)` + `Mint` `PoolToken` GRC20 to creator.
4. Keep `PoolUgnot`/`PoolToken` as **record** for UI / Confirm.
5. Disables `SwapBuy`/`SwapSell` and `RetryList` until Confirm (or forever if abandoned).

EOA then: optional `wugnot.Withdraw` → `Approve(zdex RealmAddr)` → hub `CreatePool` + OriginSend ugnot.

### ConfirmZdexList semantics

- Require graduated, not listed; poolId **non-empty** (no on-chain pool verify).
- If pad still holds LP seed (`!ListSeedReleased && Pool* > 0`) → panic `ReleaseListSeed first`.
- Sets `ListVenue=zdex`, `GnoswapListed=true` (compat), `GnoswapPoolPath=poolId`, note + events `ConfirmZdexList` / `ListedRetry`.

### Zdex RetryList stub

`RetryList(id,"zdex")` soft-fails with note pointing to ReleaseListSeed → EOA CreatePool → ConfirmZdexList.  
`testForceZdexList` unit-test force path only.

---

## Live Mainnet (`gnomi/padv2`) — GO (qeval 2026-09-18)

| Item | Live `g1n4pl5…/gnomi/padv2` |
|------|-----------------------------|
| Hub `GetModule("pad")` | `…/gnomi/padv2` |
| Math | `ammmathv2` MulDiv |
| `DefaultListVenue` | **zdex** |
| `ListVenues` | `zdex` + `gnoswap` both enabled |
| Raise | **300_000 GNOT** |
| Bond `CurrentBondUgnot` | **150 GNOT** (platform fee) |
| Zdex hub | `…/zdex/v1` · ExactIn in-app on Token page |
| Legacy `…/gnomi/pad` | GNOME 0000001 stuck; not hub-active |

---

## Live Pearl (`gnomi/pad`) — dual-DEX GO (qeval 2026-09-17)

| Item | Live `g1n4pl5…/gnomi/pad` |
|------|-------------|
| Hub `GetModule("pad")` | `…/gnomi/pad` (+ bond/profile/meta/points) |
| `DefaultListVenue` | **zdex** |
| `ListVenues` | `zdex` + `gnoswap` both enabled |
| `ListFeeRequiredFor` | zdex **0** · gnoswap **100e6** |
| PreferredVenue / CreateWithVenue / ReleaseListSeed / ConfirmZdexList | **Present** |
| Bond `CurrentBondUgnot` | **100 GNOT** (Pearl) |
| Zdex hub | `…/zdex/v3` · RealmAddr `g1dme66…` · CreatePool EOA |

Legacy `…/gnomemepad/padv23` still on chain (gnoswap-only) — not used by current Pearl UI.

---

## GO / NO-GO after source cut (when deployed)

| Step | zdex | Gnoswap |
|------|------|---------|
| Create preferred + fee | **GO** (`CreateWithVenue` / fee-by-venue) | **GO** |
| Graduate | **GO** (no auto-list) | **GO** |
| List | **PARTIAL** — ReleaseListSeed + EOA CreatePool + Confirm; may need Zdex `ApproveListing` unless admin | **GO** (RetryList + inventory) |
| Mark listed | **GO** (`ConfirmZdexList`) | **GO** |
| Post-list trade | **GO** — in-app hub `SwapExactIn` (Token page) | **GO** — router ExactIn |
| Pad realm CreatePool | **NO-GO** (EOA-only on Zdex) | N/A (pad calls Gnoswap) |

**zdex `pushToken`:** must use **RealmTeller** for pad-registered GRC20 (CallerTeller resolves EOA incorrectly).

---

## Invariants kept

- Money-path fail-closed (`panic` on bad caller / empty pool / double release / empty poolId).
- Graduate never auto-lists (Buy-safe).
- Realm never `wugnot.Deposit` / `Withdraw`.
- Gnoswap `RetryList` path unchanged when venue enabled.
- `ListSeedReleased` excluded from `reservedWugnot` / `reservedUgnot`.
- Create bond = platform fee (not creator refund).

## Assumptions not proven

- End-to-end Adena: ReleaseListSeed → Withdraw → CreatePool → Confirm on every network.
- Zdex admin `ApproveListing` SLA for permissionless memes.
- Local Adena vs gnodev: UnauthorizedError is a known client mismatch; gnokey E2E is the verified path.

## Related

- `docs/MAINNET_STATUS.md`
- `docs/MAINNET_DEPLOY.md`
- `docs/ZDEX_EOA_LIST.md`
- `docs/ZDEX_LIST_VENUE_DESIGN.md`
- `docs/BOND_AND_RAISE.md`
