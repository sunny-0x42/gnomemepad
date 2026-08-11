# GRC20 + Gnoswap architecture (gnomemepad)

## Goal

- Every Create produces a **real GRC20** token (not only an internal AVL balance map).
- After **graduation**, the token is **listable on Gnoswap** (permissionless pool).
- Pad keeps a **locked internal CPMM** for continuous trading without external DEX.

## Token lifecycle

```
Create
  → grc20.NewToken(name, symbol, decimals=0, seq, cur)
  → Token.ID = <padPkg>.<SYMBOL>.<seq>
  → no pre-mint

Buy (curve / pool)
  → mint GRC20 to buyer (pad PrivateLedger)

Sell (curve / pool)
  → burn GRC20 from seller

Transfer / Approve
  → GRC20 ledger ops (DEX-friendly)

Graduate
  → locked pad CPMM seeded from curve raised + PoolSeed
  → GnoswapReady = true
  → event Graduated{token, gnoswap_ready}

Gnoswap (external)
  → create GNOT/token pool + add liquidity (community/creator)
  → optional: register token metadata on gno-token-resource
```

## Sapphire live Gnoswap stack (verified qpaths)

| Role | Path |
|------|------|
| Router (proxy) | `gno.land/r/gnoswap/router` |
| Router impl | `gno.land/r/gnoswap/router/v1` |
| Pool factory (proxy) | `gno.land/r/gnoswap/pool` |
| Pool impl | `gno.land/r/gnoswap/pool/v1` |
| Position / LP | `gno.land/r/gnoswap/position` (+ `/v1`) |
| WUGNOT | `gno.land/r/gnoland/wugnot` |
| App | https://beta.gnoswap.io |

### Router usage (swaps)

- `ExactInSwapRoute(inputToken, outputToken, amountIn, routeArr, quoteArr, amountOutMin, deadline, referrer)`
- Native GNOT: `inputToken` / `outputToken` = `"ugnot"`, but **route strings must use** `gno.land/r/gnoland/wugnot`
- Route single-hop: `gno.land/r/gnoland/wugnot:<tokenPkg>:3000`
- Quote: `DrySwapRoute(...)` on router (read-only)

### Pool listing (after pad graduate)

1. Token must be GRC20-registered (`grc20reg` on Create — padv3+)
2. `CreatePool(token0, token1, fee, sqrtPriceX96)` on pool — **~100 GNS fee**
3. Fee tiers: 100 / 500 / 3000 / 10000 (meme default **3000 = 0.3%**)
4. `position.Mint` to seed concentrated liquidity
5. Trade via router

### Why pad does not auto-CreatePool yet

- Needs GNS for creation fee + dual-sided LP mint (GNOT + meme) with tick range / sqrtPriceX96
- Griefing risk on arbitrary initial price (Gnoswap docs)
- Pad keeps its own locked CPMM after graduate; Gnoswap is a **second venue**
- UI deep-links + `/api/gnoswap` probe are the integration layer until a dedicated `ListOnGnoswap` helper realm is designed

### padv8 + Gnoswap

- padv8: last-buy curve clamp/refund (finish curve UX)
- Gnoswap wiring: GRC20 path = pad package path; Adena key = `pkg.SYMBOL`
- Hub `pad` → padv8; listing still external via pool/router above

## Redeploy note

Existing Sapphire pad packages with internal-only balances **cannot** be upgraded in place.
Ship a new package path (e.g. `.../pad/v2`) with this GRC20 model, then point `PKG` / Netlify env to it.

## Key code

| Piece | Path |
|---|---|
| Pad realm | `gno.land/r/gnomemepad/pad` |
| GRC20 lib (local vendor / on-chain demo) | `gno.land/p/demo/tokens/grc20` |
| LaunchInfo extras | `tokenID\|gnoswapReady` fields |
