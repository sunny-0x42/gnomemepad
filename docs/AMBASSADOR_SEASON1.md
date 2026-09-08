# Ambassador Season 1: Signal Builders

**Status:** internal draft — **not public** until founder yes.  
**Agents:** growth · trust · product (consensus).  
**Metric locked:** **Option A** — `PrizePool = 10% × ProtocolFeeAccrued`.  
**Brand:** Learn the loop. Leave the hype.

### Ship pack (Option A)

| Doc | Path |
|---|---|
| Rules 1-pager | [`docs/AMBASSADOR_S1_RULES.md`](./AMBASSADOR_S1_RULES.md) |
| Form fields | [`docs/AMBASSADOR_S1_FORM.md`](./AMBASSADOR_S1_FORM.md) |
| X posts (EN + VI) | [`docs/AMBASSADOR_S1_X_POST.md`](./AMBASSADOR_S1_X_POST.md) |

---

## 1. Pitch

| | EN | VI |
|---|---|---|
| **Name** | Ambassador Season 1: Signal Builders | Ambassador Season 1: Signal Builders |
| **Pitch** | Teach the fair-launch loop — curve → locked LP / Gnoswap — and compete for a **discretionary prize pool** funded from **up to 10% of Month-1 protocol fee revenue (if any)**. | Dạy vòng fair-launch — curve → locked LP / Gnoswap — và cạnh tranh **prize pool discretionary** tài trợ từ **tối đa 10% doanh thu protocol fee Tháng 1 (nếu có)**. |

This is a **contest prize**, not salary, dividend, APR, equity, or an investment return.

---

## 2. Who can join

- Creators / guides who explain gnomi.fun correctly (fair launch, locked LP, no pre-mint, Adena).
- Age ≥ 18; **1 person / 1 slot**; team / `protocolAddr` controllers **out** of prize.
- Apply: Discord + X + `g1` + 3 sample links; accept Code of Conduct.
- **Participating** = approved + ≥ 1 scored action in the window.

---

## 3. Timeline (recommended)

**30 days** from public announce (not a vague “calendar month” unless founder picks that).

| Phase | When |
|---|---|
| Soft apply | D−7 → D0 |
| Season live | **D1 → D30** (= Month-1 revenue window) |
| Freeze / anti-sybil | D31 → D37 |
| Announce ranks | ≤ D40 |
| Payout | ≤ D45 after pool metric published |

**Critical:** If Sapphire is still testnet, prefer **mainnet Month-1** for cash prizes, **or** a separate **fixed floor** (USDC/GNOT), **or** badge-only on testnet. Testnet fees must not be sold as USD income.

---

## 4. What “10% doanh thu” means (founder picks one)

Fee fact on pad: curve **120 BPS (1.20%)**, split **40% creator / 40% protocol / 20% LP**.

| Option | Definition | Notes |
|---|---|---|
| **A — Recommended** | `PrizePool = 10% × ProtocolFeeAccrued` in window (the **40% protocol share** of trade fees on the **active hub pad**) | On-chain measurable; excludes creator fees, LP share, Gnoswap DEX fees, bond |
| **B** | Only protocol fees **claimed** to treasury in window | Claim timing can be gamed — prefer accrued or claim-by-D37 |
| **C** | Company-declared ops revenue | Less transparent |
| **D** | `max(10% × A, Floor_X)` with Floor announced **before** start | Protects Ambassadors if volume is low |

**Public formula (if A):** publish once after freeze: accrued GNOT + 10% pool. Pool **may be zero**.

**Language:** “contest prize pool sized at up to 10% of [defined metric]” — **never** “Ambassadors get 10% revenue forever / revenue share / dividend”.

---

## 5. Prize split (inside the 10% pool)

**Default (growth):**

| Rank | Share of pool |
|---|---|
| #1 | 40% |
| #2 | 25% |
| #3 | 15% |
| #4 | 10% |
| #5 | 10% |

**Safer vs sybil (alt):** Top 5 = **70%** (30/20/10/5/5) + **Participation 30%** pro-rata by score (per-wallet cap).

Payout asset: GNOT or stable to registered `g1` — **not** a new pad token, **not** APR.

---

## 6. Scoring rubric

