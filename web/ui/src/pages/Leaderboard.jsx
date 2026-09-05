import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { usePrefs } from "../context/PrefsContext";
import { EmptyState, PageHeader, SkeletonPanel } from "../components/ui";
import CreatorChip from "../components/CreatorChip";
import { api } from "../lib/api";
import { fmtCompact, fmtMcapUsd, fmtNum, fmtUsd, shortAddr } from "../lib/format";

const TABS = [
  { id: "traders", key: "lbTopTraders" },
  { id: "pnl", key: "lbTopPnl" },
  { id: "creators", key: "lbTopCreators" },
  { id: "volume", key: "lbTopVolume" },
  { id: "mcap", key: "lbTopMcap" },
  { id: "points", key: "lbPoints" },
];

function tokenPath(row) {
  if (!row?.id) return null;
  const q = row.pkg ? `?pkg=${encodeURIComponent(row.pkg)}` : "";
  return `/token/${encodeURIComponent(row.id)}${q}`;
}

function Rank({ n }) {
  return (
    <span className={`lb-rank-badge${n <= 3 ? ` top-${n}` : ""}`} aria-label={`Rank ${n}`}>
      {n}
    </span>
  );
}

/** Primary USD (or GNOT) + optional muted GNOT secondary on one line */
function Money({ usd, gnot, signed = false }) {
  const u = Number(usd);
  const g = Number(gnot);
  const hasUsd = Number.isFinite(u) && Math.abs(u) >= 1e-12;
  const hasGnot = Number.isFinite(g) && Math.abs(g) >= 1e-12;
  if (!hasUsd && !hasGnot) return <span className="lb-val">—</span>;

  const signOf = hasUsd ? u : g;
  let main;
  if (hasUsd) {
    const abs = fmtUsd(Math.abs(u));
    if (signed) {
      main = signOf > 0 ? `+${abs}` : signOf < 0 ? `-${abs}` : abs;
    } else {
      main = signOf < 0 ? `-${abs}` : abs;
    }
  } else {
    const body = `${fmtCompact(Math.abs(g))} GNOT`;
    if (signed) {
      main = signOf > 0 ? `+${body}` : signOf < 0 ? `-${body}` : body;
    } else {
      main = signOf < 0 ? `-${body}` : body;
    }
  }

  const cls =
    signed && signOf > 0 ? "lb-val pnl-pos" : signed && signOf < 0 ? "lb-val pnl-neg" : "lb-val";

  return (
    <span className={cls} title={hasGnot && hasUsd ? `${fmtCompact(g)} GNOT` : undefined}>
      {main}
      {hasUsd && hasGnot && <span className="lb-val-sec"> · {fmtCompact(g)}</span>}
    </span>
  );
}

function Pct({ value }) {
  if (value == null || !Number.isFinite(Number(value))) return null;
  const p = Number(value);
  const cls = p > 0 ? "pnl-pos" : p < 0 ? "pnl-neg" : "";
  return (
    <span className={`lb-pct ${cls}`.trim()}>
      {p >= 0 ? "+" : ""}
      {p.toFixed(1)}%
    </span>
  );
}

function TokenCell({ row }) {
  const path = tokenPath(row);
  const sym = row.symbol ? `$${row.symbol}` : row.name || `#${row.id}`;
  const name = row.name && row.symbol ? row.name : null;
  const inner = (
    <>
      <span className="lb-id-primary">
        {sym}
        {row.gnoswapListed ? <span className="lb-gs">GS</span> : null}
      </span>
      {name ? <span className="lb-id-sec">{name}</span> : null}
    </>
  );
  if (!path) return <div className="lb-id">{inner}</div>;
  return (
    <Link to={path} className="lb-id lb-id-link">
      {inner}
    </Link>
  );
}

function AddrCell({ address }) {
  if (!address) return <span className="lb-val">—</span>;
  return (
    <div className="lb-id">
      <span className="lb-id-primary">
        <CreatorChip address={address} />
      </span>
      <span className="lb-id-sec mono">{shortAddr(address, 5)}</span>
    </div>
  );
}

