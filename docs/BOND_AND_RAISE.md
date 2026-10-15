# Bond fee + graduation raise (pad)

## Create bond = platform fee

As of the fee cut (source `memepad.gno` · live mainnet **`…/gnomi/padv2`**):

| | Old (legacy `…/gnomi/pad`) | New (`padv2`+) |
|--|---------------------------|----------------|
| On Create | Escrow `BondUgnot` on launch | **`creditBondFee(bond)`** → **`protocolBondFees`** immediately |
| Refund to creator | Yes if ≥5 buyers + raise ≥5 GNOT within height window | **Never** |
| At Graduate | Unrefunded bond → protocol | No-op (already fee’d) |
| Claim | — | Protocol `ClaimProtocolFees` / `PushProtocolFees` |

Events: `BondFee` + `Created.bondFee`.

Bond **amount** still comes from bond realm `CurrentBondUgnot()` (Admin `SetNormalBond`).

**Mainnet live (2026-09-18):** bond normal **150 GNOT**. Create fee is **not** refundable escrow.

## Changing raise (`SetGraduationThreshold`)

`graduationUgnot` is a **single live pad param** (not per-launch).

| Launch state | Effect of changing threshold |
|--------------|------------------------------|
| **StatusCurve** (still raising) | **Affected.** `Buy` caps raise to new threshold; `readyToGraduate` uses new value. Lowering can make almost-full launches graduate on next Buy; raising can push graduation further out. |
| **StatusGraduated** / listed | **Not affected.** `PoolUgnot` / `PoolToken` / list venue already fixed at Graduate. |
| Virtual curve shape (`VirtualUgnot0` / `VirtualToken0`) | **Baked at Create** into each launch. Changing consts requires a **new pad package**; existing launches keep their virtuals. |

Comment in code: *Changing graduation mid-flight affects ALL StatusCurve launches.*

**Mainnet raise:** **300_000 GNOT** on `padv2` (needs `ammmathv2` MulDiv at VU0 ≈ 102k).

## Legacy note

Live mainnet `…/gnomi/pad` (pre-padv2) may still have old escrow/refund behavior. Hub routes new traffic to **padv2**. **GNOME 0000001** on the old pad stays stuck.
