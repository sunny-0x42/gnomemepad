# Gnoswap logo standardization (gnomemepad)

## Goal

Every token created on gnomemepad should be able to show its logo on **Gnoswap / Adena** without manual copy-paste.

Gnoswap **does not** read memepad `uri` / meta. Logos load only from:

[onbloc/gno-token-resource](https://github.com/onbloc/gno-token-resource)  
→ `grc20/sapphire-1.json` + SVG under `grc20/images/`.

## Canonical standard (all new tokens)

| Field | Value |
|--------|--------|
| `token_path` | Adena key `packagePath.SYMBOL` (e.g. `…/padv22.JAE`) — **never** `.0000001` seq |
| `pkg_path` | Pad package path |
| `decimals` | **0** (pad GRC20 whole tokens) |
| `chain_id` | `sapphire-1` |
| `image` | `/grc20/images/<path_slug>.svg` (relative, SVG only) |
| Memepad icon | https/ipfs on `Create.uri` + `SetMeta.imageURI` (source art for SVG) |

## Pipeline

```
Create / SetMeta / ListGnoswap
        │
        ▼
POST /api/token-resource/register   (queue one token)
        │
        ▼
GET  /api/token-resource            (plan: missing vs upstream)
GET  /api/token-resource/logo       (live SVG preview for our CDN)
        │
        ▼
GitHub Action: sync-token-resource  (every 6h + manual)
        │  uses TOKEN_RESOURCE_GITHUB_TOKEN + TOKEN_RESOURCE_FORK
        ▼
PR → onbloc/gno-token-resource
        │
        ▼
Merge + Gnoswap indexer refresh → logoURI on beta.gnoswap.io
```

## API

| Endpoint | Purpose |
|----------|---------|
| `GET /api/token-resource` | Registration plan (status per token) |
| `GET /api/token-resource?format=grc20` | Array of entries only |
| `GET /api/token-resource/logo?pkg=&id=` | Generated SVG (image embed or initials) |
| `POST /api/token-resource/register?id=&pkg=` | Queue / open PR path (if Netlify has GH token) |
| `GET /api/token-resource/spec` | Spec constants |

## Enable auto-PR (required for unattended logos)

**Hướng dẫn chi tiết (GitHub UI, PAT, secrets, troubleshooting):**  
→ [GITHUB_SETUP.md](./GITHUB_SETUP.md)

### Tóm tắt nhanh

### 1. Fork upstream once

```bash
gh repo fork onbloc/gno-token-resource --clone=false
```

### 2. GitHub repo secrets (`sunny-0x42/gnomemepad`)

| Secret | Value |
|--------|--------|
| `TOKEN_RESOURCE_GITHUB_TOKEN` | PAT with `repo` (push fork + open PR) |
| `TOKEN_RESOURCE_FORK` | `sunny-0x42/gno-token-resource` |

Optional Netlify env (if you want API-side PR too):

- `TOKEN_RESOURCE_GITHUB_TOKEN`
- `TOKEN_RESOURCE_FORK`
- `TOKEN_RESOURCE_SYNC_SECRET` (protect `/sync`)

### 3. Run

- **Actions** → “Sync token-resource (Gnoswap logos)” → Run workflow  
- Or schedule: every 6 hours  
- Local dry-run:

```bash
node scripts/sync-token-resource.mjs --dry
```

## Local assets (one-off padv22)

See `docs/token-resource/images/` and `entries-only.json` for the first three tokens (JAE / GNOMIES / TARDI).

## Code map

- `web/lib/token-resource.mjs` — schema, SVG, plan, GitHub PR
- `web/lib/chain-api.mjs` — HTTP routes
- `scripts/sync-token-resource.mjs` — CLI / CI entry
- `.github/workflows/sync-token-resource.yml` — schedule
- Create / Token UI queues register on create, list, meta save
