# Deploy UI to Netlify

React (Vite) frontend (`web/ui`) + serverless functions for **read** APIs.
Production: **https://gnomi.fun** (site `gnomemepad-sapphire`).

**Network posture:** **Mainnet only** (`gnoland-1`). Sapphire/Pearl hidden (`SHOW_PEARL=0` / `SHOW_TESTNETS=0`).
Pad: **`MAINNET_PAD_READY=1`** — dual-DEX `…/gnomi/pad` live (see `docs/MAINNET_DEPLOY.md`).

## Continuous deploy (collaborators)

Pushes / merges to **`master`** that touch `web/**` or `netlify.toml` trigger
[`.github/workflows/netlify-deploy.yml`](.github/workflows/netlify-deploy.yml).

| Event | Result |
|---|---|
| Push to `master` | Production deploy → gnomi.fun |
| Pull request | Draft Netlify preview + PR comment |
| Actions → “Deploy Netlify” → Run workflow | Manual prod/preview |

**Required GitHub Actions secrets** (already set on `sunny-0x42/gnomemepad`):

| Secret | Value |
|---|---|
| `NETLIFY_AUTH_TOKEN` | Netlify personal access token |
| `NETLIFY_SITE_ID` | `a64de89a-8ba0-49a2-a38e-1cea76b81996` |

## What works on Netlify

| Feature | Netlify |
|---|---|
| Markets / params / charts | Yes (after `MAINNET_PAD_READY=1`) |
| Portfolio / creator | Yes |
| **Create / Buy / Sell / Claim** | **Yes — via Adena browser wallet** |

1. Install [Adena](https://adena.app/)
2. Switch Adena to **Gno Mainnet** (`gnoland-1` / OnBloc RPC) when prompted
3. Open the site → **Connect wallet** → **Adena Wallet**
4. Create / trade — approve each tx in Adena

## Build settings (`netlify.toml`)

- Build: `npm run build --prefix web/ui`
- Publish: `web/ui/dist`
- Functions: `web/netlify/functions`

### Env vars (mainnet)

| Variable | Default |
|---|---|
| `DEFAULT_NETWORK` | `mainnet` |
| `MAINNET_CHAIN_ID` | `gnoland-1` |
| `MAINNET_RPC_URL` | `https://rpc.onbloc.xyz:443` |
| `MAINNET_PKG` / `HUB` / … | `…/gnomi/pad` dual-DEX tree |
| `MAINNET_PAD_READY` | `1` (unlocked) |
| `MAINNET_SIGNER` | `g1n4pl5…` |
| `SNAPSHOT_NETWORKS` | `mainnet` |

## Manual CLI deploy

```powershell
cd C:\Users\Hi\gnomemepad
npx netlify-cli login
npx netlify-cli link   # site: gnomemepad-sapphire
npm run build --prefix web/ui
npx netlify-cli deploy --prod
```

## Local

```powershell
# API (mainnet RPC; pad pending until MAINNET_PAD_READY=1)
$env:DEFAULT_NETWORK='mainnet'; node web/api-dev.mjs

# UI
cd web/ui; npm run dev
# http://localhost:5174/
```
