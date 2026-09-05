import { useEffect, useMemo, useRef, useState } from "react";
import { createChart, ColorType, CrosshairMode, LineStyle } from "lightweight-charts";
import {
  fmtClock,
  fmtGnot,
  fmtNum,
  fmtPrice,
  fmtPriceUsd,
  relativeTime,
  tradeOnchainLink,
  accountExplorerUrl,
} from "../lib/format";

/* primary-accent palette */
const UP = "#1164ee";
const DOWN = "#f6465d";
const UP_DIM = "rgba(17, 100, 238, 0.55)";
const DOWN_DIM = "rgba(246, 70, 93, 0.55)";
const UP_SOFT = "rgba(17, 100, 238, 0.18)";
const DOWN_SOFT = "rgba(246, 70, 93, 0.18)";
const GRID = "rgba(148, 163, 184, 0.07)";
const CROSS = "rgba(226, 232, 240, 0.55)";
const LABEL_BG = "#0f1419";
const TEXT = "rgba(226, 232, 240, 0.92)";

function formatTickMark(time, timeframe) {
  const date = new Date(time * 1000);
  const d = String(date.getUTCDate()).padStart(2, "0");
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  if (timeframe === "1d") return `${d}/${m}`;
  if (timeframe === "1h") return `${d}/${m} ${String(date.getUTCHours()).padStart(2, "0")}:00`;
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mm = String(date.getUTCMinutes()).padStart(2, "0");
  if (timeframe === "s" || timeframe === "tick") {
    const ss = String(date.getUTCSeconds()).padStart(2, "0");
    return `${hh}:${mm}:${ss}`;
  }
  return `${hh}:${mm}`;
}

/**
 * Pump.fun-style price chart: candles + buy/sell volume, live header, OHLC tip.
 * points: { height, priceGnot, priceUsd, side, volumeGnot, ugnot, tokens, timeMs }[]
 */
