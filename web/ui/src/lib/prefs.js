const KEY = "gnomemepad.prefs.v2";

const DEFAULTS = {
  lang: "en", // en | vi
  theme: "system", // system | dark | light
  sound: false,
  alerts: true,
  alertThreshold: 80, // % progress for watchlist alerts
};

export function loadPrefs() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function savePrefs(p) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
  return p;
}

export function applyTheme(theme) {
  let t = theme;
  if (t === "system" || !t) {
    t = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } else {
    t = theme === "light" ? "light" : "dark";
  }
  document.documentElement.setAttribute("data-theme", t);
  document.documentElement.style.colorScheme = t;
}

/** Tiny UI beep (Web Audio). */
export function playBeep(kind = "ok") {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = kind === "err" ? 220 : kind === "grad" ? 660 : 520;
    g.gain.value = 0.04;
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18);
    o.stop(ctx.currentTime + 0.2);
    setTimeout(() => ctx.close().catch(() => {}), 300);
  } catch {
    /* ignore */
  }
}

const ALERT_SEEN = "gnomemepad.alertSeen.v1";

export function loadAlertSeen() {
  try {
    return new Set(JSON.parse(localStorage.getItem(ALERT_SEEN) || "[]"));
  } catch {
    return new Set();
  }
}

export function markAlertSeen(key) {
  const s = loadAlertSeen();
  s.add(key);
  try {
    localStorage.setItem(ALERT_SEEN, JSON.stringify([...s].slice(-200)));
  } catch {
    /* ignore */
  }
}
