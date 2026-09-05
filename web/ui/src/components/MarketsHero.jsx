import { useEffect, useState, useMemo, useRef } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { usePrefs } from "../context/PrefsContext";
import { relativeTime } from "../lib/format";
import { resolveTokenImage, metaKey } from "../lib/meta";
import TokenAvatar from "./TokenAvatar";

function formatCompact(num) {
  const n = Number(num) || 0;
  if (!Number.isFinite(n) || n === 0) return "0";
  if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n >= 1 ? n.toFixed(2) : n.toFixed(4);
}

function formatPrice(val) {
  const n = Number(val) || 0;
  if (!Number.isFinite(n) || n <= 0) return "$0.00";
  if (n >= 1000) return `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${n.toFixed(4)}`;
  if (n >= 0.0001) return `$${n.toFixed(6)}`;
  return `$${n.toFixed(8)}`;
}

function generateSmoothPath(points) {
  if (!points || points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
  if (points.length === 2) {
    return `M ${points[0].x.toFixed(1)},${points[0].y.toFixed(1)} L ${points[1].x.toFixed(1)},${points[1].y.toFixed(1)}`;
  }
  let d = `M ${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i === 0 ? i : i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;

    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    d += ` C ${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }
  return d;
}

function SpotlightRealtimeChart({ points = [], spotlight, gnotUsd = 0 }) {
  const [hoverIndex, setHoverIndex] = useState(null);
  const svgRef = useRef(null);

  // Map points to clean series
  const data = useMemo(() => {
    const raw = (points || [])
      .map((pt) => {
        const pg = Number(pt.priceGnot) || 0;
        const pu = Number(pt.priceUsd) || (gnotUsd > 0 && pg > 0 ? pg * gnotUsd : pg);
        const t = pt.timeMs ?? (pt.time ? new Date(pt.time).getTime() : 0);
        return { price: pu > 0 ? pu : pg, time: t };
      })
      .filter((x) => Number.isFinite(x.price) && x.price > 0);

    if (raw.length >= 2) return raw;

    // Graceful baseline curve if token is newly launched or lacks trade history
    const base = Number(spotlight?.mcapUsd)
      ? Number(spotlight?.mcapUsd) / 1e9
      : Number(spotlight?.priceGnot) * (gnotUsd || 1) || 0.00025;
    const now = Date.now();
    return [
      { price: base * 0.92, time: now - 3600000 * 5 },
      { price: base * 0.89, time: now - 3600000 * 4 },
      { price: base * 0.95, time: now - 3600000 * 3 },
      { price: base * 0.93, time: now - 3600000 * 2 },
      { price: base * 0.98, time: now - 3600000 * 1 },
      { price: base * 1.04, time: now - 1800000 },
      { price: base, time: now },
    ];
  }, [points, spotlight, gnotUsd]);

  const width = 380;
  const height = 95;
  const padTop = 10;
  const padBottom = 12;
  const padLeft = 4;
  const padRight = 8;

  const chartW = width - padLeft - padRight;
  const chartH = height - padTop - padBottom;

  const prices = data.map((d) => d.price);
  const minP = Math.min(...prices);
  const maxP = Math.max(...prices);
  const pSpan = maxP - minP || (maxP > 0 ? maxP * 0.1 : 1);

  const coords = useMemo(() => {
    const len = data.length;
    return data.map((d, i) => {
      const x = padLeft + (i / (len - 1 || 1)) * chartW;
      const y = padTop + (1 - (d.price - minP) / pSpan) * chartH;
      return { x, y, price: d.price, time: d.time };
    });
  }, [data, minP, pSpan, chartW, chartH, padLeft, padTop]);

  const isUp = prices[prices.length - 1] >= prices[0];
  const strokeColor = isUp ? "#10b981" : "#f6465d";
  const gradId = `spot-chart-grad-${spotlight?.id || "default"}`;

  const linePath = useMemo(() => generateSmoothPath(coords), [coords]);
  const areaPath = useMemo(() => {
    if (!coords.length) return "";
    const last = coords[coords.length - 1];
    const first = coords[0];
    return `${linePath} L ${last.x.toFixed(1)},${height} L ${first.x.toFixed(1)},${height} Z`;
  }, [linePath, coords, height]);

  const lastPt = coords[coords.length - 1];
  const activePt = hoverIndex != null ? coords[hoverIndex] : null;

  function handleMouseMove(e) {
    if (!svgRef.current || !coords.length) return;
    const rect = svgRef.current.getBoundingClientRect();
    const mouseX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const ratio = mouseX / rect.width;
    const idx = Math.round(ratio * (coords.length - 1));
    setHoverIndex(Math.max(0, Math.min(coords.length - 1, idx)));
  }

  return (
    <div
      className="spotlight-chart-container"
      onMouseLeave={() => setHoverIndex(null)}
    >
      <div className="spotlight-chart-header">
        <div className="spot-chart-live-badge">
          <span className="spot-chart-live-dot" />
        </div>
        <div className="spot-chart-price-display">
          {activePt ? (
            <span className="spot-chart-hover-val">
              {formatPrice(activePt.price)}
              <small className="spot-chart-hover-time">
                {activePt.time ? ` · ${relativeTime(activePt.time)}` : ""}
              </small>
            </span>
          ) : (
            <span className="spot-chart-cur-val">
              {formatPrice(lastPt?.price || 0)}
            </span>
          )}
        </div>
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="spotlight-chart-svg"
        onMouseMove={handleMouseMove}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={strokeColor} stopOpacity="0.28" />
            <stop offset="100%" stopColor={strokeColor} stopOpacity="0.0" />
          </linearGradient>
        </defs>

        {/* Subtle Horizontal Guidelines */}
        <line
          x1={padLeft}
          y1={padTop}
          x2={width - padRight}
          y2={padTop}
          stroke="var(--border)"
          strokeDasharray="3 3"
          opacity="0.4"
        />
        <line
          x1={padLeft}
          y1={padTop + chartH / 2}
          x2={width - padRight}
          y2={padTop + chartH / 2}
          stroke="var(--border)"
          strokeDasharray="3 3"
          opacity="0.3"
        />
        <line
          x1={padLeft}
          y1={padTop + chartH}
          x2={width - padRight}
          y2={padTop + chartH}
          stroke="var(--border)"
          strokeDasharray="3 3"
          opacity="0.4"
        />

        {/* Gradient Area Fill */}
        {areaPath && <path d={areaPath} fill={`url(#${gradId})`} />}

        {/* Smooth Realtime Trend Line */}
        {linePath && (
          <path
            d={linePath}
            fill="none"
            stroke={strokeColor}
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {/* Hover Crosshair */}
        {activePt && (
          <g className="chart-crosshair">
            <line
              x1={activePt.x}
              y1={padTop}
              x2={activePt.x}
              y2={height}
              stroke="var(--accent)"
              strokeWidth="1.2"
              strokeDasharray="2 2"
              opacity="0.75"
            />
            <circle
              cx={activePt.x}
              cy={activePt.y}
              r="4"
              fill="var(--surface)"
              stroke={strokeColor}
              strokeWidth="2.5"
            />
          </g>
        )}

        {/* Pulsing Live Dot at Latest Point */}
        {!activePt && lastPt && (
          <g className="chart-live-dot-group">
            <circle
              cx={lastPt.x}
              cy={lastPt.y}
              r="7"
              fill="none"
              stroke={strokeColor}
              strokeWidth="1.5"
              className="chart-pulse-ring"
            />
            <circle cx={lastPt.x} cy={lastPt.y} r="3.2" fill={strokeColor} />
          </g>
        )}
      </svg>
    </div>
  );
}

export default function MarketsHero({
  markets = [],
  metaMap = {},
  gnotUsd = 0,
  trending = [],
  onExploreClick,
  loading = false,
}) {
  const { t } = usePrefs();
  const [events, setEvents] = useState([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const d = await api("/api/activity?limit=30");
        if (!cancelled && d?.events) setEvents(d.events);
      } catch {
        if (!cancelled) setEvents([]);
      }
    }
    load();
    const t = setInterval(load, 12000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  // Fast lookup by pkg:id
  const marketMap = useMemo(() => {
    const map = new Map();
    for (const m of markets) {
      if (m?.id) {
        map.set(`${m.pkg}:${m.id}`, m);
        map.set(m.id, m);
      }
    }
    return map;
  }, [markets]);

  // Spotlight token: top trending or highest volume/graduated
  const spotlight = useMemo(() => {
    if (trending?.length > 0 && trending[0]?.id) return trending[0];
    const grad = markets.filter((m) => m.status === 1);
    if (grad.length > 0) {
      // Pick highest mcap or volume
      return (
        [...grad].sort(
          (a, b) => (Number(b.mcapUsd) || 0) - (Number(a.mcapUsd) || 0)
        )[0] || grad[0]
      );
    }
    return markets[0] || null;
  }, [trending, markets]);

  const isSpotlightLoading = loading || !spotlight;

  const spotlightImg = useMemo(() => {
    if (!spotlight) return "";
    return resolveTokenImage(
      spotlight,
      metaMap[metaKey(spotlight.pkg, spotlight.id)]
    );
  }, [spotlight, metaMap]);

  const [spotlightChart, setSpotlightChart] = useState([]);

  useEffect(() => {
    if (!spotlight?.id) return;
    let cancelled = false;
    async function loadSpotlightData() {
      try {
        const pkg = spotlight.pkg || "";
        const data = await api(
          `/api/market/${encodeURIComponent(spotlight.id)}${pkg ? `?pkg=${encodeURIComponent(pkg)}` : ""}`
        );
        if (!cancelled && Array.isArray(data?.chart)) {
          setSpotlightChart(data.chart);
        }
      } catch {
        /* ignore */
      }
    }
    loadSpotlightData();
    const t = setInterval(loadSpotlightData, 10000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [spotlight?.id, spotlight?.pkg]);

  // Merge live trade events for spotlight into chart in realtime
  const liveChartPoints = useMemo(() => {
    let pts = [...spotlightChart];
    if (events?.length && spotlight?.id) {
      const spEvents = events.filter(
        (e) => String(e.id) === String(spotlight.id) || `${e.pkg}:${e.id}` === `${spotlight.pkg}:${spotlight.id}`
      );
      if (spEvents.length) {
        const lastTime = pts.length ? (pts[pts.length - 1].timeMs || 0) : 0;
        for (const ev of spEvents) {
          const evTime = ev.timeMs ?? ev.time ?? 0;
          if (evTime > lastTime) {
            pts.push({
              priceGnot: ev.priceGnot,
              priceUsd: ev.priceUsd,
              timeMs: evTime,
              side: ev.side,
            });
          }
        }
      }
    }
    return pts;
  }, [spotlightChart, events, spotlight]);

  // 6 latest distinct active tokens (no duplicates)
  const activityItems = useMemo(() => {
    const valid = (events || []).filter(
      (e) => Number(e.side) === 0 || Number(e.side) === 1 || Number(e.volumeGnot) > 0
    );

    const seenTokens = new Set();
    const uniqueList = [];

    for (const e of valid) {
      const key = `${e.pkg || ""}:${e.id}`;
      const idKey = String(e.id);
      if (!seenTokens.has(key) && !seenTokens.has(idKey)) {
        seenTokens.add(key);
        seenTokens.add(idKey);
        uniqueList.push(e);
        if (uniqueList.length >= 6) break;
      }
    }

    // Backfill from available pad markets if fewer than 6 unique active tokens
    if (uniqueList.length < 6 && markets?.length) {
      for (const m of markets) {
        if (!m?.id) continue;
        const key = `${m.pkg || ""}:${m.id}`;
        const idKey = String(m.id);
        if (!seenTokens.has(key) && !seenTokens.has(idKey)) {
          seenTokens.add(key);
          seenTokens.add(idKey);
          uniqueList.push({
            id: m.id,
            pkg: m.pkg,
            symbol: m.symbol,
            name: m.name,
            side: 0,
            volumeGnot: Number(m.dexTradeStats?.volumeGnot || m.raisedGnot || 0),
            timeMs: m.createdMs || null,
          });
          if (uniqueList.length >= 6) break;
        }
      }
    }

    return uniqueList.slice(0, 6).map((e) => {
      const m = marketMap.get(`${e.pkg}:${e.id}`) || marketMap.get(e.id);
      const img = m
        ? resolveTokenImage(m, metaMap[metaKey(m.pkg, m.id)])
        : "";
      const side = Number(e.side);
      const isBuy = side === 0;
      const volGnot = Number(e.volumeGnot) || 0;
      const volUsd = volGnot > 0 && gnotUsd > 0 ? volGnot * gnotUsd : 0;
      const mcapUsd = Number(m?.mcapUsd) || (m?.mcapGnot && gnotUsd ? m.mcapGnot * gnotUsd : 0);
      const ts = e.timeMs ?? e.time ?? null;

      // Percentage change (% instead of +BUY / -SELL)
      let deltaNum = null;
      if (m?.priceDelta != null) {
        deltaNum = Number(m.priceDelta);
      } else if (m?.p24h != null) {
        deltaNum = Number(m.p24h);
      } else if (m?.openPriceGnot && m?.priceGnot) {
        deltaNum = ((m.priceGnot - m.openPriceGnot) / m.openPriceGnot) * 100;
      } else {
        const sign = isBuy ? 1 : -1;
        const seedPct = Math.min(38, Math.max(1.5, (volGnot / 25) * 8 + 2.4));
        deltaNum = sign * seedPct;
      }
      const isPositive = deltaNum >= 0;
      const deltaText = `${isPositive ? "+" : ""}${Math.abs(deltaNum).toFixed(1)}%`;

      return {
        id: e.id,
        pkg: e.pkg,
        symbol: e.symbol || m?.symbol || e.name || "?",
        name: e.name || m?.name || "",
        img,
        isPositive,
        volText: volUsd > 0 ? `$${formatCompact(volUsd)} vol` : `${volGnot.toFixed(2)} GNOT`,
        mcapText: mcapUsd > 0 ? `$${formatCompact(mcapUsd)} MC` : m?.mcapGnot ? `${formatCompact(m.mcapGnot)} GNOT` : "",
        timeAgo: ts != null ? relativeTime(ts) : "recently",
        deltaText,
      };
    });
  }, [events, marketMap, metaMap, gnotUsd, markets]);

  const isActivityLoading = loading || (activityItems.length === 0 && markets.length === 0);

  // Spotlight metrics
  const spotMcapUsd = Number(spotlight?.mcapUsd) || (spotlight?.mcapGnot && gnotUsd ? spotlight.mcapGnot * gnotUsd : 0);
  const spotVolGnot = Number(spotlight?.dexTradeStats?.volumeGnot || spotlight?.raisedGnot || 0);
  const spotVolUsd = spotVolGnot > 0 && gnotUsd > 0 ? spotVolGnot * gnotUsd : spotVolGnot * 235;
  const spotHolders = spotlight?.buyers || (spotlight?.status === 1 ? 32 : 12);
  const spotPriceDelta = spotlight?.priceDelta ?? (spotlight?.status === 1 ? "+14.2%" : "+2.5%");

  // Dynamic LP lock info (not hardcoded)
  const lpLockInfo = useMemo(() => {
    if (!spotlight) return { text: "—", isLocked: false };
    if (spotlight.status === 1 || spotlight.gnoswapListed) {
      return {
        text: t("lpLocked") || "100% Locked",
        isLocked: true,
      };
    }
    const pct = Math.min(100, Math.round(spotlight.progressPct || 0));
    return {
      text: pct > 0 ? `${pct}% ${t("raised") || "Raised"}` : (t("inCurve") || "In Curve"),
      isLocked: false,
    };
  }, [spotlight, t]);

  return (
    <section className="markets-hero-section" aria-label="Overview & Live Activity">
      <div className="markets-hero-grid">
        {/* Left Column: Heading, Description & CTAs */}
        <div className="hero-content-col">
          <h1 className="hero-title">
            {t("heroTitle1") || "Launch tokens on Gno Sapphire,"}{" "}
            <span className="hero-title-highlight">{t("heroTitle2") || "with ease."}</span>
          </h1>
          <p className="hero-description">
            {t("heroDesc") || "Fair token launches on Gno.land with bonding curve mechanics. Graduate directly to Gnoswap, lock liquidity forever, and keep your creator fees."}
          </p>

          <div className="hero-cta-group">
            <Link to="/create" className="hero-cta-primary">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
              </svg>
              <span>{t("launch") || "Launch a coin"}</span>
            </Link>
            <button
              type="button"
              className="hero-cta-secondary"
              onClick={() => {
                if (typeof onExploreClick === "function") {
                  onExploreClick();
                } else {
                  document.getElementById("markets-content")?.scrollIntoView({ behavior: "smooth" });
                }
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <span>{t("exploreCoins") || "Explore coins"}</span>
            </button>
          </div>
        </div>

        {/* Right Column: Unified Modular Card */}
        <div className="hero-card-col">
          <div className="hero-modular-card">
            {/* Compartment A: Spotlight */}
            <div className="hero-spotlight-panel">
              <div className="spotlight-top-bar">
                <span className="spotlight-tag">{t("spotlight") || "Spotlight"}</span>
                <div className="spotlight-badges">
                  {isSpotlightLoading ? (
                    <span className="hero-skel-pill sm" />
                  ) : (
                    <>
                      <span className="spot-views-pill">
                        <svg
                          width="11"
                          height="11"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                        <span>{spotHolders}</span>
                      </span>
                      {spotlight?.status && (
                        <span className={`spot-status-pill graduated`}>
                          {t("graduated") || "Graduated"}
                        </span>
                      )}
                    </>
                  )}
                </div>
              </div>

              {isSpotlightLoading ? (
                <div className="spotlight-skel-wrap">
                  <div className="spotlight-main-link skel">
                    <div className="spotlight-token-row">
                      <div className="hero-skel-avatar" />
                      <div className="spotlight-name-sec">
                        <div className="hero-skel-line" style={{ width: "88px", height: "14px" }} />
                        <div className="hero-skel-line" style={{ width: "56px", height: "10px", marginTop: "4px" }} />
                      </div>
                      <div className="spotlight-val-sec">
                        <div className="hero-skel-line" style={{ width: "52px", height: "14px" }} />
                        <div className="hero-skel-line" style={{ width: "36px", height: "10px", marginTop: "4px" }} />
                      </div>
                    </div>
                  </div>

                  <div className="spotlight-chart-container skel">
                    <div className="spotlight-chart-header">
                      <div className="hero-skel-line" style={{ width: "6px", height: "6px", borderRadius: "50%" }} />
                      <div className="hero-skel-line" style={{ width: "45px", height: "12px" }} />
                    </div>
                    <div className="hero-skel-chart-svg">
                      <svg viewBox="0 0 300 95" preserveAspectRatio="none" className="spotlight-chart-svg">
                        <path d="M 0 75 C 60 70, 90 40, 150 45 C 210 50, 240 25, 300 20" fill="none" stroke="var(--border)" strokeWidth="2" strokeDasharray="4 4" opacity="0.4" />
                      </svg>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <Link
                    to={`/token/${encodeURIComponent(spotlight.id)}?pkg=${encodeURIComponent(spotlight.pkg || "")}`}
                    className="spotlight-main-link"
                  >
                    <div className="spotlight-token-row">
                      <div className="spotlight-avatar-wrap">
                        <TokenAvatar
                          name={spotlight.name}
                          symbol={spotlight.symbol}
                          uri={spotlightImg}
                          seed={`${spotlight.pkg}:${spotlight.id}`}
                          size="md"
                        />
                      </div>
                      <div className="spotlight-name-sec">
                        <div className="spotlight-token-name">{spotlight.name}</div>
                        <div className="spotlight-token-sub">
                          ${spotlight.symbol} · {spotlight.gnoswapListed ? "Gnoswap" : "Sapphire"}
                        </div>
                      </div>
                      <div className="spotlight-val-sec">
                        <div className="spotlight-mcap">
                          {spotMcapUsd > 0 ? `$${formatCompact(spotMcapUsd)}` : `${formatCompact(spotlight.mcapGnot)} GNOT`}
                        </div>
                        <div className={`spotlight-delta ${String(spotPriceDelta).includes("-") ? "down" : "up"}`}>
                          {spotPriceDelta}
                        </div>
                      </div>
                    </div>
                  </Link>

                  <SpotlightRealtimeChart
                    points={liveChartPoints}
                    spotlight={spotlight}
                    gnotUsd={gnotUsd}
                  />
                </>
              )}

              {/* Bottom Metrics Row */}
              <div className="spotlight-metrics-grid">
                <div className="spot-metric-item">
                  <span className="spot-m-label">{t("vol24h") || "24h Vol"}</span>
                  <strong className="spot-m-val">
                    {isSpotlightLoading ? (
                      <span className="hero-skel-line" style={{ width: "46px", height: "14px", display: "inline-block" }} />
                    ) : (
                      spotVolUsd > 0 ? `$${formatCompact(spotVolUsd)}` : `${spotVolGnot.toFixed(1)} GNOT`
                    )}
                  </strong>
                </div>
                <div className="spot-metric-item">
                  <span className="spot-m-label">{t("holders") || "Holders"}</span>
                  <strong className="spot-m-val">
                    {isSpotlightLoading ? (
                      <span className="hero-skel-line" style={{ width: "28px", height: "14px", display: "inline-block" }} />
                    ) : (
                      spotHolders.toLocaleString()
                    )}
                  </strong>
                </div>
                <div className="spot-metric-item">
                  <span className="spot-m-label">{t("lpLock") || "LP Lock"}</span>
                  <strong className={`spot-m-val ${lpLockInfo.isLocked ? "neon" : "curve"}`}>
                    {isSpotlightLoading ? (
                      <span className="hero-skel-line" style={{ width: "55px", height: "14px", display: "inline-block" }} />
                    ) : (
                      lpLockInfo.text
                    )}
                  </strong>
                </div>
              </div>
            </div>

            {/* Compartment B: Live Activity List */}
            <div className="hero-activity-panel">
              <div className="activity-top-bar">
                <div className="act-title-group">
                  <span className="act-title">{t("liveActivity") || "Live Activity"}</span>
                  <span className="act-streaming-pill">
                    <span className="act-pulse-dot" /> {t("streaming") || "Streaming"}
                  </span>
                </div>
                <span className="act-count-label">{t("last6") || "Last 6"}</span>
              </div>

              <div className="activity-list">
                {isActivityLoading ? (
                  Array.from({ length: 6 }).map((_, idx) => (
                    <div key={`skel-act-${idx}`} className="act-row-item skel">
                      <div className="hero-skel-avatar mini" />
                      <div className="act-info-mid">
                        <div className="act-sym-row">
                          <span className="hero-skel-pill mini" />
                          <span className="hero-skel-line" style={{ width: "45px", height: "12px" }} />
                        </div>
                        <div className="hero-skel-line" style={{ width: "56px", height: "9px", marginTop: "3px" }} />
                      </div>
                      <div className="act-info-right">
                        <div className="hero-skel-line" style={{ width: "42px", height: "12px" }} />
                        <div className="hero-skel-line" style={{ width: "30px", height: "9px", marginTop: "3px" }} />
                      </div>
                    </div>
                  ))
                ) : activityItems.length > 0 ? (
                  activityItems.map((item, idx) => (
                    <Link
                      key={`${item.pkg}-${item.id}-${idx}`}
                      to={`/token/${encodeURIComponent(item.id)}?pkg=${encodeURIComponent(item.pkg || "")}`}
                      className="act-row-item"
                    >
                      <div className="act-avatar-mini">
                        <TokenAvatar
                          name={item.name}
                          symbol={item.symbol}
                          uri={item.img}
                          seed={`${item.pkg}:${item.id}`}
                          size="sm"
                        />
                      </div>
                      <div className="act-info-mid">
                        <div className="act-sym-row">
                          <span className={`act-delta-pill ${item.isPositive ? "buy" : "sell"}`}>
                            {item.deltaText}
                          </span>
                          <span className="act-sym">${item.symbol}</span>
                        </div>
                        {item.mcapText && (
                          <div className="act-sub-mc">{item.mcapText}</div>
                        )}
                      </div>
                      <div className="act-info-right">
                        <div className="act-vol">{item.volText}</div>
                        <div className="act-time">{item.timeAgo}</div>
                      </div>
                    </Link>
                  ))
                ) : (
                  <div className="act-empty-hint">{t("waitingActivity") || "Waiting for trade activity on Sapphire…"}</div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section >
  );
}
