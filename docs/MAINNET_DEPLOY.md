# Mainnet deploy — `gnoland-1` dual-DEX `gnomi/*`

**Chain:** `gnoland-1`  
**RPC:** `https://rpc.onbloc.xyz:443` · also `https://rpc.gno.land:443` · gnoweb `https://gno.land`  
**Deploy gnokey:** `deploykey` → `g1n4pl5uc4yt5r96m9w6fmdznx3x0jyg8l6arhmt`  
**Hard gate:** no Netlify / hub flips without **human yes**.  
**GPAO:** post-genesis `MsgAddPackage` may **park** until the package-approvals oracle `EnablePackage`.

**Live (2026-09-18):** hub `GetModule("pad")` → **`…/gnomi/padv2`**. Snapshot: `docs/MAINNET_STATUS.md`.

---

## 1. On-chain inventory

| Package | Status |
|---------|--------|
| `gno.land/r/gnoland/wugnot` | Present |
| `gno.land/p/nt/grc20/v0` + `r/nt/grc20reg/v0` | **Present** (use these — not demo) |
| `gno.land/p/demo/tokens/grc20` | **Absent** |
| `gno.land/r/gnoswap/pool` | **LIVE** · `GetPoolCreationFee() = 100e6` (100 GNS) |
| `gno.land/r/gnoswap/router` | **LIVE** · `GetSwapFee() = 15` |
| `gno.land/p/gnoswap/{consts,uint256}/v1` | Present |
| `gno.land/p/g1n4pl5…/zdex/amm/v1` | **LIVE** |
| `gno.land/r/g1n4pl5…/zdex/v1` | Present (ExactIn / CreatePool EOA) |
| `gno.land/r/g1n4pl5…/gnomi/*` | **LIVE** |
| **`…/gnomi/padv2`** | **LIVE** — active pad (hub SetModule 2026-09-18) |
| `…/gnomi/pad` | Legacy — **GNOME 0000001 stuck**; do not route UI here |
| **`…/gnomi/ammmathv2`** | **LIVE** — MulDiv (k-overflow fix) |
| `…/gnomi/ammmath` | Legacy broken for large k |

---

## 2. Paths (namespace **`gnomi`**)

| Module | Path |
|--------|------|
| ammmath (**broken** for large k — immutable) | `gno.land/p/g1n4pl5…/gnomi/ammmath` |
| **ammmathv2** (MulDiv fix) | `gno.land/p/g1n4pl5…/gnomi/ammmathv2` |
| pad (GNOME 0000001 stuck here) | `gno.land/r/g1n4pl5…/gnomi/pad` |
| **padv2** (imports ammmathv2) — **active** | `gno.land/r/g1n4pl5…/gnomi/padv2` |
| hubv2 | `gno.land/r/g1n4pl5…/gnomi/hubv2` |
| bond | `gno.land/r/g1n4pl5…/gnomi/bond` |
| meta | `gno.land/r/g1n4pl5…/gnomi/meta` |
| pointsv2 | `gno.land/r/g1n4pl5…/gnomi/pointsv2` (import only; points **OFF**) |
| profile | optional / later |

### Economics (live padv2)

| Param | Value |
|-------|--------|
| `VirtualUgnot0` | `102_375_071_625` (~102_375 GNOT) |
| `VirtualToken0` | `1_073_000_191` (unchanged) |
| Max net raise `R` | **Exactly** `300_000 GNOT`: `R = VU0 × CurveSupply / (VT0 − CurveSupply)` |
| `GraduationThreshold` | **300_000 GNOT** (coincides with sold-out in ideal math) |
| Bond normal | **150 GNOT** (`SetNormalBond` / `CurrentBondUgnot`) |
| Create bond semantics | **Platform fee** (`creditBondFee` / `protocolBondFees`) — **not** refundable escrow |
| List fee GNS | **100 GNS** (match Gnoswap) |
| Default venue | **zdex** (+ **gnoswap** enabled) |
| Pad GRC20 reads | `BalanceOf` · `Allowance(id, owner, spender)` |

**Scale notes:** `VU0×VT0 ≈ 1.098×10²⁰` needs `ammmathv2.MulDiv` (curve + internal CPMM + graduate). At GT graduate, seamless `needed = raised×VT/VU ≈ 203.54M` but only `200M` unsold remain → LP uses all remaining (`Leftover=0`), pool open ≈ **+177 bps** vs curve exit. Floor drift on chunked buys can hit `CurveSupply` ~0.13 GNOT under GT (sold-out escape hatch).

---

## 3. Prepare + deploy (historical / next cut)

```powershell
# Upgrade cut (k-overflow fix) — already live as padv2:
node scripts/prepare-mainnet-padv2.mjs
# → deploy/mainnet-v1/…/ammmathv2 + …/padv2  (nt grc20, gnoswap /v1, full list)

# Full historical tree (does NOT overwrite live packages on-chain):
node scripts/prepare-mainnet-gnomi.mjs

.\scripts\deploy-mainnet-dualdex.ps1
# After ammmathv2+padv2 addpkg+Init: hub SetModule("pad", …/padv2) — DONE 2026-09-18.
# NOTE: GNOME 0000001 on old pad stays stuck; new creates go to padv2.
```

Rewrites applied by prepare:

- `p/demo/tokens/grc20` → `p/nt/grc20/v0`
- `r/demo/defi/grc20reg` → `r/nt/grc20reg/v0`
- `p/gnoswap/consts|uint256` → `…/v1`
- `gnoswap_list_full.gno` → pad `gnoswap_list.gno`

---

## 4. Post-Init checklist (padv2 — done)

1. ~~`Init` bond / pointsv2 / hub / meta / pad(v2)~~  
2. ~~Hub `SetModule` pad → **padv2** + bond/meta/points~~  
3. ~~`SetNormalBond(150e6)` · `SetGraduationThreshold(300e9)` · venues zdex+gnoswap~~  
4. qeval: `ParamsInfo`, `ListVenues`, `DefaultListVenue`, `ListFeeRequiredFor("zdex"|"gnoswap")`  
5. App flags / Netlify: human yes only (see `NETLIFY.md`)

Zdex EOA list + in-app ExactIn: hub `…/zdex/v1`; `pushToken` uses **RealmTeller** for pad GRC20.

---

## 5. App flags

| Env | Meaning |
|-----|---------|
| `MAINNET_PAD_READY=0` | Pad pending |
| `MAINNET_PAD_READY=1` | Unlock mainnet markets API |
| `DEFAULT_NETWORK=mainnet` | UI default |
| `VITE_SITE_UPGRADE=1` | Maintenance overlay (admin/protocol wallet bypass) |

Adena: chainId `gnoland-1`, RPC `https://rpc.onbloc.xyz:443`.
