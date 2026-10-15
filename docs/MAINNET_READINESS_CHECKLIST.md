# Checklist sẵn sàng Mainnet — gnomi.fun / gnomemepad

**Cập nhật:** 2026-09-18 · Roster gốc 2026-09-09; on-chain live refresh bên dưới  
**Phạm vi:** Mainnet `gnomi/padv2` **LIVE** (hub SetModule) · Pearl `gnomi/pad` · Sapphire `padv22` (legacy beta)  
**Hard gate:** không `addpkg` / hub `SetModule` / Netlify prod flip / tweet mà không có **human yes** tường minh.

> **Live snapshot (2026-09-18):** pad `…/gnomi/padv2` · `ammmathv2` · raise **300k GNOT** · bond **150 GNOT** (platform fee) · default venue **zdex** (+ gnoswap) · legacy `…/gnomi/pad` GNOME 0000001 stuck. Chi tiết: `docs/MAINNET_STATUS.md`.

Legend:

| Status | Ý nghĩa |
|--------|---------|
| 🔴 Blocker | Chặn soft/full mainnet nếu bỏ |
| 🟡 Improve | Cần trước / lúc soft launch |
| ✅ Done | Ổn trên testnet / pattern đã có |
| ⬜ Optional | Nên có, không chặn cứng |
| ❓ Unknown | Cần human / chain confirm |

---

## 0. Tóm tắt ưu tiên

| P0 (Blocker) | P1 (Trước soft launch) | P2 (Post-launch sớm) |
|--------------|------------------------|----------------------|
| Netlify unpause / plan (site 503) | Audit sâu list + CI tests | Holder indexer + volume24h |
| Mainnet chain-id + RPC + Gnoswap paths | Runbook fees / list-fail | Bug bounty |
| Freeze params (≠ Sapphire 500 GNOT) | UI sync `/api/networks` + Adena | Points ON có kiểm soát |
| Multisig / protocol custody | Disclaimer + known limitations | Ambassador Month-1 payout |
| Pad mới từ Pearl lineage + Init + hub | Monitoring + snapshot cron | Governance / timelock (nếu cần) |

**Baseline kinh tế Mainnet live (`padv2`):** raise **300_000 GNOT** · `VirtualUgnot0` ≈ **102_375 GNOT** · FeeBPS **120** · bond **150 GNOT** (platform fee, không escrow refund) · ListFeeGns **100 GNS** · default **zdex**.  
Pearl testnet vẫn ~**10_000** raise / bond **100**. **Không** copy Sapphire `padv22` threshold **500 GNOT**.

**Protocol probe (2026-09-18):** Gnoswap + zdex + `gnomi/padv2` **live** trên `gnoland-1`. Checklist P0/P1 bên dưới giữ lịch sử ưu tiên; nhiều hạng mục deploy đã xong — xem `docs/MAINNET_STATUS.md` trước khi coi lại blocker.

---

## P0 — Blockers (không go-live)

| ID | Hạng mục | Owner | Status | Done khi |
|----|----------|-------|--------|----------|
| P0-01 | **Netlify Free exhausted / 503** — nâng plan, tách credit khỏi zdex/vault | devops | 🔴 | `gnomi.fun` = 200 |
| P0-02 | **Mainnet identity** — `MAINNET_CHAIN_ID`, RPC, gnoweb chính thức | protocol + devops | ❓ | Document + env |
| P0-03 | **Deploy / protocol namespace** — `g1mv0052…` vs `g16p08…` vs multisig mới | protocol + chief | ❓ | Human chốt addr |
| P0-04 | **Freeze params kinh tế** pad mainnet (const sau addpkg) | defi + protocol | 🔴 | Spec 1 trang + sim sheet |
| P0-05 | **Gnoswap mainnet stack** — pool/position/router/consts/`GetPoolCreationFee`/tier | defi + protocol | 🔴 | Smoke list 1 token |
| P0-06 | **Protocol key custody** — HW/multisig; không 1 hot key | security + protocol | 🔴 | Ceremony doc |
| P0-07 | **Upgrade policy** — pad immutable → `padvN` + hub `SetModule` | protocol | 🟡 | Hub migration doc signed |
| P0-08 | **Audit tối thiểu** (internal deep + external nếu TVL thật) | security | 🔴 | Báo cáo / remediations |
| P0-09 | **Disclaimer / risk** live — unaudited, no-advice, testnet≠mainnet | trust + product | 🟡 | Copy live i18n |

