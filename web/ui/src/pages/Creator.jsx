import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useApp } from "../context/AppContext";
import { usePrefs } from "../context/PrefsContext";
import TokenAvatar from "../components/TokenAvatar";
import {
  Badge,
  EmptyState,
  PageHeader,
  ProgressBar,
  SkeletonCards,
} from "../components/ui";
import { api } from "../lib/api";
import {
  copyText,
  fmtGnot,
  fmtMcapUsd,
  fmtNum,
  fmtPriceUsd,
  shortAddr,
  toUsd,
} from "../lib/format";
import { isRetiredPad } from "../lib/marketHeat";
import { resolveTokenImage } from "../lib/meta";

const FILTERS = [
  { id: "all", labelKey: "all" },
  { id: "raising", labelKey: "raising" },
  { id: "graduated", labelKey: "graduated" },
  { id: "claimable", labelKey: "chClaimable" },
];

function feesGnotOf(m) {
  if (m?.creatorFeesGnot != null) return Number(m.creatorFeesGnot) || 0;
  return (Number(m?.creatorFees) || 0) / 1e6;
}

function raisedGnotOf(m) {
  if (m?.raisedGnot != null) return Number(m.raisedGnot) || 0;
  return (Number(m?.raised) || 0) / 1e6;
}

export default function Creator() {
  const { wallet, connect, broadcast, showToast } = useApp();
  const { t, lang } = usePrefs();
  const vi = lang === "vi";
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [claimingId, setClaimingId] = useState(null);
  const [filter, setFilter] = useState("all");
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    if (!wallet?.address) return;
    setLoading(true);
    setErr("");
    try {
      const d = await api(`/api/creator?address=${encodeURIComponent(wallet.address)}`);
      const launches = (d?.launches || []).filter(
        (m) => !isRetiredPad(m.pkg) && !isRetiredPad(m.padLabel),
      );
      setData({ ...d, launches, count: launches.length });
    } catch (e) {
      setData(null);
      setErr(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [wallet]);

  useEffect(() => {
    setData(null);
    load();
  }, [load]);

  const launches = data?.launches || [];

  const claimable = useMemo(
    () => launches.filter((m) => feesGnotOf(m) > 0),
    [launches],
  );

  const totalClaimableGnot = useMemo(
    () => claimable.reduce((s, m) => s + feesGnotOf(m), 0),
    [claimable],
  );

  const totalRaisedGnot = useMemo(() => {
    if (data?.totalRaisedGnot != null) return Number(data.totalRaisedGnot) || 0;
    if (data?.totalRaised != null) return (Number(data.totalRaised) || 0) / 1e6;
    return launches.reduce((s, m) => s + raisedGnotOf(m), 0);
  }, [data, launches]);

  const graduatedCount = useMemo(() => {
    if (data?.graduated != null) return Number(data.graduated) || 0;
    return launches.filter((m) => m.status === 1).length;
  }, [data, launches]);

  const listedCount = useMemo(
    () => launches.filter((m) => m.gnoswapListed).length,
    [launches],
  );

  const totalBuyers = useMemo(
    () => launches.reduce((s, m) => s + (Number(m.buyers) || 0), 0),
    [launches],
  );

  const gnotUsd = Number(data?.gnotUsd || launches[0]?.gnotUsd) || 0;

  const filtered = useMemo(() => {
    let list = [...launches];
    if (filter === "raising") list = list.filter((m) => m.status !== 1);
    else if (filter === "graduated") list = list.filter((m) => m.status === 1);
    else if (filter === "claimable") list = list.filter((m) => feesGnotOf(m) > 0);
    // Claimable first, then by fees, then raised
    list.sort((a, b) => {
      const fa = feesGnotOf(a);
      const fb = feesGnotOf(b);
      if (fb !== fa) return fb - fa;
      return raisedGnotOf(b) - raisedGnotOf(a);
    });
    return list;
  }, [launches, filter]);

  async function claim(id, pkg, symbol) {
    if (!wallet?.canSign) return connect();
    setBusy(true);
    setClaimingId(`${pkg}:${id}`);
    try {
      await broadcast("ClaimCreatorFees", [id], "", pkg, {
        label: `Claim fees $${symbol || id}`,
      });
      showToast(vi ? "Đã gửi claim" : "Claim submitted");
      await load();
    } catch (e) {
      showToast(e.message || e, false);
    } finally {
      setBusy(false);
      setClaimingId(null);
    }
  }

  async function claimAll() {
    if (!wallet?.canSign) return connect();
    if (!claimable.length) {
      showToast(vi ? "Không có phí để claim" : "Nothing to claim", false);
      return;
    }
    setBusy(true);
    let ok = 0;
    for (const m of claimable) {
      try {
        setClaimingId(`${m.pkg}:${m.id}`);
        await broadcast("ClaimCreatorFees", [m.id], "", m.pkg, {
          label: `Claim $${m.symbol || m.id}`,
        });
        ok += 1;
      } catch (e) {
        showToast(e.message || e, false);
        break;
      }
    }
    if (ok) {
      showToast(
        vi
          ? `Đã claim ${ok} launch`
          : `Claimed ${ok} launch${ok > 1 ? "es" : ""}`,
      );
    }
    await load().catch(() => {});
    setBusy(false);
    setClaimingId(null);
  }

  async function copyAddr() {
    try {
      await copyText(wallet.address);
      showToast(vi ? "Đã copy địa chỉ" : "Address copied");
    } catch {
      showToast(vi ? "Copy thất bại" : "Copy failed", false);
    }
  }

  if (!wallet) {
    return (
      <section className="view creator-hub">
        <EmptyState
          icon="✦"
          title={t("creator")}
          action={
            <button type="button" className="btn primary" onClick={connect}>
              {t("connect")}
            </button>
          }
        >
          {vi
            ? "Kết nối ví đã dùng để launch coin — claim phí creator và theo dõi launch."
            : "Connect the wallet you used to launch coins to claim fees and manage launches."}
        </EmptyState>
      </section>
    );
  }

  return (
    <section className="view creator-hub">
      <PageHeader
        kicker={t("creator")}
        title={vi ? "Creator hub" : "Creator hub"}
        lede={
          vi
            ? "Theo dõi launch, raise, và claim phí trade (40% của 1.2%)."
            : "Track launches, raise progress, and claim your share of the 1.2% trade fee."
        }
        actions={
          <>
            <Link className="btn sm primary" to="/create">
              + {t("create")}
            </Link>
            {claimable.length > 0 && (
              <button
                type="button"
                className="btn sm primary"
                disabled={busy}
                onClick={claimAll}
              >
                {vi ? "Claim tất cả" : "Claim all"} ({claimable.length})
              </button>
            )}
            <button
              type="button"
              className="btn sm ghost"
              onClick={() => load()}
              disabled={busy || loading}
            >
              {loading ? t("loading") : t("refresh")}
            </button>
          </>
        }
      />

      {/* Identity strip */}
      <div className="creator-identity panel">
        <div className="creator-identity-main">
          <div className="creator-avatar-ring" aria-hidden>
            {wallet.address.slice(2, 4).toUpperCase()}
          </div>
          <div>
            <div className="creator-identity-label muted">{vi ? "Ví creator" : "Creator wallet"}</div>
            <button
              type="button"
              className="creator-addr mono"
              onClick={copyAddr}
              title={wallet.address}
            >
              {shortAddr(wallet.address, 6)}
              <span className="faint"> · {vi ? "sao chép" : "copy"}</span>
            </button>
          </div>
        </div>
        <div className="creator-identity-meta">
          <span className="creator-pill">
            <strong>{launches.length}</strong> {vi ? "launch" : "launches"}
          </span>
          <span className="creator-pill">
            <strong>{graduatedCount}</strong> {t("graduated").toLowerCase()}
          </span>
          {listedCount > 0 && (
            <span className="creator-pill gnoswap">
              <strong>{listedCount}</strong> Gnoswap
            </span>
          )}
        </div>
      </div>

      {err && (
        <div className="callout warn" style={{ marginBottom: "1rem" }}>
          {err}
          <button type="button" className="btn sm ghost" style={{ marginLeft: 8 }} onClick={load}>
            {t("retry")}
          </button>
        </div>
      )}

      {loading && !data && <SkeletonCards n={4} />}

      {data && (
        <div className="creator-stats" role="group" aria-label="Creator stats">
          <div className="creator-stat">
            <span className="creator-stat-k">{vi ? "Launches" : "Launches"}</span>
            <strong className="creator-stat-v mono">{fmtNum(launches.length)}</strong>
            <span className="creator-stat-s faint">
              {fmtNum(totalBuyers)} {vi ? "buyers" : "buyers"}
            </span>
          </div>
          <div className={`creator-stat${totalClaimableGnot > 0 ? " glow" : ""}`}>
            <span className="creator-stat-k">{vi ? "Phí claim được" : "Claimable fees"}</span>
            <strong className="creator-stat-v mono">
              {gnotUsd > 0
                ? fmtMcapUsd(totalClaimableGnot * gnotUsd)
                : `${fmtGnot(totalClaimableGnot, { alreadyGnot: true })} GNOT`}
            </strong>
            <span className="creator-stat-s faint">
              {totalClaimableGnot > 0
                ? `${fmtGnot(totalClaimableGnot, { alreadyGnot: true })} GNOT · ${claimable.length}`
                : vi
                  ? "Phí trade tích lũy khi có giao dịch"
                  : "Accrues as people trade"}
            </span>
          </div>
          <div className="creator-stat">
            <span className="creator-stat-k">{vi ? "Tổng raised" : "Total raised"}</span>
            <strong className="creator-stat-v mono">
              {gnotUsd > 0
                ? fmtMcapUsd(totalRaisedGnot * gnotUsd)
                : `${fmtGnot(totalRaisedGnot, { alreadyGnot: true })} GNOT`}
            </strong>
            <span className="creator-stat-s faint">
              {fmtGnot(totalRaisedGnot, { alreadyGnot: true })} GNOT
            </span>
          </div>
          <div className="creator-stat">
            <span className="creator-stat-k">{t("graduated")}</span>
            <strong className="creator-stat-v mono">{fmtNum(graduatedCount)}</strong>
            <span className="creator-stat-s faint">
              {listedCount > 0
                ? `${fmtNum(listedCount)} ${vi ? "đã list Gnoswap" : "on Gnoswap"}`
                : vi
                  ? "sẵn sàng list khi đủ raise"
                  : "ready to list when raise fills"}
            </span>
          </div>
        </div>
      )}

      {data && claimable.length > 0 && (
        <div className="creator-claim-hero">
          <div className="creator-claim-hero-text">
            <span className="creator-claim-badge">{vi ? "Sẵn sàng claim" : "Ready to claim"}</span>
            <h2 className="creator-claim-amount mono">
              {gnotUsd > 0
                ? fmtMcapUsd(totalClaimableGnot * gnotUsd)
                : `${fmtGnot(totalClaimableGnot, { alreadyGnot: true })} GNOT`}
            </h2>
            <p className="muted">
              {vi
                ? `${fmtGnot(totalClaimableGnot, { alreadyGnot: true })} GNOT từ ${claimable.length} launch — 40% phí trade 1.2%.`
                : `${fmtGnot(totalClaimableGnot, { alreadyGnot: true })} GNOT across ${claimable.length} launch${claimable.length > 1 ? "es" : ""} — your 40% of the 1.2% trade fee.`}
            </p>
          </div>
          <button type="button" className="btn primary lg" disabled={busy} onClick={claimAll}>
            {busy && claimingId
              ? t("signing")
              : vi
                ? "Claim tất cả phí"
                : "Claim all fees"}
          </button>
        </div>
      )}

      {data && launches.length > 0 && (
        <div className="creator-toolbar">
          <div className="filter-tabs creator-filters" role="tablist" aria-label="Filter launches">
            {FILTERS.map((f) => {
              const count =
                f.id === "all"
                  ? launches.length
                  : f.id === "raising"
                    ? launches.filter((m) => m.status !== 1).length
                    : f.id === "graduated"
                      ? graduatedCount
                      : claimable.length;
              return (
                <button
                  key={f.id}
                  type="button"
                  role="tab"
                  aria-selected={filter === f.id}
                  className={`filter-btn${filter === f.id ? " active" : ""}`}
                  onClick={() => setFilter(f.id)}
                >
                  {f.id === "claimable" ? (vi ? "Claim được" : "Claimable") : t(f.labelKey) || f.id}
                  {count > 0 ? <span className="tab-count">{count}</span> : null}
                </button>
              );
            })}
          </div>
          <span className="muted creator-toolbar-count">
            {filtered.length} / {launches.length}
          </span>
        </div>
      )}

      {data && !launches.length && (
        <EmptyState
          icon="◎"
          title={vi ? "Chưa có launch" : "No launches yet"}
          action={
            <Link className="btn primary" to="/create">
              {vi ? "Tạo coin đầu tiên" : "Create your first coin"}
            </Link>
          }
        >
          {vi
            ? "Launch fair curve — phí creator tích lũy khi mọi người trade."
            : "Launch a fair curve token — creator fees accrue as people trade."}
        </EmptyState>
      )}

      {data && launches.length > 0 && !filtered.length && (
        <div className="muted" style={{ padding: "1.25rem 0" }}>
          {vi ? "Không có launch trong bộ lọc này." : "No launches in this filter."}
        </div>
      )}

      <div className="creator-grid">
        {filtered.map((m) => {
          const fees = feesGnotOf(m);
          const raised = raisedGnotOf(m);
          const hasFees = fees > 0;
          const pct = Math.min(100, Number(m.progressPct) || 0);
          const key = `${m.pkg}:${m.id}`;
          const claiming = claimingId === key;
          const isGrad = m.status === 1;
          const img = resolveTokenImage(m, null);
          const priceUsd = toUsd(m.priceGnot, m.gnotUsd || gnotUsd, m.priceUsd);
          const mcapUsd = toUsd(m.mcapGnot, m.gnotUsd || gnotUsd, m.mcapUsd);
          const feesUsd = gnotUsd > 0 ? fees * gnotUsd : 0;
          const raisedUsd = gnotUsd > 0 ? raised * (m.gnotUsd || gnotUsd) : 0;
          const path = `/token/${encodeURIComponent(m.id)}?pkg=${encodeURIComponent(m.pkg || "")}`;

          return (
            <article
              key={key}
              className={`creator-card panel${hasFees ? " is-claimable" : ""}${isGrad ? " is-grad" : ""}`}
            >
              <div className="creator-card-top">
                <Link to={path} className="creator-card-id">
                  <TokenAvatar
                    name={m.name}
                    symbol={m.symbol}
                    uri={img || m.uri}
                    seed={key}
                    size="lg"
                  />
                  <div>
                    <div className="creator-card-title">
                      {m.name || m.symbol}
                      <span className="card-symbol">${m.symbol}</span>
                    </div>
                    <div className="creator-card-meta muted">
                      <span className="mono">#{m.id}</span>
                      {m.padLabel ? <span>· {m.padLabel}</span> : null}
                    </div>
                  </div>
                </Link>
                <div className="creator-card-badges">
                  {m.gnoswapListed ? (
                    <Badge kind="gnoswap">{t("gnoswapBadge")}</Badge>
                  ) : (
                    <Badge kind={isGrad ? "graduated" : pct >= 70 ? "promo" : "curve"}>
                      {isGrad ? t("graduated") : t("raising")}
                    </Badge>
                  )}
                  {hasFees && (
                    <span className="creator-fee-pill">
                      {vi ? "Có phí" : "Fees"}
                    </span>
                  )}
                </div>
              </div>

              {!isGrad && (
                <div className="creator-card-raise">
                  <div className="creator-card-raise-top">
                    <span className="muted">{vi ? "Tiến độ raise" : "Raise progress"}</span>
                    <strong className="mono">{pct}%</strong>
                  </div>
                  <ProgressBar pct={pct} />
                </div>
              )}

              <div className="creator-card-metrics">
                <div>
                  <span className="k">{vi ? "Phí" : "Fees"}</span>
                  <strong className={`v mono${hasFees ? " fee-hot" : ""}`}>
                    {feesUsd > 0
                      ? fmtMcapUsd(feesUsd)
                      : `${fmtGnot(fees, { alreadyGnot: true })}`}
                  </strong>
                  <span className="s faint">
                    {fmtGnot(fees, { alreadyGnot: true })} GNOT
                  </span>
                </div>
                <div>
                  <span className="k">{t("raised")}</span>
                  <strong className="v mono">
                    {raisedUsd > 0
                      ? fmtMcapUsd(raisedUsd)
                      : `${fmtGnot(raised, { alreadyGnot: true })}`}
                  </strong>
                  <span className="s faint">
                    {fmtGnot(raised, { alreadyGnot: true })} GNOT
                  </span>
                </div>
                <div>
                  <span className="k">{t("price")}</span>
                  <strong className="v mono">
                    {priceUsd > 0 ? fmtPriceUsd(priceUsd) : "—"}
                  </strong>
                </div>
                <div>
                  <span className="k">{t("mcap")}</span>
                  <strong className="v mono">
                    {mcapUsd > 0 ? fmtMcapUsd(mcapUsd) : "—"}
                  </strong>
                </div>
                <div>
                  <span className="k">{t("buyers")}</span>
                  <strong className="v mono">{fmtNum(m.buyers)}</strong>
                </div>
              </div>

              <div className="creator-card-actions">
                <Link className="btn sm" to={path}>
                  {vi ? "Mở token" : "Open"}
                </Link>
                <button
                  type="button"
                  className={`btn sm${hasFees ? " primary" : " ghost"}`}
                  disabled={!hasFees || busy}
                  onClick={() => claim(m.id, m.pkg, m.symbol)}
                >
                  {claiming
                    ? t("signing")
                    : hasFees
                      ? vi
                        ? "Claim phí"
                        : "Claim fees"
                      : vi
                        ? "Chưa có phí"
                        : "No fees yet"}
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
