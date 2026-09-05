export const UGNOT_PER_GNOT = 1_000_000;

/** Force en-US so 1,234.56 is stable (not locale-dependent 1.234,56). */
const LOCALE = "en-US";

export function shortAddr(addr, n = 4) {
  if (!addr || typeof addr !== "string") return "—";
  if (addr.length < 12) return addr;
  return `${addr.slice(0, 2 + n)}…${addr.slice(-n)}`;
}

function trimFrac(s) {
  if (!s.includes(".")) return s;
  return s.replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.0+$/, "");
}

/**
 * Group thousands with commas; optional fixed fraction digits.
 * 1234.5 → "1,234.5"  |  0.5 → "0.5"
 */
export function fmtGrouped(n, { maxFrac = 2, minFrac = 0 } = {}) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  return x.toLocaleString(LOCALE, {
    maximumFractionDigits: maxFrac,
    minimumFractionDigits: minFrac,
  });
}

/**
 * Compact K / M / B (always en-US, max 2 frac, trim trailing zeros).
 * 1500 → "1.5K"  |  1_200_000 → "1.2M"
 */
export function fmtCompact(n, { threshold = 1_000 } = {}) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  if (x === 0) return "0";
  const sign = x < 0 ? "-" : "";
  const abs = Math.abs(x);
  if (abs < threshold) {
    if (Number.isInteger(abs) || abs >= 100) return sign + fmtGrouped(abs, { maxFrac: 0 });
    if (abs >= 1) return sign + trimFrac(abs.toFixed(2));
    return sign + trimFrac(abs.toFixed(4));
  }
  let div = 1;
  let suf = "";
  if (abs >= 1e9) {
    div = 1e9;
    suf = "B";
  } else if (abs >= 1e6) {
    div = 1e6;
    suf = "M";
  } else {
    div = 1e3;
    suf = "K";
  }
  const v = abs / div;
  const body =
    v >= 100 ? v.toFixed(0) : v >= 10 ? trimFrac(v.toFixed(1)) : trimFrac(v.toFixed(2));
  return sign + body + suf;
}

/**
 * Counts / balances / buyers / token amounts.
 * ≥1K → K/M/B; else integer or short decimal.
 */
export function fmtNum(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  if (x === 0) return "0";
  const abs = Math.abs(x);
  // Token balances often huge integers
  if (abs >= 1_000) return fmtCompact(x, { threshold: 1_000 });
  if (Number.isInteger(x)) return String(x);
  return trimFrac(x.toFixed(4));
}

/**
 * Fixed-decimal for tiny values (prices) — never scientific, never compact.
 * 3.27e-6 → "0.00000327"
 */
export function fmtFixedDecimal(n, { maxDecimals = 16 } = {}) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  if (x === 0) return "0";
  const abs = Math.abs(x);
  const sign = x < 0 ? "-" : "";

  if (abs >= 1_000) return sign + fmtGrouped(abs, { maxFrac: 2 });
  if (abs >= 1) return sign + trimFrac(abs.toFixed(4));
  if (abs >= 0.01) return sign + trimFrac(abs.toFixed(6));
  if (abs >= 0.0001) return sign + trimFrac(abs.toFixed(8));

  // Significant digits in fixed form (e.g. 0.00000327)
  const exp = Math.floor(Math.log10(abs));
  const decimals = Math.min(maxDecimals, Math.max(8, -exp + 3));
  return sign + trimFrac(abs.toFixed(decimals));
}

/**
 * GNOT amounts (volume, raised, fees, trade size).
 * ≥1M → compact M/B; 1K–1M → grouped "1,234.56"; small → sensible decimals.
 */
export function fmtGnot(ugnotOrGnot, { alreadyGnot = false } = {}) {
  const g = alreadyGnot
    ? Number(ugnotOrGnot)
    : (Number(ugnotOrGnot) || 0) / UGNOT_PER_GNOT;
  if (!Number.isFinite(g)) return "—";
  if (g === 0) return "0";
  const abs = Math.abs(g);
  const sign = g < 0 ? "-" : "";

  // Very large: 1.2M / 3.4B GNOT
  if (abs >= 1_000_000) return sign + fmtCompact(abs, { threshold: 1_000_000 }).replace(/^-/, "");
  // Thousands: always show full with comma separators (not "3.5K")
  if (abs >= 1_000) return sign + fmtGrouped(abs, { maxFrac: 2 });
  // 1 … 999.9999
  if (abs >= 1) return sign + trimFrac(abs.toFixed(4));
  // 0.0001 … 1
  if (abs >= 0.0001) return sign + trimFrac(abs.toFixed(6));
  // Tiny GNOT leftovers
  return sign + fmtFixedDecimal(abs).replace(/^-/, "");
}

/** Spot price in GNOT/token — full fixed decimal only. */
export function fmtPriceGnot(priceGnot) {
  const p = Number(priceGnot);
  if (!Number.isFinite(p) || p <= 0) return "—";
  return fmtFixedDecimal(p);
}

export function fmtPrice(priceGnot) {
  return fmtPriceGnot(priceGnot);
}

/**
 * Market cap in GNOT.
 * ≥1K → K/M/B; else 2–4 decimals.
 */
export function fmtMcap(mcapGnot) {
  const m = Number(mcapGnot);
  if (!Number.isFinite(m) || m <= 0) return "—";
  if (m >= 1_000) return fmtCompact(m, { threshold: 1_000 });
  if (m >= 1) return trimFrac(m.toFixed(2));
  return fmtFixedDecimal(m);
}

