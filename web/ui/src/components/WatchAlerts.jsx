import { useEffect, useRef } from "react";
import { useApp } from "../context/AppContext";
import { usePrefs } from "../context/PrefsContext";
import { api } from "../lib/api";
import { loadAlertSeen, markAlertSeen } from "../lib/prefs";
import { isWatched } from "../lib/watchlist";
import { marketKey } from "../lib/marketHeat";

/**
 * Poll markets and toast/notify when watched tokens hit progress threshold.
 */
export default function WatchAlerts() {
  const { watchlist, showToast } = useApp();
  const { prefs, beep } = usePrefs();
  const seenRef = useRef(loadAlertSeen());

  useEffect(() => {
    if (!prefs.alerts || !watchlist?.length) return;

    async function check() {
      try {
        const m = await api("/api/markets");
        const thr = Number(prefs.alertThreshold) || 80;
        for (const w of watchlist) {
          const hit = (m?.markets || []).find(
            (x) => x.id === w.id && (x.pkg || "") === (w.pkg || ""),
          );
          if (!hit || hit.error) continue;
          if (!isWatched(watchlist, hit.id, hit.pkg)) continue;
          const pct = Number(hit.progressPct) || 0;
          const key = `${marketKey(hit.id, hit.pkg)}@${thr}`;
          if (pct >= thr && !seenRef.current.has(key)) {
            seenRef.current.add(key);
            markAlertSeen(key);
            const msg =
              pct >= 100
                ? `$${hit.symbol || hit.id} ready to graduate!`
                : `$${hit.symbol || hit.id} at ${pct}% (watch alert)`;
            showToast(msg);
            beep("grad");
            if (typeof Notification !== "undefined" && Notification.permission === "granted") {
              try {
                // eslint-disable-next-line no-new
                new Notification("Gnomi.fun", { body: msg });
              } catch {
                /* ignore */
              }
            }
          }
        }
      } catch {
        /* ignore */
      }
    }

    check();
    const t = setInterval(check, 45000);
    return () => clearInterval(t);
  }, [watchlist, prefs.alerts, prefs.alertThreshold, showToast, beep]);

  // Request notification permission once when alerts enabled
  useEffect(() => {
    if (!prefs.alerts) return;
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  }, [prefs.alerts]);

  return null;
}
