import { useEffect, useMemo, useState } from "react";
import { useApp } from "../context/AppContext";
import { usePrefs } from "../context/PrefsContext";
import { EmptyState, PageHeader, SkeletonPanel, Stat } from "../components/ui";
import { api } from "../lib/api";
import { copyText, fmtNum, shortAddr } from "../lib/format";

const STREAK_DAYS = 7;

export default function Rewards() {
  const { wallet, connect, broadcast, showToast, health } = useApp();
  const { t } = usePrefs();
  const [data, setData] = useState(null);
  const [ref, setRef] = useState("");
  const [log, setLog] = useState("");
  const [loading, setLoading] = useState(true);
  const pointsPkg = health?.points || health?.modules?.points;

  async function load() {
    setLoading(true);
    try {
      const q = wallet?.address ? `?address=${encodeURIComponent(wallet.address)}` : "";
      setData(await api(`/api/points${q}`));
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [wallet]);

  // Soft streak UI from lastCheckIn / checkInCount if API provides; else points-based hint
  const streak = useMemo(() => {
    const n = Number(data?.streak ?? data?.checkInStreak ?? data?.checkInCount ?? 0) || 0;
    const capped = Math.min(STREAK_DAYS, Math.max(0, n));
    // If only points exist, light up first cell when points > 0 as "active"
    if (!n && Number(data?.points) > 0) return 1;
    return capped;
  }, [data]);

  const referralLink = useMemo(() => {
    if (!wallet?.address) return "";
    return `${typeof window !== "undefined" ? window.location.origin : ""}/rewards?ref=${encodeURIComponent(wallet.address)}`;
  }, [wallet]);

  useEffect(() => {
    // Prefill referrer from ?ref=
    try {
      const u = new URL(window.location.href);
      const r = u.searchParams.get("ref");
      if (r && /^g1[a-z0-9]{38,}$/i.test(r)) setRef(r);
    } catch {
      /* ignore */
    }
  }, []);

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

  async function copyAddress() {
    if (!wallet?.address) return;
    try {
      await copyText(wallet.address);
      showToast("Address copied");
    } catch {
      showToast("Copy failed", false);
    }
  }

  return (
    <section className="view">
      <PageHeader
        kicker="Points"
        title={t("rewards")}
        lede={t("rewardsLede")}
        actions={
          !wallet ? (
            <button type="button" className="btn primary" onClick={connect}>
              {t("connect")}
            </button>
          ) : (
            <button type="button" className="btn sm ghost" onClick={load} disabled={loading}>
              {loading ? t("loading") : t("refresh")}
            </button>
          )
        }
      />

      {loading && !data && <SkeletonPanel height={120} />}

      <div className="stat-row">
        <Stat
          label={t("yourPoints")}
          value={wallet ? fmtNum(data?.points) : "-"}
          hint={wallet ? shortAddr(wallet.address) : t("connect")}
        />
        <Stat label="Streak" value={wallet ? `${streak}/${STREAK_DAYS}` : "-"} hint="check-in days" />
      </div>

      {!wallet && (
        <EmptyState
          icon="★"
          title={t("rewards")}
          action={
            <button type="button" className="btn primary" onClick={connect}>
              {t("connect")}
            </button>
          }
        >
          {t("rewardsLede")}
        </EmptyState>
      )}

      {wallet && (
        <div className="rewards-grid">
          <div className="panel rewards-panel">
            <h2 className="panel-title">{t("checkIn")}</h2>
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
            <p className="muted" style={{ fontSize: "0.8rem", margin: "0.65rem 0 0.85rem" }}>
              Check in once per day to earn points. Streak highlights recent activity when the
              chain exposes it.
            </p>
            <button type="button" className="btn primary" onClick={checkIn} disabled={!pointsPkg}>
              {t("checkIn")}
            </button>
          </div>

          <div className="panel rewards-panel">
            <h2 className="panel-title">Referral</h2>
            <p className="muted" style={{ fontSize: "0.82rem", marginTop: 0 }}>
              Share your link. Friends set you as referrer when they join points.
            </p>
            <div className="referral-box mono">
              {referralLink || shortAddr(wallet.address)}
            </div>
            <div className="admin-actions" style={{ marginTop: "0.75rem" }}>
              <button type="button" className="btn sm primary" onClick={copyReferral}>
                Copy referral link
              </button>
              <button type="button" className="btn sm ghost" onClick={copyAddress}>
                Copy address
              </button>
            </div>

            <label style={{ marginTop: "1.1rem" }}>
              {t("referrer")}
              <input
                value={ref}
                onChange={(e) => setRef(e.target.value)}
                placeholder="g1..."
                className="mono"
              />
            </label>
            <button type="button" className="btn sm" onClick={setReferrer} disabled={!pointsPkg}>
              {t("setReferrer")}
            </button>
            {data?.referrer && (
              <p className="muted" style={{ fontSize: "0.8rem", marginTop: "0.65rem" }}>
                Current: <span className="mono">{shortAddr(data.referrer)}</span>
              </p>
            )}
          </div>
        </div>
      )}

      <h2 className="panel-title" style={{ margin: "1.25rem 0 0.65rem" }}>
        {t("leaderboard")}
      </h2>
      <div className="panel">
        {(data?.leaderboard || []).slice(0, 20).map((row, i) => (
          <div key={row.address || i} className="lb-row">
            <span className="lb-left">
              <span className="faint lb-rank">{i + 1}</span>
              <span className="mono">{shortAddr(row.address)}</span>
            </span>
            <strong className="lb-pts">{fmtNum(row.points)}</strong>
          </div>
        ))}
        {!data?.leaderboard?.length && !loading && (
          <div className="muted" style={{ padding: "0.5rem 0" }}>
            {t("noEntries")}
          </div>
        )}
      </div>
      {log && (
        <pre className="log" style={{ marginTop: "1rem" }}>
          {log}
        </pre>
      )}
    </section>
  );
}
