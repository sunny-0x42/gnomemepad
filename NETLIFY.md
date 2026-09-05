# Deploy UI to Netlify

React (Vite) frontend (`web/ui`) + serverless functions for **read** APIs against **Gno Pearl** (`pearl-1` / `padv23`).
Production: **https://gnomi.fun** (site `gnomemepad-sapphire`).

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

Collaborators (`nhatphamcdn`, …) only need **write** on the repo — they do **not** need Netlify login.
Merge (or push) to `master` → Actions builds → Netlify updates.

## What works on Netlify

| Feature | Netlify |
|---|---|
| Markets / params / charts | Yes |
| Portfolio / creator | Yes |
| **Create / Buy / Sell / Claim** | **Yes — via Adena browser wallet** |

1. Install [Adena](https://adena.app/)
2. Switch Adena network to **Pearl** (`pearl-1`) when prompted
3. Open the site → **Connect wallet** → **Adena Wallet**
4. Create / trade — approve each tx in Adena

## Build settings (`netlify.toml`)

- Build: `npm run build --prefix web/ui`
- Publish: `web/ui/dist`
- Functions: `web/netlify/functions`

### Env vars (override in Netlify Dashboard if needed)

| Variable | Default (Pearl) |
|---|---|
| `RPC_URL` | `https://rpc.pearl.testnets.gno.land:443` |
| `CHAIN_ID` | `pearl-1` |
| `PKG` | `…/padv23` |
| `HUB` / `PROFILE` / `META` / `POINTS` / `BOND` | matching Pearl paths |
| `SIGNER_ADDR` | deploy wallet `g1mv0052…` |

Sapphire archives: `web/.env.sapphire.example` (local only).

## Manual CLI deploy

```powershell
cd C:\Users\Hi\gnomemepad
npx netlify-cli login
npx netlify-cli link   # site: gnomemepad-sapphire
npm run build --prefix web/ui
npx netlify-cli deploy --prod
```

## Local Netlify emulator

```powershell
npx netlify-cli dev
```
