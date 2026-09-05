/** Deterministic pastel-ish gradient from a seed string. */
export function avatarGradient(seed = "") {
  let h = 0;
  const s = String(seed || "g");
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const h1 = h % 360;
  return {
    css: `hsl(${h1} 45% 28%)`,
    hue: h1,
  };
}

export function avatarInitial(name, symbol) {
  const t = (symbol || name || "?").trim();
  return t.slice(0, 1).toUpperCase() || "?";
}

/**
 * Normalize user-entered image / website URI for storage (SetMeta / Create uri).
 * Empty → ""; invalid → "".
 * Meta on-chain maxURILen is 200 — prefer short HTTPS / ipfs CIDs.
 */
export function normalizeImageUri(raw, { maxLen = 200 } = {}) {
  let u = String(raw || "").trim();
  if (!u) return "";
  if (u.startsWith("ipfs://")) {
    // keep protocol form for chain storage
    return u.length <= maxLen ? u : u.slice(0, maxLen);
  }
  // bare domain/path → https
  if (!/^https?:\/\//i.test(u) && /^[\w.-]+\.[a-z]{2,}/i.test(u)) {
    u = `https://${u}`;
  }
  if (!/^https?:\/\//i.test(u)) return "";
  try {
    const parsed = new URL(u);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    const out = parsed.toString();
    return out.length <= maxLen ? out : out.slice(0, maxLen);
  } catch {
    return "";
  }
}

/** Safe image URL for <img src> (resolves ipfs → gateway). */
export function safeImageUrl(uri) {
  if (!uri || typeof uri !== "string") return null;
  const u = uri.trim();
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith("ipfs://")) {
    const path = u.slice(7).replace(/^ipfs\//, "");
    return `https://ipfs.io/ipfs/${path}`;
  }
  // bare host
  if (/^[\w.-]+\.[a-z]{2,}\//i.test(u) || /^[\w.-]+\.[a-z]{2,}$/i.test(u)) {
    return `https://${u}`;
  }
  return null;
}
