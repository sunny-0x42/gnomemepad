# Checklist cải thiện — sẵn sàng triển khai chính thức

**Phạm vi:** pad live Sapphire `padv22` + hub/bond/meta/points + UI/API.  
**Mục tiêu:** từ *public beta ổn* → *mainnet / tiền thật có kỷ luật*.

Legend:

| Status | Ý nghĩa |
|--------|---------|
| ✅ Done | Đã ổn trên Sapphire |
| 🟡 Improve | Cần làm trước / khi lên chính thức |
| 🔴 Blocker | Chặn mainnet nếu bỏ qua |
| ⬜ Optional | Nên có, không chặn cứng |

---

## 0. Tóm tắt ưu tiên

| P0 (Blocker) | P1 (Trước launch) | P2 (Sau launch sớm) |
|--------------|-------------------|---------------------|
| Params kinh tế mainnet + pad mới | Audit độc lập + test CI | Holder indexer |
| Runbook treasury / incident | Logo auto (token-resource merge) | Governance / timelock (nếu cần) |
| Multisig / key ops | Monitoring alerts | Points bật có kiểm soát |
| Xác nhận Gnoswap list path trên mainnet stack | Docs + legal disclaimer | Analytics |

---

## 1. On-chain — kinh tế & tham số

| # | Hạng mục | Status | Chi tiết cần làm | Done khi |
|---|----------|--------|------------------|----------|
| 1.1 | **Raise target mainnet** | 🔴 | Chốt `GraduationThreshold` (không dùng 500 GNOT testnet). Mô phỏng max raise vs `VirtualUgnot0`/`VirtualToken0`/`CurveSupply`. | Spec số liệu + sheet mô phỏng |
| 1.2 | **Virtual curve retune** | 🔴 | Đảm bảo raise reachable trước sold-out; P_curve ≈ P_pool lúc graduate. | Công thức + unit test |
| 1.3 | **Fee BPS / shares** | 🟡 | Review 120 bps + 40/40/20 creator/protocol/LP. So sánh DEX peers. | Quyết định ghi trong params.gno |
| 1.4 | **Create bond** | 🟡 | Bond live từ `bond` realm (hiện 2 GNOT). Mainnet: normal/promo policy, anti-spam. | Bond config + docs |
| 1.5 | **ListFeeGns** | 🟡 | Khớp `gnspool.GetPoolCreationFee()` trên chain đích (có thể ≠ 100 GNS). | Env/const đúng chain |
| 1.6 | **Anti-snipe** | 🟡 | Review `AntiSnipeHeights` / `AntiSnipeMaxBuyBPS` cho mainnet liquidity. | Params + test |
| 1.7 | **Immutability** | 🔴 | Params là `const` — **không sửa sau deploy**. Mọi thay đổi = **pad mới** (padvN). | Deploy plan + versioning |
| 1.8 | **Decimals=0** | 🟡 | Cố ý whole tokens; xác nhận UX Gnoswap/Adena/mainnet OK. | Checklist wallet/DEX |
| 1.9 | **Token supply 1B / 80% curve** | 🟡 | Chốt tokenomics công khai; LP = remaining (không chỉ PoolSeed legacy). | Docs + marketing khớp chain |

---

## 2. On-chain — bảo mật & correctness

| # | Hạng mục | Status | Chi tiết cần làm | Done khi |
|---|----------|--------|------------------|----------|
| 2.1 | **Audit độc lập** | 🔴 | Audit bên thứ 3: `memepad.gno`, `gnoswap_list.gno`, `ammmathv2`, `bond`, payment prepaid. | Báo cáo + remediations |
| 2.2 | **EOA / payment guards** | ✅ | Create/Buy/Sell/Claim* dùng `IsUserCall`; Buy = prepaid WUGNOT (không Approve trên Buy). | Giữ regression tests |
| 2.3 | **Deep pass `tryListOnGnoswap`** | 🟡 | Full-line audit CreatePool/Mint/sqrtPrice/ticks/refund/settle funding. | Findings closed |
| 2.4 | **RetryList + TransferFrom** | 🟡 | UI không khuyến khích Approve max vô hạn; document shortfall pull; prefer escrow GNS lúc Create. | UI copy + Guide |
| 2.5 | **Reserved WUGNOT / ugnot accounting** | 🟡 | Invariant tests: `reservedWugnot`, prepaid, creator/protocol fees, pool unlisted, free balance. | Property / integration tests |
| 2.6 | **Sell raise accounting** | 🟡 | Sell giảm `RaisedUgnot`; edge cases gần threshold. | Tests |
| 2.7 | **Bond refund sybil** | 🟡 | `BondRefundBuyers` + `BondRefundMinRaised` + height window — review anti-gaming. | Spec + tests |
| 2.8 | **Points toggle** | ✅/🟡 | Hiện OFF (an toàn). Trước khi bật: `pointsv2.AllowPad(padPath)` + không panic trade. | Checklist bật points |
| 2.9 | **Admin surface** | 🟡 | `TransferProtocol`, `WithdrawProtocolUgnot`, `SetPointsEnabled` — chỉ protocol key; ideally multisig. | Multisig + ops policy |
| 2.10 | **Bug bounty / disclosure** | ⬜ | Chương trình báo lỗ hổng trước TVL lớn. | Policy published |
| 2.11 | **Test flags** | ✅ | `testSkipBanker` / `testForceGnoswapList` chỉ test — verify **false** on-chain production. | Eval / deploy checklist |