| Pillar | Weight | How |
|---|---|---|
| Content quality | **35%** | Guide/thread/video on Create → curve → graduate → Gnoswap; facts correct; human panel |
| On-chain referrals | **25%** | `pointsv2.SetReferrer`; unique first-time referees with real curve activity |
| Qualified volume brought | **20%** | Curve Buy volume of referred wallets; wash/sell loops slash; post-list Gnoswap ExactIn **does not** count (same as Season 0) |
| Quests / consistency | **10%** | Check-in / quests on `/rewards` |
| Community signal | **10%** | Discord help, translations, useful bugs — mod attestation |

**DQ:** sybil, wash, fake engagement, “guaranteed profit”, self-referral rings.

---

## 7. vs Season 0 Curve Camp

| | Season 0 | Ambassador S1 |
|---|---|---|
| Goal | Learn the loop | GTM / education |
| Reward | Points / badges — **not cash** | Contest prize pool |
| Track | **Separate** | No Points → money conversion |

Optional tiny Season 0 multiplier: **discourage** or keep ≤ discretionary boost announced upfront.

---

## 8. Ops / product (MVP = no big build)

1. Discord/Typeform apply → role `Ambassador-S1` + sheet/Notion board.
2. Weekly content submissions + on-chain `g1` binding.
3. Public sheet: rank, handle, short `g1`, verified referrals, content links.
4. In-app: **copy only** — short note on `/docs` + one line on `/rewards`: Ambassador Prize ≠ Season 0 Points.
5. Optional P1 later: static `/docs#ambassadors` or `/ambassadors` JSON board (2–4 eng days). **Do not** reuse Season 0 leaderboard as prize board.

---

## 9. Trust framing (canonical)

Gnomi Labs may run a discretionary Ambassador contest. Eligible Ambassadors may compete for a prize pool that Gnomi Labs intends to fund from **up to 10% of Month-1 protocol/ops revenue (if any)**, as defined in the Rules — not as salary, dividend, APR, or an investment return. The pool may be zero unless a separate fixed floor is announced. Separate from Season 0 Points. Non-custodial (Adena). Testnet ≠ mainnet. Not financial/tax/legal advice.

### Required disclaimer bullets (short)

1. Discretionary pool; up to 10% of **defined** Month-1 revenue (if any); not guaranteed income.  
2. Not APR / dividend / investment product.  
3. Revenue categories + exclusions listed in Rules.  
4. Pool may be zero; any floor announced separately.  
5. Testnet ≠ mainnet.  
6. Season 0 Points ≠ cash; separate from contest.  
7. Sybil / wash / fake content → DQ / forfeiture.  
8. Age / geo / KYC may apply before payout; you own local tax/law — consult counsel.  
9. Never send keys/funds to “claim” a share.  
10. Gnomi may change/pause/cancel; permissionless launches ≠ endorsement.

---

## 10. Founder decisions (before publish)

1. Revenue metric: **A / B / C / D** (+ Floor amount?)  
2. Timeline neo: **mainnet Month-1** vs Sapphire signal-first?  
3. Split: Top5 40/25/15/10/10 **or** Top5 70% + Participation 30%?  
4. Season 0 multiplier: **no** (recommended) or small?  
5. Payout asset + KYC/geo (counsel)?  
6. Human yes before any X / Discord post.

---

## 11. Paste-ready announce (DRAFT — do not post until yes)

### X (EN)

1/ Ambassador Season 1: Signal Builders is open.  
Teach the gnomi.fun loop — fair launch curve → locked LP / Gnoswap. No pre-mint theater.

2/ Prize pool = up to **10% of Month-1 protocol fee revenue (if any)** — definition in the Rules.  
Contest prize only — not an investment, not APR, not a guaranteed airdrop.

3/ Apply: [form] — Discord + X + your `g1`.

4/ Score: quality content, on-chain referrals (`SetReferrer`), qualified curve volume, quests. Wash = out.

5/ Season 0 Points stay separate (learn / discretionary).  
Learn the loop. Leave the hype. → gnomi.fun

### Discord (VI, rút gọn)

Mở **Ambassador Season 1: Signal Builders**. Dạy đúng loop fair-launch trên gnomi.fun. Prize pool = tối đa 10% protocol fee revenue Tháng 1 theo Rules (có thể = 0). Không hứa lợi nhuận / APR. Season 0 Points tách, không đổi ra tiền. Apply: [form] + `g1`. Wash/sybil = loại.