---

## P1 — Protocol & deploy

| ID | Hạng mục | Owner | Status | Done khi |
|----|----------|-------|--------|----------|
| P1-01 | Cut **mainnet `padv2`** từ Pearl/`pad` source (seamless list), **không** padv22@500 | protocol | ✅ | Live `…/gnomi/padv2` |
| P1-02 | Deploy pure **`ammmathv2`** | protocol | ✅ | MulDiv live |
| P1-03 | Deploy + Init: `profile`, `meta`, `bond`, `pointsv2` (**OFF**), `hubv2` | protocol | ✅ | Modules live |
| P1-04 | Deploy pad + **Init** (caller = protocol treasury) | protocol | ✅ | `ParamsInfo` 300k / 150 bond |
| P1-05 | Hub **`SetModule`** pad→**padv2** / profile/meta/points/bond | protocol | ✅ | `GetModule("pad")` = padv2 |
| P1-06 | Verify `testSkipBanker` / `testForceGnoswapList` = **false** | security + protocol | ⬜ | qeval sau deploy |
| P1-07 | Bond `SetNormalBond` **150 GNOT**; promo policy | protocol + defi | ✅ | `CurrentBondUgnot=150e6` |
| P1-08 | Smoke: Create → Buy/Sell → Graduate → RetryList → ExactIn | protocol + defi | 🟡 | gnokey E2E verified; Adena local Unauthorized known |
| P1-09 | Dependencies: `wugnot`, `grc20`, `grc20reg`, `p/nt/*` trên mainnet | protocol | ✅ | Paths confirmed |
| P1-10 | Grant D6 **Mainnet readiness memo** đóng | protocol + chief | 🟡 | Memo published |

---

## P2 — Security & audit

| ID | Hạng mục | Owner | Status | Done khi |
|----|----------|-------|--------|----------|
| P2-01 | External audit memepad + gnoswap_list + ammmath + bond + prepaid | security | 🔴 | Report closed |
| P2-02 | Deep pass `tryListOnGnoswap` (CreatePool/Mint/sqrtPrice/ticks/refund) | security + defi | 🟡 | Findings closed |
| P2-03 | Delta audit mỗi `padvN` trước hub switch | security | ⬜ | Diff signed |
| P2-04 | Invariants: `reservedWugnot`, prepaid, fees, free vs reserved withdraw | security | 🟡 | Property tests |
| P2-05 | Sell raise near-threshold; last-fill / overpay credit | security + defi | 🟡 | Tests green |
| P2-06 | Bond = platform fee on `padv2` (no creator refund); legacy pad may still escrow | security + defi | ✅ | BOND_AND_RAISE.md |
| P2-07 | Admin surface: `TransferProtocol`, `WithdrawProtocolUgnot`, `SetGraduationThreshold`, hub `SetModule` | security | 🔴 | Multisig + policy |
| P2-08 | **Policy mutable raise/list-fee** sau launch (hiện **có** setter — không “const-only”) | chief + security | ❓ | Human quyết định |
| P2-09 | LP lock: Mint vào pad; không DecreaseLiquidity/Burn | security | ✅ | Giữ regression |
| P2-10 | EOA / `IsUserCall` / prepaid Buy (không Approve trên Buy) | security | ✅ | CI regression |
| P2-11 | Bug bounty / disclosure trước TVL lớn | security + trust | ⬜ | Policy published |
| P2-12 | API: bắt buộc `TOKEN_RESOURCE_SYNC_SECRET`; harden Ambassador admin (hiện so khớp g1 **không chữ ký**) | security + devops | 🔴 | Auth thật |
| P2-13 | X OAuth: không fallback HMAC `"dev-insecure"` trên prod | devops | 🟡 | Env only |
| P2-14 | `markets-snapshot` manual invoke: rate-limit / secret | devops | 🟡 | Không open abuse |
| P2-15 | Netlify **không** ký tx (`/api/tx` → 501) | devops | ✅ | Keep |

---

## P3 — DeFi / params freeze

