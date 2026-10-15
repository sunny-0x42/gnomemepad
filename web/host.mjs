/**
 * Production host for a VPS: static UI (web/ui/dist) plus /api.
 * Same chain-api as Netlify. No gnokey and no signing on this process.
 *
 * Env is applied before chain-api loads. Override any value in the environment.
 *   node web/host.mjs
 */
process.env.DEFAULT_NETWORK = process.env.DEFAULT_NETWORK || "mainnet";
process.env.MAINNET_PAD_READY = process.env.MAINNET_PAD_READY || "1";
process.env.SHOW_PEARL = process.env.SHOW_PEARL || "0";
process.env.SHOW_TESTNETS = process.env.SHOW_TESTNETS || "0";
process.env.SHOW_LOCAL = process.env.SHOW_LOCAL || "0";
if (!process.env.SNAPSHOT_NETWORKS) process.env.SNAPSHOT_NETWORKS = "mainnet";
process.env.MAINNET_RPC_URL =
  process.env.MAINNET_RPC_URL || "https://rpc.onbloc.xyz:443";
process.env.MAINNET_CHAIN_ID = process.env.MAINNET_CHAIN_ID || "gnoland-1";
process.env.MAINNET_GNOWEB = process.env.MAINNET_GNOWEB || "https://gno.land";
process.env.MAINNET_PKG =
  process.env.MAINNET_PKG ||
  "gno.land/r/g1n4pl5uc4yt5r96m9w6fmdznx3x0jyg8l6arhmt/gnomi/padv3";
process.env.MAINNET_HUB =
  process.env.MAINNET_HUB ||
  "gno.land/r/g1n4pl5uc4yt5r96m9w6fmdznx3x0jyg8l6arhmt/gnomi/hubv2";
process.env.MAINNET_PROFILE =
  process.env.MAINNET_PROFILE ||
  "gno.land/r/g1n4pl5uc4yt5r96m9w6fmdznx3x0jyg8l6arhmt/gnomi/profile";
process.env.MAINNET_META =
  process.env.MAINNET_META ||
  "gno.land/r/g1n4pl5uc4yt5r96m9w6fmdznx3x0jyg8l6arhmt/gnomi/meta";
process.env.MAINNET_POINTS =
  process.env.MAINNET_POINTS ||
  "gno.land/r/g1n4pl5uc4yt5r96m9w6fmdznx3x0jyg8l6arhmt/gnomi/pointsv2";
process.env.MAINNET_BOND =
  process.env.MAINNET_BOND ||
  "gno.land/r/g1n4pl5uc4yt5r96m9w6fmdznx3x0jyg8l6arhmt/gnomi/bond";
process.env.MAINNET_SIGNER =
  process.env.MAINNET_SIGNER || "g1n4pl5uc4yt5r96m9w6fmdznx3x0jyg8l6arhmt";
process.env.RPC_URL = process.env.RPC_URL || process.env.MAINNET_RPC_URL;
process.env.CHAIN_ID = process.env.CHAIN_ID || process.env.MAINNET_CHAIN_ID;
process.env.PKG = process.env.PKG || process.env.MAINNET_PKG;
process.env.HUB = process.env.HUB || process.env.MAINNET_HUB;
process.env.PROFILE = process.env.PROFILE || process.env.MAINNET_PROFILE;
process.env.META = process.env.META || process.env.MAINNET_META;
process.env.POINTS = process.env.POINTS || process.env.MAINNET_POINTS;
process.env.BOND = process.env.BOND || process.env.MAINNET_BOND;
process.env.SIGNER_ADDR = process.env.SIGNER_ADDR || process.env.MAINNET_SIGNER;
// VPS host. Empty or unset becomes full metrics. Explicit "0" stays off (Netlify).
if (process.env.FULL_METRICS == null || process.env.FULL_METRICS === "") {
  process.env.FULL_METRICS = "1";
}

import http from "node:http";
import fs from "node:fs";
import zlib from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { buildNetworkMarketsPayload, handleApi } = await import("./lib/chain-api.mjs");
const { startMarketsSnapshotWorker } = await import("./lib/markets-snapshot.mjs");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, "ui", "dist");
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "127.0.0.1";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

