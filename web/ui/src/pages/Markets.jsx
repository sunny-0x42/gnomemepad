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
  fmtPrice,
  fmtPriceUsd,
  fmtVolGnot,
  relativeTime,
  shortAddr,
  toUsd,
} from "../lib/format";
import {
  buildFeaturedRails,
  cardVolumeOf,
  graduationGnotOf,
  heatLabel,
  isAlmostList,
  isRaising,
  isReadyToGraduate,
  isVisiblePadMarket,
  marketHeatScore,
  marketKey,
  mergeVolumeMaps,
  formatProgressPct,
  progressPctOf,
  raisedGnotOf,
  volumeMapFromActivity,
  volumeMapFromMarkets,
} from "../lib/marketHeat";
import { fetchMetaBatch, metaKey, resolveTokenImage, twitterUrl, telegramUrl, websiteUrl } from "../lib/meta";
import { isWatched } from "../lib/watchlist";
import { gnoswapSwapUrl, isGnoswapListed } from "../lib/gnoswap";
import { AchievementBadgeRow } from "../components/AchievementBadge";
import { wearFromMarket } from "../lib/badges";
import { useFlipGrid } from "../lib/useFlipGrid";
import { dexTradeUrl, isListed, venueLabel, venueOf } from "../lib/venues";

/** Estimate creation wall-clock from launch height (Gno ~2s blocks). */
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
    const hard = !!opts.hard;
    try {
      if (!soft) setErr("");
      if (soft) setRefreshing(true);
      // Credit/speed: always paint markets-lite first (CDN + snapshot). Hard = refresh=1.
      // Volume: markets-lite now includes tradeStats from TradeHistory (same as Token page).
      const marketsQs = hard ? "/api/markets?refresh=1" : "/api/markets-lite";
      const m = await api(marketsQs);
      setData(m);
      setUpdatedAt(Date.now());
      // Seed volMap immediately from tradeStats so cards don't wait on activity sample.
      const fromMarkets = volumeMapFromMarkets(m?.markets || []);
      setVolMap((prev) => mergeVolumeMaps(prev, fromMarkets));

      if (soft) {
        // Live ranking fuel: refresh activity (CDN ~20s); merge — never shrink tradeStats totals
        api("/api/activity?limit=80")
          .then((act) => {
            const fromAct = volumeMapFromActivity(act?.events || []);
            setVolMap((prev) => mergeVolumeMaps(prev, fromAct, fromMarkets));
          })
          .catch(() => {});
      } else {
        // Eager activity + bond (parallel with paint) — volume already seeded from markets
        Promise.all([
          api("/api/bond").catch(() => null),
          api("/api/activity?limit=80").catch(() => ({ events: [] })),
        ]).then(([b, act]) => {
          setBond(b);
          const fromAct = volumeMapFromActivity(act?.events || []);
          setVolMap((prev) => mergeVolumeMaps(prev, fromAct, fromMarkets));
        });
        if (hard) {
          api("/api/markets")
            .then((full) => {
              if (full?.markets?.length) {
                setData(full);
                setVolMap((prev) =>
                  mergeVolumeMaps(prev, volumeMapFromMarkets(full.markets)),
                );
              }
            })
            .catch(() => {});
        }
      }

      const items = (m?.markets || [])
        .filter((x) => !x.error && x.id && x.pkg)
        .map((x) => ({ pkg: x.pkg, id: x.id }));
      if (items.length && !soft) {
        fetchMetaBatch(items).then(setMetaMap).catch(() => {});
      }
    } catch (e) {
      if (!soft) setErr(e.message || String(e));
    } finally {
      if (soft) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load({ soft: false });
    // Soft: markets + activity for live re-rank (~20–35s CDN window)
    const t = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      load({ soft: true });
    }, 22000);
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
        return tier >= 2 || cardVolumeOf(m, volMap).volumeGnot > 0;
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
          const va = cardVolumeOf(a, volMap).volumeGnot;
          const vb = cardVolumeOf(b, volMap).volumeGnot;
          cmp = vb - va || marketHeatScore(b, volMap) - marketHeatScore(a, volMap);
        } else {
          // hot (default): live interaction — volume/trades bubble up, quiet sinks
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

  // Stable order signature for FLIP when live heat reorders cards
  const orderSig = useMemo(
    () => markets.map((m) => `${m.pkg}:${m.id}`).join("|"),
    [markets],
  );
  const flipRef = useFlipGrid([orderSig]);

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
                const pctValue = progressPctOf(m, params);
                const pct = pctValue == null ? null : Math.min(100, pctValue);
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
                          <Badge kind="neutral">
                            {(() => {
                              const label = formatProgressPct(pct, m);
                              return label === "—" ? label : `+${label}`;
                            })()}
                          </Badge>
                        )}
                      </div>
                      <div className="tc-desc">
                        {m.symbol}
                      </div>
                      <div className="tc-footer">
                        <span className="muted">Progress</span>
                        <span className="tc-pct">{pct == null ? "—" : formatProgressPct(pct, m)}</span>
                      </div>
                    </div>
                    <div className="tc-progress-line" style={{ width: `${pct == null ? 0 : pct}%` }} />
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
              { value: "hot", label: t("liveRank") || "Live · volume" },
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
              <div className="market-grid market-grid-hero market-grid-live" ref={flipRef}>
                {markets.map((m, idx) => (
                  <div
                    key={`${m.pkg}:${m.id}`}
                    className="market-flip-item"
                    data-flip-key={`${m.pkg}:${m.id}`}
                    data-rank={idx + 1}
                  >
                    <MarketCard
                      m={m}
                      volMap={volMap}
                      meta={metaMap[metaKey(m.pkg, m.id)]}
                      pageParams={params}
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
                  </div>
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
          {" · live rank by volume / interaction"}
        </p>
      )}
    </section>
  );
}