| ID | Hạng mục | Owner | Status | Done khi |
|----|----------|-------|--------|----------|
| P3-01 | Raise mainnet **300_000 GNOT** (+ `ammmathv2`); ≠ Sapphire 500 | defi | ✅ | Live ParamsInfo |
| P3-02 | VirtualUgnot0 ≈ 102_375e9 / VT0; P_curve ≈ P_pool (~+177 bps LP open) | defi | ✅ | Documented MAINNET_DEPLOY |
| P3-03 | FeeBPS 120 + 40/40/20 — review peers rồi ký | defi | 🟡 | Params + Docs |
| P3-04 | Create bond mainnet **150 GNOT** = platform fee (`creditBondFee`) | defi | ✅ | BOND_AND_RAISE.md |
| P3-05 | `ListFeeGns` = `GetPoolCreationFee()` trên **chain đích** | defi | ✅ | 100 GNS |
| P3-06 | Anti-snipe: chốt Heights/MaxBuyBPS (source 20/5% vs deploy 30/3%; comment drift) | defi | 🟡 | 1 bộ trong params |
| P3-07 | Tokenomics public: 1B / 80% curve; LP = curve-spot sized (không “fixed 200M”) | defi + trust | 🟡 | Docs = chain |
| P3-08 | Decimals=0 UX Adena + Gnoswap mainnet | defi + product | ❓ | Checklist wallet |
| P3-09 | List = EOA wrap + Approve + RetryList (pad **không** `wugnot.Deposit`) | defi | ✅ | Playbook |
| P3-10 | Create-time GNS escrow + `ClaimListFee` | defi | ✅ | Keep |
| P3-11 | Dependency: Gnoswap down → list delay / internal CPMM — document | defi + trust | 🟡 | Risk section |
| P3-12 | ProtocolFeeAccrued Month-1 ops (D0/D30 snapshot; chain chưa có cửa sổ sẵn) | defi + trust | ⬜ | Runbook Amb |
| P3-13 | Points ≠ cash; post-list ExactIn = 0 points / 0 Amb volume | defi + trust | ✅ | Copy giữ |

---

## P4 — Product / UI / Adena

| ID | Hạng mục | Owner | Status | Done khi |
|----|----------|-------|--------|----------|
| P4-01 | Sync client `networks.js` với `/api/networks` (hiện hardcode Mainnet soon) | product | 🔴 | Env bật → UI chọn được |
| P4-02 | Set `MAINNET_*` env; bỏ `comingSoon` sau smoke | product + devops | 🟡 | Switcher live |
| P4-03 | Adena AddNetwork/SwitchNetwork mainnet; StatusBanners copy **theo net** (không cứng “Sapphire”) | product | 🟡 | E2E connect |
| P4-04 | **Cắt fallback USD 235** — GNOT CEX (~2026-09-16); UI = Gnoswap prices **ORACLE** | product | ✅ | No fake $235; fail → GNOT-only |
| P4-05 | Create/Buy/Sell/List E2E UI; Gnoswap app URL mainnet (không chỉ beta.gnoswap.io) | product | 🟡 | 1 token full loop |
| P4-06 | Chart honesty: `markReliable`; empty DEX banner; block-time mainnet | product | ✅/🟡 | Verify mainnet |
| P4-07 | Ẩn faucet trên Mainnet; copy Portfolio/Docs/Token theo network | product | 🟡 | No testnet CTA |
| P4-08 | Buyers vs Holders disclaimer; FDV vs “MCap” unify | product + trust | 🟡 | Docs + tooltips |
| P4-09 | Season 0 UI giữ Sapphire-only; không entitlement mainnet | product | ✅ | Keep |
| P4-10 | Ambassador Month-1 window hiển thị; volume pillar mainnet-only | product + growth | 🟡 | Board note |
| P4-11 | Admin scoped theo network; Points OFF; cảnh báo tiền thật | product | 🟡 | Confirm UX |
| P4-12 | Disable trade khi `health.ok === false`; phân biệt empty vs RPC fail | product | 🟡 | Banners |
| P4-13 | Explorer / gnoscan / gnoweb links đúng mainnet | product | ❓ | URLs confirmed |

---

## P5 — DevOps / RPC / Netlify / monitoring

