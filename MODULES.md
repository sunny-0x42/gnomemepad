# Modular architecture (hub + profile + pad)

## Why

Pad packages (`padv2`…`padv4`) are immutable on-chain. Upgrading a monolith means a new path and loses seamless continuity. Modules split concerns so **profile / social / config** can change without redeploying trade markets.

## Packages (Sapphire)

| Module | Path | Role |
|--------|------|------|
| **hub** | `…/gnomemepad/hub` | Module registry: `SetModule` / `GetModule` / `ListModules` |
| **profile** | `…/gnomemepad/profile` | User cards: `SetProfile` / `GetProfile` |
| **pad** | `…/gnomemepad/padv4` | Launch + trade (registered as hub key `pad`) |

## Deploy

```powershell
cd C:\Users\Hi\gnomemepad
.\scripts\deploy-sapphire-modules.ps1
```

Script: addpkg hub + profile → Init → `SetModule(pad, padv4)` + `SetModule(profile, …)`.

## UI

- `/api/health` returns `hub`, `modules`, resolved `pkg` (from hub `pad`)
- `/api/modules` — full map
- `/api/profile?address=g1…` — read profile
- Nav **Profile** → Adena `SetProfile` on profile realm

## Upgrade playbook

| Change | Action |
|--------|--------|
| Profile fields | Deploy `profilev2`, hub `SetModule("profile", newPath)` |
| Trade/security | Deploy `padv5`, hub `SetModule("pad", newPath)` |
| Markets on old pad | Keep path; register `legacy_*` on hub — UI aggregates all |

## Phase 3C / 3D / 3F

| Piece | What |
|-------|------|
| **3C Activity** | `/api/activity`, home feed, CSV trade export |
| **3D padv5** | Stricter bond/graduate/anti-snipe/history — `deploy-sapphire-v5.ps1` |
| **3F hubv2** | Multi-admin hub — `deploy-sapphire-hubv2.ps1` |
| **Ops** | `/api/ops` + `scripts/ops-health.ps1` |

See `DEPLOY_V5.md`.

## Meta + Points (Phase 3A / 3B)

| Module | Path | Role |
|--------|------|------|
| **meta** | `…/gnomemepad/meta` | Token description, image, socials (first writer owns) |
| **points** | `…/gnomemepad/points` | Referral, check-in, leaderboard |

```powershell
.\scripts\deploy-sapphire-meta-points.ps1
```

UI: token page **Token info** + **Rewards** nav.

## Profile in UI (Phase 2C)

- Cache `/api/profile?address=` client-side
- Market cards + token page show creator **name** (if set) + short addr + gnoweb link
- Portfolio / Creator headers show own profile + CTA to set profile
- Badge `P` when profile exists

## Multi-pad markets (Phase 2A)

- `/api/markets` scans hub `pad` + every `legacy*` / `pad*` module key
- Each market carries `pkg`, `legacy`, `padLabel`
- Trade / claim fees use that market’s `pkg`; **Create** always uses active `pad`
- `/api/market/:id?pkg=…` and `/api/balance?pkg=…` for disambiguation

Hub admin = deploy key after Init. Rotate with `TransferAdmin`.
