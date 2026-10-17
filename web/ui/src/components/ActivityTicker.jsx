import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { fmtUsd, fmtVolGnot, relativeTime } from "../lib/format";

/**
 * Live-ish strip of recent platform trades / opens.
 */
export default function ActivityTicker({ className = "" }) {
  const [events, setEvents] = useState([]);
  const [gnotUsd, setGnotUsd] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const d = await api("/api/activity?limit=40");
        if (!cancelled) {
          setEvents(d?.events || []);
          const fx = Number(d?.gnotUsd) || 0;
          setGnotUsd(fx);
          if (!(fx > 0)) {
            api("/api/fx")
              .then((fxBody) => {
                if (!cancelled) setGnotUsd(Number(fxBody?.gnotUsd) || 0);
              })
              .catch(() => {});
          }
        }
      } catch {
        if (!cancelled) setEvents([]);
      }
    }
    load();
    const t = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      load();
    }, 45000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  const items = events
    .filter((e) => Number(e.side) !== 2 || (Number(e.volumeGnot) || 0) > 0)
    .slice(0, 24);

  if (!items.length) {
    return (
      <div className={`activity-ticker ${className}`.trim()}>
        <span className="ticker-live">
          <i /> LIVE
        </span>
        <span className="muted ticker-empty">Waiting for trades on Mainnet…</span>
      </div>
    );
  }

  const loop = [...items, ...items];

  return (
    <div className={`activity-ticker ${className}`.trim()} aria-label="Recent activity">
      <span className="ticker-live">
        <i /> LIVE
      </span>
      <div className="ticker-track-wrap">
        <div className="ticker-track">
          {loop.map((e, i) => {
            const side = Number(e.side);
            const lab = side === 0 ? "BUY" : side === 1 ? "SELL" : "NEW";
            const cls = side === 0 ? "buy" : side === 1 ? "sell" : "new";
            const vol = Number(e.volumeGnot) || 0;
            const fx = Number(e.gnotUsd) > 0 ? Number(e.gnotUsd) : gnotUsd;
            const volUsd =
              Number(e.volumeUsd) > 0 ? Number(e.volumeUsd) : vol > 0 && fx > 0 ? vol * fx : 0;
            const ts = e.timeMs ?? e.time ?? null;
            const rel = ts != null ? relativeTime(ts) : "";
            return (
              <Link
                key={`${e.pkg}-${e.id}-${e.height}-${i}`}
                className={`ticker-item ${cls}`}
                to={`/token/${encodeURIComponent(e.id)}?pkg=${encodeURIComponent(e.pkg || "")}`}
              >
                <span className="ticker-side">{lab}</span>
                <span className="ticker-sym">${e.symbol || e.name || e.id}</span>
                {vol > 0 && (
                  <span className="ticker-vol mono">
                    {volUsd > 0 ? `${fmtUsd(volUsd)} · ` : ""}
                    {fmtVolGnot(vol)} GNOT
                  </span>
                )}
                {rel && <span className="ticker-time muted">{rel}</span>}
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
