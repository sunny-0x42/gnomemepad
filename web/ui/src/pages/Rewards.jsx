import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useApp } from "../context/AppContext";
import { usePrefs } from "../context/PrefsContext";
import { EmptyState, PageHeader, SkeletonPanel, Stat } from "../components/ui";
import { api } from "../lib/api";
import { copyText, fmtNum, shortAddr } from "../lib/format";
import {
  BADGES,
  POINT_TABLE,
  QUESTS,
  SEASON0,
  rulesBlocks,
} from "../lib/season0";

const STREAK_DAYS = 7;

function questStatus(quest, ctx) {
  if (quest.comingSoon) return { state: "locked", current: 0, done: false };
  const p = ctx.progress?.[quest.id];
  const current = Number(p?.current ?? 0) || 0;
  const target = Number(p?.target ?? quest.target ?? 1) || 1;
  const done = !!(p?.done || current >= target);
  if (done) return { state: "done", current: target, done: true, target };
  if (quest.action === "connect" && ctx.connected) {
    return { state: "done", current: 1, done: true, target: 1 };
  }
  return { state: "active", current, done: false, target };
}

function badgeUnlocked(badge, ctx) {
  const rule = String(badge.rule || "");
  if (rule === "any_quest") {
    return Object.values(ctx.progress || {}).some((q) => q?.done);
  }
  if (rule.startsWith("quest:")) {
    const id = rule.slice(6);
    return !!ctx.progress?.[id]?.done;
  }
  if (rule === "rank_le_20") {
    const r = Number(ctx.rank);
    return Number.isFinite(r) && r > 0 && r <= 20;
  }
  return false;
}

