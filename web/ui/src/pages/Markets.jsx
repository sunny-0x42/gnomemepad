import { Component, useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useApp } from "../context/AppContext";
import ActivityTicker from "../components/ActivityTicker";
import MarketsHero from "../components/MarketsHero";
import TokenAvatar from "../components/TokenAvatar";
import CreatorChip from "../components/CreatorChip";
import { Badge, EmptyState, SkeletonCards, DropdownSelect } from "../components/ui";
import { usePrefs } from "../context/PrefsContext";
import { api } from "../lib/api";
import {
  formatCountdown,
  fmtGnot,
  fmtMcapUsd,
  fmtNum,
  fmtPriceUsd,
  relativeTime,
  shortAddr,
  toUsd,
} from "../lib/format";
import {
  buildFeaturedRails,
  heatLabel,
  isAlmostList,
  isRaising,
  isReadyToGraduate,
  isVisiblePadMarket,
  marketHeatScore,
  marketKey,
  raisedGnotOf,
  volumeMapFromActivity,
} from "../lib/marketHeat";
import { fetchMetaBatch, metaKey, resolveTokenImage, twitterUrl, telegramUrl, websiteUrl } from "../lib/meta";
import { isWatched } from "../lib/watchlist";
import { gnoswapSwapUrl, isGnoswapListed } from "../lib/gnoswap";

/** Estimate creation wall-clock from launch height (Sapphire ~2s blocks). */
function tokenCreatedMs(m, tipHeight) {
  if (Number(m?.createdMs) > 0) return Number(m.createdMs);
  if (m?.createdAt) {
    const p = Date.parse(m.createdAt);
    if (Number.isFinite(p)) return p;
  }
  const h = Number(m?.created) || 0;
  if (!h) return null;
  const tip = Number(tipHeight) || 0;
  if (tip > 0 && h <= tip) return Date.now() - (tip - h) * 2000;
  return null;
}

/** Compact age for market cards: 5m · 2h · 3d */
function tokenAgeLabel(m, tipHeight) {
  const ms = tokenCreatedMs(m, tipHeight);
  if (ms == null) {
    const h = Number(m?.created) || 0;
    return h > 0 ? `h${h}` : null;
  }
  const sec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  if (sec < 86400 * 30) return `${Math.floor(sec / 86400)}d`;
  return `${Math.floor(sec / (86400 * 30))}mo`;
}

const SORT_KEYS = new Set([
  "hot",
  "volume",
  "almost",
  "mcap",
  "price",
  "newest",
  "buyers",
  "raised",
  "watched",
]);

