# Pearl (pearl-1) deploy — gnomemepad padv23

Pearl is Gno.land’s current testnet (Test16). **No Sapphire state carries over.**

## Network

| Item | Value |
|------|--------|
| Chain ID | `pearl-1` |
| RPC | `https://rpc.pearl.testnets.gno.land:443` |
| Gnoweb | `https://pearl.testnets.gno.land` |
| Faucet | `https://pearl.testnets.gno.land/faucet` |

## Defaults (adjustable by deploy wallet)

| Param | Default | Admin call |
|-------|---------|------------|
| Raise (`GraduationThreshold`) | **10_000 GNOT** | pad `SetGraduationThreshold(ugnot)` |
| Create bond | **100 GNOT** | bond `SetNormalBond(ugnot)` |
| List fee GNS | **100 GNS** | pad `SetListFeeGns(gnsBaseUnits)` |

Admin UI (protocol wallet): **Admin → Set raise target / Create bond policy**.

**Multisig:** not on-pad. One `protocolAddr` / bond `admin`. Use shared custody off-chain if needed.

## Toolchain

Pearl needs a **chain-matched `gnokey`** (tag `chain/pearl` / commit `c4c72fdd`). An older
`gnokey` can sign `MsgSend` but fail `MsgAddPackage` with opaque
`signature verification failed; verify correct account, sequence, and chain-id`.

```powershell
# install once
$store = "$env:USERPROFILE\.cache\gno-toolchains\pearl"
New-Item -ItemType Directory -Force -Path $store | Out-Null
$env:GOBIN = $store
go install github.com/gnolang/gno/gno.land/cmd/gnokey@c4c72fdd288c757e8da0d93aae867fa479b1b15c
# put $store first on PATH (or copy over C:\Users\Hi\tools\gnokey.exe)
```

On Windows, pipe passwords with **LF only** (`Write($pass + "`n")`), not `WriteLine`
(CRLF makes `invalid account password`).

## Gnoswap on Pearl (gate OPEN — checked 2026-09-05)

Gnoswap **is live** on `pearl-1` (height ~213k). Probe results:

| Check | Result |
|-------|--------|
| `gno.land/r/gnoswap/router` (+ `/v1`) | present; `GetSwapFee()` = **15** |
| `gno.land/r/gnoswap/pool` (+ `/v1`) | present; `GetPoolCreationFee()` = **100e6** (100 GNS) |
| `gno.land/r/gnoswap/position` | present (Mint path) |
| `gno.land/r/gnoswap/gns` | present; `TotalSupply()` ok |
| `gno.land/r/gnoland/wugnot` | present |
| `gno.land/p/gnoswap/*` | consts, uint256, version_manager, … |
| Other DEX (`zdex`, demo AMM) | **not** on Pearl |

Approve spender addresses are **deterministic from package path** (same as Sapphire):

| Realm | Address |
|-------|---------|
| pool | `g1dexaf6aqkkyr9yfy9d5up69lsn7ra80af34g5v` |
| router | `g1vc883gshu5z7ytk5cdynhc8c2dh67pdp4cszkp` |

`padv23` can `addpkg` now (imports resolve). Prefer the **seamless graduate** source (LP sized to curve spot) before deploy.

## Deploy order

1. Faucet fund deploy key (`https://faucet.gno.land` → Pearl / or `https://faucet.pearl.testnets.gno.land`).
2. Supporting realms if missing: `ammmathv2`, `bond`, `meta`, `points(v2)`, `profile`, `hubv2` (Pearl remote/chain-id + Pearl gnokey).
3. Deploy pad:

```powershell
# prepare tree (copies seamless list template)
.\scripts\prepare-pearl-v23.ps1 -Address g1mv0052e7r6s09f5t9xsqf00nj3tqsgt9dg52jr

# deploy (requires Pearl-matched gnokey + funded key + .env.deploy)
.\scripts\deploy-pearl-v23.ps1
```

4. After Init: confirm

```text
padv23.ParamsInfo()           # grad = 10000000000 (10k GNOT)
bond.BondInfo() / SetNormalBond(100000000)
hubv2.GetModule("pad")        # → …/padv23
```

5. Point Netlify / local env at Pearl (`.env.pearl.example`).

### Already on Pearl (deploy wallet `g1mv0052…`)

| Package | Path |
|---------|------|
| profile | `…/gnomemepad/profile` |
| hubv2 | `…/gnomemepad/hubv2` |
| bond | `…/gnomemepad/bond` (normal = 100 GNOT) |
| meta | `…/gnomemepad/meta` |
| pointsv2 | `…/gnomemepad/pointsv2` |
| ammmathv2 | `…/gnomemepad/ammmathv2` |
| **padv23** | **LIVE** (height ~213875, Init + hub SetModule `pad`) |

Verified 2026-09-05:

- `ParamsInfo` → raise **10_000 GNOT**, bond **100 GNOT**, list fee **100 GNS**
- `DefaultListVenue` → `gnoswap`; `ListVenues` → `gnoswap|Gnoswap|1|GNS`
- Hub modules include `pad|…/padv23`

**Production Netlify** → Pearl `padv23` (`netlify.toml` + site env).  
Local: `copy web\.env.pearl.example web\.env.pearl` then `node --env-file=web/.env.pearl web/api-dev.mjs`.  
Sapphire local: `web/.env.sapphire.example`.

## Multi-DEX listing (ListVenue — Approach A)

Pad ships a **venue registry** + compile-time dispatch (Gno cannot `import(path)` dynamically):

| API | Role |
|-----|------|
| `ListVenues()` | `id\|label\|enabled\|feeHint` lines |
| `DefaultListVenue()` / `SetDefaultListVenue` | protocol default |
| `SetListVenue(id, label, enabled, feeHint)` | protocol metadata |
| `RetryList(id, venueId)` | list; empty venue → default |
| `RetryListGnoswap(id)` | compat → `RetryList(..., "gnoswap")` |
| `ListNeed` / `ListNeedFor(id, venue)` | funding wizard |

Only **`gnoswap`** has an adapter today (`tryListOnGnoswap`). Unknown/disabled venues soft-fail with a note.

**Add a 2nd DEX later:** new `case` in `tryListVenue` + adapter file → new pad version.  
**True hot-plug without pad redeploy:** follow-up Approach B (`listrouter` realm).  

Pearl still has **no** alternate DEX packages — ship Gnoswap-only.

## Changing params after deploy

| Change | Who | Function | Arg |
|--------|-----|----------|-----|
| Raise target | Protocol (Init wallet) | `SetGraduationThreshold` | ugnot (`GNOT * 1e6`) |
| List fee | Protocol | `SetListFeeGns` | GNS base (`GNS * 1e6`) |
| Bond | Bond admin | `SetNormalBond` | ugnot |
| Bond promo | Bond admin | `StartPromo` / `SetPromoBond` / `EndPromo` | see bond realm |

**Warning:** changing graduation while curve launches are open updates remaining-raise / ready-to-graduate for those markets.

## Local UI against Pearl

```powershell
copy web\.env.pearl.example web\.env.pearl
# edit PKG/HUB/… after deploy
node --env-file=web/.env.pearl web/api-dev.mjs
cd web/ui ; npm run dev
```
