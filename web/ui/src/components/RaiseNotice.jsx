/**
 * Gnomi Labs raise notice.
 * Toggle: VITE_RAISE_NOTICE=1.
 * Close hides the dialog for this tab and leaves a progress bubble.
 * Notices stay hidden unless VITE_RAISE_NOTICE=1 and the end instant is still ahead.
 */
import { useEffect, useState } from "react";
import { usePrefs } from "../context/PrefsContext";

export const RAISE_URL = "https://seed.gnomi.fun";
/** 07:00 ICT 30 Sep 2026. */
export const RAISE_NOTICE_END_MS = Date.parse("2026-09-30T00:00:00.000Z");

export function useRaiseNoticeLive() {
  const [live, setLive] = useState(() => Date.now() < RAISE_NOTICE_END_MS);
  useEffect(() => {
    const left = RAISE_NOTICE_END_MS - Date.now();
    if (left <= 0) {
      setLive(false);
      return undefined;
    }
    const id = window.setTimeout(() => setLive(false), left);
    return () => window.clearTimeout(id);
  }, []);
  return live;
}
const DISMISS_KEY = "gnomi.raiseNotice.v1";
const HEARTH_PKG = "gno.land/r/g1n4pl5uc4yt5r96m9w6fmdznx3x0jyg8l6arhmt/hearth/v1";
const HEARTH_RPC = "https://rpc.onbloc.xyz:443";

let progressState = null;
const progressListeners = new Set();
let progressTimer = null;

function parseSummary(text) {
  const quoted = String(text || "").match(/^"(.*)"\s+string$/s);
  const body = quoted ? quoted[1] : String(text || "");
  const parts = body.split("|").map((part) => part.replace(/\s+\w+$/, "").replace(/[()]/g, "").trim());
  const raised = Number(parts[1]);
  const cap = Number(parts[7]);
  const seats = Number(parts[5]);
  if (!Number.isFinite(raised) || !Number.isFinite(cap) || cap <= 0) return null;
  return { raised, cap, seats: Number.isFinite(seats) ? seats : 0 };
}

async function pullProgress() {
  const expr = `${HEARTH_PKG}.Summary()`;
  const res = await fetch(HEARTH_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "1",
      method: "abci_query",
      params: { path: "vm/qeval", data: btoa(expr), height: "0", prove: false },
    }),
  });
  const json = await res.json();
  const data = json?.result?.response?.ResponseBase?.Data;
  if (!data) return;
  const next = parseSummary(atob(data));
  if (!next) return;
  progressState = next;
  progressListeners.forEach((fn) => fn(next));
}

function ensureProgress() {
  if (progressTimer) return;
  pullProgress().catch(() => {});
  progressTimer = window.setInterval(() => {
    pullProgress().catch(() => {});
  }, 20000);
}

export function useRaiseProgress() {
  const [value, setValue] = useState(progressState);
  useEffect(() => {
    ensureProgress();
    progressListeners.add(setValue);
    return () => progressListeners.delete(setValue);
  }, []);
  return value;
}

function gnotLabel(ugnot) {
  const n = (Number(ugnot) || 0) / 1e6;
  return n.toLocaleString("en-US", { maximumFractionDigits: n >= 100 ? 0 : 2 });
}

function pctOf(progress) {
  if (!progress?.cap) return 0;
  return Math.max(0, Math.min(100, (progress.raised / progress.cap) * 100));
}

function alreadyDismissed() {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

function RaiseProgressRing({ pct }) {
  const r = 18;
  const c = 2 * Math.PI * r;
  const shown = Math.max(0, Math.min(100, pct));
  return (
    <svg className="raise-ring" viewBox="0 0 44 44" aria-hidden>
      <circle cx="22" cy="22" r={r} />
      <circle
        cx="22"
        cy="22"
        r={r}
        style={{ strokeDasharray: `${(c * shown) / 100} ${c}` }}
      />
    </svg>
  );
}

function RaiseHoverCard({ progress, t }) {
  const pct = pctOf(progress);
  return (
    <div className="raise-fab-card">
      <strong>{t("raiseNoticeTitle")}</strong>
      <p>
        {progress
          ? `${gnotLabel(progress.raised)} / ${gnotLabel(progress.cap)} GNOT · ${pct.toFixed(pct >= 10 ? 1 : 2)}%`
          : t("raiseNoticeWhen")}
      </p>
      <p>{t("raiseNoticeWhen")}</p>
      <a href={RAISE_URL} target="_blank" rel="noreferrer">
        {t("raiseNoticeOpen")}
      </a>
    </div>
  );
}

export function RaiseHomeBanner() {
  const { t } = usePrefs();
  const progress = useRaiseProgress();
  const pct = pctOf(progress);
  return (
    <a className="raise-banner" href={RAISE_URL} target="_blank" rel="noreferrer">
      <strong>{t("raiseNoticeTitle")}</strong>
      <span>
        {progress
          ? `${gnotLabel(progress.raised)} / ${gnotLabel(progress.cap)} GNOT · ${pct.toFixed(pct >= 10 ? 1 : 2)}%`
          : t("raiseNoticeWhen")}
      </span>
      <em>{t("raiseNoticeOpen")}</em>
    </a>
  );
}

export default function RaiseNotice() {
  const { t } = usePrefs();
  const progress = useRaiseProgress();
  const [open, setOpen] = useState(() => !alreadyDismissed());

  function dismiss() {
    try {
      sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* private mode can block storage; still hide this view */
    }
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return undefined;
    function onKey(e) {
      if (e.key === "Escape") dismiss();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const pct = pctOf(progress);

  return (
    <>
      {open ? (
        <div
          className="raise-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="raise-title"
          aria-describedby="raise-desc"
        >
          <div className="raise-modal">
            <button type="button" className="raise-x" onClick={dismiss} aria-label={t("raiseNoticeDismiss")}>
              ×
            </button>
            <div className="raise-modal-icon" aria-hidden>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                <path
                  d="M12 3.5c2.8 2.2 4.6 5.2 5 8.7-.9.4-1.9.7-3 .9L12 20.5l-2-7.4c-1.1-.2-2.1-.5-3-.9.4-3.5 2.2-6.5 5-8.7Z"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <h1 id="raise-title" className="raise-title">
              {t("raiseNoticeTitle")}
            </h1>
            <p id="raise-desc" className="raise-sub">
              {t("raiseNoticeBody")}
            </p>
            <p className="raise-when">{t("raiseNoticeWhen")}</p>
            <div className="raise-actions">
              <a className="raise-open" href={RAISE_URL} target="_blank" rel="noreferrer">
                {t("raiseNoticeOpen")}
              </a>
              <button type="button" className="raise-close" onClick={dismiss}>
                {t("raiseNoticeClose")}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="raise-fab">
          <a className="raise-fab-btn" href={RAISE_URL} target="_blank" rel="noreferrer" aria-label={t("raiseNoticeTitle")}>
            <RaiseProgressRing pct={pct} />
            <span>{progress ? `${Math.round(pct)}%` : "…"}</span>
          </a>
          <RaiseHoverCard progress={progress} t={t} />
        </div>
      )}
    </>
  );
}
