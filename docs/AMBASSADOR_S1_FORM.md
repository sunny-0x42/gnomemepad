# Ambassador Season 1 — Application form fields

Use in Typeform / Google Form / Discord modal.  
**Required** unless marked optional.

---

## A. Identity

| Field | Type | Required | Notes / validation |
|---|---|---|---|
| Full name or public name | short text | yes | Display name on sheet |
| Age confirmation | checkbox | yes | “I confirm I am 18+” |
| Country / region | short text or dropdown | yes | For geo/KYC screening later — not public |
| Primary language | dropdown | yes | EN / VI / Other (specify) |
| Email | email | yes | Payout + ops only; not public |
| Discord username | short text | yes | `name#0000` or new username |
| X (Twitter) handle | short text | yes | `@…` — must be public |
| Telegram (optional) | short text | no | |
| Other channel (optional) | URL | no | YouTube / TikTok / Lens / blog |

---

## B. Wallet (on-chain)

| Field | Type | Required | Notes / validation |
|---|---|---|---|
| Adena `g1` address | short text | yes | Regex `^g1[a-z0-9]{38,}$`; used for SetReferrer + payout default |
| Confirm `g1` | short text | yes | Must match above |
| Preferred payout note | short text | no | e.g. “same g1” / “contact me for USDC” — final asset TBD |

---

## C. Portfolio (content)

| Field | Type | Required | Notes / validation |
|---|---|---|---|
| Sample link 1 | URL | yes | Best explanation of a product loop / crypto UX |
| Sample link 2 | URL | yes | |
| Sample link 3 | URL | yes | |
| Audience size (approx) | number or ranges | no | Followers / members — self-report, not scored alone |
| Languages you will create in | multi-select | yes | EN / VI / Other |
| Why Gnomi / fair launch | long text ≤500 | yes | No “will pump” / APR promises |

---

## D. Referral & tracking

| Field | Type | Required | Notes / validation |
|---|---|---|---|
| Planned content cadence | dropdown | yes | e.g. 1+/week, 2+/month |
| Will you use `/rewards?ref=g1…` links? | yes/no | yes | Educate: on-chain SetReferrer still required for score |
| How did you hear about Gnomi? | short text | no | |

---

## E. Legal / CoC (checkboxes — all required)

1. I have read **Ambassador Season 1 Rules (Option A)** and agree.  
2. I understand the prize pool is **discretionary**, equal to **10% × ProtocolFeeAccrued** in the Season window (**if any**), and **may be zero**.  
3. This is **not** salary, APR, dividend, or an investment return.  
4. **Season 0 Points are not cash** and are separate from this contest.  
5. **Testnet ≠ mainnet.**  
6. I will not wash trade, sybil, buy fake engagement, or promise guaranteed profits.  
7. I accept that Gnomi Labs may DQ / claw back for abuse and may require KYC before payout.  
8. I am responsible for my local taxes and laws; Gnomi does not give legal/tax advice.  
9. I will never ask users for seed phrases / private keys.  
10. Team / protocol controllers: I confirm I am **not** an ineligible insider (or I am applying as mentor-only with no prize).

---

## F. Ops-only (hidden / post-approve)

| Field | Who fills | Purpose |
|---|---|---|
| Status | Mod | pending / approved / rejected / DQ |
| Ambassador-S1 role granted | Mod | date |
| Judge content score (running) | Panel | 0–100 |
| Notes / risk flags | Mod | sybil, geo, etc. |
| Final rank | Ops | after freeze |

---

## Form intro blurb (paste at top)

**EN:** Apply to **Ambassador Season 1: Signal Builders**. Teach the gnomi.fun loop. Prize pool = **10% of ProtocolFeeAccrued** in the 30-day window (Option A) — contest prize only; may be zero. Rules: [link].

**VI:** Đăng ký **Ambassador Season 1: Signal Builders**. Dạy loop gnomi.fun. Prize pool = **10% ProtocolFeeAccrued** trong 30 ngày (Option A) — chỉ giải contest; có thể = 0. Rules: [link].