---

## 3. Gnoswap / DEX integration

| # | Hạng mục | Status | Chi tiết cần làm | Done khi |
|---|----------|--------|------------------|----------|
| 3.1 | **List path trên chain đích** | 🔴 | Xác nhận pool/position/router/consts/fee tier trên **mainnet** (không hardcode Sapphire-only). | Smoke list 1 token |
| 3.2 | **Create-time GNS escrow** | ✅ | padv20+; ClaimListFee nếu bỏ list. | Keep + Guide |
| 3.3 | **Auto-list không trong Buy** | ✅ | Tránh revert Buy vì CreatePool. | Regression |
| 3.4 | **Logo / token-resource** | 🟡 | Pipeline Action + secrets OK; **PR #55 chờ Onbloc merge**; token mới cần auto-PR ổn định. | Merge + indexer logoURI |
| 3.5 | **PAT bền (không OAuth gh tạm)** | 🟡 | Đổi `TOKEN_RESOURCE_GITHUB_TOKEN` sang classic PAT `repo` dài hạn. | Secret rotated |
| 3.6 | **Adena path = pkg.SYMBOL** | ✅ | Không dùng Token.ID `.seq`. | UI/copy kit |
| 3.7 | **Post-list trading** | ✅ | Curve đóng; Swap* nội bộ tắt khi listed; UI → Gnoswap ExactIn. | E2E |
| 3.8 | **Price post-list** | ✅ | Last Gnoswap trade + mcap recalc. | Monitor drift |
| 3.9 | **Dependency risk** | 🟡 | Document: Gnoswap upgrade / downtime → list delay; internal CPMM fallback. | Risk section in Docs |

---

## 4. Sản phẩm — holders / volume / data

| # | Hạng mục | Status | Chi tiết cần làm | Done khi |
|---|----------|--------|------------------|----------|
| 4.1 | **Buyers = UniqueBuyers curve** | ✅ (label) | Tooltip đã có; Docs phải nói rõ. | Docs + i18n |
| 4.2 | **Holders full post-DEX** | 🟡 | Indexer GRC20 Transfer / Gnoswap traders — hoặc ghi “curve holders only”. | Indexer v1 hoặc disclaimer |
| 4.3 | **Volume excl. LP seed** | ✅ | Đã bỏ side 2/3/4 khỏi stats/activity. | Keep |
| 4.4 | **Volume Markets = sample** | 🟡 | Activity limit 120 — chưa full history. Cân nhắc `volume24h` từ indexer. | Spec volume windows |
| 4.5 | **Trades dedupe** | ✅ | localStorage + indexer. | Keep |
| 4.6 | **Raised after graduate** | ✅ | `raisedGnot` từ `pool_at_grad`. | Keep |
| 4.7 | **`npm run audit:onchain`** | ✅ | Script so params/LaunchInfo. | CI optional |
| 4.8 | **Chart continuity** | ✅ | Curve + best-effort Gnoswap REST + `/api/trades/report`; no fake mark when `pool_mark`/thin LP; Token banner when DEX empty. Probe: `scripts/probe-gnoswap-history.mjs`. | Banner + markReliable + report path live |

---

## 5. Backend / API / UI

