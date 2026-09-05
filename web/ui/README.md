# gnomemepad React UI

Vite + React SPA. Backend reads stay on `web/lib/chain-api.mjs` (Netlify function).

## Local

```bash
# terminal 1 — API (Sapphire via env or defaults)
set RPC_URL=https://rpc.sapphire.testnets.gno.land:443
set CHAIN_ID=sapphire-1
set PKG=gno.land/r/g1mv0052e7r6s09f5t9xsqf00nj3tqsgt9dg52jr/gnomemepad/padv7
set SIGNER_ADDR=g1mv0052e7r6s09f5t9xsqf00nj3tqsgt9dg52jr
node web/api-dev.mjs

# terminal 2 — UI
cd web/ui
npm run dev
# http://127.0.0.1:5174  (proxies /api → :8787)
```

## Build

```bash
cd web/ui && npm run build
# → dist/  (Netlify publish)
```

## Admin

Tab **Admin** only when connected wallet === `SIGNER_ADDR` (deploy key).