function BoardHead({ cols }) {
  return (
    <div className="lb-board-head" role="row">
      {cols.map((c) => (
        <div key={c.key} className={`lb-cell ${c.align || ""}`.trim()} role="columnheader">
          {c.label}
        </div>
      ))}
    </div>
  );
}

function BoardRow({ cols, children, rank }) {
  return (
    <div className="lb-board-row" role="row">
      <div className="lb-cell lb-cell-rank" role="cell">
        <Rank n={rank} />
      </div>
      {children}
    </div>
  );
}

export default function Leaderboard() {
  const { t } = usePrefs();
  const [params, setParams] = useSearchParams();
  const tabParam = params.get("tab") || "traders";
  const tab = TABS.some((x) => x.id === tabParam) ? tabParam : "traders";

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const d = await api("/api/leaderboard");
      setData(d);
    } catch (e) {
      setData(null);
      setErr(e?.message || "Failed to load leaderboard");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function setTab(id) {
    const next = new URLSearchParams(params);
    if (id === "traders") next.delete("tab");
    else next.set("tab", id);
    setParams(next, { replace: true });
  }

  const note = useMemo(() => {
    const n = data?.notes || {};
    if (tab === "traders") return n.traders || t("lbNoteTraders");
    if (tab === "pnl") return n.pnl || t("lbNotePnl");
    if (tab === "volume") return n.volume || t("lbNoteVolume");
    if (tab === "mcap") return n.mcap || t("lbNoteMcap");
    if (tab === "creators") return n.creators || t("lbNoteCreators");
    if (tab === "points") return t("lbNotePoints");
    return "";
  }, [data, tab, t]);

  const rows = useMemo(() => {
    if (!data) return [];
    if (tab === "traders") return data.topTraders || [];
    if (tab === "pnl") return data.topPnl || [];
    if (tab === "creators") return data.topCreators || [];
    if (tab === "volume") return data.topVolume || [];
    if (tab === "mcap") return data.topMcap || [];
    if (tab === "points") return data.pointsBoard || [];
    return [];
  }, [data, tab]);

  const gnotUsd = Number(data?.gnotUsd) || 0;
  const scanned = data?.scanned || {};

  const headCols = useMemo(() => {
    const rank = { key: "rank", label: "#", align: "lb-cell-rank" };
    if (tab === "traders") {
      return [
        rank,
        { key: "trader", label: t("lbTrader"), align: "lb-cell-id" },
        { key: "mkts", label: t("lbMarketsHeld"), align: "lb-cell-num" },
        { key: "bag", label: t("lbBagValue"), align: "lb-cell-num" },
        { key: "pnl", label: t("lbEstPnl"), align: "lb-cell-num" },
      ];
    }
    if (tab === "pnl") {
      return [
        rank,
        { key: "trader", label: t("lbTrader"), align: "lb-cell-id" },
        { key: "token", label: t("token"), align: "lb-cell-id" },
        { key: "pos", label: t("lbPosition"), align: "lb-cell-num" },
        { key: "pnl", label: t("lbEstPnl"), align: "lb-cell-num" },
      ];
    }
    if (tab === "creators") {
      return [
        rank,
        { key: "creator", label: t("creator"), align: "lb-cell-id" },
        { key: "n", label: t("lbLaunches"), align: "lb-cell-num" },
        { key: "gl", label: t("lbGradListed"), align: "lb-cell-num" },
        { key: "raised", label: t("lbTotalRaised"), align: "lb-cell-num" },
        { key: "mcap", label: t("lbTotalMcap"), align: "lb-cell-num" },
      ];
    }
    if (tab === "volume") {
      return [
        rank,
        { key: "token", label: t("token"), align: "lb-cell-id" },
        { key: "vol", label: t("lbVolume"), align: "lb-cell-num" },
        { key: "trades", label: t("lbTrades"), align: "lb-cell-num" },
        { key: "mcap", label: t("lbMcap"), align: "lb-cell-num" },
      ];
    }
    if (tab === "mcap") {
      return [
        rank,
        { key: "token", label: t("token"), align: "lb-cell-id" },
        { key: "mcap", label: t("lbMcap"), align: "lb-cell-num" },
        { key: "price", label: t("lbPrice"), align: "lb-cell-num" },
        { key: "buyers", label: t("lbBuyers"), align: "lb-cell-num" },
      ];
    }
    return [
      rank,
      { key: "trader", label: t("lbTrader"), align: "lb-cell-id" },
      { key: "pts", label: t("yourPoints"), align: "lb-cell-num" },
    ];
  }, [tab, t]);

  return (
    <section className="view leaderboard-page">
      <PageHeader
        kicker="Rankings"
        title={t("leaderboard")}
        lede={t("lbLede")}
        actions={
          <button type="button" className="btn sm ghost" onClick={load} disabled={loading}>
            {loading ? t("loading") : t("refresh")}
          </button>
        }
      />

      <div className="lb-meta-bar">
        <span>
          <strong>{loading && !data ? "…" : fmtNum(scanned.markets)}</strong> {t("lbScannedMarkets").toLowerCase()}
        </span>
        <span className="lb-meta-dot" aria-hidden>
          ·
        </span>
        <span>
          <strong>{loading && !data ? "…" : fmtNum(scanned.traders)}</strong> {t("lbTraders").toLowerCase()}
        </span>
        <span className="lb-meta-dot" aria-hidden>
          ·
        </span>
        <span>
          <strong>{loading && !data ? "…" : fmtNum(scanned.hotMarkets)}</strong> {t("lbHotMarkets").toLowerCase()}
        </span>
        {gnotUsd > 0 && (
          <>
            <span className="lb-meta-dot" aria-hidden>
              ·
            </span>
            <span className="faint">GNOT ${gnotUsd.toFixed(4)}</span>
          </>
        )}
      </div>

      <div className="filter-tabs leaderboard-tabs" role="tablist" aria-label={t("leaderboard")}>
        {TABS.map((x) => (
          <button
            key={x.id}
            type="button"
            role="tab"
            aria-selected={tab === x.id}
            className={`filter-btn${tab === x.id ? " active" : ""}`}
            onClick={() => setTab(x.id)}
          >
            {t(x.key)}
          </button>
        ))}
      </div>

      {note && <p className="muted leaderboard-note">{note}</p>}

      {loading && !data && <SkeletonPanel height={280} />}

      {err && !data && (
        <EmptyState
          icon="!"
          title={t("leaderboard")}
          action={
            <button type="button" className="btn primary sm" onClick={load}>
              {t("retry")}
            </button>
          }
        >
          {err}
        </EmptyState>
      )}

      {data && (
        <div className={`lb-board lb-board--${tab}`} role="table" aria-label={t("leaderboard")}>
          <BoardHead cols={headCols} />

          {tab === "traders" &&
            rows.map((r, i) => (
              <BoardRow key={r.address || i} rank={i + 1} cols={headCols}>
                <div className="lb-cell lb-cell-id" role="cell">
                  <AddrCell address={r.address} />
                </div>
                <div className="lb-cell lb-cell-num" role="cell">
                  <span className="lb-val">{fmtNum(r.markets)}</span>
                </div>
                <div className="lb-cell lb-cell-num" role="cell">
                  <Money usd={r.totalValueUsd} gnot={r.totalValueGnot} />
                </div>
                <div className="lb-cell lb-cell-num" role="cell">
                  <Money usd={r.totalPnlUsd} gnot={r.totalPnlGnot} signed />
                </div>
              </BoardRow>
            ))}

          {tab === "pnl" &&
            rows.map((r, i) => (
              <BoardRow key={`${r.address}-${r.pkg}-${r.id}-${i}`} rank={i + 1} cols={headCols}>
                <div className="lb-cell lb-cell-id" role="cell">
                  <AddrCell address={r.address} />
                </div>
                <div className="lb-cell lb-cell-id" role="cell">
                  <TokenCell row={r} />
                </div>
                <div className="lb-cell lb-cell-num" role="cell">
                  <Money usd={r.valueUsd} gnot={r.valueGnot} />
                </div>
                <div className="lb-cell lb-cell-num" role="cell">
                  <span className="lb-val-stack">
                    <Money usd={r.pnlUsd} gnot={r.pnlGnot} signed />
                    <Pct value={r.pnlPct} />
                  </span>
                </div>
              </BoardRow>
            ))}

          {tab === "creators" &&
            rows.map((r, i) => (
              <BoardRow key={r.address || i} rank={i + 1} cols={headCols}>
                <div className="lb-cell lb-cell-id" role="cell">
                  <div className="lb-id">
                    <span className="lb-id-primary">
                      <CreatorChip address={r.address} />
                    </span>
                    {r.symbols?.length > 0 && (
                      <span className="lb-id-sec">{r.symbols.map((s) => `$${s}`).join(" · ")}</span>
                    )}
                  </div>
                </div>
                <div className="lb-cell lb-cell-num" role="cell">
                  <span className="lb-val">{fmtNum(r.launches)}</span>
                </div>
                <div className="lb-cell lb-cell-num" role="cell">
                  <span className="lb-val">
                    {fmtNum(r.graduated)}
                    <span className="lb-val-sec"> / {fmtNum(r.listed)}</span>
                  </span>
                </div>
                <div className="lb-cell lb-cell-num" role="cell">
                  <Money
                    usd={gnotUsd > 0 ? r.totalRaisedGnot * gnotUsd : 0}
                    gnot={r.totalRaisedGnot}
                  />
                </div>
                <div className="lb-cell lb-cell-num" role="cell">
                  <Money usd={r.totalMcapUsd} gnot={r.totalMcapGnot} />
                </div>
              </BoardRow>
            ))}

          {tab === "volume" &&
            rows.map((r, i) => (
              <BoardRow key={`${r.pkg}|${r.id}|${i}`} rank={i + 1} cols={headCols}>
                <div className="lb-cell lb-cell-id" role="cell">
                  <TokenCell row={r} />
                </div>
                <div className="lb-cell lb-cell-num" role="cell">
                  <Money usd={r.volumeUsd} gnot={r.volumeGnot} />
                </div>
                <div className="lb-cell lb-cell-num" role="cell">
                  <span className="lb-val">{fmtNum(r.trades)}</span>
                </div>
                <div className="lb-cell lb-cell-num" role="cell">
                  <span className="lb-val">
                    {fmtMcapUsd(r.mcapUsd) !== "—" ? fmtMcapUsd(r.mcapUsd) : `${fmtCompact(r.mcapGnot)} GNOT`}
                  </span>
                </div>
              </BoardRow>
            ))}

          {tab === "mcap" &&
            rows.map((r, i) => (
              <BoardRow key={`${r.pkg}|${r.id}|${i}`} rank={i + 1} cols={headCols}>
                <div className="lb-cell lb-cell-id" role="cell">
                  <TokenCell row={r} />
                </div>
                <div className="lb-cell lb-cell-num" role="cell">
                  <Money usd={r.mcapUsd} gnot={r.mcapGnot} />
                </div>
                <div className="lb-cell lb-cell-num" role="cell">
                  <span className="lb-val">
                    {r.priceUsd > 0
                      ? fmtUsd(r.priceUsd, { compact: r.priceUsd >= 1 })
                      : r.priceGnot > 0
                        ? `${fmtCompact(r.priceGnot)}`
                        : "—"}
                  </span>
                </div>
                <div className="lb-cell lb-cell-num" role="cell">
                  <span className="lb-val">{fmtNum(r.buyers)}</span>
                </div>
              </BoardRow>
            ))}

          {tab === "points" &&
            rows.map((r, i) => (
              <BoardRow key={r.address || i} rank={i + 1} cols={headCols}>
                <div className="lb-cell lb-cell-id" role="cell">
                  <AddrCell address={r.address} />
                </div>
                <div className="lb-cell lb-cell-num" role="cell">
                  <span className="lb-val lb-val-strong">{fmtNum(r.points)}</span>
                </div>
              </BoardRow>
            ))}

          {!rows.length && !loading && (
            <div className="lb-empty muted">{t("noEntries")}</div>
          )}
        </div>
      )}

      {data?.updatedAt && (
        <p className="lb-updated muted">
          {t("lbUpdated")}: {new Date(data.updatedAt).toLocaleString()}
          {data.cached ? " · cached" : ""}
        </p>
      )}
    </section>
  );
}