| ID | Hạng mục | Owner | Status | Done khi |
|----|----------|-------|--------|----------|
| P5-01 | Nâng Netlify + tách credit team sites | devops | 🔴 | Site unpaused |
| P5-02 | CDN durable + markets snapshot Blobs + cron 1m | devops | 🟡 | Cache-Status hit |
| P5-03 | `SNAPSHOT_NETWORKS` gồm mainnet khi live; skip Sapphire nếu NXDOMAIN | devops | 🟡 | Cron không spam fail |
| P5-04 | Env `MAINNET_*` trên Netlify (không commit secret) | devops | ⬜ | `/api/health?network=mainnet` ok |
| P5-05 | RPC failover / timeout / circuit breaker | devops | ⬜ | Config |
| P5-06 | CI Deploy Netlify; secrets valid; **human yes** mỗi prod có mainnet flags | devops | 🟡 | Workflow green |
| P5-07 | Logo token-resource: PAT bền; chainId mainnet trong registry JSON | devops | 🟡 | Pipeline ổn |
| P5-08 | Uptime: `/`, `/api/health`, `/api/ops` + Netlify usage alerts | devops | ⬜ | Channel alert |
| P5-09 | Rollback: previous deploy; empty `MAINNET_PKG` → coming soon | devops | ⬜ | Runbook |
| P5-10 | Domain/SSL `gnomi.fun` sau unpause | devops | 🟡 | TLS OK |
| P5-11 | Backup export launch IDs / pools / protocol state | devops | ⬜ | Script cron |
| P5-12 | Status page RPC/API/Gnoswap | devops | ⬜ | Optional |

---

## P6 — Trust / legal / disclosures

| ID | Hạng mục | Owner | Status | Done khi |
|----|----------|-------|--------|----------|
| P6-01 | Disclaimer: risk of loss; unaudited; not investment advice | trust | 🟡 | Live i18n |
| P6-02 | Non-custodial Adena; API read-only | trust | ✅ | Docs |
| P6-03 | Testnet ≠ mainnet trên mọi Amb/Season claim | trust | 🟡 | Quét copy |
| P6-04 | Amb Option A wording: contest prize; pool may be zero; not APR/salary | trust | 🟡 | Rules published |
| P6-05 | Payout asset `[FILL]` + KYC trước payout | trust + chief | ❓ | Human fill |
| P6-06 | Claims freeze: không “audited” / “guaranteed pool” / “will pump” | trust | 🔴 | Sign-off sheet |
| P6-07 | Terms / geo (nếu cần counsel) | trust | ⬜ | Optional |
| P6-08 | Support Discord/TG: list fail / ClaimWugnot | trust + growth | 🟡 | Pin |
| P6-09 | Known limitations (legacy GNOME stuck · Adena local Unauthorized · maint overlay) | trust + product | ✅ | MAINNET_STATUS.md |

---

## P7 — Growth / launch comms (DRAFT only — không post)

| ID | Hạng mục | Owner | Status | Done khi |
|----|----------|-------|--------|----------|
| P7-01 | Soft-launch thread EN/VI + known limitations | growth | ⬜ | Draft; **yes** mới post |
| P7-02 | Amb S1 X pack (`AMBASSADOR_S1_X_POST.md`) — prizes after Month-1 | growth | 🟡 | Founder yes |
| P7-03 | Discord `#ambassador-s1` + pin Rules/Form | growth | ⬜ | Ops |
| P7-04 | Soft vs full announce timeline; optional TVL cap messaging | growth + chief | ❓ | Human |
| P7-05 | Brand: Learn the loop. Leave the hype. — không shill FDV | growth | ✅ | Keep |
| P7-06 | X OAuth production trước khi claim “verified X” | growth + devops | 🟡 | Honest UX |

---

## P8 — Post-launch (Month-1 Ambassador & ops)

| ID | Hạng mục | Owner | Status | Done khi |
|----|----------|-------|--------|----------|
| P8-01 | Định nghĩa **D0 go-live** → Month-1 = D1–D30 | chief + trust | ⬜ | Announce |
| P8-02 | Publish ProtocolFeeAccrued + PrizePool 10%; freeze D31–D37 | defi + trust | ⬜ | Public numbers |
| P8-03 | Scoreboard 50/30/20; volume **mainnet curve only** | growth + product | 🟡 | Tracker |
| P8-04 | Season 0 wind-down; không migrate Points → tiền | protocol + product | 🟡 | Note public |
| P8-05 | Holder indexer + volume24h | product + devops | ⬜ | Spec |
| P8-06 | Points mainnet `AllowPad` + load test rồi mới ON | protocol | ⬜ | Human yes |
| P8-07 | Bug bounty live; fire-drill Claim/list | security + devops | ⬜ | Drill done |
| P8-08 | Governance / timelock (nếu TVL lớn) | protocol + security | ⬜ | Optional |