export default function PriceChart({
  points = [],
  symbol = "",
  height = 480,
  gnotUsd = 0,
  priceUsd = 0,
  /** Canonical spot from API (pool_mark / gnoswap) — keeps header C in sync with Price/MCap metrics */
  markPriceGnot = null,
  markPriceUsd = null,
}) {
  const wrapRef = useRef(null);
  const tipRef = useRef(null);
  const chartRef = useRef(null);
  const candleRef = useRef(null);
  const volumeRef = useRef(null);
  const [range, setRange] = useState("all");
  const [timeframe, setTimeframe] = useState("5m"); // s | 1m | 5m | 1h | 1d
  const [mode, setMode] = useState("candles"); // candles | line
  const [hover, setHover] = useState(null);
  const [liveFlash, setLiveFlash] = useState(false);
  const prevLastRef = useRef(null);
  const candlesRef = useRef([]);

  const fx = Number(gnotUsd) || 0;
  const showUsd = fx > 0;
  const markPg = Number(markPriceGnot);
  const markPu =
    Number(markPriceUsd) > 0
      ? Number(markPriceUsd)
      : fx > 0 && markPg > 0
        ? markPg * fx
        : 0;
  const markPrice = showUsd && markPu > 0 ? markPu : markPg > 0 ? markPg : 0;

  const series = useMemo(() => {
    let pts = (points || [])
      .map((p) => {
        const pg = Number(p.priceGnot) || 0;
        const pu = Number(p.priceUsd) || (fx > 0 && pg > 0 ? pg * fx : 0);
        const side = Number(p.side);
        const vol =
          Number(p.volumeGnot != null ? p.volumeGnot : (Number(p.ugnot) || 0) / 1e6) || 0;
        const tMs = Number(p.timeMs) || 0;
        return {
          height: Number(p.height) || 0,
          price: showUsd && pu > 0 ? pu : pg,
          priceGnot: pg,
          priceUsd: pu,
          side,
          vol,
          buyVol: side === 0 ? vol : 0,
          sellVol: side === 1 ? vol : 0,
          timeMs: tMs,
        };
      })
      // buys + sells; open/add_lp marks only seed price when no trades yet
      .filter((p) => p.price > 0 && (p.side === 0 || p.side === 1 || p.side === 2 || p.side === 3))
      .sort((a, b) => {
        if (a.timeMs && b.timeMs && a.timeMs !== b.timeMs) return a.timeMs - b.timeMs;
        return a.height - b.height || a.price - b.price;
      });
    const tradePts = pts.filter((p) => p.side === 0 || p.side === 1);
    // Prefer real trades; keep open/LP marks only as baseline when empty
    pts = tradePts.length ? tradePts : pts.filter((p) => p.side === 2 || p.side === 3).slice(0, 2);

    // Align series end with canonical API spot (pool_mark / gnoswap) so chart C ≈ metrics.
    // Soft patch last point when drift is small; append mark tick when material.
    if (markPrice > 0 && pts.length) {
      const last = pts[pts.length - 1];
      const lastH = Number(last.height) || 0;
      const lastT = Number(last.timeMs) || Date.now();
      const rel =
        Number.isFinite(last.price) && last.price > 0
          ? Math.abs(last.price - markPrice) / markPrice
          : 1;
      if (rel > 0.005) {
        if (rel <= 0.03 && !last.mark) {
          // Tiny drift — patch last trade close (avoids extra cliff candle)
          pts = [
            ...pts.slice(0, -1),
            {
              ...last,
              price: markPrice,
              priceGnot: markPg > 0 ? markPg : markPrice,
              priceUsd: markPu > 0 ? markPu : last.priceUsd,
            },
          ];
        } else {
          pts = [
            ...pts,
            {
              height: lastH + 1,
              price: markPrice,
              priceGnot: markPg > 0 ? markPg : markPrice,
              priceUsd: markPu > 0 ? markPu : 0,
              side: 0,
              vol: 0,
              buyVol: 0,
              sellVol: 0,
              timeMs: Math.max(lastT + 1000, Date.now()),
              mark: true,
            },
          ];
        }
      }
    } else if (markPrice > 0 && !pts.length) {
      pts = [
        {
          height: 1,
          price: markPrice,
          priceGnot: markPg > 0 ? markPg : markPrice,
          priceUsd: markPu > 0 ? markPu : 0,
          side: 2,
          vol: 0,
          buyVol: 0,
          sellVol: 0,
          timeMs: Date.now(),
          mark: true,
        },
      ];
    }

    const now = Date.now();
    if (range === "5m" && pts.some((p) => p.timeMs > 0)) {
      pts = pts.filter((p) => !p.timeMs || p.timeMs >= now - 5 * 60_000);
    } else if (range === "15m" && pts.some((p) => p.timeMs > 0)) {
      pts = pts.filter((p) => !p.timeMs || p.timeMs >= now - 15 * 60_000);
    } else if (range === "1h" && pts.some((p) => p.timeMs > 0)) {
      pts = pts.filter((p) => !p.timeMs || p.timeMs >= now - 3600_000);
    } else if (range === "4h" && pts.some((p) => p.timeMs > 0)) {
      pts = pts.filter((p) => !p.timeMs || p.timeMs >= now - 4 * 3600_000);
    } else if (range === "1d" && pts.some((p) => p.timeMs > 0)) {
      pts = pts.filter((p) => !p.timeMs || p.timeMs >= now - 24 * 3600_000);
    } else if (range === "100") pts = pts.slice(-100);
    else if (range === "50") pts = pts.slice(-50);
    else if (range === "20") pts = pts.slice(-20);

    return pts;
  }, [points, range, fx, showUsd, markPrice, markPg, markPu]);

  function fmtChartPrice(v) {
    if (showUsd) return fmtPriceUsd(v);
    return fmtPrice(v);
  }

  /** Build OHLC candles — tick (s) or time buckets with gap-fill so TF switches are visible. */
  const candles = useMemo(() => {
    if (!series.length) return [];
    const n = series.length;
    const timed = series.filter((p) => p.timeMs > 0);
    const hasTime = timed.length >= Math.min(2, n);
    const out = [];

    // TICK / SECONDS: 1 trade = 1 candle
    if (timeframe === "s" || timeframe === "tick") {
      let prevClose = series[0]?.price;
      let lastTime = 0;
      for (let i = 0; i < n; i++) {
        const tr = series[i];
        const open = i === 0 ? tr.price : prevClose;
        const close = tr.price;
        const high = Math.max(open, close);
        const low = Math.min(open, close);
        const isBuy = tr.side === 0;
        const isSell = tr.side === 1;
        const up =
          close > open ? true : close < open ? false : isBuy ? true : isSell ? false : true;

        let t = tr.timeMs ? Math.max(1, Math.floor(tr.timeMs / 1000)) : (i + 1) * 60;
        if (t <= lastTime) t = lastTime + 1;
        lastTime = t;

        out.push({
          time: t,
          open,
          high,
          low,
          close,
          volume: tr.vol,
          buyVol: tr.buyVol,
          sellVol: tr.sellVol,
          height: tr.height,
          up,
          trades: 1,
          timeMs: tr.timeMs,
          side: tr.side,
        });
        prevClose = close;
      }
      return out;
    }

    const bucketMs =
      timeframe === "1m"
        ? 60_000
        : timeframe === "5m"
          ? 300_000
          : timeframe === "1h"
            ? 3600_000
            : timeframe === "1d"
              ? 86400_000
              : 300_000;

    if (!hasTime) {
      // No reliable timestamps — group by trade count scaled to TF
      const perBucket =
        timeframe === "1m" ? 1 : timeframe === "5m" ? 3 : timeframe === "1h" ? 8 : 20;
      let prevClose = series[0].price;
      let lastTime = 0;
      for (let i = 0; i < n; i += perBucket) {
        const chunk = series.slice(i, i + perBucket);
        if (!chunk.length) continue;
        const candle = makeCandle(chunk, out.length, false, prevClose);
        if (candle.time <= lastTime) candle.time = lastTime + 1;
        lastTime = candle.time;
        out.push(candle);
        prevClose = candle.close;
      }
      return out;
    }

    // TIME BUCKETS with gap-fill (flat candles) so 1m ≠ 1H ≠ 1D visually
    const firstMs = timed[0].timeMs;
    const lastMs = timed[timed.length - 1].timeMs;
    let bucketStart = Math.floor(firstMs / bucketMs) * bucketMs;
    const endBucket = Math.floor(lastMs / bucketMs) * bucketMs;
    const maxBars = 720; // cap (e.g. 12h of 1m, 60d of 1h)
    const spanBuckets = Math.floor((endBucket - bucketStart) / bucketMs) + 1;
    const stepBuckets = spanBuckets > maxBars ? Math.ceil(spanBuckets / maxBars) : 1;
    const stepMs = bucketMs * stepBuckets;

    let i = 0;
    let prevClose = series[0].price;
    let lastTime = 0;
    // Align series index to first timed point
    while (i < n && !(series[i].timeMs > 0)) i += 1;

    for (let b = bucketStart; b <= endBucket; b += stepMs) {
      const bucketEnd = b + stepMs;
      const chunk = [];
      while (i < n) {
        const tm = series[i].timeMs || 0;
        if (tm > 0 && tm < b) {
          i += 1;
          continue;
        }
        if (tm <= 0 || tm >= bucketEnd) break;
        chunk.push(series[i]);
        i += 1;
      }

      let candle;
      if (chunk.length) {
        const candleTime = Math.max(1, Math.floor(b / 1000));
        candle = makeCandle(chunk, out.length, true, prevClose, candleTime);
        prevClose = candle.close;
      } else {
        // Gap-fill: carry forward last close (no volume)
        const t = Math.max(1, Math.floor(b / 1000));
        candle = {
          time: t,
          open: prevClose,
          high: prevClose,
          low: prevClose,
          close: prevClose,
          volume: 0,
          buyVol: 0,
          sellVol: 0,
          height: 0,
          up: true,
          trades: 0,
          side: null,
          fill: true,
        };
      }
      if (candle.time <= lastTime) candle.time = lastTime + 1;
      lastTime = candle.time;
      out.push(candle);
    }

    return out;
  }, [series, timeframe]);

  useEffect(() => {
    candlesRef.current = candles;
  }, [candles]);

  const stats = useMemo(() => {
    if (!candles.length) return null;
    const first = candles[0].open;
    const last = candles[candles.length - 1].close;
    const min = Math.min(...candles.map((c) => c.low));
    const max = Math.max(...candles.map((c) => c.high));
    const chg = first > 0 ? ((last - first) / first) * 100 : 0;
    const vol = candles.reduce((s, c) => s + c.volume, 0);
    const buyVol = candles.reduce((s, c) => s + (c.buyVol || 0), 0);
    const sellVol = candles.reduce((s, c) => s + (c.sellVol || 0), 0);
    const trades = series.length;
    const buyPct = vol > 0 ? Math.round((buyVol / vol) * 100) : 50;
    return { first, last, min, max, chg, vol, buyVol, sellVol, trades, buyPct };
  }, [candles, series.length]);

  // Flash header when last close moves (FOMO pulse)
  useEffect(() => {
    if (!stats) return;
    const prev = prevLastRef.current;
    prevLastRef.current = stats.last;
    if (prev != null && prev !== stats.last) {
      setLiveFlash(true);
      const t = setTimeout(() => setLiveFlash(false), 700);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [stats?.last]);

  const [themeMode, setThemeMode] = useState(() => {
    return document.documentElement.getAttribute("data-theme") || "dark";
  });

  useEffect(() => {
    const observer = new MutationObserver(() => {
      const t = document.documentElement.getAttribute("data-theme") || "dark";
      setThemeMode(t);
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  const isLight = themeMode === "light";

  // Create chart once canvas is mounted (canvas is always in DOM so first trade can paint)
  useEffect(() => {
    if (!wrapRef.current) return undefined;
    const el = wrapRef.current;
    const chartH = Math.max(height, el.clientHeight || height);
    // Grid/sticky layouts can report width 0 on first paint — fall back then RO fixes
    const initW = Math.max(el.clientWidth || 0, el.parentElement?.clientWidth || 0, 320);

    const chart = createChart(el, {
      width: initW,
      height: chartH,
      layout: {
        background: { type: ColorType.Solid, color: isLight ? "#ffffff" : "#0b0e14" },
        textColor: isLight ? "#475569" : TEXT,
        fontSize: 12,
        fontFamily: "Inter, Roboto, system-ui, sans-serif",
      },
      grid: {
        vertLines: { color: isLight ? "rgba(0, 0, 0, 0.06)" : GRID, style: LineStyle.Dotted },
        horzLines: { color: isLight ? "rgba(0, 0, 0, 0.06)" : GRID, style: LineStyle.Dotted },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: isLight ? "rgba(15, 23, 42, 0.35)" : CROSS,
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: isLight ? "#0f172a" : LABEL_BG,
        },
        horzLine: {
          color: isLight ? "rgba(15, 23, 42, 0.35)" : CROSS,
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: isLight ? "#0f172a" : LABEL_BG,
        },
      },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: { top: 0.06, bottom: 0.28 },
        entireTextOnly: false,
      },
      leftPriceScale: { visible: false },
      timeScale: {
        borderVisible: false,
        timeVisible: timeframe !== "1d",
        secondsVisible: timeframe === "s" || timeframe === "tick",
        rightOffset: 6,
        barSpacing: 14,
        minBarSpacing: 4,
        fixLeftEdge: false,
        fixRightEdge: false,
        tickMarkFormatter: (time) => formatTickMark(time, timeframe),
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true },
      handleScale: {
        axisPressedMouseMove: true,
        mouseWheel: true,
        pinch: true,
      },
    });

    const priceFmt = {
      type: "custom",
      minMove: 1e-12,
      formatter: (price) => {
        const p = Number(price);
        if (!Number.isFinite(p)) return "";
        if (showUsd) {
          if (p >= 1) return `$${p.toFixed(4)}`;
          if (p >= 0.01) return `$${p.toFixed(6)}`;
          if (p >= 0.0001) return `$${p.toFixed(8)}`;
          return `$${p.toPrecision(4)}`;
        }
        if (p >= 1) return p.toFixed(4);
        if (p >= 0.0001) return p.toFixed(8);
        return p.toPrecision(4);
      },
    };

    const candleSeries = chart.addCandlestickSeries({
      upColor: UP,
      downColor: DOWN,
      borderUpColor: UP,
      borderDownColor: DOWN,
      wickUpColor: UP,
      wickDownColor: DOWN,
      borderVisible: true,
      priceLineVisible: true,
      priceLineWidth: 1,
      priceLineColor: "rgba(148, 163, 184, 0.55)",
      priceLineStyle: LineStyle.Dashed,
      lastValueVisible: true,
      priceFormat: priceFmt,
    });

    const areaSeries = chart.addAreaSeries({
      lineColor: UP,
      topColor: UP_SOFT,
      bottomColor: "rgba(17, 100, 238, 0.01)",
      lineWidth: 2,
      priceLineVisible: true,
      lastValueVisible: true,
      visible: false,
      priceFormat: priceFmt,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 5,
    });

    const volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceScaleId: "vol",
      lastValueVisible: false,
      priceLineVisible: false,
    });
    chart.priceScale("vol").applyOptions({
      scaleMargins: { top: 0.74, bottom: 0 },
      borderVisible: false,
    });

    chart.subscribeCrosshairMove((param) => {
      const tip = tipRef.current;
      if (!param?.time || !param.point || param.point.x < 0 || param.point.y < 0) {
        setHover(null);
        if (tip) tip.style.display = "none";
        return;
      }
      const c = param.seriesData.get(candleSeries);
      const a = param.seriesData.get(areaSeries);
      const v = param.seriesData.get(volumeSeries);
      let hov = null;
      const cand = candlesRef.current?.find((cd) => cd.time === param.time);
      if (c && c.open != null) {
        hov = {
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          vol: cand?.volume ?? v?.value,
          buyVol: cand?.buyVol,
          sellVol: cand?.sellVol,
          trades: cand?.trades,
          up: cand?.up != null ? cand.up : c.close >= c.open,
          time: param.time,
          sideLabel:
            cand?.trades === 1
              ? cand.side === 0
                ? "BUY"
                : cand.side === 1
                  ? "SELL"
                  : null
              : null,
        };
      } else if (a && a.value != null) {
        hov = { close: a.value, vol: v?.value, up: true, line: true, time: param.time };
      }
      setHover(hov);

      if (tip && hov) {
        const w = el.clientWidth;
        const left = Math.min(Math.max(12, param.point.x + 14), w - 168);
        const top = Math.max(8, param.point.y - 8);
        tip.style.display = "block";
        tip.style.left = `${left}px`;
        tip.style.top = `${top}px`;
      } else if (tip) {
        tip.style.display = "none";
      }
    });

    chartRef.current = chart;
    candleRef.current = { candle: candleSeries, area: areaSeries };
    volumeRef.current = volumeSeries;

    const ro = new ResizeObserver(() => {
      if (!wrapRef.current || !chartRef.current) return;
      const w = Math.max(wrapRef.current.clientWidth || 0, 1);
      const h = Math.max(height, wrapRef.current.clientHeight || height);
      chartRef.current.applyOptions({ width: w, height: h });
    });
    ro.observe(el);
    // One more layout pass after sticky/grid settles
    const raf = requestAnimationFrame(() => {
      if (!wrapRef.current || !chartRef.current) return;
      const w = Math.max(wrapRef.current.clientWidth || 0, 1);
      chartRef.current.applyOptions({
        width: w,
        height: Math.max(height, wrapRef.current.clientHeight || height),
      });
      try {
        chartRef.current.timeScale().fitContent();
      } catch {
        /* empty */
      }
    });

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      volumeRef.current = null;
    };
  }, [height, showUsd, themeMode]);

  // Push data + mode
  useEffect(() => {
    if (!candleRef.current || !volumeRef.current || !chartRef.current) return;
    const { candle, area } = candleRef.current;
    const vol = volumeRef.current;

    if (!candles.length) {
      candle.setData([]);
      area.setData([]);
      vol.setData([]);
      return;
    }

    const up = stats ? stats.chg >= 0 : true;
    area.applyOptions({
      lineColor: up ? UP : DOWN,
      topColor: up ? UP_SOFT : DOWN_SOFT,
      bottomColor: up ? "rgba(20, 241, 149, 0.01)" : "rgba(246, 70, 93, 0.01)",
      priceLineColor: up ? UP : DOWN,
    });
    candle.applyOptions({
      priceLineColor: up ? "rgba(20, 241, 149, 0.65)" : "rgba(246, 70, 93, 0.65)",
    });

    // Ensure strictly ascending unique times (LWC rejects duplicates)
    const candleData = [];
    const areaData = [];
    const volData = [];
    let lastT = 0;
    for (const c of candles) {
      let t = Number(c.time) || 0;
      if (t <= lastT) t = lastT + 1;
      lastT = t;
      candleData.push({
        time: t,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        color: c.up ? UP : DOWN,
        borderColor: c.up ? UP : DOWN,
        wickColor: c.up ? UP : DOWN,
      });
      areaData.push({ time: t, value: c.close });
      volData.push({
        time: t,
        value: c.volume,
        color:
          c.buyVol > c.sellVol * 1.15
            ? UP_DIM
            : c.sellVol > c.buyVol * 1.15
              ? DOWN_DIM
              : c.up
                ? UP_DIM
                : DOWN_DIM,
      });
    }

    try {
      chartRef.current.timeScale().applyOptions({
        timeVisible: timeframe !== "1d",
        secondsVisible: timeframe === "s" || timeframe === "tick",
        tickMarkFormatter: (time) => formatTickMark(time, timeframe),
      });

      if (mode === "candles") {
        candle.applyOptions({ visible: true });
        area.applyOptions({ visible: false });
        candle.setData(candleData);
        area.setData([]);
      } else {
        candle.applyOptions({ visible: false });
        area.applyOptions({ visible: true });
        candle.setData([]);
        area.setData(areaData);
      }
      vol.setData(volData);

      // Bar spacing by timeframe so S / 1m / 5m / 1H / 1D feel distinct
      const nBars = candleData.length;
      let barSpacing = 10;
      if (timeframe === "s" || timeframe === "tick") barSpacing = nBars <= 40 ? 16 : 8;
      else if (timeframe === "1m") barSpacing = nBars <= 60 ? 12 : 6;
      else if (timeframe === "5m") barSpacing = nBars <= 48 ? 14 : 8;
      else if (timeframe === "1h") barSpacing = nBars <= 48 ? 16 : 10;
      else if (timeframe === "1d") barSpacing = nBars <= 30 ? 22 : 12;
      if (nBars > 0 && nBars <= 5) barSpacing = Math.max(barSpacing, 28);

      chartRef.current.timeScale().applyOptions({
        barSpacing,
        rightOffset: nBars <= 8 ? 12 : 6,
        secondsVisible: timeframe === "s" || timeframe === "tick",
        timeVisible: timeframe !== "1d",
      });
      chartRef.current.timeScale().fitContent();
    } catch (e) {
      console.warn("PriceChart setData failed", e);
    }
  }, [candles, mode, stats, timeframe]);

  const latestCandle = candles[candles.length - 1];
  const display = hover ||
    (latestCandle
      ? {
        close: markPrice > 0 ? markPrice : latestCandle.close,
        open: latestCandle.open,
        high: Math.max(latestCandle.high, markPrice > 0 ? markPrice : latestCandle.high),
        low: Math.min(latestCandle.low, markPrice > 0 ? markPrice : latestCandle.low),
        up: markPrice > 0
          ? markPrice >= (latestCandle.open || markPrice)
          : latestCandle.up,
      }
      : stats
        ? {
          close: markPrice > 0 ? markPrice : stats.last,
          open: stats.first,
          high: Math.max(stats.max, markPrice > 0 ? markPrice : stats.max),
          low: Math.min(stats.min, markPrice > 0 ? markPrice : stats.min),
          up: markPrice > 0 ? markPrice >= (stats.first || markPrice) : stats.chg >= 0,
        }
        : markPrice > 0
          ? { close: markPrice, open: markPrice, high: markPrice, low: markPrice, up: true }
          : null);

  const timeframeOpts = [
    ["s", "s"],
    ["1m", "1m"],
    ["5m", "5m"],
    ["1h", "1H"],
    ["1d", "1D"],
  ];

  return (
    <div className={`price-chart pump-chart terminal-chart-wrap${liveFlash ? " live-flash" : ""}`}>
      <div className="terminal-chart-header">
        <div className="tch-left">
          <span className="tch-pair mono">
            {symbol ? `${symbol}/${showUsd ? "USD" : "GNOT"}` : "PUNK/USD"}
          </span>
          <span className="tch-dex-pill mono">
            GNOSWAP
          </span>
          <div className="tch-tf-group" role="group" aria-label="Candle timeframe">
            {timeframeOpts.map(([k, lab]) => (
              <button
                key={k}
                type="button"
                className={`tch-tf-btn${timeframe === k ? " active" : ""}`}
                onClick={() => setTimeframe(k)}
              >
                {lab}
              </button>
            ))}
          </div>
          {display && display.open != null && (
            <div className="tch-ohlc mono">
              <span className="tch-ohlc-item">
                <i className="tch-lbl">O</i>{" "}
                <b className={`val ${display.up ? "up" : "down"}`}>{fmtChartPrice(display.open)}</b>
              </span>
              <span className="tch-ohlc-item">
                <i className="tch-lbl">H</i>{" "}
                <b className={`val ${display.up ? "up" : "down"}`}>{fmtChartPrice(display.high)}</b>
              </span>
              <span className="tch-ohlc-item">
                <i className="tch-lbl">L</i>{" "}
                <b className={`val ${display.up ? "up" : "down"}`}>{fmtChartPrice(display.low)}</b>
              </span>
              <span className="tch-ohlc-item">
                <i className="tch-lbl">C</i>{" "}
                <b className={`val ${display.up ? "up" : "down"}`}>{fmtChartPrice(display.close)}</b>
              </span>
            </div>
          )}
        </div>

        <div className="tch-right">
          <button
            type="button"
            className={`tch-tool-btn${mode === "candles" ? " active" : ""}`}
            onClick={() => setMode("candles")}
            title="Candlestick Chart"
            aria-label="Candlestick Chart"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <line x1="9" y1="2" x2="9" y2="22" />
              <rect x="6.5" y="6" width="5" height="11" rx="1" fill="currentColor" fillOpacity="0.25" />
              <line x1="16" y1="5" x2="16" y2="19" />
              <rect x="13.5" y="9" width="5" height="7" rx="1" fill="currentColor" fillOpacity="0.25" />
            </svg>
          </button>
          <button
            type="button"
            className={`tch-tool-btn${mode === "line" ? " active" : ""}`}
            onClick={() => setMode("line")}
            title="Line Chart"
            aria-label="Line Chart"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
              <polyline points="16 7 22 7 22 13" />
            </svg>
          </button>
          <button
            type="button"
            className="tch-tool-btn"
            onClick={() => {
              if (chartRef.current) chartRef.current.timeScale().fitContent();
            }}
            title="Reset Zoom / Fit Content"
            aria-label="Reset Zoom / Fit Content"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
            </svg>
          </button>
        </div>
      </div>

      <div className="pump-chart-wrap">
        {/* Always mounted so chart engine inits even before first trade */}
        <div
          className="pump-chart-canvas"
          ref={wrapRef}
          style={{ minHeight: height, opacity: candles.length < 1 ? 0.35 : 1 }}
        />
        {candles.length < 1 && (
          <div className="price-chart-empty muted price-chart-empty-overlay">
            <div className="empty-chart-icon" aria-hidden>
              📈
            </div>
            <p>No trades yet — chart appears after first buy</p>
          </div>
        )}
        <div className="pump-chart-tip" ref={tipRef} style={{ display: "none" }} aria-hidden>
          {hover && !hover.line ? (
            <>
              <div className={`tip-side ${hover.up ? "up" : "down"}`}>
                {hover.sideLabel ? hover.sideLabel : hover.up ? "BUY / UP" : "SELL / DOWN"}
              </div>
              <div>
                O <b>{fmtChartPrice(hover.open)}</b>
              </div>
              <div>
                H <b className="up">{fmtChartPrice(hover.high)}</b>
              </div>
              <div>
                L <b className="down">{fmtChartPrice(hover.low)}</b>
              </div>
              <div>
                C <b className={hover.up ? "up" : "down"}>{fmtChartPrice(hover.close)}</b>
              </div>
              {hover.vol != null ? (
                <div>
                  Vol{" "}
                  <b>
                    {showUsd && fx > 0
                      ? fmtPriceUsd(hover.vol * fx)
                      : fmtGnot(hover.vol, { alreadyGnot: true })}
                  </b>
                </div>
              ) : null}
              {hover.trades != null && hover.trades > 1 ? (
                <div className="tip-trades muted" style={{ fontSize: "0.72rem", marginTop: "0.2rem" }}>
                  {hover.trades} trades ({Math.round(((hover.buyVol || 0) / (hover.vol || 1)) * 100)}% buy)
                </div>
              ) : null}
            </>
          ) : hover?.line ? (
            <div>
              Price <b>{fmtChartPrice(hover.close)}</b>
            </div>
          ) : null}
        </div>
      </div>

      {/* 
      {stats && (
        <div className="price-chart-foot muted">
          <span>
            Low <em className="down mono">{fmtChartPrice(stats.min)}</em>
          </span>
          <span>
            High <em className="up mono">{fmtChartPrice(stats.max)}</em>
          </span>
          <span className="mono">
            {candles.length} bars · {fmtNum(stats.trades)} trades · {timeframe.toUpperCase()}
          </span>
        </div>
      )}
      */}
    </div>
  );
}

function makeCandle(chunk, index, hasTime, prevClose, customTime) {
  const prices = chunk.map((c) => c.price);
  const open = prevClose != null ? prevClose : prices[0];
  const close = prices[prices.length - 1];
  const high = Math.max(...prices, open, close);
  const low = Math.min(...prices, open, close);
  const volume = chunk.reduce((s, c) => s + (c.vol || 0), 0);
  const buyVol = chunk.reduce((s, c) => s + (c.buyVol || 0), 0);
  const sellVol = chunk.reduce((s, c) => s + (c.sellVol || 0), 0);
  const isBuy = chunk.length === 1 && chunk[0].side === 0;
  const isSell = chunk.length === 1 && chunk[0].side === 1;
  const up =
    close > open
      ? true
      : close < open
        ? false
        : buyVol > sellVol
          ? true
          : sellVol > buyVol
            ? false
            : isBuy
              ? true
              : isSell
                ? false
                : true;

  // LWC needs unique ascending UTCTimestamp (seconds)
  const time =
    customTime != null
      ? customTime
      : hasTime
        ? Math.max(1, Math.floor((chunk[chunk.length - 1].timeMs || Date.now()) / 1000))
        : (index + 1) * 60;
  return {
    time,
    open,
    high,
    low,
    close,
    volume,
    buyVol,
    sellVol,
    height: chunk[chunk.length - 1].height,
    up,
    trades: chunk.length,
    side: chunk.length === 1 ? chunk[0].side : null,
  };
}

/**
 * Stable identity for a trade row.
 * MUST NOT include timeMs — stampTradeTimes rewrites ms every poll from tip height,
 * which made every row look "new" and flash + show "now".
 */
function tradeKey(t) {
  const hash = String(t?.hash || t?.txHash || t?.tx_hash || "").trim();
  const ug = Math.round(Number(t?.ugnot != null ? t.ugnot : (Number(t?.volumeGnot) || 0) * 1e6) || 0);
  const tok = Math.round(Number(t?.tokens) || 0);
  const h = Number(t?.height) || 0;
  const side = Number(t?.side);
  const src = String(t?.source || t?.sideLabel || "curve");
  const px = Number(t?.price || t?.priceGnot || 0);
  if (hash) return `tx:${hash}|${h}|${side}|${ug}|${tok}|${px}`;
  return `r:${src}|${h}|${side}|${ug}|${tok}|${px}`;
}

function tradeTimeMs(t) {
  if (t == null) return null;
  const ms = Number(t.timeMs);
  if (Number.isFinite(ms) && ms > 0) return ms;
  if (t.time != null) {
    const p = typeof t.time === "number" ? t.time : Date.parse(t.time);
    if (Number.isFinite(p) && p > 0) return p;
  }
  return null;
}

const CLIENT_BLOCK_TX_CACHE = new Map();

async function resolveBlockTxHash(height) {
  const h = Math.floor(Number(height));
  if (!h || h <= 0) return null;
  if (CLIENT_BLOCK_TX_CACHE.has(h)) return CLIENT_BLOCK_TX_CACHE.get(h);

  try {
    const res = await fetch(`https://rpc.sapphire.testnets.gno.land/block?height=${h}`);
    if (!res.ok) return null;
    const data = await res.json();
    const txs = data?.result?.block?.data?.txs;
    if (Array.isArray(txs) && txs.length > 0) {
      const rawB64 = txs[0];
      const binary = atob(rawB64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const hashBuffer = await crypto.subtle.digest("SHA-256", bytes);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hashHex = "0x" + hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
      CLIENT_BLOCK_TX_CACHE.set(h, hashHex);
      return hashHex;
    }
  } catch {
    /* non-fatal */
  }
  return null;
}

/**
 * Recent trades with FOMO flash on newly arrived rows (poll / after own trade).
 */
export function TradesList({ trades = [], limit = 30, showSource = false, gnotUsd = 0 }) {
  const fx = Number(gnotUsd) || 0;
  const seenRef = useRef(new Set());
  const primedRef = useRef(false);
  const [flashKeys, setFlashKeys] = useState(() => new Set());
  // Tick so relative times ("3m ago") update without re-flashing
  const [nowTick, setNowTick] = useState(0);
  const [resolvedHashes, setResolvedHashes] = useState(() => ({}));

  const rows = useMemo(() => {
    return (trades || [])
      .filter((t) => {
        const s = Number(t.side);
        const lab = String(t.sideLabel || "");
        if (s === 0 || s === 1 || s === 3 || s === 4) return true;
        if (lab === "add_lp" || lab === "remove_lp" || lab === "open") return true;
        if (s === 2) return true;
        return (Number(t.ugnot) || 0) > 0 || (Number(t.tokens) || 0) > 0;
      })
      .slice()
      .sort((a, b) => {
        const tb = tradeTimeMs(b) || 0;
        const ta = tradeTimeMs(a) || 0;
        if (tb !== ta) return tb - ta;
        return (Number(b.height) || 0) - (Number(a.height) || 0);
      })
      .slice(0, limit);
  }, [trades, limit]);

  useEffect(() => {
    const missing = rows.filter(
      (r) => !r.hash && !r.txHash && !r.tx_hash && r.height > 0 && !resolvedHashes[Math.floor(Number(r.height))]
    );
    if (!missing.length) return;

    let cancelled = false;
    const heights = [...new Set(missing.map((r) => Math.floor(Number(r.height))))];

    Promise.all(
      heights.map(async (h) => {
        const hash = await resolveBlockTxHash(h);
        return [h, hash];
      })
    ).then((results) => {
      if (cancelled) return;
      setResolvedHashes((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const [h, hash] of results) {
          if (hash && next[h] !== hash) {
            next[h] = hash;
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [rows, resolvedHashes]);

  useEffect(() => {
    const id = setInterval(() => setNowTick((n) => n + 1), 15_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const keys = rows.map(tradeKey).filter(Boolean);
    // Do not prime on empty — otherwise the first real history batch all "flash"
    // and freeze the page for a few seconds on reload.
    if (!primedRef.current) {
      if (!keys.length) return undefined;
      keys.forEach((k) => seenRef.current.add(k));
      primedRef.current = true;
      setFlashKeys(new Set());
      return undefined;
    }
    const fresh = keys.filter((k) => !seenRef.current.has(k)).slice(0, 3);
    if (!fresh.length) return undefined;

    fresh.forEach((k) => seenRef.current.add(k));
    if (seenRef.current.size > 400) {
      const keep = new Set(keys);
      fresh.forEach((k) => keep.add(k));
      seenRef.current = keep;
    }

    let clearT = null;
    const startT = requestAnimationFrame(() => {
      setFlashKeys(new Set(fresh));
      clearT = setTimeout(() => {
        setFlashKeys((prev) => {
          const n = new Set(prev);
          fresh.forEach((k) => n.delete(k));
          return n;
        });
      }, 2800);
    });
    return () => {
      cancelAnimationFrame(startT);
      if (clearT) clearTimeout(clearT);
    };
  }, [rows]);

  if (!rows.length) {
    return (
      <div className="trades-empty muted">
        No trades yet — curve history + Gnoswap swaps on this device appear here
      </div>
    );
  }

  return (
    <div
      className={`trades-list trades-list-pro trades-list-terminal trades-with-tx${showSource ? " trades-with-source" : ""}`}
    >
      <div className="trades-head trades-head-terminal" aria-hidden>
        <span>AGE</span>
        <span>TYPE</span>
        <span>PRICE</span>
        <span>AMOUNT</span>
        <span>TOTAL</span>
        <span>VIA</span>
        <span>TX</span>
      </div>
      {rows.map((t, i) => {
        const side = Number(t.side);
        const lab = String(t.sideLabel || "");
        const isBuy = side === 0;
        const isSell = side === 1;
        const isAddLp = side === 3 || lab === "add_lp";
        const isRmLp = side === 4 || lab === "remove_lp";
        const vol = t.volumeGnot != null ? t.volumeGnot : (Number(t.ugnot) || 0) / 1e6;
        const ts = tradeTimeMs(t);
        void nowTick;
        const rel =
          ts != null
            ? relativeTime(ts)
            : t.height
              ? `h${t.height}`
              : "—";
        const abs =
          ts != null ? fmtClock(ts) : t.height ? `block ${t.height}` : "—";
        const key = tradeKey(t);
        const flashing = flashKeys.has(key);
        const src = String(t.source || "curve").toLowerCase();
        const viaGno = src === "gnoswap" || src === "dex";
        const viaLp = src === "lp" || isAddLp || isRmLp;
        const hKey = Math.floor(Number(t.height));
        const rawHash = t.hash || t.txHash || t.tx_hash || (hKey > 0 ? resolvedHashes[hKey] : null);
        if (!t.hash && rawHash) t.hash = rawHash;
        const onchain = tradeOnchainLink({
          hash: rawHash,
          height: t.height,
        });
        let sideText = "OPEN";
        if (isBuy) sideText = "BUY";
        else if (isSell) sideText = "SELL";
        else if (isAddLp) sideText = t.label || "+LP";
        else if (isRmLp) sideText = t.label || "-LP";
        const rowKind = isBuy
          ? "buy"
          : isSell
            ? "sell"
            : isAddLp
              ? "add-lp"
              : isRmLp
                ? "rm-lp"
                : "open";

        return (
          <div
            key={key ? `${key}#${i}` : `i-${i}`}
            className={`trade-row trade-row-pro trade-row-terminal ${rowKind}${flashing ? " flash-new" : ""}${viaGno ? " via-gnoswap" : ""}`}
          >
            <span className="trade-age mono" title={abs}>
              {rel}
            </span>
            <span className={`trade-type-tag ${rowKind}`}>
              {/* {flashing ? <i className="flash-dot" aria-hidden /> : null} */}
              {sideText}
            </span>
            <span className="mono trade-px">
              {t.priceUsd != null && t.priceUsd > 0
                ? fmtPriceUsd(t.priceUsd)
                : t.priceGnot != null && t.priceGnot > 0
                  ? fx > 0
                    ? fmtPriceUsd(Number(t.priceGnot) * fx)
                    : `${fmtPrice(t.priceGnot)} GNOT`
                  : "—"}
            </span>
            <span className="mono trade-tokens">{fmtNum(t.tokens)}</span>
            <span className={`mono trade-total ${isBuy ? "up" : isSell ? "down" : ""}`}>
              {fx > 0 && vol > 0
                ? fmtPriceUsd(vol * fx)
                : `${fmtGnot(vol, { alreadyGnot: true })} GNOT`}
            </span>
            <span className={`trade-via mono ${viaGno ? "gnoswap" : viaLp ? "lp" : "curve"}`}>
              {viaGno ? "GNOSWAP" : viaLp ? "LP" : "CURVE"}
            </span>
            <span className="trade-tx">
              {onchain ? (
                <a
                  className={`tx-link mono${onchain.kind === "block" ? " is-block" : " is-tx"}`}
                  href={onchain.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={`${onchain.title} · open on Gnoscan`}
                  onClick={(e) => e.stopPropagation()}
                >
                  <span className="tx-link-label">{onchain.label}</span>
                  <span className="tx-link-ext" aria-hidden>
                    ↗
                  </span>
                </a>
              ) : (
                <span className="faint">—</span>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
