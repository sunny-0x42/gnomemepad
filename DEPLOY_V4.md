# Deploy V4 — security fixes

Package:

```
gno.land/r/g1mv0052e7r6s09f5t9xsqf00nj3tqsgt9dg52jr/gnomemepad/padv4
```

## Changes vs padv3

| Fix | Detail |
|-----|--------|
| Slippage | `Buy/SwapBuy(id, minTokensOut)`, `Sell/SwapSell(id, tokens, minUgnotOut)` — `0` = off |
| No dust buy | Oversized curve buy **panics** (no silent residual GNOT) |
| Anti-snipe | Cumulative tokens **per address** in first 20 heights |
| Bond refund | Also requires `RaisedUgnot ≥ 5 GNOT` |
| Unexport ledger | `Launch.token` / `ledger` private |
| TransferFrom | On-pad allowance spend for DEX |
| TransferProtocol | Rotate protocol fee recipient |

## Deploy

```powershell
cd C:\Users\Hi\gnomemepad
.\scripts\deploy-sapphire-v4.ps1
```

Then Netlify already points `PKG=.../padv4` after this repo update.