function safeFile(urlPath) {
  let rel = decodeURIComponent(String(urlPath || "/").split("?")[0]);
  if (rel.includes("\0")) return null;
  rel = rel.replace(/^\/+/, "");
  const full = path.resolve(DIST, rel);
  if (full !== DIST && !full.startsWith(DIST + path.sep)) return null;
  return full;
}

const GZIP_EXT = new Set([".html", ".js", ".css", ".json", ".svg", ".txt", ".webmanifest"]);
const GZIP_MIN = 860;

function acceptsGzip(req) {
  return /\bgzip\b/i.test(String(req.headers["accept-encoding"] || ""));
}

function endMaybeGzip(req, res, status, headers, body) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body ?? "", "utf8");
  const type = String(headers["Content-Type"] || headers["content-type"] || "");
  const compressible = /json|javascript|css|text|svg|xml|manifest/i.test(type);
  if (!compressible || buf.length < GZIP_MIN || !acceptsGzip(req)) {
    res.writeHead(status, headers);
    res.end(buf);
    return;
  }
  zlib.gzip(buf, (err, gz) => {
    if (err || !gz || gz.length >= buf.length) {
      if (!res.headersSent) res.writeHead(status, headers);
      res.end(buf);
      return;
    }
    res.writeHead(status, {
      ...headers,
      "Content-Encoding": "gzip",
      Vary: "Accept-Encoding",
      "Content-Length": gz.length,
    });
    res.end(gz);
  });
}

function sendFile(req, res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const cache =
    ext === ".html"
      ? "no-cache"
      : filePath.includes(`${path.sep}assets${path.sep}`)
        ? "public, max-age=31536000, immutable"
        : "public, max-age=3600";
  const headers = {
    "Content-Type": MIME[ext] || "application/octet-stream",
    "Cache-Control": cache,
    "X-Content-Type-Options": "nosniff",
  };
  if (!GZIP_EXT.has(ext) || !acceptsGzip(req)) {
    res.writeHead(200, headers);
    fs.createReadStream(filePath).pipe(res);
    return;
  }
  fs.readFile(filePath, (err, buf) => {
    if (err) {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      }
      res.end("read failed");
      return;
    }
    endMaybeGzip(req, res, 200, headers, buf);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      let body = null;
      if (req.method === "POST" || req.method === "PUT" || req.method === "PATCH") {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        body = Buffer.concat(chunks).toString("utf8");
      }
      const out = await handleApi(
        req.method || "GET",
        url.pathname,
        url.searchParams,
        body,
        req.headers || {},
      );
      if (out.multiValueHeaders?.["Set-Cookie"]) {
        res.setHeader("Set-Cookie", out.multiValueHeaders["Set-Cookie"]);
      }
      endMaybeGzip(req, res, out.statusCode || 200, out.headers || {}, out.body ?? "");
      return;
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("method not allowed");
      return;
    }

    const wanted = safeFile(url.pathname);
    let filePath = wanted;
    if (!filePath || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      if (url.pathname.startsWith("/assets/")) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("not found");
        return;
      }
      filePath = path.join(DIST, "index.html");
    }
    if (req.method === "HEAD") {
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
      res.end();
      return;
    }
    sendFile(req, res, filePath);
  } catch (e) {
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    }
    res.end(JSON.stringify({ error: String(e.message || e) }));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`gnomi.fun host http://${HOST}:${PORT}`);
  console.log(`ui ${DIST}`);
  console.log(`network ${process.env.DEFAULT_NETWORK} pkg ${process.env.PKG}`);
  const nets = String(process.env.SNAPSHOT_NETWORKS || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s && s !== "off");
  if (nets.length) {
    startMarketsSnapshotWorker({
      networkIds: nets,
      intervalMs: Number(process.env.MARKETS_SNAP_INTERVAL_MS || 60_000),
      buildFn: (id) =>
        buildNetworkMarketsPayload(id, {
          // Homepage serves this snapshot. Enrich stays off the request path.
          lite: process.env.FULL_METRICS === "1" ? false : true,
          tradeStats: true,
          writeSnapshot: true,
          force: true,
        }),
    });
  }
});
