/**
 * OG HTML for social crawlers: /.netlify/functions/og?id=&pkg=
 */
import { handleApi } from "../../lib/chain-api.mjs";

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function handler(event) {
  const q = event.queryStringParameters || {};
  const id = q.id || "";
  const pkg = q.pkg || "";
  const site =
    process.env.URL || process.env.DEPLOY_PRIME_URL || "https://gnomemepad-sapphire.netlify.app";

  let title = "Gnomi.fun";
  let desc = "Fair meme launches on Gno.land — bonding curve, graduate to Gnoswap.";
  let tokenUrl = site;
  let image = "";

  if (id) {
    try {
      const path = `/api/market/${encodeURIComponent(id)}`;
      const query = new URLSearchParams();
      if (pkg) query.set("pkg", pkg);
      const res = await handleApi("GET", path, query, null);
      const body = typeof res.body === "string" ? JSON.parse(res.body) : res.body;
      if (body && !body.error && body.symbol) {
        const pct = body.progressPct || 0;
        title = `$${body.symbol} · ${pct}% · Gnomi.fun`;
        desc = `${body.name || body.symbol} — ${pct}% to graduate on Gnomi.fun. Raised ${body.raisedGnot ?? "—"} GNOT.`;
        tokenUrl = `${site}/token/${encodeURIComponent(id)}${pkg ? `?pkg=${encodeURIComponent(pkg)}` : ""}`;
        // Prefer meta image, then launch uri
        try {
          const mq = new URLSearchParams({ id, pkg: body.pkg || pkg || "" });
          const mr = await handleApi("GET", "/api/meta", mq, null);
          const mb = typeof mr.body === "string" ? JSON.parse(mr.body) : mr.body;
          const uri = String(mb?.meta?.imageURI || body.uri || "").trim();
          if (uri.startsWith("ipfs://")) {
            image = `https://ipfs.io/ipfs/${uri.slice(7)}`;
          } else if (/^https?:\/\//i.test(uri)) {
            image = uri;
          }
        } catch {
          if (body.uri && /^https?:\/\//i.test(body.uri)) image = body.uri;
        }
      }
    } catch {
      /* fallback */
    }
  }

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(desc)}"/>
  <meta property="og:title" content="${esc(title)}"/>
  <meta property="og:description" content="${esc(desc)}"/>
  <meta property="og:type" content="website"/>
  <meta property="og:url" content="${esc(tokenUrl)}"/>
  ${image ? `<meta property="og:image" content="${esc(image)}"/>` : ""}
  <meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}"/>
  <meta name="twitter:title" content="${esc(title)}"/>
  <meta name="twitter:description" content="${esc(desc)}"/>
  ${image ? `<meta name="twitter:image" content="${esc(image)}"/>` : ""}
  <meta http-equiv="refresh" content="0;url=${esc(tokenUrl)}"/>
</head>
<body>
  <p><a href="${esc(tokenUrl)}">${esc(title)}</a></p>
  <p>${esc(desc)}</p>
</body>
</html>`;

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=60",
    },
    body: html,
  };
}
