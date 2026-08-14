# Backend (private)

The **API / serverless backend** for gnomemepad is **not** part of this public repository.

| Private repo | https://github.com/sunny-0x42/gnomemepad-backend |
| Local paths (gitignored) | `web/lib/`, `web/server.mjs`, `web/api-dev.mjs`, `web/netlify/functions/` |

## Why private?

Product differentiation for the production API layer. **On-chain Gno packages** remain fully transparent on Gno.land.

## For maintainers

1. Clone or pull `gnomemepad-backend` into the matching paths under `web/`, **or** keep your existing local files (they stay on disk; only untracked by git).  
2. Deploy Netlify with functions from your private backend tree.  
3. Never force-push backend secrets into this public repo.

## Public surface

- On-chain realms / pure packages under `gno.land/` and `deploy/`  
- Frontend under `web/ui/` (when committed)  
- Scripts, docs, Netlify static config  
