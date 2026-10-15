# Achievement badges (pools.xyz-inspired)

**Scope:** UI + API compute only — no new realm, no NFT mint.  
**Surfaces:** Markets cards (≤2 wear), Token detail (full), Profile (creator + trader).  
**Redesign (2026-09):** Token/Creator lean on **volume (sampled)**, **buyers**, **raised**, **FDV mark** (gated), graduate/list — vanity launch-count factory badges removed.

## Rules

- Badges from pad stats — discretionary recognition, **not** investment advice / APR / guaranteed value.
- Tokens wear up to **2** badges on discovery; full set on token page.
- **Buyers ≠ holders** (GRC20). **Volume = sampled** activity window. **FDV = spot×1B** (can be virtual early via VirtualUgnot0) — dual-gated with raised/grad.
- Season 0 badges remain separate (`/rewards`).

## Token badges

| Icon | ID | Title | When |
|------|-----|-------|------|
| 🦄 | `tok_listed` | DEX Listed | Gnoswap listed |
| 🎓 | `tok_grad` | Graduated | status graduated |
| 📈 | `tok_fdv_l` | FDV Mark 40k | mcap≥40k **and** (grad / raised≥7k / listed) |
| 🌊 | `tok_vol_l` | Volume Wave | sampled vol ≥ 1 000 GNOT |
| 🏛️ | `tok_buyers_l` | 50 Buyers | buyers ≥ 50 |
| ⚓ | `tok_raise_half` | Half Raise | raised ≥ 5 000 GNOT |
| 📊 | `tok_fdv_m` | FDV Mark 15k | mcap≥15k **and** raised≥2 500 |
| 💧 | `tok_vol_m` | Volume Flow | sampled vol ≥ 250 |
| 📣 | `tok_buyers_m` | 25 Buyers | buyers ≥ 25 |
| 🔥 | `tok_near_grad` | Near Grad | progress ≥ 70% on curve |
| ✨ | `tok_vol_s` | Volume Spark | sampled vol ≥ 50 |
| 👥 | `tok_buyers_s` | 10 Buyers | buyers ≥ 10 |
| 🌱 | `tok_fresh` | Fresh Launch | age ≤ ~2h |

Ladders (buyers / volume / FDV) are **exclusive** within pillar.

## Creator badges

| Icon | ID | Title | When |
|------|-----|-------|------|
| 🦄 | `cre_listed` | Lister | ≥1 listed launch |
| 🏆 | `cre_grad_pro` | Graduation Pro | ≥3 graduated |
| 🌊 | `cre_vol_sum` | Volume Builder | Σ sampled vol ≥ 2 000 |
| 🏦 | `cre_raise_l` | Raise 10k | Σ raised ≥ 10 000 |
| 📈 | `cre_fdv_peak` | Peak FDV 40k | max mcap ≥ 40 000 |
| 🧲 | `cre_crowd` | Crowd Sum | Σ buyers ≥ **100** |
| 📦 | `cre_raise_m` | Raise 5k | Σ raised ≥ 5 000 |
| 🎯 | `cre_grad_one` | Graduate Maker | ≥1 graduated |
| ✨ | `cre_vol_sum_s` | Volume Starter | Σ sampled vol ≥ 250 |
| 🌱 | `cre_raise_s` | Raise 1k | Σ raised ≥ 1 000 |
| 🚀 | `cre_first` | First Launch | ≥1 launch |

**Removed:** `cre_serial`, `cre_factory` (vanity launch count), `tok_whale_bait`, `tok_liquid` / Crowd-Mob-Village vanity titles, `Capital Raiser` / “Gọi vốn”.

## Trader badges

| Icon | ID | Title | When |
|------|-----|-------|------|
| 🎒 | `tr_holder` | Bag Holder | ≥1 position |
| 🗃️ | `tr_multi` | Multi-Bag | ≥3 positions |
| 💪 | `tr_heavy` | Sized Bag (est.) | est. value ≥ 100 GNOT |
| 💎 | `tr_diamond` | Large Bag (est.) | est. value ≥ 1 000 GNOT |

## API

- `GET /api/badges` — catalog  
- `GET /api/badges?address=g1…` — creator + trader + per-token  
- Markets include `badges` + `wearBadges`

## Files

- `web/lib/badges.mjs` · `web/ui/src/lib/badges.js` · `AchievementBadge.jsx`
