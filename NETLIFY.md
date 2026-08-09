# Deploy UI to Netlify

Static frontend (`web/public`) + serverless function for **read** APIs (markets, portfolio, charts) against **Gno Sapphire**.

## What works on Netlify

| Feature | Netlify |
|---|---|
| Markets / params / charts | Yes |
| Portfolio / creator (view) | Yes (paste any `g1…`) |
| Create / Buy / Sell / Claim | **No** — needs `gnokey` on your machine |

Txs: use local UI (`scripts/start-ui-sapphire.ps1`) or CLI. Browser wallet (Adena) can be added later.

## One-time setup

1. Account: https://app.netlify.com  
2. Repo: https://github.com/sunny-0x42/gnomemepad (or your fork)  
3. **Add new site → Import from Git** → pick `gnomemepad`  
4. Build settings (already in `netlify.toml`):
   - Publish directory: `web/public`
   - Functions directory: `web/netlify/functions`
5. Deploy

### Env vars (optional; defaults in `netlify.toml`)

| Variable | Default (Sapphire deploy) |
|---|---|
| `RPC_URL` | `https://rpc.sapphire.testnets.gno.land:443` |
| `CHAIN_ID` | `sapphire-1` |
| `PKG` | `gno.land/r/g1mv0052e7r6s09f5t9xsqf00nj3tqsgt9dg52jr/gnomemepad/pad` |
| `SIGNER_ADDR` | `g1mv0052e7r6s09f5t9xsqf00nj3tqsgt9dg52jr` |

## CLI deploy

```powershell
cd C:\Users\Hi\gnomemepad
npx netlify-cli login
npx netlify-cli init     # link site once
npx netlify-cli deploy --prod
```

Draft preview:

```powershell
npx netlify-cli deploy
```

## Local Netlify emulator

```powershell
npx netlify-cli dev
```

Opens UI + `/api/*` like production.

## After deploy

Open `https://<site>.netlify.app` → should show Sapphire height + markets.  
Create coins: still via local/CLI against the same `PKG`.
