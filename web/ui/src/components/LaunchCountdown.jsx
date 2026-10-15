/**
 * Non-dismissible GNOMI launch countdown for public users.
 * Protocol admin (wallet === signerAddr) bypasses via MaintenanceGate in App.jsx.
 * Toggle: VITE_SITE_UPGRADE=1
 */
import { useEffect, useMemo, useState } from "react";
import { useApp } from "../context/AppContext";
import { usePrefs } from "../context/PrefsContext";

/** Single source of truth — change this ISO to retarget the countdown. */
export const GNOMI_LAUNCH_AT = "2026-09-21T07:00:00.000Z";

/** Epoch ms for gate auto-open (App.jsx MaintenanceGate). */
export const GNOMI_LAUNCH_MS = Date.parse(GNOMI_LAUNCH_AT);

const LAUNCH_MS = GNOMI_LAUNCH_MS;

function pad2(n) {
  return String(Math.max(0, n)).padStart(2, "0");
}

function remainingParts(nowMs) {
  const diff = Math.max(0, LAUNCH_MS - nowMs);
  const totalSec = Math.floor(diff / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  return { days, hours, minutes, seconds, done: diff <= 0 };
}

export default function LaunchCountdown() {
  const { wallet, connect, connecting } = useApp();
  const { t } = usePrefs();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);

  const parts = useMemo(() => remainingParts(now), [now]);
  const short = wallet?.address
    ? `${wallet.address.slice(0, 8)}…${wallet.address.slice(-4)}`
    : "";

  return (
    <div
      className="launch-overlay"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="launch-title"
      aria-describedby="launch-desc"
      onClick={(e) => {
        if (e.target?.closest?.(".launch-admin-actions")) return;
        e.preventDefault();
        e.stopPropagation();
      }}
      onMouseDown={(e) => {
        if (e.target?.closest?.(".launch-admin-actions")) return;
        e.preventDefault();
        e.stopPropagation();
      }}
      onTouchStart={(e) => {
        if (e.target?.closest?.(".launch-admin-actions")) return;
        e.preventDefault();
        e.stopPropagation();
      }}
      onKeyDown={(e) => {
        if (e.target?.closest?.(".launch-admin-actions")) return;
        e.preventDefault();
        e.stopPropagation();
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="launch-modal" role="document">
        <div className="launch-modal-icon" aria-hidden>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 3.5c2.8 2.2 4.6 5.2 5 8.7-.9.4-1.9.7-3 .9L12 20.5l-2-7.4c-1.1-.2-2.1-.5-3-.9.4-3.5 2.2-6.5 5-8.7Z"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinejoin="round"
            />
            <path
              d="M9.2 14.2c-.9.9-1.4 2.1-1.5 3.4 1.3-.1 2.5-.6 3.4-1.5M14.8 14.2c.9.9 1.4 2.1 1.5 3.4-1.3-.1-2.5-.6-3.4-1.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </div>

        <h1 id="launch-title" className="launch-title">
          {t("launchTitle")}
        </h1>

        <p id="launch-desc" className="launch-sub">
          {t("launchTagline")}
        </p>

        <p className="launch-when">{t("launchWhen")}</p>

        {parts.done ? (
          <div className="launch-live" aria-live="polite">
            <span className="launch-pulse" aria-hidden />
            <span>{t("launchLive")}</span>
          </div>
        ) : (
          <div
            className="launch-countdown"
            aria-live="polite"
            aria-atomic="true"
          >
            <div className="launch-unit">
              <span className="launch-num">{pad2(parts.days)}</span>
              <span className="launch-label">{t("launchDays")}</span>
            </div>
            <span className="launch-sep" aria-hidden>
              :
            </span>
            <div className="launch-unit">
              <span className="launch-num">{pad2(parts.hours)}</span>
              <span className="launch-label">{t("launchHours")}</span>
            </div>
            <span className="launch-sep" aria-hidden>
              :
            </span>
            <div className="launch-unit">
              <span className="launch-num">{pad2(parts.minutes)}</span>
              <span className="launch-label">{t("launchMinutes")}</span>
            </div>
            <span className="launch-sep" aria-hidden>
              :
            </span>
            <div className="launch-unit">
              <span className="launch-num">{pad2(parts.seconds)}</span>
              <span className="launch-label">{t("launchSeconds")}</span>
            </div>
          </div>
        )}

        <div
          className="launch-admin-actions"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
        >
          <p className="launch-hint">{t("launchAdminHint")}</p>
          <button
            type="button"
            className="launch-connect"
            disabled={connecting}
            onClick={() => connect?.()}
          >
            {connecting
              ? t("connecting")
              : wallet?.address
                ? `${t("connected")} ${short}`
                : t("connectAdena")}
          </button>
        </div>
      </div>
    </div>
  );
}
