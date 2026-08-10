# Phase P1 + pointsv2 / padv6

## What ships

| Piece | Role |
|-------|------|
| **pointsv2** | Referral + check-in + **trade/create points** (pad allowlist only) |
| **padv6** | Same economics as padv5 + optional `pointsv2.OnTrade` / `OnCreate` hooks |
| **UI Ops** | `/api/ops` dashboard in the app |
| **Trade intel** | Almost-graduate toasts, Gnoswap checklist, rewards v2 params |

## Deploy order (Sapphire)

```powershell
cd C:\Users\Hi\gnomemepad

# 1) pointsv2
.\scripts\deploy-sapphire-pointsv2.ps1

# 2) padv6 (registers pad + legacy_padv5, AllowPad)
.\scripts\deploy-sapphire-v6.ps1 -EnablePoints

# 3) Point Netlify PKG / hub already hubv2 — pad resolves via hub SetModule
```

After deploy:

- Hub key `points` → `…/pointsv2`
- Hub key `pad` → `…/padv6`
- Hub key `legacy_padv5` → previous active pad

## Points model (v2)

| Action | Award |
|--------|--------|
| Set referrer | +50 referrer / +25 referee |
| Check-in | +5 / ~100 heights |
| Create (via pad) | +30 creator |
| Buy | +2 + 10×GNOT notional |
| Sell | +1 + 3×GNOT notional |
| Cap | 200 trade pts / user / height |

Only **allowlisted pad packages** may call `OnTrade` / `OnCreate`. EOAs cannot self-award.

## Pad toggle

```text
padv6.SetPointsEnabled(true)   # protocol admin
pointsv2.AllowPad("<padv6 path>")
```

If points is enabled but pad is not allowed, **trades panic** — always AllowPad first.

## UI (no chain deploy)

- Nav **Ops** → module health from `/api/ops`
- Rewards shows v2 trade/create params when hub points path is pointsv2
- Home toasts when a raising market hits ≥80% graduation