---

## Thứ tự làm việc đề xuất

### Phase A — Giữ beta + mở lại site (ngay)
1. Netlify plan / unpause (P0-01)  
2. Snapshot cron + CDN durable ổn định (P5-02)  
3. Harden API secrets / admin auth (P2-12)  
4. Runbook fees + list-fail v1 (P2 runbooks)  
5. Disclaimer + Buyers/Holders copy (P6 / P4-08)

### Phase B — Chuẩn bị pad mainnet (2–6 tuần)
1. Human freeze params + custody + Gnoswap go/no-go  
2. Cut `padvN` + tests + deep audit list  
3. External audit kickoff (nếu soft+money)  
4. UI: networks sync, cắt USD 235, Adena mainnet  
5. Hub migration + Init runbook (không broadcast)

### Phase C — Soft launch (chỉ sau human yes)
1. Deploy D1→D8 + smoke list  
2. Set `MAINNET_*` + monitoring  
3. Announce + known limitations  
4. Optional cap TVL lần 1  
5. D0 Amb Month-1 clock start

### Phase D — Post
Indexer · bounty · Points · Amb payout ≤D45 · retune chỉ bằng pad mới

---

## “Done” theo tầng

| Tầng | Xong khi… |
|------|-----------|
| **Beta testnet** | Create/trade/list ổn; UI khớp params; ops biết claim/list; site không 503 |
| **Mainnet soft** | Pad mới + params freeze + custody + list smoke + disclaimer + monitoring |
| **Mainnet full** | External audit closed + holder story + logo pipeline + Amb Month-1 process + fire-drill |

---

## Open questions — cần human quyết định

1. Mainnet **chain-id / RPC** chính thức? Stub `gnoland1` / `rpc.gno.land` có đúng không?  
2. **Gnoswap mainnet** timeline / paths? (hiện trống trên probe)  
3. Namespace / **protocolAddr** / multisig threshold?  
4. Freeze số: giữ Pearl **10k / 3500 / 120 / 100 GNOT bond / 100 GNS**?  
5. Anti-snipe + `BondRefundMinRaised` — chốt 1 bộ (đang drift)?  
6. Cho phép `SetGraduationThreshold` sau launch công khai không?  
7. Netlify: Personal/Pro hay hybrid API host?  
8. Soft launch: default network = Mainnet hay giữ testnet + opt-in?  
9. Amb payout asset + có floor nếu Month-1 ≈ 0?  
10. Audit: internal-only soft vs bắt buộc external trước announce?  
11. Points mainnet: OFF bao lâu?  
12. Sapphire còn maintain khi DNS chết?

---

## 5 quyết định nên chốt tiếp theo

1. **Netlify billing** — mở lại gnomi.fun  
2. **Mainnet RPC + Gnoswap go/no-go**  
3. **Namespace + custody / multisig** (không hỏi mnemonic — chỉ mô hình)  
4. **Freeze kinh tế pad** (const)  
5. **Launch posture:** soft (disclaimer unaudited) vs đợi external audit + **D0 Amb**

---

## Liên kết nội bộ

- Mainnet status: `docs/MAINNET_STATUS.md`  
- Mainnet deploy: `docs/MAINNET_DEPLOY.md`  
- Dual-DEX: `docs/DUAL_DEX_READINESS.md`  
- Bond / raise: `docs/BOND_AND_RAISE.md`  
- Zdex EOA / ExactIn: `docs/ZDEX_EOA_LIST.md`  
- Pearl deploy: `docs/PEARL_DEPLOY.md`  
- Season 0: `docs/SEASON0.md`  
- Ambassador: `docs/AMBASSADOR_S1_RULES.md`, `docs/AMBASSADOR_S1_X_POST.md`  
- Grants memo: `docs/grants/gnomemepad.md`  
- Networks: `web/lib/networks.mjs`  
- Netlify: `NETLIFY.md`, `netlify.toml`  
- Audit script: `npm run audit:onchain`

---

*Roster discussion artifacts: chief master list + protocol M0–F5 + security SEC-* + defi freeze B1–B11 + devops MN-* + product P0–P2 UI + trust T* / growth G*. Không deploy / không tweet từ checklist này.*
