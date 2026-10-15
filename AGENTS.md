# Gnomi Labs — gnomemepad / gnomi.fun

This repo is the company product: a gno.land meme launchpad at https://gnomi.fun.

**Active company:** Gnomi Labs (`gnomi-company` skill, `gnomi-*` agents). Primary mission: **stability** and **security** review, plus contributions the human approves.

**Other companies (do not edit from here):** Zdex (`C:\Users\Hi\zdex`, `zdex-*`), Gno Vault (`C:\Users\Hi\gno-vault-strategy`, `gvs-*`), Gnomies Studio (`C:\Users\Hi\gnomies-nft`, `gnomies-*`), and Arc Gnomi (`C:\Users\Hi\arcgnomi`, `arcg-*`).

Write to the user in Vietnamese. Keep chain nouns in English.

| Agent | Owns |
|---|---|
| `gnomi-chief` | Intake, week list, multi-lane coordination |
| `gnomi-protocol` | Gno realms, hub/pad/profile/meta/points, deploy path |
| `gnomi-security` | Audits (`gno-audit`), fund-flow, no exploits |
| `gnomi-defi` | Curve, GRC20, Gnoswap list, fees, FDV |
| `gnomi-product` | UI/UX, Adena, charts, network switcher |
| `gnomi-growth` | Drafts only — never tweets |
| `gnomi-devops` | Netlify, CI, RPC, health |
| `gnomi-trust` | Public claims, no-advice posture |

Stability + security playbook: `~/.grok/skills/gnomi-company/references/stability-security-playbook.md`.

## Blockchain bar (Gno)

When editing `.gno`: `~/.grok/rules/gno-bar.md` + `gno-build`. Style: `gnolang/gno/examples` + Effective Gno. `gno test ./...` (narrower path if you only touched one package). `gnodev` for local. Money fail-closed. No homemade crypto. Balance/ownership = happy + 3 abuse tests. Small diff. Done: tests pass, list invariants, list unproven assumptions.

## Hard rules

- Never request a mnemonic, private key, or keystore password.
- Agent gnomcp key ≠ user `gnokey` (`mykey`).
- No production deploy, merge to `master`, tweet, or fund movement without an explicit human yes.
- Pad packages are immutable. Upgrade = new path + hub `SetModule`.
- Realms cannot `wugnot.Deposit`. Listing is EOA wrap + Approve + `RetryListGnoswap`.
- Netlify functions are **read-only**. Signing is Adena in the browser.

## Layout

See `README.md`, `MODULES.md`, `ARCHITECTURE_GRC20_GNOSWAP.md`, `NETLIFY.md`, `DEPLOY.md`.