/**
 * USD amounts — always prefixed with $.
 * ≥1K → $1.2K / $3.4M; else sensible decimals.
 */
export function fmtUsd(n, { compact = true } = {}) {
  const x = Number(n);
  if (!Number.isFinite(x) || x === 0) return x === 0 ? "$0" : "—";
  const sign = x < 0 ? "-" : "";
  const abs = Math.abs(x);
  if (compact && abs >= 1_000) {
    return `${sign}$${fmtCompact(abs, { threshold: 1_000 })}`;
  }
  if (abs >= 1_000) return `${sign}$${fmtGrouped(abs, { maxFrac: 2 })}`;
  if (abs >= 1) return `${sign}$${trimFrac(abs.toFixed(2))}`;
  if (abs >= 0.01) return `${sign}$${trimFrac(abs.toFixed(4))}`;
  if (abs >= 0.0001) return `${sign}$${trimFrac(abs.toFixed(6))}`;
  return `${sign}$${fmtFixedDecimal(abs)}`;
}

/**
 * Token spot in USD — full fixed form for micro-prices (memecoins).
 * 0.00000321 → "$0.00000321"
 */
export function fmtPriceUsd(priceUsd) {
  const p = Number(priceUsd);
  if (!Number.isFinite(p) || p <= 0) return "—";
  if (p >= 1_000) return `$${fmtGrouped(p, { maxFrac: 2 })}`;
  if (p >= 1) return `$${trimFrac(p.toFixed(4))}`;
  if (p >= 0.01) return `$${trimFrac(p.toFixed(6))}`;
  return `$${fmtFixedDecimal(p)}`;
}

/**
 * Market cap / raised / volume in USD.
 */
export function fmtMcapUsd(mcapUsd) {
  const m = Number(mcapUsd);
  if (!Number.isFinite(m) || m <= 0) return "—";
  return fmtUsd(m, { compact: true });
}

/**
 * Prefer API USD; else derive from GNOT × gnotUsd.
 */
export function toUsd(gnotAmount, gnotUsd, explicitUsd) {
  if (explicitUsd != null && Number.isFinite(Number(explicitUsd)) && Number(explicitUsd) > 0) {
    return Number(explicitUsd);
  }
  const g = Number(gnotAmount) || 0;
  const fx = Number(gnotUsd) || 0;
  if (g > 0 && fx > 0) return g * fx;
  return 0;
}

export function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Relative time for "updated Xs ago" style labels. */
export function relativeTime(ts) {
  if (ts == null) return "—";
  const t = typeof ts === "number" ? ts : Date.parse(ts);
  if (!Number.isFinite(t)) return "—";
  const sec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

/** Clock time for trade rows (local). Accepts ms, ISO string, or Date. */
export function fmtClock(ts) {
  if (ts == null) return "—";
  const t = typeof ts === "number" ? ts : Date.parse(ts);
  if (!Number.isFinite(t)) return "—";
  try {
    return new Date(t).toLocaleString(LOCALE, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "—";
  }
}

/** Signed PnL number for display. */
export function fmtPnl(n, { alreadyGnot = true } = {}) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  const sign = x > 0 ? "+" : "";
  return `${sign}${fmtGnot(x, { alreadyGnot })}`;
}

export function formatCountdown(secondsLeft) {
  const s = Math.max(0, Math.floor(Number(secondsLeft) || 0));
  if (s <= 0) return "ended";
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

const GNOSCAN = "https://gnoscan.io";

/** Best-effort explorer link for Sapphire / Gno txs. */
export function txExplorerUrl(hash) {
  if (!hash || typeof hash !== "string") return null;
  const h = hash.replace(/^0x/i, "").trim();
  if (!h) return null;
  return `${GNOSCAN}/transactions/${encodeURIComponent(h)}`;
}

/** Block explorer page (TradeHistory only stores height, not hash). */
export function blockExplorerUrl(height) {
  const h = Number(height);
  if (!Number.isFinite(h) || h <= 0) return null;
  return `${GNOSCAN}/block/${Math.floor(h)}`;
}

/** Account / wallet explorer page. */
export function accountExplorerUrl(address) {
  const a = String(address || "").trim();
  if (!/^g1[a-z0-9]{38,}$/i.test(a)) return null;
  return `${GNOSCAN}/account/${encodeURIComponent(a)}`;
}

/**
 * Prefer tx hash → transaction page; else block height → block page.
 * Returns { href, label, kind: "tx"|"block" } or null.
 */
export function tradeOnchainLink({ hash, height } = {}) {
  const tx = txExplorerUrl(hash);
  if (tx) {
    const h = String(hash).replace(/^0x/i, "");
    const short = h.length > 12 ? `${h.slice(0, 6)}…${h.slice(-4)}` : h;
    return { href: tx, label: short, kind: "tx", title: `Tx ${h}` };
  }
  const blk = blockExplorerUrl(height);
  if (blk) {
    return {
      href: blk,
      label: `#${Math.floor(Number(height))}`,
      kind: "block",
      title: `Block ${Math.floor(Number(height))}`,
    };
  }
  return null;
}

/** Short hash for display. */
export function shortHash(hash, n = 4) {
  if (!hash || typeof hash !== "string") return "—";
  const h = hash.replace(/^0x/i, "");
  if (h.length <= n * 2 + 1) return h;
  return `${h.slice(0, n)}…${h.slice(-n)}`;
}

export async function copyText(text) {
  const s = String(text ?? "");
  if (!s) throw new Error("Nothing to copy");
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(s);
    return;
  }
  const ta = document.createElement("textarea");
  ta.value = s;
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  document.body.removeChild(ta);
}