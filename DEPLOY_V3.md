# Deploy V3 — GRC20 + grc20reg (Adena-compatible)

## Why V3

Adena **only** resolves custom GRC20 tokens via the on-chain registry:

`gno.land/r/demo/defi/grc20reg`

Looking up a path that is not registered always shows **Invalid path** (same message as a malformed path).

`padv2` created GRC20 tokens but **never called** `grc20reg.Register`, so wallet import could not work.

`padv3` registers every token on `Create`:

```gno
token, ledger := grc20.NewToken(...)
regKey := grc20reg.Register(cross(cur), token, symbol) // packagePath.SYMBOL
```

## Package

```
gno.land/r/g1mv0052e7r6s09f5t9xsqf00nj3tqsgt9dg52jr/gnomemepad/padv3
```

## Deploy

```powershell
cd C:\Users\Hi\gnomemepad
.\scripts\deploy-sapphire-v3.ps1
```

Then point UI:

- `netlify.toml` → `PKG=.../padv3`
- `scripts/start-ui-sapphire.ps1` → same

## Adena path after Create

```
gno.land/r/g1mv0052e7r6s09f5t9xsqf00nj3tqsgt9dg52jr/gnomemepad/padv3.YOURSYMBOL
```

Not the full `Token.ID` (`…SYMBOL.0000001`).

## Notes

- Old `padv2` markets stay on-chain but cannot be registered retroactively without a padv2 code change.
- Create new tokens on **padv3** for Adena display.