| # | Hạng mục | Status | Chi tiết cần làm | Done khi |
|---|----------|--------|------------------|----------|
| 5.1 | **Backend private** | ✅ | `web/lib` gitignore; repo `gnomemepad-backend`. | Policy giữ |
| 5.2 | **Push backend sync** | 🟡 | Commit local token-resource/API fixes → push private repo nếu chưa. | `git status` clean remote |
| 5.3 | **Netlify usage / quotas** | 🟡 | Đã gặp `usage_exceeded` — plan/quota + caching. | Stable /api/* |
| 5.4 | **RPC failover** | 🟡 | Multi RPC / timeout / circuit breaker. | Config |
| 5.5 | **Rate limit / abuse** | ⬜ | Protect sync endpoints (`TOKEN_RESOURCE_SYNC_SECRET`). | Secret set |
| 5.6 | **i18n Docs khớp params** | 🟡 | Docs đọc live ParamsInfo hoặc “see Ops”. | No hardcode lệch |
| 5.7 | **Create UX: GNS + bond + icon** | 🟡 | Bắt buộc/icon khuyến nghị; preflight FreeGns/FreeWugnot. | Conversion checklist |
| 5.8 | **Error messages** | 🟡 | Map panic strings → UI thân thiện (underpay bond, need Transfer WUGNOT…). | Error map |

---

## 6. Ops / treasury / keys

| # | Hạng mục | Status | Chi tiết cần làm | Done khi |
|---|----------|--------|------------------|----------|
| 6.1 | **Protocol key custody** | 🔴 | Multisig / hardware; không 1 hot key. | Key ceremony doc |
| 6.2 | **Runbook Claim/Push fees** | 🟡 | `PushProtocolFees`, `ClaimCreatorFees`, `ClaimWugnot`, `ClaimListFee`. | Runbook.md |
| 6.3 | **Runbook list fail** | 🟡 | ListNeed → fund GNS/WUGNOT → RetryList → refund. | Playbook + screenshots |
| 6.4 | **Inventory monitoring** | 🟡 | Pad WUGNOT/GNS/bank ugnot vs reserved; alert khi short. | Dashboard/alert |
| 6.5 | **Incident: stuck Buy/graduate** | 🟡 | Sold-out / raise-filled paths; refund to credit. | Table of panics |
| 6.6 | **Upgrade policy** | 🔴 | Pad immutable → version bump `padvN` + hub module switch. | Hub migration doc |
| 6.7 | **Backup / export** | ⬜ | Export launch IDs, pool paths, protocol state định kỳ. | Script cron |

---

## 7. Hub / modules liên quan

| # | Module | Status | Cần cải thiện |
|---|--------|--------|----------------|
| 7.1 | **hubv2** | 🟡 | Verify `GetModule("pad")` trỏ pad production; quy trình đổi pad. |
| 7.2 | **bond** | 🟡 | Promo/normal policy mainnet; admin StartPromo giới hạn. |
| 7.3 | **meta** | 🟡 | URI length 200; moderation NSFW/scam images (off-chain). |
| 7.4 | **pointsv2** | 🟡 | Chỉ bật sau AllowPad + load test; hiện OFF. |
| 7.5 | **profile** | ⬜ | Optional social identity — không block. |

---

## 8. Compliance / product / GTM

| # | Hạng mục | Status | Chi tiết |
|---|----------|--------|----------|
| 8.1 | **Disclaimer** | 🟡 | Testnet ≠ investment advice; risk of loss; unaudited until stated. |
| 8.2 | **Terms / geographic** | ⬜ | Tùy jurisdiction. |
| 8.3 | **Support channel** | 🟡 | Discord/Telegram cho list fail / ClaimWugnot. |
| 8.4 | **Public status page** | ⬜ | RPC / API / Gnoswap dependency status. |
| 8.5 | **Grants / ecosystem** | ⬜ | Đã có draft grants — follow-up nếu cần. |

---

## 9. Testing & CI

| # | Hạng mục | Status | Chi tiết |
|---|----------|--------|----------|
| 9.1 | **Unit tests pad** | 🟡 | Buy/Sell/Graduate/last-fill/anti-snipe/bond — chạy CI mỗi PR. |
| 9.2 | **Integration Sapphire** | 🟡 | Create→Buy→Graduate→RetryList smoke (funded key). |
| 9.3 | **UI E2E** | 🟡 | Create, 1-click buy, trades dedupe, holders note. |
| 9.4 | **`audit:onchain` in CI** | ⬜ | Cron so params API vs chain. |
| 9.5 | **Load / soak** | ⬜ | Concurrent Buy near graduation. |

---

## 10. Thứ tự làm việc đề xuất (roadmap)

### Phase A — Giữ Sapphire beta (1–2 tuần)
- [ ] Rotate PAT token-resource bền
- [ ] Theo dõi / ping merge PR logo #55
- [ ] Runbook ops v1 (fees, list fail, ClaimWugnot)
- [ ] Docs disclaimer + Buyers/Holders semantics
- [ ] Fix Netlify quota / API reliability
- [ ] Push private backend nếu còn commit local

### Phase B — Chuẩn bị mainnet pad (2–6 tuần)
- [ ] Spec kinh tế (raise, virtual, fee, bond, list fee)
- [ ] Implement `padvN` + tests
- [ ] Deep audit gnoswap_list + ammmath
- [ ] External audit kickoff
- [ ] Hub switch procedure
- [ ] Multisig protocol

### Phase C — Soft launch mainnet
- [ ] Deploy pad + Init + hub register
- [ ] Smoke: 1 create → trade → graduate → list
- [ ] Monitoring alerts live
- [ ] Cap TVL / raise nhỏ lần 1 (optional)
- [ ] Public announcement + known limitations

### Phase D — Post-launch
- [ ] Holder indexer
- [ ] Volume 24h from indexer
- [ ] Bug bounty
- [ ] Points (optional)

---

## 11. “Done” cho từng tầng

| Tầng | Được gọi là xong khi… |
|------|------------------------|
| **Beta Sapphire** | Không panic path chính; list được; UI khớp params; ops biết claim/list |
| **Mainnet soft** | Pad mới + audit tối thiểu + multisig + smoke list + disclaimer |
| **Mainnet full** | Audit ngoài closed + monitoring + holder story + logo pipeline ổn + runbook thử fire-drill |

---

## 12. Liên kết nội bộ

- Token logos GitHub: `docs/token-resource/GITHUB_SETUP.md`
- On-chain audit script: `npm run audit:onchain`
- Holders/volume audit: `node scripts/audit-holders-volume.mjs`
- Live pad: `…/gnomemepad/padv22` @ sapphire-1
