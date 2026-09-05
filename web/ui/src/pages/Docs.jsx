import { Link } from "react-router-dom";
import { PageHeader } from "../components/ui";
import { usePrefs } from "../context/PrefsContext";

/**
 * End-user guide only (no admin / deploy / gnokey ops).
 * Numbers match live Sapphire padv22 params when known; wording stays general where
 * bond/promo can change on-chain.
 */
export default function Docs() {
  const { lang } = usePrefs();
  const vi = lang === "vi";

  const t = (en, vn) => (vi ? vn : en);

  return (
    <section className="view">
      <article className="docs">
        <PageHeader
          kicker={t("Docs", "Tài liệu")}
          title={t("Guide", "Hướng dẫn")}
          lede={t(
            "How gnomemepad works on Gno Sapphire: fair launch, WUGNOT bonding curve, graduate, then trade on Gnoswap.",
            "Cách gnomemepad hoạt động trên Gno Sapphire: fair launch, bonding curve WUGNOT, graduate, rồi giao dịch trên Gnoswap.",
          )}
        />

        <nav className="docs-toc" aria-label={t("Contents", "Mục lục")}>
          <a href="#overview">{t("Overview", "Tổng quan")}</a>
          <a href="#flow">{t("Launch flow", "Luồng launch")}</a>
          <a href="#params">{t("Parameters", "Thông số")}</a>
          <a href="#start">{t("Get started", "Bắt đầu")}</a>
          <a href="#create">{t("Create", "Tạo coin")}</a>
          <a href="#trade">{t("Trade", "Giao dịch")}</a>
          <a href="#graduate">{t("Graduate & list", "Graduate & list")}</a>
          <a href="#pages">{t("App pages", "Các trang")}</a>
          <a href="#fees">{t("Fees", "Phí")}</a>
          <a href="#glossary">{t("Glossary", "Thuật ngữ")}</a>
          <a href="#troubleshoot">{t("Troubleshooting", "Xử trí sự cố")}</a>
          <a href="#shortcuts">{t("Shortcuts", "Phím tắt")}</a>
        </nav>

        {/* ── Overview ── */}
        <section className="docs-section" id="overview">
          <h2>{t("Overview", "Tổng quan")}</h2>
          <p>
            {t(
              "gnomemepad is a meme launchpad on Gno.land Sapphire testnet. Anyone can create a coin with no pre-mint. Buyers trade on a bonding curve until the raise target is hit; then the launch graduates and can list a Gnoswap pool for open market trading.",
              "gnomemepad là launchpad meme trên Gno.land Sapphire testnet. Ai cũng tạo được coin, không pre-mint. Mua bán trên bonding curve đến khi đạt mục tiêu raise; launch graduate và có thể list pool Gnoswap để giao dịch tự do.",
            )}
          </p>
          <ul>
            <li>
              <strong>{t("Fair curve", "Curve công bằng")}:</strong>{" "}
              {t(
                "price moves with buys/sells; no team allocation at create.",
                "giá đi theo mua/bán; không cấp token cho team lúc create.",
              )}
            </li>
            <li>
              <strong>WUGNOT:</strong>{" "}
              {t(
                "curve collateral is wrapped GNOT (1 WUGNOT = 1 GNOT). The UI wraps and funds the pad in one Adena sign when you buy.",
                "tài sản curve là GNOT bọc (1 WUGNOT = 1 GNOT). UI wrap và nạp pad trong một lần ký Adena khi mua.",
              )}
            </li>
            <li>
              <strong>Gnoswap:</strong>{" "}
              {t(
                "after list, curve buy/sell closes; use on-page swap or the Gnoswap app.",
                "sau khi list, buy/sell curve tắt; dùng swap trên trang hoặc app Gnoswap.",
              )}
            </li>
          </ul>
          <p className="docs-callout">
            {t(
              "Testnet only. Tokens have no guaranteed value. Use small amounts of test GNOT and treat every launch as experimental.",
              "Chỉ testnet. Token không đảm bảo giá trị. Dùng ít GNOT test và coi mọi launch là thử nghiệm.",
            )}
          </p>
        </section>

        {/* ── Flow ── */}
        <section className="docs-section" id="flow">
          <h2>{t("Launch flow", "Luồng launch")}</h2>
          <div className="flow-diagram" aria-hidden>
            <div className="flow-step">
              <strong>1. Create</strong>
              <span>{t("Bond + open curve", "Bond + mở curve")}</span>
            </div>
            <div className="flow-arrow">→</div>
            <div className="flow-step">
              <strong>2. Trade</strong>
              <span>{t("Buy/sell on curve", "Mua/bán trên curve")}</span>
            </div>
            <div className="flow-arrow">→</div>
            <div className="flow-step">
              <strong>3. Graduate</strong>
              <span>{t("Hit raise target", "Đạt mục tiêu raise")}</span>
            </div>
            <div className="flow-arrow">→</div>
            <div className="flow-step">
              <strong>4. Gnoswap</strong>
              <span>{t("Pool + open swap", "Pool + swap tự do")}</span>
            </div>
          </div>
          <ol className="docs-steps">
            <li>
              {t(
                "Creator pays a creation bond and (when required) escrows GNS for the future CreatePool fee, then mints a fair curve launch.",
                "Creator trả bond tạo coin và (khi cần) khóa GNS cho phí CreatePool, rồi mở launch curve công bằng.",
              )}
            </li>
            <li>
              {t(
                "Traders buy with GNOT (wrapped to WUGNOT). Price rises along the curve; sells return WUGNOT.",
                "Trader mua bằng GNOT (wrap thành WUGNOT). Giá tăng theo curve; bán nhận lại WUGNOT.",
              )}
            </li>
            <li>
              {t(
                "When net raised hits the threshold, the launch graduates. Remaining tokens seed LP; raised WUGNOT becomes pool depth.",
                "Khi net raised chạm ngưỡng, launch graduate. Token còn lại seed LP; WUGNOT raised thành độ sâu pool.",
              )}
            </li>
            <li>
              {t(
                "List on Gnoswap creates the CL pool. Trading moves to the pool; curve pads closes.",
                "List Gnoswap tạo pool CL. Giao dịch chuyển sang pool; curve pad đóng.",
              )}
            </li>
          </ol>
        </section>

        {/* ── Parameters ── */}
        <section className="docs-section" id="params">
          <h2>{t("Current parameters (padv22)", "Thông số hiện tại (padv22)")}</h2>
          <p className="muted docs-lead">
            {t(
              "Live Sapphire defaults. Bond and promo rates can change via the bond module; always check Create and the token page.",
              "Mặc định live trên Sapphire. Bond/promo có thể đổi qua module bond; luôn xem trang Create và trang token.",
            )}
          </p>
          <div className="docs-table-wrap">
            <table className="docs-table">
              <tbody>
                <tr>
                  <th>{t("Curve collateral", "Tài sản curve")}</th>
                  <td>
                    <strong>WUGNOT</strong> (1:1 GNOT)
                  </td>
                </tr>
                <tr>
                  <th>{t("Raise target", "Mục tiêu raise")}</th>
                  <td>
                    <strong>500 GNOT</strong>{" "}
                    <span className="docs-hint">
                      {t(
                        "(WUGNOT 1:1 net into curve — live from pad ParamsInfo)",
                        "(WUGNOT 1:1 net vào curve — live từ pad ParamsInfo)",
                      )}
                    </span>
                  </td>
                </tr>
                <tr>
                  <th>Tokenomics</th>
                  <td>
                    {t(
                      "1B total · ~80% sold on curve · ~20% + unsold remainder seed LP at graduate",
                      "1B total · ~80% bán trên curve · ~20% + phần chưa bán seed LP lúc graduate",
                    )}
                  </td>
                </tr>
                <tr>
                  <th>{t("Trade fee", "Phí trade")}</th>
                  <td>
                    <strong>1.2%</strong> — 40% creator · 40% protocol · 20% LP/remainder
                  </td>
                </tr>
                <tr>
                  <th>{t("Creation bond", "Bond tạo coin")}</th>
                  <td>
                    {t(
                      "From bond module (promo or normal). Shown on Create before you sign.",
                      "Theo module bond (promo hoặc normal). Hiện trên Create trước khi ký.",
                    )}
                  </td>
                </tr>
                <tr>
                  <th>{t("List fee (GNS)", "Phí list (GNS)")}</th>
                  <td>
                    ~<strong>100 GNS</strong>{" "}
                    {t(
                      "for Gnoswap CreatePool — prefer escrow at Create so list does not hunt for GNS later.",
                      "cho CreatePool Gnoswap — nên khóa lúc Create để list không phải tìm GNS sau.",
                    )}
                  </td>
                </tr>
                <tr>
                  <th>{t("Anti-snipe", "Anti-snipe")}</th>
                  <td>
                    {t(
                      "Early heights: per-address max buy cap (on-chain).",
                      "Vài block đầu: giới hạn mua theo địa chỉ (on-chain).",
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
          <ol className="docs-steps">
            <li>
              <strong>Adena</strong> —{" "}
              <a href="https://adena.app/" target="_blank" rel="noreferrer">
                adena.app
              </a>
              {t(
                " browser wallet. Create or import a key; fund it with Sapphire test GNOT (faucet / community).",
                " ví trình duyệt. Tạo hoặc import key; nạp GNOT testnet Sapphire (faucet / community).",
              )}
            </li>
            <li>
              {t("Switch network to", "Chuyển network sang")} <strong>Sapphire</strong>{" "}
              <span className="mono faint">(sapphire-1)</span>.
            </li>
            <li>
              {t("Open", "Mở")}{" "}
              <a href="https://gnomemepad-sapphire.netlify.app" target="_blank" rel="noreferrer">
                gnomemepad
              </a>
              , {t("tap", "bấm")} <strong>{t("Connect", "Kết nối")}</strong>.
            </li>
            <li>
              <Link to="/">{t("Browse markets", "Xem thị trường")}</Link>
              {t(" to trade, or ", " để trade, hoặc ")}
              <Link to="/create">{t("create a launch", "tạo launch")}</Link>.
            </li>
          </ol>
        </section>

        {/* ── Create ── */}
        <section className="docs-section" id="create">
          <h2>{t("Create a coin", "Tạo coin")}</h2>
          <p>
            {t(
              "Open Create, connect wallet, and fill name, symbol, and optional description. Add an image URL and social links so the launch is easier to discover on Markets and token pages.",
              "Vào Create, kết nối ví, điền name, symbol và mô tả (tuỳ chọn). Thêm URL ảnh và social để dễ discovery trên Markets và trang token.",
            )}
          </p>
          <ul>
            <li>
              <strong>{t("Bond", "Bond")}:</strong>{" "}
              {t(
                "paid with Create. Promo bonds may be lower for a limited window.",
                "trả cùng Create. Bond promo có thể rẻ hơn trong thời gian giới hạn.",
              )}
            </li>
            <li>
              <strong>GNS list fee:</strong>{" "}
              {t(
                "when the pad requires it, transfer free GNS to the pad first (UI guides this), then Create locks it per launch.",
                "khi pad yêu cầu, Transfer GNS free vào pad trước (UI hướng dẫn), rồi Create khóa theo từng launch.",
              )}
            </li>
            <li>
              <strong>Meta:</strong>{" "}
              {t(
                "image / website / socials can be set at create or updated later when supported on the token page.",
                "ảnh / website / social đặt lúc create hoặc cập nhật sau nếu trang token hỗ trợ.",
              )}
            </li>
            <li>
              <strong>{t("Fair launch", "Fair launch")}:</strong>{" "}
              {t(
                "no pre-mint to creator. Everyone buys from the open curve.",
                "không pre-mint cho creator. Mọi người mua từ curve mở.",
              )}
            </li>
          </ul>
          <p>
            {t("After success, open the token page, share the link, and seed early buys.", "Sau khi thành công, mở trang token, chia sẻ link và seed lệnh mua sớm.")}{" "}
            <Link to="/create">{t("Go to Create →", "Tới Create →")}</Link>
          </p>
        </section>

        {/* ── Trade ── */}
        <section className="docs-section" id="trade">
          <h2>{t("Buy & sell on the curve", "Mua & bán trên curve")}</h2>
          <h3>{t("Buy (1-click)", "Mua (1-click)")}</h3>
          <p>
            {t(
              "Enter GNOT amount (or use quick amounts / % of balance). One Adena approval typically: wrap GNOT → WUGNOT if needed, fund the pad, then Buy. No separate multi-step wait for the common path.",
              "Nhập số GNOT (hoặc quick amount / % số dư). Một lần duyệt Adena thường gồm: wrap GNOT → WUGNOT nếu thiếu, nạp pad, rồi Buy. Không phải chờ nhiều bước rời cho luồng phổ biến.",
            )}
          </p>
          <ul>
            <li>
              <strong>{t("Fill rest", "Đổ nốt")}:</strong>{" "}
              {t(
                "when raise is almost full, this sets the exact gross (fee-adjusted) to hit 100%. Last fill may spend less than a large typed amount.",
                "khi raise gần đầy, nút này đặt đúng gross (đã tính phí) để chạm 100%. Last fill có thể tốn ít hơn số typed lớn.",
              )}
            </li>
            <li>
              <strong>{t("Slippage", "Slippage")}:</strong>{" "}
              {t(
                "max slippage protects you if the curve moves before the tx lands.",
                "max slip bảo vệ nếu curve đổi trước khi tx vào block.",
              )}
            </li>
            <li>
              <strong>WUGNOT:</strong>{" "}
              {t(
                "portfolio and trade panel show wallet WUGNOT as well as GNOT. Selling returns WUGNOT you can unwrap elsewhere if needed.",
                "portfolio và panel trade hiện cả WUGNOT và GNOT. Bán nhận WUGNOT; unwrap ở nơi khác nếu cần.",
              )}
            </li>
          </ul>
          <h3>{t("Sell", "Bán")}</h3>
          <p>
            {t(
              "Choose token amount or % of holdings. Curve sells send WUGNOT back after the trade fee. After Gnoswap list, use the Gnoswap buy/sell controls instead — pad curve trading is closed.",
              "Chọn số token hoặc % bag. Bán trên curve trả WUGNOT sau phí. Sau khi list Gnoswap, dùng buy/sell Gnoswap — curve pad đã đóng.",
            )}
          </p>
          <h3>{t("Chart & activity", "Biểu đồ & activity")}</h3>
          <p>
            {t(
              "The token chart uses on-chain trade history (and Gnoswap swap history after list when available). Markets shows a live activity ticker of recent trades.",
              "Chart token lấy từ lịch sử trade on-chain (và swap history Gnoswap sau list khi có). Markets có ticker activity các lệnh gần đây.",
            )}
          </p>
        </section>

        {/* ── Graduate ── */}
        <section className="docs-section" id="graduate">
          <h2>{t("Graduate & list on Gnoswap", "Graduate & list Gnoswap")}</h2>
          <ol className="docs-steps">
            <li>
              <strong>{t("Raise fills", "Raise đầy")}</strong> —{" "}
              {t(
                "net WUGNOT raised reaches the target (progress bar 100% / Fill rest).",
                "net WUGNOT raised đạt mục tiêu (progress 100% / Đổ nốt).",
              )}
            </li>
            <li>
              <strong>Graduate</strong> —{" "}
              {t(
                "status moves off the open curve; LP inventory is prepared from raised collateral + remaining tokens.",
                "status rời curve mở; inventory LP chuẩn bị từ collateral raised + token còn lại.",
              )}
            </li>
            <li>
              <strong>{t("List on Gnoswap", "List Gnoswap")}</strong> —{" "}
              {t(
                "creates the pool (CreatePool fee ~100 GNS from escrow or pad inventory). UI may auto-list when ready, or offer List when GNS/WUGNOT checklist is green.",
                "tạo pool (phí CreatePool ~100 GNS từ escrow hoặc inventory pad). UI có thể auto-list khi sẵn, hoặc hiện List khi checklist GNS/WUGNOT xanh.",
              )}
            </li>
            <li>
              <strong>{t("Trade on pool", "Trade trên pool")}</strong> —{" "}
              {t(
                "use Buy/Sell via Gnoswap router on the token page, or open the token/pool on Gnoswap.",
                "dùng Buy/Sell qua router Gnoswap trên trang token, hoặc mở token/pool trên Gnoswap.",
              )}
            </li>
          </ol>
          <p className="docs-callout">
            {t(
              "If list is skipped for missing GNS or WUGNOT, fund the pad / complete the checklist on the token page, then retry List. Temporary wrap from your wallet for LP is reimbursed from raised ugnot when the flow says so.",
              "Nếu list bị skip vì thiếu GNS hoặc WUGNOT, nạp pad / hoàn checklist trên trang token rồi Retry List. Wrap tạm từ ví cho LP được hoàn từ ugnot raised khi UI ghi rõ.",
            )}
          </p>
        </section>

        {/* ── Pages ── */}
        <section className="docs-section" id="pages">
          <h2>{t("App pages", "Các trang trong app")}</h2>
          <div className="docs-table-wrap">
            <table className="docs-table docs-table-pages">
              <thead>
                <tr>
                  <th>{t("Page", "Trang")}</th>
                  <th>{t("What it is for", "Dùng để")}</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <Link to="/">{t("Markets", "Thị trường")}</Link>
                  </td>
                  <td>
                    {t(
                      "Discover launches: filters (raise / hot / graduated), search, sort by volume, mcap, progress. Watchlist stars.",
                      "Khám phá launch: lọc (raise / hot / graduated), tìm kiếm, sort volume, mcap, progress. Sao watchlist.",
                    )}
                  </td>
                </tr>
                <tr>
                  <td>
                    <Link to="/create">{t("Create", "Tạo coin")}</Link>
                  </td>
                  <td>{t("Launch a new fair curve coin.", "Phát hành coin curve mới.")}</td>
                </tr>
                <tr>
                  <td>
                    <Link to="/token/1">{t("Token", "Token")}</Link>
                  </td>
                  <td>
                    {t(
                      "Trade, chart, holders, raise progress, list checklist, meta links.",
                      "Trade, chart, holders, tiến độ raise, checklist list, meta links.",
                    )}
                  </td>
                </tr>
                <tr>
                  <td>
                    <Link to="/portfolio">{t("Portfolio", "Danh mục")}</Link>
                  </td>
                  <td>
                    {t(
                      "GNOT / WUGNOT balances and meme positions (est. value).",
                      "Số dư GNOT / WUGNOT và vị thế meme (ước giá).",
                    )}
                  </td>
                </tr>
                <tr>
                  <td>
                    <Link to="/leaderboard">{t("Leaderboard", "Bảng xếp hạng")}</Link>
                  </td>
                  <td>
                    {t(
                      "Top traders, PnL estimates, creators, volume, mcap, points.",
                      "Top trader, PnL ước tính, creator, volume, mcap, điểm.",
                    )}
                  </td>
                </tr>
                <tr>
                  <td>
                    <Link to="/creator">{t("Creator", "Creator")}</Link>
                  </td>
                  <td>
                    {t(
                      "Your launches and creator fee claims when available.",
                      "Launch của bạn và claim phí creator khi có.",
                    )}
                  </td>
                </tr>
                <tr>
                  <td>
                    <Link to="/profile">{t("Profile", "Hồ sơ")}</Link>
                  </td>
                  <td>
                    {t(
                      "Public profile name / bio and launches by address.",
                      "Tên / bio hồ sơ công khai và launch theo địa chỉ.",
                    )}
                  </td>
                </tr>
                <tr>
                  <td>
                    <Link to="/rewards">{t("Rewards", "Điểm thưởng")}</Link>
                  </td>
                  <td>
                    {t(
                      "Daily check-in, referral link, on-chain points board.",
                      "Check-in ngày, link referral, bảng điểm on-chain.",
                    )}
                  </td>
                </tr>
                <tr>
                  <td>
                    <Link to="/ops">Ops</Link>
                  </td>
                  <td>
                    {t(
                      "Read-only stack health (RPC, modules, pads) — for status, not admin actions.",
                      "Sức khỏe stack chỉ đọc (RPC, module, pad) — xem trạng thái, không phải thao tác admin.",
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
          <ul>
            <li>
              <strong>{t("Trade fee 1.2%", "Phí trade 1.2%")}</strong> —{" "}
              {t(
                "taken on curve buys/sells. Split: 40% creator, 40% protocol, 20% LP/remainder.",
                "trên mua/bán curve. Chia: 40% creator, 40% protocol, 20% LP/phần còn.",
              )}
            </li>
            <li>
              <strong>{t("Creation bond", "Bond tạo coin")}</strong> —{" "}
              {t(
                "GNOT paid at Create (amount from bond module / promo).",
                "GNOT trả lúc Create (số từ module bond / promo).",
              )}
            </li>
            <li>
              <strong>Gnoswap CreatePool ~100 GNS</strong> —{" "}
              {t(
                "list fee; escrow at Create when the pad requires it, or from pad free GNS / fee swap path.",
                "phí list; khóa lúc Create khi pad yêu cầu, hoặc từ GNS free trên pad / đường swap phí.",
              )}
            </li>
            <li>
              <strong>{t("Network gas", "Gas mạng")}</strong> —{" "}
              {t(
                "Sapphire gas in ugnot/GNOT for each signed transaction (Adena shows estimate).",
                "gas Sapphire bằng ugnot/GNOT mỗi tx ký (Adena hiện ước lượng).",
              )}
            </li>
            <li>
              <strong>{t("Gnoswap pool fee", "Phí pool Gnoswap")}</strong> —{" "}
              {t(
                "after list, swaps pay the pool fee tier (meme pools often 0.3%) in addition to any router path costs.",
                "sau list, swap trả fee tier của pool (meme thường 0.3%) cộng chi phí path router nếu có.",
              )}
            </li>
          </ul>
        </section>

        {/* ── Glossary ── */}
        <section className="docs-section" id="glossary">
          <h2>{t("Glossary", "Thuật ngữ")}</h2>
          <dl className="docs-dl">
            <dt>GNOT / ugnot</dt>
            <dd>
              {t(
                "Native Sapphire token. 1 GNOT = 1,000,000 ugnot (base unit on chain).",
                "Token native Sapphire. 1 GNOT = 1.000.000 ugnot (đơn vị on-chain).",
              )}
            </dd>
            <dt>WUGNOT</dt>
            <dd>
              {t(
                "Wrapped GNOT used as curve and LP collateral (1:1).",
                "GNOT bọc dùng làm collateral curve và LP (1:1).",
              )}
            </dd>
            <dt>GNS</dt>
            <dd>
              {t(
                "Gnoswap fee token; ~100 GNS needed for CreatePool on list.",
                "Token phí Gnoswap; ~100 GNS cho CreatePool khi list.",
              )}
            </dd>
            <dt>{t("Bonding curve", "Bonding curve")}</dt>
            <dd>
              {t(
                "Virtual constant-product market that prices buys/sells before graduation.",
                "Thị trường constant-product ảo định giá mua/bán trước graduate.",
              )}
            </dd>
            <dt>{t("Raise / progress", "Raise / progress")}</dt>
            <dd>
              {t(
                "Net WUGNOT into the curve toward the graduation threshold.",
                "Net WUGNOT vào curve hướng tới ngưỡng graduate.",
              )}
            </dd>
            <dt>{t("Market cap (FDV)", "Market cap (FDV)")}</dt>
            <dd>
              {t(
                "Spot price × total supply. Can look high early because of virtual reserves — not the same as cash raised.",
                "Giá spot × total supply. Có thể cao sớm vì virtual reserve — khác số GNOT/WUGNOT đã raise.",
              )}
            </dd>
            <dt>{t("Graduate", "Graduate")}</dt>
            <dd>
              {t(
                "Raise target met; launch leaves open curve and prepares LP inventory.",
                "Đạt mục tiêu raise; rời curve mở và chuẩn bị inventory LP.",
              )}
            </dd>
            <dt>List / Gnoswap</dt>
            <dd>
              {t(
                "CreatePool + liquidity so anyone can swap on Gnoswap.",
                "CreatePool + thanh khoản để ai cũng swap trên Gnoswap.",
              )}
            </dd>
            <dt>{t("Est. PnL (leaderboard)", "PnL ước tính (leaderboard)")}</dt>
            <dd>
              {t(
                "Open position value vs rough entry — not realized fill history.",
                "Giá trị vị thế mở so với entry thô — không phải PnL đã chốt từ từng fill.",
              )}
            </dd>
          </dl>
        </section>

        {/* ── Troubleshooting ── */}
        <section className="docs-section" id="troubleshoot">
          <h2>{t("Troubleshooting", "Xử trí sự cố")}</h2>
          <ul>
            <li>
              <strong>{t("Wallet not connecting", "Không kết nối ví")}</strong> —{" "}
              {t(
                "Install Adena, unlock it, select Sapphire, refresh the page, then Connect again.",
                "Cài Adena, mở khóa, chọn Sapphire, refresh trang, Connect lại.",
              )}
            </li>
            <li>
              <strong>{t("Buy fails / insufficient funds", "Mua fail / thiếu quỹ")}</strong> —{" "}
              {t(
                "Need GNOT for spend + gas. For WUGNOT path, leave headroom for wrap and fee. Try a smaller size or Fill rest near the end of raise.",
                "Cần GNOT cho lệnh + gas. Đường WUGNOT cần dư cho wrap và phí. Thử số nhỏ hơn hoặc Đổ nốt khi gần full raise.",
              )}
            </li>
            <li>
              <strong>curve sold out / raise capped</strong> —{" "}
              {t(
                "Curve inventory or raise cap hit. Use Fill rest for the last slice, or wait for graduate/list. Very old pad versions may behave differently.",
                "Hết hàng curve hoặc chạm cap raise. Dùng Đổ nốt cho phần cuối, hoặc chờ graduate/list. Pad rất cũ có thể khác.",
              )}
            </li>
            <li>
              <strong>list skip / need GNS</strong> —{" "}
              {t(
                "Pad needs ~100 GNS (or fee path) and enough WUGNOT for LP. Complete the token page checklist, then List / Retry.",
                "Pad cần ~100 GNS (hoặc path phí) và đủ WUGNOT cho LP. Làm xong checklist trang token, rồi List / Retry.",
              )}
            </li>
            <li>
              <strong>{t("Stale markets / empty chart", "Markets cũ / chart trống")}</strong> —{" "}
              {t(
                "Refresh; check Ops for RPC health. New launches need at least one trade for chart points. After list, chart may merge Gnoswap history when the API is available.",
                "Refresh; xem Ops cho RPC. Launch mới cần ít nhất một trade để có điểm chart. Sau list, chart có thể gộp history Gnoswap khi API sẵn.",
              )}
            </li>
            <li>
              <strong>{t("Token icon missing", "Thiếu icon token")}</strong> —{" "}
              {t(
                "Set a public image URL in meta (Create or edit links). Private or broken URLs will not render.",
                "Đặt URL ảnh public trong meta (Create hoặc sửa links). URL private/hỏng sẽ không hiện.",
              )}
            </li>
            <li>
              <strong>{t("Wrong network", "Sai network")}</strong> —{" "}
              {t(
                "This UI targets Sapphire testnet only. Mainnet or other chains will not match the pad package.",
                "UI này chỉ Sapphire testnet. Mainnet hoặc chain khác không khớp package pad.",
              )}
            </li>
          </ul>
        </section>

        {/* ── Shortcuts ── */}
        <section className="docs-section" id="shortcuts">
          <h2>{t("Shortcuts", "Phím tắt")}</h2>
          <ul>
            <li>
              <kbd className="kbd">Ctrl</kbd> / <kbd className="kbd">⌘</kbd> +{" "}
              <kbd className="kbd">K</kbd> — {t("Command palette (search & navigate)", "Command palette (tìm & điều hướng)")}
            </li>
            <li>
              <kbd className="kbd">Ctrl</kbd> / <kbd className="kbd">⌘</kbd> +{" "}
              <kbd className="kbd">,</kbd> — {t("Settings (theme, language, alerts)", "Cài đặt (giao diện, ngôn ngữ, alerts)")}
            </li>
            <li>
              {t("Token trade panel", "Panel trade token")}:{" "}
              <kbd className="kbd">1</kbd> / <kbd className="kbd">2</kbd> /{" "}
              <kbd className="kbd">3</kbd> / <kbd className="kbd">4</kbd> = 25% / 50% / 75% / Max ·{" "}
              <kbd className="kbd">Enter</kbd> {t("submit", "gửi lệnh")}
            </li>
          </ul>
        </section>

        <section className="docs-section docs-footer-links">
          <h2>{t("Links", "Liên kết")}</h2>
          <ul>
            <li>
              <a href="https://adena.app/" target="_blank" rel="noreferrer">
                Adena wallet
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
              <Link to="/">{t("Open Markets", "Mở Thị trường")}</Link>
            </li>
            <li>
              <Link to="/create">{t("Create a launch", "Tạo launch")}</Link>
            </li>
          </ul>
        </section>
      </article>
    </section>
  );
}