/** Prevent a blank home if card grid render throws. */
class MarketsErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error) {
    console.error("Markets render error", error);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="callout err" style={{ margin: "1rem 0" }}>
          <p style={{ margin: "0 0 0.65rem" }}>Markets failed to render.</p>
          <button
            type="button"
            className="btn primary sm"
            onClick={() => {
              this.setState({ error: null });
              this.props.onReset?.();
            }}
          >
            Reload markets
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function tierOf(tiers, id, pkg) {
  try {
    if (tiers && typeof tiers.get === "function") {
      return Number(tiers.get(marketKey(id, pkg || ""))) || 0;
    }
  } catch {
    /* ignore */
  }
  return 0;
}

export default function Markets() {
  const { health, connect, wallet, watchlist, toggleWatch } = useApp();
  const { t } = usePrefs();
  const [data, setData] = useState(null);
  const [bond, setBond] = useState(null);
  const [volMap, setVolMap] = useState({});
  const [metaMap, setMetaMap] = useState({});
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState("hot");
  const [err, setErr] = useState("");
  const [updatedAt, setUpdatedAt] = useState(null);
  const [tick, setTick] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [sortDir, setSortDir] = useState("desc");
  const [boundaryKey, setBoundaryKey] = useState(0);

  // Drop legacy table-view preference
  useEffect(() => {
    try {
      localStorage.removeItem("gnomemepad.viewMode");
      localStorage.removeItem("gnomemepad.viewRecover.v2");
      localStorage.removeItem("gnomemepad.showActivity");
    } catch {
      /* ignore */
    }
  }, []);

  function onSortSelect(value) {
    const key = SORT_KEYS.has(value) ? value : "hot";
    setSort(key);
    setSortDir("desc");
  }

  const load = useCallback(async (opts = {}) => {
    const soft = !!opts.soft;
    try {
      if (!soft) setErr("");
      if (soft) setRefreshing(true);
      const [m, b, act] = await Promise.all([
        api("/api/markets?refresh=1"),
        api("/api/bond").catch(() => null),
        api("/api/activity?limit=120").catch(() => ({ events: [] })),
      ]);
      setData(m);
      setBond(b);
      setVolMap(volumeMapFromActivity(act?.events || []));
      setUpdatedAt(Date.now());
      const items = (m?.markets || [])
        .filter((x) => !x.error && x.id && x.pkg)
        .map((x) => ({ pkg: x.pkg, id: x.id }));
      if (items.length) {
        fetchMetaBatch(items).then(setMetaMap).catch(() => { });
      }
    } catch (e) {
      if (!soft) setErr(e.message || String(e));
    } finally {
      if (soft) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load({ soft: false });
    // Soft refresh: keep list, show subtle indicator
    const t = setInterval(() => load({ soft: true }), 20000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const allMarkets = useMemo(
    () => (data?.markets || []).filter((m) => isVisiblePadMarket(m)),
    [data],
  );

  const gnotUsd = Number(data?.gnotUsd) || Number(allMarkets?.[0]?.gnotUsd) || 0;

  const featured = useMemo(
    () => buildFeaturedRails(allMarkets, volMap),
    [allMarkets, volMap],
  );

  // Single trending strip: almost first, then hot, unique
  const trending = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const m of [...featured.almost, ...featured.hot, ...featured.raising]) {
      const k = marketKey(m.id, m.pkg);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(m);
      if (out.length >= 8) break;
    }
    return out;
  }, [featured]);

  const markets = useMemo(() => {
    void tick;
    let list = [...allMarkets];
    if (status === "curve") list = list.filter((m) => m.status !== 1);
    if (status === "graduated") list = list.filter((m) => m.status === 1);
    if (status === "almost") list = list.filter((m) => isAlmostList(m, 70));
    if (status === "hot") {
      list = list.filter((m) => {
        const tier = featured.tiers.get(marketKey(m.id, m.pkg || "")) || 0;
        return tier >= 2 || (volMap[marketKey(m.id, m.pkg || "")]?.volumeGnot || 0) > 0;
      });
    }
    if (status === "watch") {
      list = list.filter((m) => isWatched(watchlist, m.id, m.pkg));
    }
    if (q.trim()) {
      const s = q.trim().toLowerCase();
      list = list.filter(
        (m) =>
          (m.name || "").toLowerCase().includes(s) ||
          (m.symbol || "").toLowerCase().includes(s) ||
          (m.id || "").toLowerCase().includes(s) ||
          (m.creator || "").toLowerCase().includes(s),
      );
    }
    const dir = sortDir === "asc" ? -1 : 1;
    const safeNum = (x) => {
      const n = Number(x);
      return Number.isFinite(n) ? n : 0;
    };
    list = [...list].sort((a, b) => {
      let cmp = 0;
      try {
        if (sort === "watched") {
          const wa = isWatched(watchlist, a.id, a.pkg) ? 1 : 0;
          const wb = isWatched(watchlist, b.id, b.pkg) ? 1 : 0;
          cmp = wb - wa || marketHeatScore(b, volMap) - marketHeatScore(a, volMap);
        } else if (sort === "newest") {
          cmp = safeNum(b.created) - safeNum(a.created);
        } else if (sort === "raised") {
          cmp = raisedGnotOf(b) - raisedGnotOf(a);
        } else if (sort === "buyers") {
          cmp = safeNum(b.buyers) - safeNum(a.buyers);
        } else if (sort === "almost") {
          cmp = safeNum(b.progressPct) - safeNum(a.progressPct);
        } else if (sort === "mcap") {
          // Prefer USD when present so sort matches displayed MCap
          const ma = safeNum(a.mcapUsd) || safeNum(a.mcapGnot) * safeNum(a.gnotUsd);
          const mb = safeNum(b.mcapUsd) || safeNum(b.mcapGnot) * safeNum(b.gnotUsd);
          cmp = mb - ma || safeNum(b.mcapGnot) - safeNum(a.mcapGnot);
        } else if (sort === "price") {
          const pa = safeNum(a.priceUsd) || safeNum(a.priceGnot) * safeNum(a.gnotUsd);
          const pb = safeNum(b.priceUsd) || safeNum(b.priceGnot) * safeNum(b.gnotUsd);
          cmp = pb - pa || safeNum(b.priceGnot) - safeNum(a.priceGnot);
        } else if (sort === "volume") {
          const va = safeNum(volMap[marketKey(a.id, a.pkg || "")]?.volumeGnot);
          const vb = safeNum(volMap[marketKey(b.id, b.pkg || "")]?.volumeGnot);
          cmp = vb - va || marketHeatScore(b, volMap) - marketHeatScore(a, volMap);
        } else {
          // hot (default)
          cmp =
            marketHeatScore(b, volMap) - marketHeatScore(a, volMap) ||
            (!!a.legacy === !!b.legacy ? 0 : a.legacy ? 1 : -1) ||
            raisedGnotOf(b) - raisedGnotOf(a);
        }
      } catch {
        cmp = 0;
      }
      if (!Number.isFinite(cmp)) cmp = 0;
      if (cmp === 0) {
        // Stable secondary: newer first, then symbol
        cmp =
          safeNum(b.created) - safeNum(a.created) ||
          String(a.symbol || "").localeCompare(String(b.symbol || ""));
      }
      return cmp * dir;
    });
    return list;
  }, [allMarkets, q, status, sort, sortDir, watchlist, tick, volMap]);

  const params = data?.params;

  const raisingCount = allMarkets.filter((m) => isRaising(m)).length;
  const almostCount = allMarkets.filter((m) => isAlmostList(m, 70)).length;
  const graduatedCount = allMarkets.filter((m) => m.status === 1).length;
  const isPromo = bond?.statusLabel === "promo";
  const promoLeft = bond?.secondsLeft;
  const showTrending = data && !q && status === "all" && trending.length > 0;

  const gradTarget =
    params?.graduationGnot != null
      ? Number(params.graduationGnot)
      : params?.graduation != null
        ? Number(params.graduation) / 1e6
        : 100;

  return (
    <section className="view markets-page markets-full">
      {/* Web3 Hero: Heading, Description, CTA + Spotlight & Live Activity List */}
      {!q && (
        <MarketsHero
          markets={allMarkets}
          metaMap={metaMap}
          gnotUsd={gnotUsd}
          trending={trending}
          loading={!data && !err}
          onExploreClick={() => {
            document.getElementById("markets-content")?.scrollIntoView({ behavior: "smooth" });
          }}
        />
      )}

      {/* Single trending strip */}
      {showTrending && (
        <div className="trending-strip">
          <div className="trending-strip-header">
            <span className="trending-label">Now trending</span>
          </div>
          <div className="trending-scroll">
            <div className={`trending-scroll-track${trending.length > 4 ? " animate" : ""}`}>
              {(trending.length > 4 ? [...trending, ...trending] : trending).map((m, i) => {
                const pct = Math.min(100, m.progressPct || 0);
                const img = resolveTokenImage(m, metaMap[metaKey(m.pkg, m.id)]);
                const almost = isAlmostList(m, 70);
                const ready = isReadyToGraduate(m);
                const tier = featured.tiers.get(marketKey(m.id, m.pkg || "")) || 0;
                return (
                  <Link
                    key={`tr-${i}-${m.pkg}:${m.id}`}
                    to={`/token/${encodeURIComponent(m.id)}?pkg=${encodeURIComponent(m.pkg || "")}`}
                    className="trending-card"
                  >
                    <div className="tc-cover">
                      {img ? (
                        <img src={img} alt={m.name} loading="lazy" />
                      ) : (
                        <div className="tc-cover-fallback">{m.symbol?.charAt(0)}</div>
                      )}
                    </div>
                    <div className="tc-body">
                      <div className="tc-header">
                        <span className="tc-name" title={m.name}>{m.name}</span>
                        {ready ? (
                          <Badge kind="promo">Ready</Badge>
                        ) : almost ? (
                          <Badge kind="promo">Soon</Badge>
                        ) : heatLabel(tier) ? (
                          <Badge kind={heatLabel(tier).kind}>{heatLabel(tier).text}</Badge>
                        ) : (
                          <Badge kind="neutral">+{pct}%</Badge>
                        )}
                      </div>
                      <div className="tc-desc">
                        {m.symbol}
                      </div>
                      <div className="tc-footer">
                        <span className="muted">Progress</span>
                        <span className="tc-pct">{pct}%</span>
                      </div>
                    </div>
                    <div className="tc-progress-line" style={{ width: `${pct}%` }} />
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Sticky control bar */}
      <div className="markets-controls sticky-controls" id="markets-content">
        <div className="filter-tabs markets-tabs" role="group" aria-label="Filter">
          {[
            ["all", t("all")],
            ["curve", t("raising") || "Raise"],
            ["almost", t("almostList") || "Soon"],
            ["hot", t("hot")],
            ["graduated", t("grad") || "Grad"],
            ["watch", "★"],
          ].map(([k, lab]) => (
            <button
              key={k}
              type="button"
              className={`filter-btn${status === k ? " active" : ""}`}
              onClick={() => setStatus(k)}
            >
              {lab}
              {k === "almost" && almostCount > 0 ? (
                <span className="tab-count">{almostCount}</span>
              ) : null}
              {k === "curve" && raisingCount > 0 ? (
                <span className="tab-count">{raisingCount}</span>
              ) : null}
            </button>
          ))}
        </div>

        <div className="markets-controls-right">
          <div className="markets-search-wrap">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="search"
              className="markets-search"
              placeholder={t("searchTokens") || `${t("search")}...`}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Search markets"
            />
          </div>
          <DropdownSelect
            value={SORT_KEYS.has(sort) ? sort : "hot"}
            onChange={(val) => onSortSelect(val)}
            ariaLabel="Sort"
            options={[
              { value: "hot", label: t("hot") },
              { value: "volume", label: t("volume") },
              { value: "almost", label: t("progress") || "Progress" },
              { value: "mcap", label: (t("mcap") || "MCAP").toUpperCase() },
              { value: "newest", label: t("newest") || "Newest" },
              { value: "buyers", label: t("buyers") },
              { value: "raised", label: t("raised") },
              { value: "watched", label: `★ ${t("watchedFirst") || "First"}` },
            ]}
          />
          <div className="markets-actions-group">
            <button
              type="button"
              className="btn sm ghost icon-btn"
              title={t("sortDirection") || "Sort direction"}
              onClick={() => setSortDir((d) => (d === "desc" ? "asc" : "desc"))}
            >
              {sortDir === "desc" ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M19 12l-7 7-7-7" /></svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
              )}
            </button>
            <div className="divider" />
            <button
              type="button"
              className={`btn sm ghost icon-btn${refreshing ? " spinning" : ""}`}
              onClick={() => load({ soft: !!data })}
              title={t("refresh") || "Refresh"}
              aria-busy={refreshing}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></svg>
            </button>
          </div>
          <span
            className={`live-pulse muted markets-live${refreshing ? " refreshing" : ""}`}
            title={updatedAt ? new Date(updatedAt).toISOString() : ""}
          >
            <span className="live-dot" />
            {refreshing ? "sync…" : updatedAt ? relativeTime(updatedAt) : "—"}
          </span>
        </div>
      </div>

      {/* One-line meta
      <div className="markets-meta-line">
        <span>
          {data ? (
            <>
              <strong>{raisingCount}</strong> raising
              {almostCount > 0 && (
                <>
                  {" · "}
                  <strong className="warn-text">{almostCount}</strong> soon
                </>
              )}
              {" · "}
              <strong>{graduatedCount}</strong> graduated
              {params?.graduationGnot != null && (
                <>
                  {" · grad @ "}
                  <strong>{params.graduationGnot}</strong> GNOT
                </>
              )}
              {markets.length !== allMarkets.length && (
                <>
                  {" · showing "}
                  <strong>{markets.length}</strong>
                </>
              )}
            </>
          ) : (
            "Loading…"
          )}
        </span>
      </div>
       */}



      {err && (
        <div className="callout err" style={{ marginBottom: "0.75rem" }}>
          <div style={{ marginBottom: "0.4rem" }}>{err}</div>
          <button type="button" className="btn sm primary" onClick={load}>
            {t("retry") || "Retry"}
          </button>
        </div>
      )}

      {!data && !err && <SkeletonCards n={8} />}

      {data && markets.length === 0 && (
        <EmptyState
          icon="◎"
          title={t("noMarkets") || "No markets"}
          action={
            status !== "all" || q ? (
              <button
                type="button"
                className="btn primary"
                onClick={() => {
                  setQ("");
                  setStatus("all");
                }}
              >
                {t("clearFilters") || "Clear filters"}
              </button>
            ) : (
              <Link className="btn primary" to="/create">
                {t("launchFirstCoin") || "Launch first coin"}
              </Link>
            )
          }
        >
          {status === "watch" ? (t("starToPin") || "Star tokens to pin them here.") : (t("tryAnotherFilter") || "Try another filter or launch a coin.")}
        </EmptyState>
      )}

      {markets.length > 0 && (
        <div className="markets-body">
          <div className="markets-main">
            <MarketsErrorBoundary
              key={boundaryKey}
              onReset={() => {
                setBoundaryKey((k) => k + 1);
                load({ soft: true });
              }}
            >
              <div className="market-grid market-grid-hero">
                {markets.map((m) => (
                  <MarketCard
                    key={`${m.pkg}:${m.id}`}
                    m={m}
                    volMap={volMap}
                    meta={metaMap[metaKey(m.pkg, m.id)]}
                    gradTarget={gradTarget}
                    tier={tierOf(featured.tiers, m.id, m.pkg)}
                    watched={isWatched(watchlist, m.id, m.pkg)}
                    tipHeight={health?.height}
                    tick={tick}
                    gnotUsd={gnotUsd}
                    t={t}
                    onToggleWatch={() =>
                      toggleWatch({
                        id: m.id,
                        pkg: m.pkg,
                        name: m.name,
                        symbol: m.symbol,
                      })
                    }
                  />
                ))}
              </div>
            </MarketsErrorBoundary>
          </div>
        </div>
      )}

      {health?.pkg && (
        <p className="markets-footer-meta faint">
          <code className="mono">{health.pkg.split("/").pop()}</code>
          {updatedAt ? ` · ${relativeTime(updatedAt)}` : ""}
          {" · ring volume"}
        </p>
      )}
    </section>
  );
}


function MarketCard({
  m,
  volMap,
  meta,
  gradTarget = 500,
  tier,
  watched,
  onToggleWatch,
  tipHeight,
  tick = 0,
  gnotUsd = 0,
  t = (k) => k,
}) {
  const pct = Math.min(100, m.progressPct || 0);
  const isGrad = m.status === 1;
  const almost = isAlmostList(m, 70);
  const ready = isReadyToGraduate(m);
  const k = marketKey(m.id, m.pkg || "");
  const rv = volMap[k] || {};
  const vol = rv.volumeGnot || 0;
  const trades = rv.trades || 0;
  const buyVol = rv.buyVol || 0;
  const heat = heatLabel(tier);
  const metaData = m.meta || {};
  const img = resolveTokenImage(m, metaData);
  const tw = twitterUrl(metaData?.twitter);
  const tg = telegramUrl(metaData?.telegram);
  const web = websiteUrl(metaData?.website);
  const raised = raisedGnotOf(m);
  const buyers = Number(m.buyers) || 0;
  const hasRv = vol > 0 || trades > 0;
  const fx = Number(m.gnotUsd || gnotUsd || 0);
  const creatorStr = typeof m?.creator === "string" ? m.creator : "";
  const creatorDisplay = creatorStr ? (creatorStr.startsWith("g1") ? shortAddr(creatorStr) : creatorStr) : "";
  const buyPct =
    hasRv && vol > 0 ? Math.min(100, Math.round((buyVol / vol) * 100)) : 50;
  // tick keeps age label fresh (1s parent interval)
  void tick;
  const age = tokenAgeLabel(m, tipHeight);
  const createdMs = tokenCreatedMs(m, tipHeight);
  const ageTitle =
    createdMs != null
      ? `Created ${relativeTime(createdMs)} · ${new Date(createdMs).toLocaleString()}`
      : m.created
        ? `Created at block ${m.created}`
        : undefined;

  // Legacy heat classes (warm / hot / fire) + ready/almost accents
  let heatClass = "";
  if (tier >= 3) heatClass = "card-heat card-fire";
  else if (tier >= 2) heatClass = "card-heat card-hot";
  else if (tier >= 1) heatClass = "card-heat card-warm";
  if (ready) heatClass += " card-ready-glow";
  else if (almost) heatClass += " card-almost-glow";
  if (watched) heatClass += " card-watched";

  return (
    <article className={`card market-card market-card-v2 ${heatClass}`}>
      <Link
        to={`/token/${encodeURIComponent(m.id)}?pkg=${encodeURIComponent(m.pkg || "")}`}
        className="mc-link"
      >
        <div className="mc-body">
          <div className="mc-header-row">
            <div className="mc-badges-left">
              {isGnoswapListed(m) ? (
                <Badge kind="gnoswap" title={t("listedOnGnoswap") || "Listed on Gnoswap"}>Gnoswap</Badge>
              ) : (
                <Badge kind={isGrad ? "graduated" : "curve"}>{isGrad ? (t("grad") || "Grad") : (t("curve") || "Curve")}</Badge>
              )}
            </div>
            <div className="mc-avatar-wrap">
              <TokenAvatar
                name={m.name}
                symbol={m.symbol}
                uri={img}
                seed={`${m.pkg}:${m.id}`}
                size="lg"
                className={tier >= 2 ? "heat" : ""}
              />
            </div>
            <div className="mc-badges-right">
              {heat && <Badge kind={heat.kind}>{heat.text}</Badge>}
              {ready && <Badge kind="promo">{t("ready") || "Ready"}</Badge>}
              {!ready && almost && <Badge kind="promo">{t("soon") || "Soon"}</Badge>}
            </div>
          </div>

          <div className="mc-title-sec">
            <h3 className="mc-title" title={m.name || m.symbol}>{m.name || m.symbol}</h3>
            <div className="mc-subtitle">
              ${m.symbol}{creatorDisplay ? ` · ${creatorDisplay}` : ""}
            </div>
            {(tw || tg || web) && (
              <div className="mc-socials" style={{ display: 'flex', justifyContent: 'center', gap: '0.4rem', marginTop: '0.5rem' }}>
                {tw && <span className="social-chip" onClick={(e) => { e.preventDefault(); e.stopPropagation(); window.open(tw, '_blank'); }}>X</span>}
                {tg && <span className="social-chip" onClick={(e) => { e.preventDefault(); e.stopPropagation(); window.open(tg, '_blank'); }}>Telegram</span>}
                {web && <span className="social-chip" onClick={(e) => { e.preventDefault(); e.stopPropagation(); window.open(web, '_blank'); }}>Website</span>}
              </div>
            )}
          </div>

          {isGnoswapListed(m) ? (
            <div className="mc-progress-sec">
              <div className="mc-progress-track">
                <div className="mc-progress-fill" style={{ width: "100%" }} />
              </div>
              <div className="mc-progress-foot" style={{ justifyContent: "center" }}>
                <span>{t("listedOnGnoswap") || "Listed on Gnoswap"} · {t("tradeViaDex") || "trade via DEX"}</span>
              </div>
            </div>
          ) : !isGrad ? (
            <div className="mc-progress-sec">
              <div className="mc-progress-head">
                <span>{t("processing") || "Processing"} {pct}%</span>
              </div>
              <div className="mc-progress-track">
                <div className="mc-progress-fill" style={{ width: `${pct}%` }}>
                  <div className="mc-progress-thumb" />
                </div>
              </div>
              <div className="mc-progress-foot">
                <span>{fmtGnot(raised, { alreadyGnot: true })} GNOT</span>
                <span>{fmtGnot(gradTarget, { alreadyGnot: true })} GNOT</span>
              </div>
            </div>
          ) : null}

          <div className="mc-stats-grid">
            <div className="mc-stat-pill">
              <span className="muted">{t("price") || "Price"}:</span> <span>{fmtPriceUsd(toUsd(m.priceGnot, fx, m.priceUsd))}</span>
            </div>
            <div className="mc-stat-pill">
              <span className="muted">{t("mcap") || "MCap"}:</span> <span>{fmtMcapUsd(toUsd(m.mcapGnot, fx, m.mcapUsd))}</span>
            </div>
            <div className="mc-stat-pill">
              <span className="muted">{t("volume") || "Vol"}:</span> <span>{hasRv && vol > 0 ? (toUsd(vol, fx) > 0 ? fmtMcapUsd(toUsd(vol, fx)) : `${fmtGnot(vol, { alreadyGnot: true })} GNOT`) : "—"}{hasRv && trades > 0 ? ` · ${trades} tx` : ""}</span>
            </div>
            <div className="mc-stat-pill">
              <span className="muted">{t("buyers") || "Buyers"}:</span> <span>{buyers > 0 ? fmtNum(buyers) : "—"}</span>
            </div>
          </div>
        </div>
      </Link>

      <div className="mc-footer">
        <div className="mc-footer-left">
          <div className="muted" style={{ fontSize: '0.7rem', marginBottom: '0.1rem' }}>{t("age") || "Age"}:</div>
          <strong>{age || (t("newLaunches") || "New")}</strong>
        </div>
        <div className="mc-footer-right">
          <button
            type="button"
            className={`mc-btn-star${watched ? " on" : ""}`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onToggleWatch();
            }}
          >
            {watched ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" /></svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" /></svg>
            )}
          </button>
          {isGnoswapListed(m) ? (
            <a
              href={gnoswapSwapUrl(m)}
              target="_blank"
              rel="noopener noreferrer"
              className="mc-btn-view"
            >
              Swap on Gnoswap
            </a>
          ) : (
            <Link
              to={`/token/${encodeURIComponent(m.id)}?pkg=${encodeURIComponent(m.pkg || "")}`}
              className="mc-btn-view"
            >
              View
            </Link>
          )}
        </div>
      </div>
    </article>
  );
}
