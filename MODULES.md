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
| Markets on old pad | Keep path; UI multi-pad later via `legacy_*` keys |

Hub admin = deploy key after Init. Rotate with `TransferAdmin`.
