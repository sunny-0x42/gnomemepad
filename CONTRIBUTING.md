# Contributing / local development

## Layout

```text
gno.land/p/gnomemepad/ammmath   # pure curve/AMM math
gno.land/r/gnomemepad/pad       # launchpad realm
web/                            # local UI (Node, no npm deps)
scripts/                        # local + Topaz deploy helpers
deploy/topaz/                   # generated deploy tree (user address paths)
```

## Local

```powershell
# Terminal A — chain (prefer C:\dev\gnomemepad on Windows)
gnodev local -no-examples -no-watch ...

# Terminal B — UI
cd web
node server.mjs
# http://127.0.0.1:5173
```

Or: `start-ui.bat` / `scripts/start-all.ps1`

## Tests

```powershell
gno test ./gno.land/p/gnomemepad/ammmath/
gno test ./gno.land/r/gnomemepad/pad/
```

## Deploy

See [DEPLOY.md](./DEPLOY.md). Personal-namespace deploys must be signed with **your** `gnokey`.

## Security

- Never commit seed phrases, keystore passwords, or `.env` with secrets.
- Do not paste private keys into chat or CI logs.
