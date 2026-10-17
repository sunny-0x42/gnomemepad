import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { fmtClock, fmtNum, fmtPrice, fmtPriceUsd, fmtUsd, fmtVolGnot, relativeTime } from "../lib/format";
import { usePrefs } from "../context/PrefsContext";

/**
 * Stable id for activity rows — must not include drifting timeMs stamps.
 */
function activityKey(e) {
  const hash = String(e?.hash || e?.txHash || e?.tx_hash || "").trim();
  if (hash) return `tx:${hash}`;
  const ug = Math.round(
    Number(e?.ugnot != null ? e.ugnot : (Number(e?.volumeGnot) || 0) * 1e6) || 0,
  );
  const tok = Math.round(Number(e?.tokens) || 0);
  const h = Number(e?.height) || 0;
  const side = Number(e?.side);
  const id = String(e?.id ?? "");
  const pkg = String(e?.pkg || "");
  return `a:${pkg}|${id}|${h}|${side}|${ug}|${tok}`;
}

function eventTimeMs(e) {
  if (e == null) return null;
  const ms = Number(e.timeMs);
  if (Number.isFinite(ms) && ms > 0) return ms;
  if (e.time != null) {
    const p = typeof e.time === "number" ? e.time : Date.parse(e.time);
    if (Number.isFinite(p) && p > 0) return p;
  }
  return null;
}

/**
 * Recent trades list for Markets discovery (pump-style feed).
 * New rows get the same running-border FOMO flash as Token Trades.
 */
export default function ActivityFeed({ limit = 18 }) {
  const { t } = usePrefs();
  const [events, setEvents] = useState([]);
  const [gnotUsd, setGnotUsd] = useState(0);
  const [err, setErr] = useState("");
  const [at, setAt] = useState(null);
  const [flashKeys, setFlashKeys] = useState(() => new Set());
  const [nowTick, setNowTick] = useState(0);
  const seenRef = useRef(new Set());
  const primedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const d = await api(`/api/activity?limit=${limit * 2}`);
        if (cancelled) return;
        const rows = (d?.events || [])
          .filter((e) => Number(e.side) !== 2 || (Number(e.volumeGnot) || 0) > 0)
          .slice(0, limit);
        setEvents(rows);
        const fx = Number(d?.gnotUsd) || 0;
        setGnotUsd(fx);
        if (!(fx > 0)) {
          api("/api/fx")
            .then((fxBody) => setGnotUsd(Number(fxBody?.gnotUsd) || 0))
            .catch(() => {});
        }
        setAt(Date.now());
        setErr("");
      } catch (e) {
        if (!cancelled) setErr(e.message || String(e));
      }
    }
    load();
    const tmr = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      load();
    }, 45000);
    return () => {
      cancelled = true;
      clearInterval(tmr);
    };
  }, [limit]);

  useEffect(() => {
    const id = setInterval(() => setNowTick((n) => n + 1), 15_000);
    return () => clearInterval(id);
  }, []);

  const rows = useMemo(() => {
    return (events || []).slice().sort((a, b) => {
      const tb = eventTimeMs(b) || 0;
      const ta = eventTimeMs(a) || 0;
      if (tb !== ta) return tb - ta;
      return (Number(b.height) || 0) - (Number(a.height) || 0);
    });
  }, [events]);

  useEffect(() => {
    const keys = rows.map(activityKey).filter(Boolean);
    // Wait for first non-empty snapshot. Priming on [] then loading history
    // made every row look "new" → mass flash + UI freeze on reload.
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

    // Defer paint of flash so list can render first (avoids jank on heavy pages)
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

  return (
    <div className="activity-feed panel activity-feed-pro">
      <div className="activity-feed-head">
        <h3 className="panel-title activity-feed-title">
          {t("recentActivity")}
          {at ? (
            <span className="activity-feed-updated muted" title={fmtClock(at)}>
              · {relativeTime(at)}
            </span>
          ) : null}
        </h3>
        <span className="activity-live-dot" aria-hidden>
          <i /> LIVE
        </span>
      </div>

      {err && <div className="muted activity-feed-err">{err}</div>}
      {!err && !events.length && (
        <div className="muted activity-feed-empty">{t("noRecentTrades")}</div>
      )}

      {rows.length > 0 && (
        <div className="activity-feed-list">
          {rows.map((e) => {
            const side = Number(e.side);
            const lab = side === 0 ? "BUY" : side === 1 ? "SELL" : "NEW";
            const cls = side === 0 ? "buy" : side === 1 ? "sell" : "new";
            const vol = Number(e.volumeGnot) || 0;
            const fx = Number(e.gnotUsd) > 0 ? Number(e.gnotUsd) : gnotUsd;
            const volUsd = Number(e.volumeUsd) > 0 ? Number(e.volumeUsd) : vol > 0 && fx > 0 ? vol * fx : 0;
            const pxG = Number(e.priceGnot) || 0;
            const pxUsd = Number(e.priceUsd) > 0 ? Number(e.priceUsd) : pxG > 0 && fx > 0 ? pxG * fx : 0;
            const ts = eventTimeMs(e);
            void nowTick;
            const rel = ts != null ? relativeTime(ts) : e.height ? `h${e.height}` : "—";
            const abs = ts != null ? fmtClock(ts) : e.height ? `block ${e.height}` : "—";
            const key = activityKey(e);
            const flashing = flashKeys.has(key);
            const src = String(e.source || "curve").toLowerCase();
            const viaGno = src === "gnoswap" || src === "dex";
            const viaLp = src === "lp";
            const viaLabel = viaGno ? "Gnoswap" : viaLp ? "LP" : "Curve";
            const sym = e.symbol || e.name || e.id;
            const tip = [
              e.name && e.symbol && e.name !== e.symbol ? e.name : null,
              pxUsd > 0 ? `px ${fmtPriceUsd(pxUsd)}` : pxG > 0 ? `px ${fmtPrice(pxG)} GNOT` : null,
              volUsd > 0 ? fmtUsd(volUsd) : null,
              e.tokens > 0 ? `${fmtNum(e.tokens)} tok` : null,
              abs,
              viaLabel,
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <Link
                key={key}
                to={`/token/${encodeURIComponent(e.id)}?pkg=${encodeURIComponent(e.pkg || "")}`}
                className={`activity-feed-row ${cls}${flashing ? " flash-new" : ""}${viaGno ? " via-gnoswap" : ""}`}
                title={tip}
              >
                <span className="trade-side af-side">
                  {flashing ? <i className="flash-dot" aria-hidden /> : null}
                  {lab}
                </span>
                <span className="af-sym">
                  <strong>${sym}</strong>
                </span>
                <span className="mono af-vol">
                  {volUsd > 0 || vol > 0 ? (
                    <span className="trade-money af-money">
                      {volUsd > 0 ? <span className="trade-money-usd">{fmtUsd(volUsd)}</span> : null}
                      {vol > 0 ? (
                        <span className="trade-money-sub">
                          {fmtVolGnot(vol)}
                          <span className="trade-unit"> GNOT</span>
                        </span>
                      ) : null}
                    </span>
                  ) : (
                    "—"
                  )}
                </span>
                <span
                  className={`af-via${viaGno ? " gnoswap" : viaLp ? " lp" : " curve"}`}
                >
                  {viaLabel}
                </span>
                <span className={`af-time${flashing ? " trade-time-live" : ""}`}>{rel}</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
