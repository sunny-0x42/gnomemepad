# Mainnet status — gnomi.fun (2026-09-18)

**Chain:** `gnoland-1` · Deployer `g1n4pl5uc4yt5r96m9w6fmdznx3x0jyg8l6arhmt`  
**Live pad:** `gno.land/r/g1n4pl5…/gnomi/padv2` · hub `SetModule("pad")` → **padv2**  
**Math:** `gno.land/p/g1n4pl5…/gnomi/ammmathv2` (MulDiv — fixes k overflow at VU0 ≈ 102k GNOT / raise 300k)

## Economics (qeval)

| Param | Live |
|-------|------|
| Raise (`GraduationThreshold`) | **300_000 GNOT** |
| Bond normal (`CurrentBondUgnot`) | **150 GNOT** |
| Default venue | **zdex** |
| Venues | **zdex** + **gnoswap** (both enabled) |
| List fee | zdex **0** · gnoswap **100 GNS** |

## Create bond = platform fee

Not refundable escrow. On Create, bank ugnot is booked via `creditBondFee` → `protocolBondFees`. Protocol claims with `ClaimProtocolFees` / `PushProtocolFees`. See `docs/BOND_AND_RAISE.md`.

## Pad GRC20 helpers

- `BalanceOf(id, owner)`
- `Allowance(id, owner, spender)` — GRC20 allowance keyed by launch id (same semantics as wugnot/gns)

## Legacy

| Package | Note |
|---------|------|
| `…/gnomi/pad` + old `ammmath` | Still on chain; **GNOME 0000001 stuck** (k overflow / broken large raise). New creates go to **padv2**. |
| `…/gnomi/ammmath` | Immutable; do not use for new pads |

## UI / ops notes

| Topic | Fact |
|-------|------|
| GNOT USD | GNOT CEX-listed (KuCoin / Kraken from ~2026-09-16). UI uses **Gnoswap prices API** (`priceGradeType=ORACLE` for ugnot). **No hardcoded / fake $235.** Env `GNOT_USD` pin only if intentionally set. |
| Maintenance overlay | `VITE_SITE_UPGRADE=1` → public users see non-dismissible overlay; **admin / protocol wallet can bypass** after Connect. |
| Local Adena | `UnauthorizedError` on local gnodev is a **known** signing/network mismatch (prefer Adena built-in Local · `http://127.0.0.1:26657` · `chainId=dev`). **gnokey E2E verified** on the same chain. |
| zdex ExactIn | In-app on Token page after zdex list (`SwapExactIn` on hub). |
| zdex `pushToken` | Uses **RealmTeller** so pad-registered GRC20 transfers work from the zdex realm (CallerTeller would resolve EOA incorrectly). |

## Related

- Deploy runbook: `docs/MAINNET_DEPLOY.md`
- Dual-DEX: `docs/DUAL_DEX_READINESS.md`
- Bond / raise: `docs/BOND_AND_RAISE.md`
- Zdex EOA list: `docs/ZDEX_EOA_LIST.md`
