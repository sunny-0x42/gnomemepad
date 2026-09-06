import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "../components/ui";
import { useApp } from "../context/AppContext";
import { usePrefs } from "../context/PrefsContext";
import { api } from "../lib/api";
import { fmtGrouped, UGNOT_PER_GNOT } from "../lib/format";
import { listClientNetworks } from "../lib/networks";

/**
 * End-user Guide. Raise / fee / list-fee come from live `/api/params` for the
 * selected network (and peer networks in the Networks table). Pad packages are
 * immutable — thresholds can differ by padv* and may be retuned on newer pads.
 */

function padLabelFromPkg(pkg) {
  const m = String(pkg || "").match(/padv(\d+)/i);
  return m ? `padv${m[1]}` : null;
}

/** Fallback raise (GNOT) when ParamsInfo is unreachable — keyed by pad version. */
function fallbackRaiseGnot(pkg) {
  const m = String(pkg || "").match(/padv(\d+)/i);
  if (!m) return null;
  const v = Number(m[1]);
  if (v >= 23) return 10_000;
  if (v >= 22) return 500;
  if (v >= 14) return 500;
  return null;
}

function feePctLabel(feeBps) {
  const bps = Number(feeBps);
  if (!Number.isFinite(bps) || bps < 0) return "—";
  return `${(bps / 100).toFixed(2)}%`;
}

function raiseGnotOf(params, pkg) {
  if (params?.graduationGnot != null && Number.isFinite(Number(params.graduationGnot))) {
    return Number(params.graduationGnot);
  }
  if (params?.graduation != null && Number.isFinite(Number(params.graduation))) {
    return Number(params.graduation) / UGNOT_PER_GNOT;
  }
  return fallbackRaiseGnot(pkg);
}

function listFeeUnitsOf(params) {
  if (params?.listFeeGnsUnits != null && Number(params.listFeeGnsUnits) > 0) {
    return Number(params.listFeeGnsUnits);
  }
  if (params?.listFeeGns != null && Number(params.listFeeGns) > 0) {
    return Number(params.listFeeGns) / 1e6;
  }
  return 100;
}

function FaqItem({ q, children, open }) {
  return (
    <details className="docs-faq" open={open || undefined}>
      <summary>{q}</summary>
      <div className="docs-faq-body">{children}</div>
    </details>
  );
}

