#!/usr/bin/env node
/**
 * Sync gnomemepad tokens → onbloc/gno-token-resource (open PR).
 *
 * Modes:
 *   1) Remote API (Netlify has TOKEN_RESOURCE_GITHUB_TOKEN):
 *        node scripts/sync-token-resource.mjs --remote
 *   2) Local PR (recommended for GitHub Actions):
 *        node scripts/sync-token-resource.mjs
 *      Uses public /api/token-resource plan + GITHUB_TOKEN to open PR.
 *
 * Env:
 *   API_BASE                     default https://gnomemepad-sapphire.netlify.app
 *   TOKEN_RESOURCE_GITHUB_TOKEN | GITHUB_TOKEN
 *   TOKEN_RESOURCE_FORK          e.g. sunny-0x42/gno-token-resource
 *   TOKEN_RESOURCE_SYNC_SECRET   if remote API is protected
 */

// Public copy (web/lib is private/gitignored — CI must not import it)
import {
  buildRegistrationPlan,
  syncTokenResourcePr,
} from "./lib/token-resource.mjs";

const API_BASE = (
  process.env.API_BASE ||
  process.env.PUBLIC_APP_URL ||
  "https://gnomemepad-sapphire.netlify.app"
).replace(/\/$/, "");

const dry =
  process.argv.includes("--dry") ||
  process.argv.includes("--dry-run") ||
  process.env.DRY_RUN === "1";
const remote = process.argv.includes("--remote");
const secret = process.env.TOKEN_RESOURCE_SYNC_SECRET || "";

async function fetchJson(url) {
  const res = await fetch(url);
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 400) };
  }
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status} ${url}`);
    err.body = body;
    throw err;
  }
  return body;
}

async function runRemote() {
  const qs = new URLSearchParams();
  if (dry) qs.set("dry", "1");
  if (secret) qs.set("secret", secret);
  const url = `${API_BASE}/api/token-resource/sync?${qs}`;
  console.log("→ remote", url.replace(secret, secret ? "***" : ""));
  const res = await fetch(url, { method: dry ? "GET" : "POST" });
  const body = await res.json().catch(async () => ({ raw: await res.text() }));
  console.log(JSON.stringify(body, null, 2));
  if (!res.ok || body.ok === false) process.exit(1);
}

async function runLocal() {
  console.log("→ fetch plan from", `${API_BASE}/api/token-resource`);
  const plan = await fetchJson(`${API_BASE}/api/token-resource`);
  console.log(
    JSON.stringify(
      {
        total: plan.total,
        missing: plan.missing,
        registered: plan.registered,
        chainId: plan.chainId,
      },
      null,
      2,
    ),
  );

  if (dry) {
    console.log(
      "dry-run missing:",
      (plan.missingItems || []).map((x) => x.token_path),
    );
    return;
  }

  // Prefer re-building plan locally so we have full missingItems + can gen SVG
  const markets = (plan.items || []).map((x) => ({
    id: x.id,
    pkg: x.pkg,
    symbol: x.symbol,
    name: x.name,
    uri: x.imageUrl,
    imageURI: x.imageUrl,
    gnoswapListed: x.gnoswapListed,
    tokenId: x.token_path,
    gnoswapPoolPath: "",
  }));
  const metaByKey = {};
  for (const x of plan.items || []) {
    metaByKey[`${x.pkg}|${x.id}`] = x.imageUrl
      ? { imageURI: x.imageUrl, description: x.entry?.description }
      : null;
  }
  const localPlan = await buildRegistrationPlan(markets, metaByKey, {
    chainId: plan.chainId,
  });
  // Use missing from remote plan entries (imageFile etc.)
  localPlan.missingItems = plan.missingItems || localPlan.missingItems;
  localPlan.missing = localPlan.missingItems.length;

  const result = await syncTokenResourcePr(localPlan);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok && !result.skipped) process.exit(1);
}

async function main() {
  if (remote) await runRemote();
  else await runLocal();
}

main().catch((e) => {
  console.error(e.body || e);
  process.exit(1);
});
