import { api } from "./api";
import { normalizeImageUri, safeImageUrl } from "./avatar";

/** Key used by /api/meta/batch responses: `${pkg}|${id}` */
export function metaKey(pkg, id) {
  return `${pkg || ""}|${id || ""}`;
}

export { normalizeImageUri, safeImageUrl };

/**
 * Fetch metadata for many launches (chunks of 32).
 * items: { pkg, id }[]
 * returns map key -> meta | null
 */
export async function fetchMetaBatch(items) {
  const list = (items || []).filter((x) => x?.pkg && x?.id);
  if (!list.length) return {};
  const out = {};
  const CHUNK = 32;
  for (let i = 0; i < list.length; i += CHUNK) {
    const chunk = list.slice(i, i + CHUNK);
    const param = chunk.map((x) => `${x.pkg}|${x.id}`).join(",");
    try {
      const r = await api(`/api/meta/batch?items=${encodeURIComponent(param)}`);
      Object.assign(out, r?.metas || {});
    } catch {
      /* keep partial */
    }
  }
  return out;
}

export async function fetchMetaOne(pkg, id) {
  if (!pkg || !id) return null;
  try {
    const r = await api(
      `/api/meta?pkg=${encodeURIComponent(pkg)}&id=${encodeURIComponent(id)}`,
    );
    return r?.meta || null;
  } catch {
    return null;
  }
}

/**
 * Prefer meta image, then launch uri / API logo fields.
 * Returns a displayable http(s) URL when possible (ipfs resolved).
 */
export function resolveTokenImage(market, meta) {
  const candidates = [
    meta?.imageURI,
    meta?.image,
    meta?.imageUrl,
    market?.imageURI,
    market?.logoURI,
    market?.uri,
    market?.image,
  ];
  for (const c of candidates) {
    const raw = String(c || "").trim();
    if (!raw) continue;
    const display = safeImageUrl(raw);
    if (display) return display;
    // already http(s)
    if (/^https?:\/\//i.test(raw)) return raw;
  }
  return "";
}

/** Raw stored image URI (for SetMeta / export), not gateway-rewritten. */
export function resolveTokenImageRaw(market, meta) {
  return (
    String(
      meta?.imageURI ||
        meta?.image ||
        meta?.imageUrl ||
        market?.imageURI ||
        market?.uri ||
        market?.logoURI ||
        "",
    ).trim() || ""
  );
}

export function twitterUrl(handle) {
  if (!handle) return null;
  const h = String(handle).replace(/^@/, "").trim();
  if (!h) return null;
  if (/^https?:\/\//i.test(h)) return h;
  return `https://x.com/${encodeURIComponent(h)}`;
}

export function telegramUrl(handle) {
  if (!handle) return null;
  const h = String(handle).replace(/^@/, "").trim();
  if (!h) return null;
  if (/^https?:\/\//i.test(h)) return h;
  return `https://t.me/${encodeURIComponent(h)}`;
}

export function websiteUrl(url) {
  if (!url) return null;
  const u = String(url).trim();
  if (!u) return null;
  if (/^https?:\/\//i.test(u)) return u;
  return `https://${u}`;
}
