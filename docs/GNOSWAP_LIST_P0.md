# Gnoswap list P0 fixes (2026-09-21)

Patched in source `gno.land/r/gnomemepad/pad` + `deploy/templates/gnoswap_list_full.gno`.

| ID | Fix |
|----|-----|
| **P0-1** | Create ugnot overpay → `sendUgnot` refund to creator (never `creditProtocol` / WUGNOT `protocolFees`) |
| **P0-2** | `payWugnotOut` panics if `freeWugnotOnPad() < amount`; `payoutProtocolFees` checks inventory before clearing `protocolFees` |
| **P0-3** | `tryListOnGnoswap` requires `BalanceOf >= reservedWugnot()` so launch A cannot Mint with launch B’s pool WUGNOT |

## Mainnet note

Shipped **2026-09-21**: `…/gnomi/padv3` addpkg + Init + hub `SetModule("pad", padv3)`. Legacy padv2 remains on-chain but unused by hub.

## Tests

`gno test ./gno.land/r/gnomemepad/pad/ ./gno.land/p/gnomemepad/ammmath/` — ok (2026-09-21).
