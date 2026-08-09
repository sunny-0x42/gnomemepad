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

## Why not auto-create Gnoswap pools in-realm yet

- Gnoswap concentrated-liquidity APIs and realm paths differ by network.
- Sapphire testnet may not host a stable Gnoswap deployment for every pair type.
- Permissionless listing is already the official Gnoswap model; deep-link + Token.ID is sufficient for MVP.

## Redeploy note

Existing Sapphire pad packages with internal-only balances **cannot** be upgraded in place.
Ship a new package path (e.g. `.../pad/v2`) with this GRC20 model, then point `PKG` / Netlify env to it.

## Key code

| Piece | Path |
|---|---|
| Pad realm | `gno.land/r/gnomemepad/pad` |
| GRC20 lib (local vendor / on-chain demo) | `gno.land/p/demo/tokens/grc20` |
| LaunchInfo extras | `tokenID\|gnoswapReady` fields |
