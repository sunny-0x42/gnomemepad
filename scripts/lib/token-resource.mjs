/**
 * Gnoswap / Adena token-resource standardization for gnomemepad.
 *
 * Gnoswap does NOT read memepad meta. Logos appear on Gnoswap only after
 * entries land in onbloc/gno-token-resource (grc20/{chain}.json + SVG).
 *
 * This module:
 *  - Builds the canonical GRC20 registry entry (decimals=0, Adena path)
 *  - Generates circular SVG logos from https image or initials
 *  - Diffs our markets vs upstream sapphire-1.json
 *  - Optionally opens a PR via GitHub API (TOKEN_RESOURCE_GITHUB_TOKEN)
 */

const UGNOT_PER_GNOT = 1_000_000;
const DEFAULT_CHAIN = "sapphire-1";
const UPSTREAM_RAW =
  process.env.TOKEN_RESOURCE_UPSTREAM_RAW ||
  "https://raw.githubusercontent.com/onbloc/gno-token-resource/main";
const UPSTREAM_REPO =
  process.env.TOKEN_RESOURCE_UPSTREAM || "onbloc/gno-token-resource";
const FORK_REPO =
  process.env.TOKEN_RESOURCE_FORK || process.env.GITHUB_REPOSITORY || "";

const WUGNOT_MARKERS = [
  "gno.land/r/gnoland/wugnot.wugnot",
  "gno.land/r/gnoland/wugnot",
  "wugnot",
  "ugnot",
];

function isWugnotKey(s) {
  const t = String(s || "").trim().toLowerCase();
  if (!t) return false;
  return WUGNOT_MARKERS.some(
    (m) => t === m.toLowerCase() || t.endsWith("/wugnot") || t.endsWith(".wugnot"),
  );
}

export function tokenKeyFromPoolPath(poolPath) {
  const s = String(poolPath || "").trim();
  if (!s) return "";
  const parts = s.split(":").filter(Boolean);
  if (parts.length < 2) return "";
  const fee = Number(parts[parts.length - 1]);
  const tokens = Number.isFinite(fee) && fee > 0 ? parts.slice(0, -1) : parts;
  const meme = tokens.find((p) => !isWugnotKey(p));
  return meme || tokens[0] || "";
}

/** Adena / grc20reg / Gnoswap key: packagePath.SYMBOL (never .seq). */
export function adenaTokenKey(m) {
  if (!m) return "";
  const fromPool = tokenKeyFromPoolPath(m.gnoswapPoolPath);
  if (fromPool) return fromPool;

  const sym = String(m.symbol || "").trim();
  const tid = String(m.tokenId || m.TokenID || m.tokenPath || "").trim();

  if (tid && sym) {
    const esc = sym.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`\\.${esc}\\.\\d+$`);
    if (re.test(tid)) return tid.replace(re, `.${sym}`);
    if (tid.endsWith(`.${sym}`)) return tid;
  }
  if (tid && /\.\d+$/.test(tid)) {
    const stripped = tid.replace(/\.\d+$/, "");
    if (stripped.includes(".")) return stripped;
  }
  const pkg = String(m.pkg || "").trim();
  if (pkg && sym) return `${pkg}.${sym}`;
  if (tid) return tid.replace(/\.\d+$/, "");
  return pkg;
}