function MarketCard({
  m,
  volMap,
  meta,
  pageParams = null,
  tier,
  watched,
  onToggleWatch,
  tipHeight,
  tick = 0,
  gnotUsd = 0,
  t = (k) => k,
}) {
  const { networkId } = useApp();
  const listedVenue = venueOf(m);
  const listed = isListed(m);
  const tradeUrl = listed ? dexTradeUrl(m, networkId) : null;
  const pctValue = progressPctOf(m, pageParams);
  const pct = pctValue == null ? null : Math.min(100, pctValue);
  const gradTarget = graduationGnotOf(m, pageParams);
  const isGrad = m.status === 1;
  const almost = isAlmostList(m, 70);
  const ready = isReadyToGraduate(m);
  // Curve tradeStats + DEX dexTradeStats. Activity sample only if stats are absent.
  const rv = cardVolumeOf(m, volMap);
  const vol = Number(rv.volumeGnot) || 0;
  const trades = Number(rv.trades) || 0;
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
              {listed && listedVenue ? (
                <Badge
                  kind={listedVenue === "zdex" ? "zdex" : "gnoswap"}
                  title={(t("listedOnVenue") || "Listed on {venue}").replace(
                    "{venue}",
                    venueLabel(listedVenue),
                  )}
                >
                  {venueLabel(listedVenue)}
                </Badge>
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
            <AchievementBadgeRow
              className="mc-ach-badges"
              badges={wearFromMarket(m, 2)}
              size="sm"
            />
            {(tw || tg || web) && (
              <div className="mc-socials" style={{ display: 'flex', justifyContent: 'center', gap: '0.4rem', marginTop: '0.5rem' }}>
                {tw && <span className="social-chip" onClick={(e) => { e.preventDefault(); e.stopPropagation(); window.open(tw, '_blank'); }}>X</span>}
                {tg && <span className="social-chip" onClick={(e) => { e.preventDefault(); e.stopPropagation(); window.open(tg, '_blank'); }}>Telegram</span>}
                {web && <span className="social-chip" onClick={(e) => { e.preventDefault(); e.stopPropagation(); window.open(web, '_blank'); }}>Website</span>}
              </div>
            )}
          </div>

          {listed ? (
            <div className="mc-progress-sec">
              <div className="mc-progress-track">
                <div className="mc-progress-fill" style={{ width: "100%" }} />
              </div>
              <div className="mc-progress-foot" style={{ justifyContent: "center" }}>
                <span>
                  {(t("listedOnVenue") || "Listed on {venue}").replace(
                    "{venue}",
                    venueLabel(listedVenue),
                  )}{" "}
                  · {t("tradeViaDex") || "trade via DEX"}
                </span>
              </div>
            </div>
          ) : !isGrad ? (
            <div className="mc-progress-sec">
              <div className="mc-progress-head">
                <span>
                  {t("processing") || "Processing"} {formatProgressPct(pct, m)}
                </span>
              </div>
              <div className="mc-progress-track">
                <div className="mc-progress-fill" style={{ width: `${pct == null ? 0 : pct}%` }}>
                  <div className="mc-progress-thumb" />
                </div>
              </div>
              <div className="mc-progress-foot">
                <span>
                  {m.raisedGnot != null || m.raised != null
                    ? `${fmtGnot(raised, { alreadyGnot: true })} GNOT`
                    : "—"}
                </span>
                <span>
                  {gradTarget != null ? `${fmtGnot(gradTarget, { alreadyGnot: true })} GNOT` : "—"}
                </span>
              </div>
            </div>
          ) : null}

          <div className="mc-stats-grid">
            <div className="mc-stat-pill">
              <span className="muted">{t("price") || "Price"}:</span>{" "}
              <span>
                {(() => {
                  const usd = toUsd(m.spotGnot ?? m.priceGnot, fx, m.priceUsd);
                  const pg = Number(m.spotGnot ?? m.priceGnot) || 0;
                  if (usd > 0) return fmtPriceUsd(usd);
                  if (pg > 0) return `${fmtPrice(pg)} GNOT`;
                  return "—";
                })()}
              </span>
            </div>
            <div className="mc-stat-pill">
              <span className="muted">{t("mcap") || "MCap"}:</span>{" "}
              <span>
                {(() => {
                  const usd = toUsd(m.mcapGnot, fx, m.mcapUsd);
                  const mg = Number(m.mcapGnot) || 0;
                  if (usd > 0) return fmtMcapUsd(usd);
                  if (mg > 0) return `${fmtGnot(mg, { alreadyGnot: true })} GNOT`;
                  return "—";
                })()}
              </span>
            </div>
            <div className="mc-stat-pill">
              <span className="muted">{t("volume") || "Vol"}:</span>{" "}
              <span>
                {hasRv && vol > 0
                  ? toUsd(vol, fx) > 0
                    ? fmtMcapUsd(toUsd(vol, fx))
                    : `${fmtVolGnot(vol)} GNOT`
                  : "—"}
                {hasRv && trades > 0 ? ` · ${trades} tx` : ""}
                {m.statWindows?.windows?.["24h"] ? (
                  <span className="muted">
                    {` · 24h ${(() => {
                      const g = Number(m.statWindows.windows["24h"].volumeGnot) || 0;
                      const usd = toUsd(g, fx);
                      if (usd > 0) return fmtMcapUsd(usd);
                      return `${fmtVolGnot(g)} GNOT`;
                    })()}`}
                  </span>
                ) : null}
              </span>
            </div>
            <div className="mc-stat-pill">
              <span className="muted">{t("holders") || "Holders"}:</span>{" "}
              <span>
                {m.holdersActive != null && Number.isFinite(Number(m.holdersActive))
                  ? fmtNum(m.holdersActive)
                  : "—"}
              </span>
              {buyers > 0 ? (
                <span className="muted">{` · ${fmtNum(buyers)} ${t("buyers") || "buyers"}`}</span>
              ) : null}
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
          {listed && tradeUrl ? (
            <a
              href={tradeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mc-btn-view"
            >
              {(t("swapOnVenue") || "Swap on {venue}").replace(
                "{venue}",
                venueLabel(listedVenue),
              )}
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
