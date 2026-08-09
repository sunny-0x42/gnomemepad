# gnomemepad

Self-contained **meme launchpad** for [gno.land](https://gno.land): bonding curve → permanently locked CPMM (no external AMM required for MVP).

Hybrid of **Pump.fun** (fair curve + graduation) and **Noxa Fun** (LP lock, no migration window), native to Gno.

## Features

- Permissionless create + fair launch (no pre-mint)
- Virtual CPMM bonding curve → atomic graduate → locked pool
- Creator / protocol fees, on-chain trade history for charts
- Local web UI: markets, price/MCap (GNOT), TradingView Lightweight chart, wallet connect, portfolio, creator hub

## Layout

```text
gno.land/p/gnomemepad/ammmath   # pure math
gno.land/r/gnomemepad/pad       # factory realm
web/                            # Node UI (no npm install)
scripts/                        # local + Topaz helpers
deploy/topaz/                   # generated personal-namespace deploy tree
```

## Local development

```powershell
# 1) Chain (Windows: use a path outside %USERPROFILE% if gnodev walk fails)
# Example: C:\dev\gnomemepad
gnodev local -no-examples -no-watch ...

# 2) UI
cd web
node server.mjs
# → http://127.0.0.1:5173
```

Quick start: double-click `start-ui.bat` (UI only) or:

```powershell
pwsh -File scripts\start-all.ps1
```

### Tests

```powershell
gno test ./gno.land/p/gnomemepad/ammmath/
gno test ./gno.land/r/gnomemepad/pad/
```

## Units

- Chain base unit: **ugnot**
- UI displays **GNOT** (1 GNOT = 1_000_000 ugnot)
- **Price** = GNOT per token  
- **Market cap (FDV)** = price × total supply (1B)

## Host UI on Netlify

Static markets UI + serverless read API (Sapphire). Signing stays local.

See **[NETLIFY.md](./NETLIFY.md)** — `netlify.toml` is ready; import the GitHub repo in Netlify or:

```powershell
npx netlify-cli login
npx netlify-cli init
npx netlify-cli deploy --prod
```

## Deploy (Sapphire testnet)

Target is **Gno.land Sapphire** (`sapphire-1`).  
(Oasis Sapphire is a different, EVM network — not used here.)

Personal deploy under:

`gno.land/r/g16p08xxtyt320hjju7769lzguxlvzszwpg8duwl/gnomemepad/pad`

See **[DEPLOY.md](./DEPLOY.md)** — you sign with your own `gnokey` (`mykey`).

```powershell
powershell -File scripts\prepare-sapphire-deploy.ps1
powershell -File scripts\deploy-sapphire.ps1   # interactive password
```

Point the UI at Sapphire after deploy:

```powershell
cd web
$env:RPC_URL = "https://rpc.sapphire.testnets.gno.land:443"
$env:CHAIN_ID = "sapphire-1"
$env:PKG = "gno.land/r/g16p08xxtyt320hjju7769lzguxlvzszwpg8duwl/gnomemepad/pad"
$env:GNOKEY_NAME = "mykey"
$env:SIGNER_ADDR = "g16p08xxtyt320hjju7769lzguxlvzszwpg8duwl"
node server.mjs
```

## Security

- Never commit seed phrases or keystore passwords
- Do not paste private keys into chat or CI
- Agent deploy tools use **agent keys**; **your** address requires **your** `gnokey` on your machine

## License

Add a license before public release (e.g. MIT / Apache-2.0).