export default function Rewards() {
  const { wallet, connect, broadcast, showToast, health, networkId } = useApp();
  const { lang } = usePrefs();
  const vi = lang === "vi";
  const t = (en, vn) => (vi ? vn : en);

  const [pointsData, setPointsData] = useState(null);
  const [seasonData, setSeasonData] = useState(null);
  const [ref, setRef] = useState("");
  const [log, setLog] = useState("");
  const [loading, setLoading] = useState(true);
  const pointsPkg = health?.points || health?.modules?.points || pointsData?.pointsPkg;

  async function load() {
    setLoading(true);
    try {
      const addrQ = wallet?.address
        ? `?address=${encodeURIComponent(wallet.address)}`
        : "";
      const [p, s] = await Promise.all([
        api(`/api/points${addrQ}`).catch(() => null),
        api(`/api/season0${addrQ}`).catch(() => null),
      ]);
      setPointsData(p);
      setSeasonData(s);
    } catch {
      setPointsData(null);
      setSeasonData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [wallet, networkId]);

  useEffect(() => {
    try {
      const u = new URL(window.location.href);
      const r = u.searchParams.get("ref");
      if (r && /^g1[a-z0-9]{38,}$/i.test(r)) setRef(r);
    } catch {
      /* ignore */
    }
  }, []);

  const progress = seasonData?.me?.quests || seasonData?.quests || {};
  const seasonScore = Number(seasonData?.me?.seasonScore ?? pointsData?.points ?? 0) || 0;
  const lifetimePts = Number(pointsData?.points ?? 0) || 0;
  const rank = Number(seasonData?.me?.rank ?? 0) || 0;
  const uniqueMarkets = Number(seasonData?.me?.uniqueMarkets ?? 0) || 0;
  const streak = useMemo(() => {
    const n =
      Number(
        seasonData?.me?.streak ??
          pointsData?.streak ??
          pointsData?.checkInStreak ??
          pointsData?.checkInCount ??
          0,
      ) || 0;
    return Math.min(STREAK_DAYS, Math.max(0, n));
  }, [seasonData, pointsData]);

  const ctx = useMemo(
    () => ({
      connected: !!wallet?.address,
      progress,
      rank,
    }),
    [wallet, progress, rank],
  );

  const referralLink = useMemo(() => {
    if (!wallet?.address) return "";
    return `${typeof window !== "undefined" ? window.location.origin : ""}/rewards?ref=${encodeURIComponent(wallet.address)}`;
  }, [wallet]);

  const params = pointsData?.params || {};
  const rules = rulesBlocks(vi);
  const board = seasonData?.board || pointsData?.leaderboard || [];
  const partial = !!seasonData?.partial;

  const windowLabel = useMemo(() => {
    const s = seasonData?.season || SEASON0;
    if (s.startHeight != null && s.endHeight != null) {
      return `h ${s.startHeight} → ${s.endHeight}`;
    }
    return vi ? SEASON0.startLabelVi : SEASON0.startLabelEn;
  }, [seasonData, vi]);

  async function checkIn() {
    if (!wallet?.canSign) return connect();
    if (!pointsPkg) return showToast("Points realm missing", false);
    try {
      const r = await broadcast("CheckIn", [], "", pointsPkg);
      setLog(r.hash || "ok");
      showToast("Check-in ok");
      await load();
    } catch (e) {
      showToast(e.message || e, false);
    }
  }

  async function setReferrer() {
    if (!wallet?.canSign) return connect();
    if (!/^g1[a-z0-9]{38,}$/i.test(ref.trim())) {
      showToast("Invalid referrer", false);
      return;
    }
    try {
      const r = await broadcast("SetReferrer", [ref.trim()], "", pointsPkg);
      setLog(r.hash || "ok");
      showToast("Referrer set");
      await load();
    } catch (e) {
      showToast(e.message || e, false);
    }
  }

  async function copyReferral() {
    if (!wallet?.address) return connect();
    try {
      await copyText(referralLink || wallet.address);
      showToast("Referral link copied");
    } catch {
      showToast("Copy failed", false);
    }
  }

  function questCta(quest, st) {
    if (quest.comingSoon || st.state === "locked") {
      return (
        <button type="button" className="btn sm ghost" disabled>
          {t("Coming soon", "Sắp mở")}
        </button>
      );
    }
    if (st.done) {
      return (
        <button type="button" className="btn sm ghost" disabled>
          {t("Done", "Xong")} ✓
        </button>
      );
    }
    if (quest.action === "connect") {
      return (
        <button type="button" className="btn sm primary" onClick={connect}>
          {t("Connect", "Kết nối")}
        </button>
      );
    }
    if (quest.action === "checkIn") {
      return (
        <button type="button" className="btn sm primary" onClick={checkIn} disabled={!pointsPkg}>
          {t("Check-in", "Check-in")}
        </button>
      );
    }
    if (quest.action === "setReferrer") {
      return (
        <a className="btn sm primary" href="#referral-box">
          {t("Set referrer", "Gắn referrer")}
        </a>
      );
    }
    if (quest.action === "link" && quest.href) {
      return (
        <Link className="btn sm primary" to={quest.href}>
          {t("Go", "Đi")} →
        </Link>
      );
    }
    return null;
  }

  return (
    <section className="view season0-page">
      <PageHeader
        kicker="Points"
        title={vi ? SEASON0.nameVi : SEASON0.nameEn}
        lede={vi ? SEASON0.taglineVi : SEASON0.taglineEn}
        actions={
          !wallet ? (
            <button type="button" className="btn primary" onClick={connect}>
              {t("Connect", "Kết nối")}
            </button>
          ) : (
            <button type="button" className="btn sm ghost" onClick={load} disabled={loading}>
              {loading ? t("Loading…", "Đang tải…") : t("Refresh", "Làm mới")}
            </button>
          )
        }
      />

      <div className="season0-meta-bar" aria-live="polite">
        <span className="season0-chip">
          <strong>S0</strong> Curve Camp
        </span>
        <span className="season0-chip">{windowLabel}</span>
        {partial && (
          <span className="season0-chip season0-chip-warn">
            {t("Progress partial", "Tiến độ một phần")}
          </span>
        )}
      </div>

      <nav className="season0-toc" aria-label={t("Sections", "Mục")}>
        <a href="#s0-rules">{t("Rules", "Luật")}</a>
        <a href="#s0-score">{t("Score", "Điểm")}</a>
        <a href="#s0-quests">{t("Quests", "Nhiệm vụ")}</a>
        <a href="#s0-badges">{t("Badges", "Huy hiệu")}</a>
        <a href="#s0-board">{t("Board", "BXH")}</a>
      </nav>

      {loading && !pointsData && !seasonData && <SkeletonPanel height={140} />}

      {/* Rules */}
      <section className="season0-section" id="s0-rules">
        <h2>{t("Season rules", "Luật Season")}</h2>
        <aside className="docs-callout docs-callout-warn">
          <strong>{t("Before you grind", "Trước khi farm")}</strong>
          <p style={{ margin: "0.35rem 0 0" }}>
            {t(
              "Points are discretionary scores — not cash, not APR, not an investment return. Testnet ≠ mainnet.",
              "Points là điểm tùy nghi — không phải tiền, không APR, không lợi nhuận đầu tư. Testnet ≠ mainnet.",
            )}
          </p>
        </aside>

        <div className="season0-rules-grid">
          {Object.values(rules).map((block) => (
            <div key={block.title} className="panel season0-rule-card">
              <h3>{block.title}</h3>
              <ul className="season0-rule-list">
                {block.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <h3 className="season0-subh">{t("On-chain point table", "Bảng điểm on-chain")}</h3>
        <div className="docs-table-wrap">
          <table className="docs-table docs-table-compact">
            <thead>
              <tr>
                <th>{t("Action", "Hành động")}</th>
                <th>Pts</th>
                <th>{t("Note", "Ghi chú")}</th>
              </tr>
            </thead>
            <tbody>
              {POINT_TABLE.map((row) => (
                <tr key={row.id}>
                  <td>{vi ? row.vi : row.en}</td>
                  <td className="mono">
                    <strong>
                      {row.id === "checkin" && params.checkIn
                        ? `+${params.checkIn}`
                        : row.id === "referrer" && params.referrerBonus
                          ? `+${params.referrerBonus}`
                          : row.id === "referee" && params.refereeBonus
                            ? `+${params.refereeBonus}`
                            : row.id === "create" && params.createBonus
                              ? `+${params.createBonus}`
                              : row.pts}
                    </strong>
                  </td>
                  <td className="docs-hint">{vi ? row.noteVi : row.noteEn}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted season0-hint">
          {t(
            "Season Score ignores post-list Gnoswap ExactIn. Full Guide:",
            "Season Score bỏ qua ExactIn Gnoswap sau list. Guide đầy đủ:",
          )}{" "}
          <Link to="/docs">{t("Open Guide", "Mở Hướng dẫn")}</Link>
        </p>
      </section>

      {/* Score */}
      <section className="season0-section" id="s0-score">
        <h2>{t("My score", "Điểm của tôi")}</h2>
        {!wallet ? (
          <EmptyState
            icon="★"
            title={t("Connect to track Season 0", "Kết nối để theo Season 0")}
            action={
              <button type="button" className="btn primary" onClick={connect}>
                {t("Connect", "Kết nối")}
              </button>
            }
          >
            {t(
              "Check-in, refer friends, and trade on the curve to climb the board.",
              "Check-in, mời bạn, và trade trên curve để leo bảng.",
            )}
          </EmptyState>
        ) : (
          <>
            <div className="stat-row">
              <Stat
                label={t("Season score", "Season score")}
                value={fmtNum(seasonScore)}
                hint={partial ? t("best-effort", "ước lượng") : shortAddr(wallet.address)}
              />
              <Stat
                label={t("Lifetime", "Lifetime")}
                value={fmtNum(lifetimePts)}
                hint="pointsv2"
              />
              <Stat
                label={t("Rank", "Hạng")}
                value={rank > 0 ? `#${rank}` : "—"}
                hint={t("season board", "BXH season")}
              />
              <Stat
                label={t("Unique markets", "Market khác nhau")}
                value={String(uniqueMarkets)}
                hint={t("Buys ≥ 0.5 GNOT", "Buy ≥ 0.5 GNOT")}
              />
            </div>

            <div className="rewards-grid">
              <div className="panel rewards-panel">
                <h3 className="panel-title">{t("Check-in", "Check-in")}</h3>
                <div className="streak-row" aria-label="Check-in streak">
                  {Array.from({ length: STREAK_DAYS }).map((_, i) => (
                    <div
                      key={i}
                      className={`streak-day${i < streak ? " on" : ""}`}
                      title={`Day ${i + 1}`}
                    >
                      {i + 1}
                    </div>
                  ))}
                </div>
                <p className="muted season0-hint">
                  {t(
                    `+${params.checkIn ?? 5} pts · about every ${params.checkInInterval ?? 100} heights.`,
                    `+${params.checkIn ?? 5} pts · khoảng mỗi ${params.checkInInterval ?? 100} height.`,
                  )}
                </p>
                <button type="button" className="btn primary" onClick={checkIn} disabled={!pointsPkg}>
                  {t("Check-in", "Check-in")}
                </button>
              </div>

              <div className="panel rewards-panel" id="referral-box">
                <h3 className="panel-title">{t("Referral", "Giới thiệu")}</h3>
                <p className="muted season0-hint">
                  {t(
                    `Share your link. Friend sets you as referrer (+${params.referrerBonus ?? 50} you / +${params.refereeBonus ?? 25} them).`,
                    `Chia sẻ link. Bạn set bạn làm referrer (+${params.referrerBonus ?? 50} bạn / +${params.refereeBonus ?? 25} họ).`,
                  )}
                </p>
                <div className="referral-box mono">{referralLink || shortAddr(wallet.address)}</div>
                <div className="admin-actions" style={{ marginTop: "0.75rem" }}>
                  <button type="button" className="btn sm primary" onClick={copyReferral}>
                    {t("Copy link", "Copy link")}
                  </button>
                </div>
                <label style={{ marginTop: "1.1rem" }}>
                  {t("Set referrer", "Gắn referrer")}
                  <input
                    value={ref}
                    onChange={(e) => setRef(e.target.value)}
                    placeholder="g1..."
                    className="mono"
                  />
                </label>
                <button type="button" className="btn sm" onClick={setReferrer} disabled={!pointsPkg}>
                  {t("Set referrer", "Gắn referrer")}
                </button>
                {pointsData?.referrer && (
                  <p className="muted season0-hint">
                    {t("Current", "Hiện tại")}:{" "}
                    <span className="mono">{shortAddr(pointsData.referrer)}</span>
                  </p>
                )}
              </div>
            </div>
          </>
        )}
      </section>

      {/* Quests */}
      <section className="season0-section" id="s0-quests">
        <h2>{t("Quests", "Nhiệm vụ")}</h2>
        <div className="season0-quest-grid">
          {QUESTS.map((quest) => {
            const st = questStatus(quest, ctx);
            const title = vi ? quest.titleVi : quest.titleEn;
            const desc = vi ? quest.descVi : quest.descEn;
            const pct = Math.min(100, Math.round((st.current / st.target) * 100));
            return (
              <article
                key={quest.id}
                className={`panel season0-quest-card is-${st.state}${quest.comingSoon ? " is-soon" : ""}`}
              >
                <div className="season0-quest-head">
                  <h3>{title}</h3>
                  {quest.bonusPts ? (
                    <span className="season0-quest-pts mono">+{quest.bonusPts}</span>
                  ) : null}
                </div>
                <p className="muted season0-hint">{desc}</p>
                <div className="season0-quest-progress" aria-hidden>
                  <i style={{ width: `${pct}%` }} />
                </div>
                <div className="season0-quest-foot">
                  <span className="mono faint">
                    {st.current}/{st.target}
                  </span>
                  {questCta(quest, st)}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {/* Badges */}
      <section className="season0-section" id="s0-badges">
        <h2>{t("Badges", "Huy hiệu")}</h2>
        <div className="season0-badge-shelf">
          {BADGES.map((b) => {
            const on = badgeUnlocked(b, ctx);
            return (
              <div key={b.id} className={`season0-badge${on ? " on" : ""}`} title={vi ? b.titleVi : b.titleEn}>
                <span className="season0-badge-icon" aria-hidden>
                  {b.icon}
                </span>
                <span className="season0-badge-name">{vi ? b.titleVi : b.titleEn}</span>
                <span className="season0-badge-state">{on ? "✓" : "·"}</span>
              </div>
            );
          })}
        </div>
      </section>

      {/* Board */}
      <section className="season0-section" id="s0-board">
        <div className="season0-board-head">
          <h2>{t("Season board", "BXH Season")}</h2>
          <Link className="btn sm ghost" to="/leaderboard">
            {t("All-time points", "Điểm all-time")} →
          </Link>
        </div>
        <div className="panel">
          {(board || []).slice(0, 25).map((row, i) => {
            const addr = row.address || "";
            const pts = row.seasonScore ?? row.points ?? 0;
            const you =
              wallet?.address && addr.toLowerCase() === wallet.address.toLowerCase();
            return (
              <div key={addr || i} className={`lb-row${you ? " is-you" : ""}`}>
                <span className="lb-left">
                  <span className="faint lb-rank">{i + 1}</span>
                  <span className="mono">{shortAddr(addr)}</span>
                  {you ? <span className="season0-you-pill">you</span> : null}
                </span>
                <strong className="lb-pts">{fmtNum(pts)}</strong>
              </div>
            );
          })}
          {!board?.length && !loading && (
            <div className="muted" style={{ padding: "0.5rem 0" }}>
              {t("No entries yet — be the first camper.", "Chưa có ai — hãy là người đầu.")}
            </div>
          )}
        </div>
      </section>

      {log && (
        <pre className="log" style={{ marginTop: "1rem" }}>
          {log}
        </pre>
      )}
    </section>
  );
}