export default function Docs() {
  const { lang } = usePrefs();
  const vi = lang === "vi";
  const t = (en, vn) => (vi ? vn : en);

  const { networkId, health, pkg: livePkg } = useApp();
  const selectedPkg = health?.pkg || livePkg || null;
  const selectedPad = padLabelFromPkg(selectedPkg);

  const [paramsByNet, setParamsByNet] = useState({});
  const [paramsErr, setParamsErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const nets = listClientNetworks().filter((n) => n.enabled && n.pkg);
    Promise.all(
      nets.map(async (n) => {
        try {
          const p = await api("/api/params", { network: n.id });
          return [n.id, { ok: true, params: p, pkg: n.pkg }];
        } catch (e) {
          return [
            n.id,
            {
              ok: false,
              params: null,
              pkg: n.pkg,
              error: String(e?.message || e),
            },
          ];
        }
      }),
    ).then((rows) => {
      if (cancelled) return;
      const map = Object.fromEntries(rows);
      setParamsByNet(map);
      const cur = map[networkId];
      setParamsErr(cur && !cur.ok ? cur.error : null);
    });
    return () => {
      cancelled = true;
    };
  }, [networkId]);

  const curEntry = paramsByNet[networkId];
  const curParams = curEntry?.params || null;
  const curPkg = selectedPkg || curEntry?.pkg || null;
  const raiseGnot = raiseGnotOf(curParams, curPkg);
  const feeLabel = feePctLabel(curParams?.feeBps ?? 120);
  const listFee = listFeeUnitsOf(curParams);
  const raiseLive = curParams?.graduationGnot != null || curParams?.graduation != null;

  const raiseDisplay = useMemo(() => {
    if (raiseGnot == null || !Number.isFinite(raiseGnot)) return "—";
    return `${fmtGrouped(raiseGnot, { maxFrac: 0 })} GNOT`;
  }, [raiseGnot]);

  const enabledNets = listClientNetworks().filter((n) => n.enabled && n.pkg);

  return (
    <section className="view">
      <article className="docs">
        <PageHeader
          kicker={t("Docs", "Tài liệu")}
          title={t("Guide", "Hướng dẫn")}
          lede={t(
            "Fair launch on Gno.land: bonding curve → graduate → locked Gnoswap LP. Numbers below follow the live pad for your selected network.",
            "Fair launch trên Gno.land: bonding curve → graduate → LP Gnoswap khóa. Số liệu theo pad live của network bạn đang chọn.",
          )}
        />

        <div className="docs-meta-bar" aria-live="polite">
          <span className="docs-chip">
            {t("Network", "Network")}: <strong>{networkId}</strong>
          </span>
          {selectedPad && (
            <span className="docs-chip mono">
              {selectedPad}
            </span>
          )}
          <span className="docs-chip">
            {t("Raise", "Raise")}: <strong>{raiseDisplay}</strong>
            {!raiseLive && raiseGnot != null && (
              <span className="docs-chip-hint">
                {" "}
                ({t("pad default", "mặc định pad")})
              </span>
            )}
          </span>
          <span className="docs-chip">
            {t("Curve fee", "Phí curve")}: <strong>{feeLabel}</strong>
          </span>
        </div>

        <aside className="docs-callout docs-callout-warn" id="safety">
          <strong>{t("Before you trade", "Trước khi trade")}</strong>
          <ul className="docs-tight">
            <li>
              {t(
                "Non-custodial: you sign with Adena. Site APIs are read-only — no server keys.",
                "Non-custodial: bạn ký bằng Adena. API trang chỉ đọc — không có key trên server.",
              )}
            </li>
            <li>
              {t(
                "Testnets only (Sapphire / Pearl). Tokens have no guaranteed value. Not investment advice.",
                "Chỉ testnet (Sapphire / Pearl). Token không đảm bảo giá trị. Không phải lời khuyên đầu tư.",
              )}
            </li>
            <li>
              {t(
                "Anyone can deploy a launch on the pad. Gnomi Labs does not issue or vouch for each meme.",
                "Ai cũng deploy được launch trên pad. Gnomi Labs không phát hành hay bảo lãnh từng meme.",
              )}
            </li>
            <li>
              {t(
                "After a successful Gnoswap list, LP is permanently locked (pad holds the position NFT).",
                "Sau khi list Gnoswap thành công, LP khóa vĩnh viễn (pad giữ position NFT).",
              )}
            </li>
          </ul>
        </aside>

        <nav className="docs-toc" aria-label={t("Contents", "Mục lục")}>
          <a href="#overview">{t("Overview", "Tổng quan")}</a>
          <a href="#networks">{t("Networks", "Network")}</a>
          <a href="#flow">{t("Flow", "Luồng")}</a>
          <a href="#params">{t("Params", "Thông số")}</a>
          <a href="#start">{t("Start", "Bắt đầu")}</a>
          <a href="#create">{t("Create", "Tạo")}</a>
          <a href="#trade">{t("Trade", "Trade")}</a>
          <a href="#graduate">{t("Graduate", "Graduate")}</a>
          <a href="#after-list">{t("After list", "Sau list")}</a>
          <a href="#pages">{t("Pages", "Trang")}</a>
          <a href="#fees">{t("Fees", "Phí")}</a>
          <a href="#faq">{t("FAQ", "FAQ")}</a>
          <a href="#glossary">{t("Glossary", "Thuật ngữ")}</a>
          <a href="#shortcuts">{t("Keys", "Phím")}</a>
        </nav>

        {/* ── Overview ── */}
        <section className="docs-section" id="overview">
          <h2>{t("Overview", "Tổng quan")}</h2>
          <p>
            {t(
              "Gnomi.fun is a permissionless meme launchpad on Gno.land. Creators open a fair curve with no pre-mint. Traders buy/sell until net raise hits the pad threshold; then the launch graduates and can list a Gnoswap pool. After list, liquidity is locked forever.",
              "Gnomi.fun là launchpad meme permissionless trên Gno.land. Creator mở curve công bằng, không pre-mint. Trader mua/bán đến khi net raise chạm ngưỡng pad; launch graduate và có thể list pool Gnoswap. Sau list, thanh khoản khóa vĩnh viễn.",
            )}
          </p>
          <ul className="docs-tight">
            <li>
              <strong>{t("Fair curve", "Curve công bằng")}:</strong>{" "}
              {t(
                "price moves with buys and sells; no team allocation at create.",
                "giá đi theo mua và bán; không cấp token cho team lúc create.",
              )}
            </li>
            <li>
              <strong>WUGNOT:</strong>{" "}
              {t(
                "curve collateral is wrapped GNOT (1:1). Buy usually wraps + funds the pad in one Adena sign.",
                "collateral curve là GNOT bọc (1:1). Mua thường wrap + nạp pad trong một lần ký Adena.",
              )}
            </li>
            <li>
              <strong>Gnoswap:</strong>{" "}
              {t(
                "after list, curve trading closes; use on-page ExactIn or the Gnoswap app.",
                "sau list, trade curve đóng; dùng ExactIn trên trang hoặc app Gnoswap.",
              )}
            </li>
          </ul>
        </section>

        {/* ── Networks ── */}
        <section className="docs-section" id="networks">
          <h2>{t("Networks", "Network")}</h2>
          <p className="docs-lead">
            {t(
              "Use the header network switcher. Each chain has its own pad package and raise target — state does not carry across.",
              "Dùng network switcher trên header. Mỗi chain có pad package và raise riêng — state không mang sang nhau.",
            )}
          </p>
          <div className="docs-table-wrap">
            <table className="docs-table docs-table-compact">
              <thead>
                <tr>
                  <th>{t("Network", "Network")}</th>
                  <th>Pad</th>
                  <th>{t("Raise target", "Mục tiêu raise")}</th>
                  <th>{t("Source", "Nguồn")}</th>
                </tr>
              </thead>
              <tbody>
                {enabledNets.map((n) => {
                  const entry = paramsByNet[n.id];
                  const pad = padLabelFromPkg(entry?.pkg || n.pkg);
                  const g = raiseGnotOf(entry?.params, entry?.pkg || n.pkg);
                  const live =
                    entry?.params?.graduationGnot != null ||
                    entry?.params?.graduation != null;
                  const active = n.id === networkId;
                  return (
                    <tr key={n.id} className={active ? "docs-row-active" : undefined}>
                      <td>
                        <strong>{n.label}</strong>
                        <div className="docs-hint mono">{n.chainId}</div>
                        {active && (
                          <span className="docs-pill">
                            {t("selected", "đang chọn")}
                          </span>
                        )}
                      </td>
                      <td className="mono">{pad || "—"}</td>
                      <td>
                        <strong>
                          {g != null ? `${fmtGrouped(g, { maxFrac: 0 })} GNOT` : "—"}
                        </strong>
                      </td>
                      <td className="docs-hint">
                        {live
                          ? t("live ParamsInfo", "ParamsInfo live")
                          : entry?.ok === false
                            ? t("pad default (API fail)", "mặc định pad (API lỗi)")
                            : t("loading…", "đang tải…")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="docs-hint docs-mt">
            {t(
              "Raise can change on newer pad versions (or live retunes). Always trust Create / token page / ParamsInfo over this Guide cache.",
              "Raise có thể đổi trên pad version mới (hoặc retune live). Luôn tin Create / trang token / ParamsInfo hơn cache Guide.",
            )}
          </p>
          {paramsErr && (
            <p className="docs-callout docs-callout-warn docs-mt">
              {t("Could not refresh live params for the selected network:", "Không tải được params live cho network đang chọn:")}{" "}
              <span className="mono">{paramsErr}</span>
            </p>
          )}
        </section>

        {/* ── Flow ── */}
        <section className="docs-section" id="flow">
          <h2>{t("Launch flow", "Luồng launch")}</h2>
          <div className="flow-diagram" aria-hidden>
            <div className="flow-step">
              <strong>1. Create</strong>
              <span>{t("Bond + curve", "Bond + curve")}</span>
            </div>
            <div className="flow-arrow">→</div>
            <div className="flow-step">
              <strong>2. Trade</strong>
              <span>{t("Buy / sell", "Mua / bán")}</span>
            </div>
            <div className="flow-arrow">→</div>
            <div className="flow-step">
              <strong>3. Graduate</strong>
              <span>{t("Hit raise", "Chạm raise")}</span>
            </div>
            <div className="flow-arrow">→</div>
            <div className="flow-step">
              <strong>4. List</strong>
              <span>{t("Gnoswap LP", "LP Gnoswap")}</span>
            </div>
          </div>
          <ol className="docs-steps docs-tight">
            <li>
              {t(
                "Creator pays a creation bond and (when required) escrows GNS for CreatePool, then opens a fair curve.",
                "Creator trả bond và (khi cần) khóa GNS cho CreatePool, rồi mở curve công bằng.",
              )}
            </li>
            <li>
              {t(
                "Traders buy/sell with GNOT→WUGNOT. Price moves both ways on the curve.",
                "Trader mua/bán bằng GNOT→WUGNOT. Giá đi cả hai chiều trên curve.",
              )}
            </li>
            <li>
              {t(
                "When net raised hits the pad threshold, the launch graduates. Remaining tokens + raised WUGNOT seed LP inventory.",
                "Khi net raised chạm ngưỡng pad, launch graduate. Token còn lại + WUGNOT raised seed inventory LP.",
              )}
            </li>
            <li>
              {t(
                "A separate List tx creates the Gnoswap pool when GNS/WUGNOT checklist is ready. Curve trading then closes.",
                "Tx List riêng tạo pool Gnoswap khi checklist GNS/WUGNOT sẵn. Trade curve sau đó đóng.",
              )}
            </li>
          </ol>
        </section>

        {/* ── Parameters ── */}
        <section className="docs-section" id="params">
          <h2>
            {t("Parameters", "Thông số")}
            {selectedPad ? (
              <span className="docs-h2-meta mono"> · {selectedPad}</span>
            ) : null}
          </h2>
          <p className="docs-lead">
            {t(
              "For the network currently selected in the header. Bond/promo can still change via the bond module — check Create before you sign.",
              "Theo network đang chọn trên header. Bond/promo vẫn có thể đổi qua module bond — xem Create trước khi ký.",
            )}
          </p>
          <div className="docs-stat-grid">
            <div className="docs-stat">
              <span className="docs-stat-k">{t("Raise target", "Mục tiêu raise")}</span>
              <span className="docs-stat-v">{raiseDisplay}</span>
              <span className="docs-stat-s">
                {raiseLive
                  ? t("live · net WUGNOT into curve", "live · net WUGNOT vào curve")
                  : t("fallback by pad version", "fallback theo pad version")}
              </span>
            </div>
            <div className="docs-stat">
              <span className="docs-stat-k">{t("Curve fee", "Phí curve")}</span>
              <span className="docs-stat-v">{feeLabel}</span>
              <span className="docs-stat-s">40% creator · 40% protocol · 20% LP</span>
            </div>
            <div className="docs-stat">
              <span className="docs-stat-k">{t("List fee", "Phí list")}</span>
              <span className="docs-stat-v">~{fmtGrouped(listFee, { maxFrac: 0 })} GNS</span>
              <span className="docs-stat-s">Gnoswap CreatePool</span>
            </div>
            <div className="docs-stat">
              <span className="docs-stat-k">Tokenomics</span>
              <span className="docs-stat-v">1B</span>
              <span className="docs-stat-s">
                {t(
                  "~80% max on curve · all unsold → LP",
                  "~80% tối đa trên curve · mọi phần chưa bán → LP",
                )}
              </span>
            </div>
          </div>
          <div className="docs-table-wrap docs-mt">
            <table className="docs-table docs-table-compact">
              <tbody>
                <tr>
                  <th>{t("Collateral", "Collateral")}</th>
                  <td>
                    <strong>WUGNOT</strong> (1:1 GNOT)
                  </td>
                </tr>
                <tr>
                  <th>{t("Creation bond", "Bond tạo coin")}</th>
                  <td>
                    {t(
                      "From bond module (promo or normal). Shown on Create.",
                      "Theo module bond (promo hoặc normal). Hiện trên Create.",
                    )}
                  </td>
                </tr>
                <tr>
                  <th>{t("Anti-snipe", "Anti-snipe")}</th>
                  <td>
                    {t(
                      "Early heights: per-address max buy cap (on-chain). See ParamsInfo / token page for live values.",
                      "Vài block đầu: giới hạn mua theo địa chỉ (on-chain). Xem ParamsInfo / trang token cho số live.",
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* ── Get started ── */}
        <section className="docs-section" id="start">
          <h2>{t("Get started", "Bắt đầu")}</h2>
          <ol className="docs-steps docs-tight">
            <li>
              <strong>Adena</strong> —{" "}
              <a href="https://adena.app/" target="_blank" rel="noreferrer">
                adena.app
              </a>
              {t(
                " browser wallet. Fund it with test GNOT for the network you pick.",
                " ví trình duyệt. Nạp GNOT test cho network bạn chọn.",
              )}
            </li>
            <li>
              {t("In the Gnomi header, select", "Trên header Gnomi, chọn")}{" "}
              <strong>Sapphire</strong> {t("or", "hoặc")} <strong>Pearl</strong>
              {t(", then match that chain in Adena.", ", rồi khớp chain đó trong Adena.")}
            </li>
            <li>
              {t("Open", "Mở")}{" "}
              <a href="https://gnomi.fun" target="_blank" rel="noreferrer">
                gnomi.fun
              </a>
              , {t("tap", "bấm")} <strong>{t("Connect", "Kết nối")}</strong>.
            </li>
            <li>
              <Link to="/">{t("Browse markets", "Xem thị trường")}</Link>
              {t(" or ", " hoặc ")}
              <Link to="/create">{t("create a launch", "tạo launch")}</Link>.
            </li>
          </ol>
        </section>

        {/* ── Create ── */}
        <section className="docs-section" id="create">
          <h2>{t("Create a coin", "Tạo coin")}</h2>
          <p>
            {t(
              "Open Create, connect, fill name / symbol / optional description, image URL, and socials. You are deploying a launch on the pad — not minting a “Gnomi-issued” coin.",
              "Vào Create, kết nối, điền name / symbol / mô tả (tuỳ chọn), URL ảnh và social. Bạn đang deploy launch trên pad — không phải mint coin “do Gnomi phát hành”.",
            )}
          </p>
          <ul className="docs-tight">
            <li>
              <strong>{t("Bond", "Bond")}:</strong>{" "}
              {t("paid with Create (promo may be lower for a limited window).", "trả cùng Create (promo có thể rẻ hơn trong thời gian giới hạn).")}
            </li>
            <li>
              <strong>GNS:</strong>{" "}
              {t(
                "when the pad requires it, transfer free GNS to the pad first (UI guides this); Create locks it per launch for CreatePool.",
                "khi pad yêu cầu, Transfer GNS free vào pad trước (UI hướng dẫn); Create khóa theo launch cho CreatePool.",
              )}
            </li>
            <li>
              <strong>{t("Fair launch", "Fair launch")}:</strong>{" "}
              {t("no pre-mint to creator. Everyone buys from the open curve.", "không pre-mint cho creator. Mọi người mua từ curve mở.")}
            </li>
          </ul>
          <p>
            {t("After success, open the token page and share the link. Buys are always the user’s own choice and signature.", "Sau khi thành công, mở trang token và chia sẻ link. Mọi lệnh mua do user tự quyết và tự ký.")}{" "}
            <Link to="/create">{t("Go to Create →", "Tới Create →")}</Link>
          </p>
        </section>

        {/* ── Trade ── */}
        <section className="docs-section" id="trade">
          <h2>{t("Buy & sell on the curve", "Mua & bán trên curve")}</h2>
          <h3>{t("Buy (1-click)", "Mua (1-click)")}</h3>
          <p>
            {t(
              "Enter GNOT (or quick % ). One Adena approval typically wraps GNOT→WUGNOT if needed, funds the pad, then Buy.",
              "Nhập GNOT (hoặc quick %). Một lần duyệt Adena thường wrap GNOT→WUGNOT nếu thiếu, nạp pad, rồi Buy.",
            )}
          </p>
          <ul className="docs-tight">
            <li>
              <strong>{t("Fill rest", "Đổ nốt")}:</strong>{" "}
              {t(
                "near full raise, sets the exact fee-adjusted gross to hit 100%.",
                "khi gần đầy raise, đặt đúng gross đã tính phí để chạm 100%.",
              )}
            </li>
            <li>
              <strong>{t("Slippage", "Slippage")}:</strong>{" "}
              {t("protects you if the curve moves before inclusion.", "bảo vệ nếu curve đổi trước khi tx vào block.")}
            </li>
            <li>
              <strong>Prepaid / ClaimWugnot:</strong>{" "}
              {t(
                "overpay or leftover WUGNOT can stay as prepaid credit on the pad. Reuse on later buys, or claim via ClaimWugnot when the UI / gnoweb path is available.",
                "overpay hoặc WUGNOT dư có thể nằm prepaid trên pad. Dùng lại cho buy sau, hoặc claim qua ClaimWugnot khi UI / gnoweb hỗ trợ.",
              )}
            </li>
          </ul>
          <h3>{t("Sell", "Bán")}</h3>
          <p>
            {t(
              "Sell returns WUGNOT after the curve fee. Unwrap with wugnot.Withdraw if you need native GNOT. After Gnoswap list, use ExactIn controls — curve trading is closed.",
              "Bán trả WUGNOT sau phí curve. Unwrap bằng wugnot.Withdraw nếu cần GNOT native. Sau list Gnoswap, dùng ExactIn — curve đã đóng.",
            )}
          </p>
          <h3>{t("Chart & activity", "Biểu đồ & activity")}</h3>
          <p>
            {t(
              "Token chart timeframes: S · 1m · 5m · 1H · D from on-chain trades (and Gnoswap history after list when available). Markets shows a live activity ticker.",
              "Timeframe chart: S · 1m · 5m · 1H · D từ trade on-chain (và history Gnoswap sau list khi có). Markets có ticker activity.",
            )}
          </p>
        </section>

        {/* ── Graduate ── */}
        <section className="docs-section" id="graduate">
          <h2>{t("Graduate & list", "Graduate & list")}</h2>
          <ol className="docs-steps docs-tight">
            <li>
              <strong>{t("Raise fills", "Raise đầy")}</strong> —{" "}
              {t("net WUGNOT raised reaches", "net WUGNOT raised đạt")}{" "}
              <strong>{raiseDisplay}</strong>{" "}
              {t("(for the active pad).", "(theo pad đang active).")}
            </li>
            <li>
              <strong>Graduate</strong> —{" "}
              {t(
                "leaves the open curve; LP inventory is prepared from raised collateral + every unsold token.",
                "rời curve mở; inventory LP từ collateral raised + mọi token chưa bán.",
              )}
            </li>
            <li>
              <strong>{t("List on Gnoswap", "List Gnoswap")}</strong> —{" "}
              {t(
                "EOA List / Retry when the token-page checklist is green (~",
                "EOA List / Retry khi checklist trang token xanh (~",
              )}
              {fmtGrouped(listFee, { maxFrac: 0 })} GNS
              {t(
                "). The UI may prompt list when ready — it is not an on-chain auto inside Buy/Graduate.",
                "). UI có thể gợi ý list khi sẵn — không phải auto on-chain bên trong Buy/Graduate.",
              )}
            </li>
            <li>
              <strong>{t("LP lock", "Khóa LP")}</strong> —{" "}
              {t(
                "successful list mints the position to the pad. There is no remove-liquidity path for users or creators.",
                "list thành công mint position về pad. Không có đường remove-liquidity cho user hay creator.",
              )}
            </li>
          </ol>
          <p className="docs-callout">
            {t(
              "If list is skipped for missing GNS or WUGNOT, complete the checklist, then Retry List. Temporary wrap from your wallet for LP is reimbursed from raised ugnot when the flow says so.",
              "Nếu list bị skip vì thiếu GNS/WUGNOT, hoàn checklist rồi Retry List. Wrap tạm từ ví cho LP được hoàn từ ugnot raised khi UI ghi rõ.",
            )}
          </p>
        </section>

        {/* ── After list ── */}
        <section className="docs-section" id="after-list">
          <h2>{t("After list (Gnoswap)", "Sau list (Gnoswap)")}</h2>
          <ul className="docs-tight">
            <li>
              {t(
                "Curve Buy/Sell is closed. Use on-page ExactIn (Deposit → Approve → swap) or open the pool on Gnoswap.",
                "Buy/Sell curve đã đóng. Dùng ExactIn trên trang (Deposit → Approve → swap) hoặc mở pool trên Gnoswap.",
              )}
            </li>
            <li>
              {t(
                "Swap fee = Gnoswap pool tier only (meme pools often 0.3%). The pad curve fee (",
                "Phí swap = fee tier Gnoswap (meme thường 0.3%). Phí curve pad (",
              )}
              {feeLabel}
              {t(") no longer applies.", ") không còn áp dụng.")}
            </li>
          </ul>
        </section>

        {/* ── Pages ── */}
        <section className="docs-section" id="pages">
          <h2>{t("App pages", "Các trang")}</h2>
          <div className="docs-table-wrap">
            <table className="docs-table docs-table-compact docs-table-pages">
              <thead>
                <tr>
                  <th>{t("Page", "Trang")}</th>
                  <th>{t("For", "Dùng để")}</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <Link to="/">{t("Markets", "Thị trường")}</Link>
                  </td>
                  <td>
                    {t(
                      "Discover launches, filters, watchlist. FDV/mcap are estimates — not promises.",
                      "Khám phá launch, lọc, watchlist. FDV/mcap là ước tính — không phải cam kết.",
                    )}
                  </td>
                </tr>
                <tr>
                  <td>
                    <Link to="/create">{t("Create", "Tạo")}</Link>
                  </td>
                  <td>{t("Deploy a new fair curve launch.", "Deploy launch curve mới.")}</td>
                </tr>
                <tr>
                  <td>
                    <Link to="/portfolio">{t("Portfolio", "Danh mục")}</Link>
                  </td>
                  <td>
                    {t(
                      "GNOT / WUGNOT and meme positions. Est. PnL ≠ realized fills.",
                      "GNOT / WUGNOT và vị thế meme. PnL ước tính ≠ đã chốt.",
                    )}
                  </td>
                </tr>
                <tr>
                  <td>
                    <Link to="/leaderboard">{t("Leaderboard", "BXH")}</Link>
                  </td>
                  <td>
                    {t(
                      "Top traders / creators — estimates only.",
                      "Top trader / creator — chỉ ước tính.",
                    )}
                  </td>
                </tr>
                <tr>
                  <td>
                    <Link to="/creator">{t("Creator", "Creator")}</Link>
                  </td>
                  <td>
                    {t("Your launches and creator fee claims.", "Launch của bạn và claim phí creator.")}
                  </td>
                </tr>
                <tr>
                  <td>
                    <Link to="/rewards">{t("Rewards", "Điểm")}</Link>
                  </td>
                  <td>
                    {t(
                      "Check-in, referral, points — points are not withdrawable value or APR.",
                      "Check-in, referral, điểm — điểm không phải giá trị rút được hay APR.",
                    )}
                  </td>
                </tr>
                <tr>
                  <td>
                    <Link to="/ops">Ops</Link>
                  </td>
                  <td>
                    {t(
                      "Read-only RPC / module health — not admin actions.",
                      "Sức khỏe RPC / module chỉ đọc — không phải thao tác admin.",
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* ── Fees ── */}
        <section className="docs-section" id="fees">
          <h2>{t("Fees", "Phí")}</h2>
          <ul className="docs-tight">
            <li>
              <strong>
                {t("Curve trade", "Trade curve")} {feeLabel}
              </strong>{" "}
              —{" "}
              {t(
                "only on pad buy/sell. Split 40% creator / 40% protocol / 20% LP remainder.",
                "chỉ trên mua/bán pad. Chia 40% creator / 40% protocol / 20% LP.",
              )}
            </li>
            <li>
              <strong>{t("Post-list ExactIn", "ExactIn sau list")}</strong> —{" "}
              {t(
                "Gnoswap pool fee only (often 0.3%). No pad curve fee.",
                "chỉ phí pool Gnoswap (thường 0.3%). Không còn phí curve pad.",
              )}
            </li>
            <li>
              <strong>{t("Creation bond", "Bond tạo coin")}</strong> —{" "}
              {t("GNOT at Create (bond module / promo).", "GNOT lúc Create (module bond / promo).")}
            </li>
            <li>
              <strong>~{fmtGrouped(listFee, { maxFrac: 0 })} GNS</strong> —{" "}
              {t(
                "CreatePool list fee (escrow at Create when required).",
                "phí CreatePool khi list (escrow lúc Create khi pad yêu cầu).",
              )}
            </li>
            <li>
              <strong>{t("Network gas", "Gas")}</strong> —{" "}
              {t(
                "ugnot/GNOT per signed tx (Adena shows estimate).",
                "ugnot/GNOT mỗi tx ký (Adena hiện ước lượng).",
              )}
            </li>
          </ul>
        </section>

        {/* ── FAQ ── */}
        <section className="docs-section" id="faq">
          <h2>FAQ</h2>
          <div className="docs-faq-list">
            <FaqItem q={t("Wallet won’t connect", "Không kết nối ví")}>
              {t(
                "Install Adena, unlock it, select the same network as the Gnomi header (Sapphire or Pearl), refresh, then Connect.",
                "Cài Adena, mở khóa, chọn cùng network với header Gnomi (Sapphire hoặc Pearl), refresh, rồi Connect.",
              )}
            </FaqItem>
            <FaqItem q={t("What’s different on Pearl vs Sapphire?", "Pearl khác Sapphire thế nào?")}>
              {t(
                "Separate chains and pad packages. Raise targets and markets do not share state — see Networks above for live numbers.",
                "Hai chain và pad package riêng. Raise và markets không share state — xem Networks phía trên cho số live.",
              )}
            </FaqItem>
            <FaqItem q={t("Buy fails / insufficient funds", "Mua fail / thiếu quỹ")}>
              {t(
                "Need GNOT for spend + gas. Leave headroom for wrap and fee. Near full raise, use Fill rest.",
                "Cần GNOT cho lệnh + gas. Để dư cho wrap và phí. Gần đầy raise, dùng Đổ nốt.",
              )}
            </FaqItem>
            <FaqItem q={t("List skipped / need GNS", "List bị skip / thiếu GNS")}>
              {t("Pad needs ~", "Pad cần ~")}
              {fmtGrouped(listFee, { maxFrac: 0 })}
              {t(
                " GNS (or fee path) and enough WUGNOT for LP. Finish the token checklist, then List / Retry.",
                " GNS (hoặc path phí) và đủ WUGNOT cho LP. Xong checklist trang token, rồi List / Retry.",
              )}
            </FaqItem>
            <FaqItem q={t("Stale markets / empty chart", "Markets cũ / chart trống")}>
              {t(
                "Refresh; check Ops for RPC health. New launches need at least one trade for chart points. API timeouts can briefly 502 on heavy Sapphire reads.",
                "Refresh; xem Ops cho RPC. Launch mới cần ít nhất một trade để có điểm chart. API nặng trên Sapphire có thể 502 tạm thời.",
              )}
            </FaqItem>
            <FaqItem q={t("Is this mainnet?", "Đây có phải mainnet?")}>
              {t(
                "No — Sapphire and Pearl are testnets. Mainnet appears as coming soon until enabled. Do not assume mainnet behavior from testnet numbers.",
                "Không — Sapphire và Pearl là testnet. Mainnet hiện coming soon cho đến khi bật. Đừng suy ra mainnet từ số testnet.",
              )}
            </FaqItem>
          </div>
        </section>

        {/* ── Glossary ── */}
        <section className="docs-section" id="glossary">
          <h2>{t("Glossary", "Thuật ngữ")}</h2>
          <dl className="docs-dl docs-dl-compact">
            <dt>GNOT / ugnot</dt>
            <dd>
              {t(
                "Native token. 1 GNOT = 1,000,000 ugnot.",
                "Token native. 1 GNOT = 1.000.000 ugnot.",
              )}
            </dd>
            <dt>WUGNOT</dt>
            <dd>
              {t(
                "Wrapped GNOT for curve + LP collateral (1:1).",
                "GNOT bọc cho curve + LP (1:1).",
              )}
            </dd>
            <dt>Raise</dt>
            <dd>
              {t(
                "Net WUGNOT into the curve toward the pad graduation threshold (live per pad version).",
                "Net WUGNOT vào curve hướng tới ngưỡng graduate của pad (live theo pad version).",
              )}
            </dd>
            <dt>FDV / mcap</dt>
            <dd>
              {t(
                "Spot × supply. Can look high early because of virtual reserves — not cash raised.",
                "Spot × supply. Có thể cao sớm vì virtual reserve — khác số đã raise.",
              )}
            </dd>
            <dt>ClaimWugnot</dt>
            <dd>
              {t(
                "Claim prepaid / leftover WUGNOT credit on the pad.",
                "Claim prepaid / WUGNOT credit dư trên pad.",
              )}
            </dd>
            <dt>ExactIn</dt>
            <dd>
              {t(
                "Post-list Gnoswap swap path on the token page.",
                "Đường swap Gnoswap sau list trên trang token.",
              )}
            </dd>
            <dt>LP lock</dt>
            <dd>
              {t(
                "After list, position NFT stays on the pad — no remove path.",
                "Sau list, position NFT nằm trên pad — không có đường remove.",
              )}
            </dd>
          </dl>
        </section>

        {/* ── Shortcuts ── */}
        <section className="docs-section" id="shortcuts">
          <h2>{t("Shortcuts", "Phím tắt")}</h2>
          <ul className="docs-tight">
            <li>
              <kbd className="kbd">Ctrl</kbd> / <kbd className="kbd">⌘</kbd> +{" "}
              <kbd className="kbd">K</kbd> — {t("Command palette", "Command palette")}
            </li>
            <li>
              <kbd className="kbd">Ctrl</kbd> / <kbd className="kbd">⌘</kbd> +{" "}
              <kbd className="kbd">,</kbd> — {t("Settings", "Cài đặt")}
            </li>
            <li>
              {t("Trade panel", "Panel trade")}:{" "}
              <kbd className="kbd">1</kbd>–<kbd className="kbd">4</kbd> = 25% / 50% / 75% / Max ·{" "}
              <kbd className="kbd">Enter</kbd> {t("submit", "gửi")}
            </li>
          </ul>
        </section>

        <section className="docs-section docs-footer-links">
          <h2>{t("Links", "Liên kết")}</h2>
          <ul>
            <li>
              <a href="https://adena.app/" target="_blank" rel="noreferrer">
                Adena
              </a>
            </li>
            <li>
              <a href="https://gno.land/" target="_blank" rel="noreferrer">
                gno.land
              </a>
            </li>
            <li>
              <a href="https://gnoswap.io/" target="_blank" rel="noreferrer">
                Gnoswap
              </a>
            </li>
            <li>
              <Link to="/">{t("Markets", "Thị trường")}</Link>
            </li>
            <li>
              <Link to="/create">{t("Create", "Tạo launch")}</Link>
            </li>
            <li>
              <a href="#safety">{t("Safety", "An toàn")}</a>
            </li>
          </ul>
        </section>
      </article>
    </section>
  );
}