/** Stable SVG filename under grc20/images/ */
export function imageFileName(m) {
  const path = adenaTokenKey(m) || String(m?.symbol || "token");
  const slug = path
    .replace(/^gno\.land\//, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  return `${slug || "token"}.svg`;
}

export function resolveImageUrl(m, meta = null) {
  const cands = [
    meta?.imageURI,
    meta?.image,
    meta?.imageUrl,
    m?.imageURI,
    m?.uri,
    m?.image,
    m?.logoURI,
  ];
  for (const c of cands) {
    const s = String(c || "").trim();
    if (/^https?:\/\//i.test(s) || s.startsWith("ipfs://")) {
      return s.startsWith("ipfs://")
        ? `https://ipfs.io/ipfs/${s.slice("ipfs://".length)}`
        : s;
    }
  }
  return "";
}

/**
 * Canonical onbloc/gno-token-resource GRC20 entry.
 * Only schema fields — no private helpers.
 */
export function buildRegistryEntry(m, meta = null, opts = {}) {
  const chainId = opts.chainId || process.env.CHAIN_ID || DEFAULT_CHAIN;
  const path = adenaTokenKey(m);
  const sym = String(m?.symbol || "").trim().toUpperCase() || "TOKEN";
  const name = String(m?.name || sym).trim();
  const pkgPath = String(m?.pkg || path.replace(/\.[^.]+$/, "")).trim();
  const svg = imageFileName(m);
  const website =
    String(meta?.website || meta?.websiteURI || opts.website || "").trim() ||
    process.env.PUBLIC_APP_URL ||
    "https://gnomemepad-sapphire.netlify.app";
  const twitter = String(meta?.twitter || "").trim();
  const desc = String(
    meta?.description || m?.description || `${name} ($${sym}) launched on gnomemepad.`,
  ).slice(0, 1500);

  return {
    name,
    token_path: path,
    pkg_path: pkgPath,
    symbol: sym,
    decimals: 0, // pad GRC20 whole-token units
    chain_id: chainId,
    description: desc,
    website_url: website.startsWith("http") ? website : "",
    twitter_url: twitter
      ? twitter.startsWith("http")
        ? twitter
        : `https://x.com/${twitter.replace(/^@/, "")}`
      : "",
    discord_url: "",
    docs_url: "",
    image: `/grc20/images/${svg}`,
  };
}

function escapeXml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function hashHue(seed) {
  let h = 0;
  for (const ch of String(seed || "t")) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 360;
}

/** Initial-letter fallback SVG (no network). */
export function svgFromInitials(symbol, name = "") {
  const sym = String(symbol || "?").toUpperCase().slice(0, 4) || "?";
  const hue = hashHue(sym + name);
  const bg = `hsl(${hue} 55% 42%)`;
  const bg2 = `hsl(${(hue + 40) % 360} 50% 28%)`;
  const label = escapeXml(sym.length > 3 ? sym.slice(0, 3) : sym);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128" role="img" aria-label="${label}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${bg}"/>
      <stop offset="100%" stop-color="${bg2}"/>
    </linearGradient>
  </defs>
  <circle cx="64" cy="64" r="64" fill="url(#g)"/>
  <text x="64" y="64" text-anchor="middle" dominant-baseline="central"
    font-family="system-ui,Segoe UI,sans-serif" font-size="${sym.length > 3 ? 28 : 36}"
    font-weight="700" fill="#fff">${label}</text>
</svg>
`;
}

/** Circular SVG with embedded raster (or initials fallback). */
export async function svgForMarket(m, meta = null, opts = {}) {
  const sym = String(m?.symbol || "T").toUpperCase();
  const name = String(m?.name || sym);
  const imageUrl = resolveImageUrl(m, meta);
  if (!imageUrl || opts.forceInitials) {
    return { svg: svgFromInitials(sym, name), source: "initials", imageUrl: "" };
  }
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs || 10_000);
    const res = await fetch(imageUrl, {
      signal: ctrl.signal,
      headers: { Accept: "image/*,*/*" },
      redirect: "follow",
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`image HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 32 || buf.length > 2_500_000) throw new Error("image size");
    const ct = String(res.headers.get("content-type") || "").split(";")[0].trim();
    let mime = "image/jpeg";
    if (ct.startsWith("image/")) mime = ct;
    else if (/\.png(\?|$)/i.test(imageUrl)) mime = "image/png";
    else if (/\.webp(\?|$)/i.test(imageUrl)) mime = "image/webp";
    else if (/\.gif(\?|$)/i.test(imageUrl)) mime = "image/gif";
    else if (/\.svg(\?|$)/i.test(imageUrl)) mime = "image/svg+xml";
    const b64 = buf.toString("base64");
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128" role="img" aria-label="${escapeXml(sym)}">
  <defs><clipPath id="c"><circle cx="64" cy="64" r="64"/></clipPath></defs>
  <circle cx="64" cy="64" r="64" fill="#11141c"/>
  <image href="data:${mime};base64,${b64}" x="0" y="0" width="128" height="128" clip-path="url(#c)" preserveAspectRatio="xMidYMid slice"/>
</svg>
`;
    return { svg, source: "image", imageUrl };
  } catch {
    return { svg: svgFromInitials(sym, name), source: "initials_fallback", imageUrl };
  }
}

/** Fetch upstream GRC20 chain registry. */
export async function fetchUpstreamRegistry(chainId = DEFAULT_CHAIN) {
  const url = `${UPSTREAM_RAW}/grc20/${chainId}.json`;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12_000);
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json" } });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`upstream HTTP ${res.status}`);
    const body = await res.json();
    return Array.isArray(body) ? body : [];
  } catch {
    return [];
  }
}

export function upstreamPathSet(rows) {
  const set = new Set();
  for (const r of rows || []) {
    const p = String(r?.token_path || "").trim();
    if (p) set.add(p);
  }
  return set;
}

/**
 * Build full registration plan for markets.
 * @param {object[]} markets
 * @param {Record<string, object|null>} metaByKey key = pkg|id
 */
export async function buildRegistrationPlan(markets, metaByKey = {}, opts = {}) {
  const chainId = opts.chainId || process.env.CHAIN_ID || DEFAULT_CHAIN;
  const upstream = opts.upstream || (await fetchUpstreamRegistry(chainId));
  const registered = upstreamPathSet(upstream);
  const items = [];

  for (const m of markets || []) {
    if (!m || m.error || !m.id || !m.symbol) continue;
    // Register all launches (not only listed) so Adena/Gnoswap can resolve logos early
    const meta = metaByKey[`${m.pkg}|${m.id}`] || null;
    const entry = buildRegistryEntry(m, meta, { chainId });
    if (!entry.token_path) continue;
    const imageUrl = resolveImageUrl(m, meta);
    const onUpstream = registered.has(entry.token_path);
    const upRow = onUpstream
      ? (upstream || []).find((r) => r.token_path === entry.token_path)
      : null;
    const hasLogo = !!(upRow && String(upRow.image || "").trim());
    items.push({
      id: m.id,
      pkg: m.pkg,
      symbol: entry.symbol,
      name: entry.name,
      token_path: entry.token_path,
      entry,
      imageUrl,
      imageFile: imageFileName(m),
      gnoswapListed: !!m.gnoswapListed,
      status: onUpstream ? (hasLogo ? "registered" : "registered_no_image") : "missing",
      needsPr: !onUpstream || !hasLogo,
    });
  }

  const missing = items.filter((x) => x.needsPr);
  return {
    chainId,
    upstreamRepo: UPSTREAM_REPO,
    upstreamCount: upstream.length,
    total: items.length,
    missing: missing.length,
    registered: items.filter((x) => x.status === "registered").length,
    items,
    missingItems: missing,
  };
}

/**
 * Open / update a PR on gno-token-resource with missing entries.
 * Requires TOKEN_RESOURCE_GITHUB_TOKEN with repo access to fork + PR.
 */
export async function syncTokenResourcePr(plan, opts = {}) {
  const token =
    opts.token ||
    process.env.TOKEN_RESOURCE_GITHUB_TOKEN ||
    process.env.GITHUB_TOKEN ||
    "";
  if (!token) {
    return {
      ok: false,
      error: "TOKEN_RESOURCE_GITHUB_TOKEN (or GITHUB_TOKEN) not set",
      planSummary: summarizePlan(plan),
    };
  }

  const fork =
    opts.fork ||
    FORK_REPO ||
    process.env.TOKEN_RESOURCE_FORK ||
    "";
  if (!fork || !fork.includes("/")) {
    return {
      ok: false,
      error: "TOKEN_RESOURCE_FORK required (e.g. sunny-0x42/gno-token-resource)",
      planSummary: summarizePlan(plan),
    };
  }

  const chainId = plan.chainId || DEFAULT_CHAIN;
  const missing = plan.missingItems || plan.items?.filter((x) => x.needsPr) || [];
  if (!missing.length) {
    return { ok: true, skipped: true, message: "All tokens already registered with logos", planSummary: summarizePlan(plan) };
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "gnomemepad-token-resource-sync",
  };

  // Ensure fork exists
  let forkFull = fork;
  try {
    const fr = await fetch(`https://api.github.com/repos/${fork}`, { headers });
    if (fr.status === 404) {
      const create = await fetch(`https://api.github.com/repos/${UPSTREAM_REPO}/forks`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ default_branch_only: true }),
      });
      if (!create.ok) {
        const t = await create.text();
        return { ok: false, error: `fork failed: ${create.status} ${t.slice(0, 200)}` };
      }
      const body = await create.json();
      forkFull = body.full_name || fork;
      // GitHub fork is async
      await sleep(4000);
    }
  } catch (e) {
    return { ok: false, error: `fork check: ${e.message || e}` };
  }

  // Get base SHA of fork main
  const refRes = await fetch(`https://api.github.com/repos/${forkFull}/git/ref/heads/main`, {
    headers,
  });
  if (!refRes.ok) {
    // try master
    const ref2 = await fetch(`https://api.github.com/repos/${forkFull}/git/ref/heads/master`, {
      headers,
    });
    if (!ref2.ok) {
      return { ok: false, error: `cannot read fork default branch: ${refRes.status}` };
    }
  }
  const branchName = refRes.ok ? "main" : "master";
  const refData = await (refRes.ok ? refRes : fetch(`https://api.github.com/repos/${forkFull}/git/ref/heads/master`, { headers })).then((r) => r.json());
  const baseSha = refData?.object?.sha;
  if (!baseSha) return { ok: false, error: "no base sha" };

  // Sync fork with upstream (best-effort)
  try {
    await fetch(`https://api.github.com/repos/${forkFull}/merge-upstream`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ branch: branchName }),
    });
  } catch {
    /* optional */
  }

  // Load current chain json from upstream raw (authoritative)
  let chainJson = await fetchUpstreamRegistry(chainId);
  if (!Array.isArray(chainJson)) chainJson = [];

  const branch = `gnomemepad-tokens-${Date.now().toString(36)}`;
  const createRef = await fetch(`https://api.github.com/repos/${forkFull}/git/refs`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseSha }),
  });
  if (!createRef.ok) {
    const t = await createRef.text();
    return { ok: false, error: `create branch: ${createRef.status} ${t.slice(0, 200)}` };
  }

  const committed = [];
  for (const item of missing.slice(0, 20)) {
    const { svg } = await svgForMarket(
      { symbol: item.symbol, name: item.name, pkg: item.pkg, id: item.id, uri: item.imageUrl, gnoswapPoolPath: "", tokenId: item.token_path },
      { imageURI: item.imageUrl },
    );
    const imgPath = `grc20/images/${item.imageFile}`;
    const putImg = await putFile(forkFull, branch, imgPath, svg, `Add logo ${item.symbol}`, headers);
    if (!putImg.ok) {
      return { ok: false, error: `put ${imgPath}: ${putImg.error}`, committed };
    }
    // Upsert entry
    const idx = chainJson.findIndex((r) => r.token_path === item.token_path);
    if (idx >= 0) chainJson[idx] = { ...chainJson[idx], ...item.entry };
    else chainJson.push(item.entry);
    committed.push(item.token_path);
  }

  const jsonPath = `grc20/${chainId}.json`;
  const putJson = await putFile(
    forkFull,
    branch,
    jsonPath,
    JSON.stringify(chainJson, null, 2) + "\n",
    `Register gnomemepad tokens on ${chainId}`,
    headers,
  );
  if (!putJson.ok) {
    return { ok: false, error: `put ${jsonPath}: ${putJson.error}`, committed };
  }

  // Open PR
  const title = `feat(grc20): register gnomemepad tokens (${committed.length})`;
  const body = [
    `## gnomemepad auto-register`,
    ``,
    `Adds GRC20 metadata + SVG logos for tokens launched on [gnomemepad](https://gnomemepad-sapphire.netlify.app) so Gnoswap/Adena can display icons.`,
    ``,
    `### Tokens`,
    ...committed.map((p) => `- \`${p}\``),
    ``,
    `### Spec`,
    `- \`decimals: 0\` (pad whole-token GRC20)`,
    `- \`token_path\`: Adena key \`packagePath.SYMBOL\` (no \`.seq\`)`,
    `- SVG logos under \`grc20/images/\``,
    ``,
    `Automated by gnomemepad token-resource sync.`,
  ].join("\n");

  const prRes = await fetch(`https://api.github.com/repos/${UPSTREAM_REPO}/pulls`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      title,
      head: `${forkFull.split("/")[0]}:${branch}`,
      base: "main",
      body,
      maintainer_can_modify: true,
    }),
  });
  const prText = await prRes.text();
  let pr;
  try {
    pr = JSON.parse(prText);
  } catch {
    pr = { raw: prText.slice(0, 300) };
  }
  if (!prRes.ok) {
    // base might be master
    if (prRes.status === 422) {
      const pr2 = await fetch(`https://api.github.com/repos/${UPSTREAM_REPO}/pulls`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          head: `${forkFull.split("/")[0]}:${branch}`,
          base: "master",
          body,
          maintainer_can_modify: true,
        }),
      });
      const pr2j = await pr2.json().catch(() => ({}));
      if (pr2.ok) {
        return {
          ok: true,
          prUrl: pr2j.html_url,
          prNumber: pr2j.number,
          branch,
          fork: forkFull,
          committed,
          planSummary: summarizePlan(plan),
        };
      }
    }
    return {
      ok: false,
      error: `open PR: ${prRes.status} ${prText.slice(0, 300)}`,
      branch,
      fork: forkFull,
      committed,
    };
  }

  return {
    ok: true,
    prUrl: pr.html_url,
    prNumber: pr.number,
    branch,
    fork: forkFull,
    committed,
    planSummary: summarizePlan(plan),
  };
}

function summarizePlan(plan) {
  return {
    total: plan?.total ?? 0,
    missing: plan?.missing ?? 0,
    registered: plan?.registered ?? 0,
    chainId: plan?.chainId,
  };
}

async function putFile(repo, branch, path, content, message, headers) {
  // Get existing sha if any
  let sha;
  const getRes = await fetch(
    `https://api.github.com/repos/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`,
    { headers },
  );
  if (getRes.ok) {
    const j = await getRes.json();
    sha = j.sha;
  }
  const body = {
    message,
    content: Buffer.from(content, "utf8").toString("base64"),
    branch,
  };
  if (sha) body.sha = sha;
  const putRes = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!putRes.ok) {
    const t = await putRes.text();
    return { ok: false, error: `${putRes.status} ${t.slice(0, 200)}` };
  }
  return { ok: true };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export const TOKEN_RESOURCE_SPEC = {
  decimals: 0,
  imageFormat: "svg",
  imageDir: "grc20/images",
  chainFile: `grc20/{chainId}.json`,
  tokenPath: "packagePath.SYMBOL (Adena / grc20reg key, never Token.ID .seq)",
  upstream: UPSTREAM_REPO,
  note: "Gnoswap/Adena logos load only after merge into gno-token-resource",
};
