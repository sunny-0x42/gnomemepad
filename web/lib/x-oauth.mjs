/**
 * X (Twitter) OAuth 2.0 Authorization Code + PKCE for Ambassador verify.
 * Secrets from env only — never commit Client Secret.
 */
import crypto from "node:crypto";

const AUTH_URL = "https://x.com/i/oauth2/authorize";
const TOKEN_URL = "https://api.x.com/2/oauth2/token";
const ME_URL = "https://api.x.com/2/users/me";

const PENDING_TTL_MS = 15 * 60 * 1000;
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;

function b64url(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function xOAuthConfigured() {
  return !!(process.env.X_CLIENT_ID && process.env.X_CLIENT_SECRET);
}

export function xOAuthConfig() {
  const clientId = String(process.env.X_CLIENT_ID || "").trim();
  const clientSecret = String(process.env.X_CLIENT_SECRET || "").trim();
  const redirectUri = String(
    process.env.X_REDIRECT_URI || "https://gnomi.fun/api/auth/x/callback",
  ).trim();
  const scopes = String(process.env.X_OAUTH_SCOPES || "users.read offline.access")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
  return { clientId, clientSecret, redirectUri, scopes };
}

export function createPkcePair() {
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  const state = b64url(crypto.randomBytes(16));
  return { verifier, challenge, state };
}

function sessionHmacKey() {
  return String(process.env.X_CLIENT_SECRET || process.env.X_SESSION_SECRET || "dev-insecure");
}

/** Signed cookie payload — works across Netlify isolates (no server RAM). */
export function createXSession(profile) {
  const body = {
    id: String(profile.id || ""),
    u: String(profile.username || "").replace(/^@/, ""),
    n: String(profile.name || ""),
    exp: Date.now() + SESSION_TTL_MS,
  };
  const payload = b64url(Buffer.from(JSON.stringify(body), "utf8"));
  const sig = b64url(crypto.createHmac("sha256", sessionHmacKey()).update(payload).digest());
  return `${payload}.${sig}`;
}

export function getXSession(token) {
  if (!token || !String(token).includes(".")) return null;
  const [payload, sig] = String(token).split(".");
  if (!payload || !sig) return null;
  const expect = b64url(crypto.createHmac("sha256", sessionHmacKey()).update(payload).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!json?.u || !json?.exp || Date.now() > Number(json.exp)) return null;
    return {
      xUserId: String(json.id || ""),
      username: String(json.u || ""),
      name: String(json.n || ""),
      at: Date.now(),
    };
  } catch {
    return null;
  }
}

export function clearXSession(_sessId) {
  /* signed cookie — clearing is cookie Max-Age=0 */
}

export function buildAuthorizeUrl({ clientId, redirectUri, scopes, state, challenge }) {
  const u = new URL(AUTH_URL);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("scope", scopes);
  u.searchParams.set("state", state);
  u.searchParams.set("code_challenge", challenge);
  u.searchParams.set("code_challenge_method", "S256");
  return u.toString();
}

export async function exchangeCodeForToken({
  clientId,
  clientSecret,
  redirectUri,
  code,
  verifier,
}) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: String(code),
    redirect_uri: redirectUri,
    code_verifier: verifier,
    client_id: clientId,
  });
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basic}`,
    },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`token exchange failed: HTTP ${res.status}`);
  }
  if (!res.ok || !json.access_token) {
    throw new Error(json.error_description || json.error || `token HTTP ${res.status}`);
  }
  return json;
}

export async function fetchXUserMe(accessToken) {
  const url = `${ME_URL}?user.fields=id,name,username,profile_image_url`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(12_000),
  });
  const json = await res.json();
  if (!res.ok || !json?.data?.username) {
    throw new Error(json?.detail || json?.title || `users/me HTTP ${res.status}`);
  }
  return json.data;
}

export function parseCookieHeader(cookieHeader) {
  const out = {};
  for (const part of String(cookieHeader || "").split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function xSessionCookie(sessId, maxAgeSec = 7200) {
  const secure = "Secure; ";
  return `gnomi_x_sess=${encodeURIComponent(sessId)}; Path=/; HttpOnly; ${secure}SameSite=Lax; Max-Age=${maxAgeSec}`;
}

export function clearXSessionCookie() {
  return "gnomi_x_sess=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0";
}

/** PKCE pending cookies — survive Netlify multi-isolate (unlike RAM maps). */
export function xOauthPendingCookies(state, verifier, maxAgeSec = 900) {
  const secure = "Secure; ";
  const base = `Path=/; HttpOnly; ${secure}SameSite=Lax; Max-Age=${maxAgeSec}`;
  return [
    `gnomi_x_oauth_state=${encodeURIComponent(state)}; ${base}`,
    `gnomi_x_oauth_verifier=${encodeURIComponent(verifier)}; ${base}`,
  ];
}

export function clearXOauthPendingCookies() {
  return [
    "gnomi_x_oauth_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
    "gnomi_x_oauth_verifier=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
  ];
}

export function redirectResponse(location, extraHeaders = {}, setCookies = null) {
  const out = {
    statusCode: 302,
    headers: {
      Location: location,
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
    body: "",
  };
  if (Array.isArray(setCookies) && setCookies.length) {
    out.multiValueHeaders = { "Set-Cookie": setCookies };
  } else if (typeof setCookies === "string" && setCookies) {
    out.headers["Set-Cookie"] = setCookies;
  }
  return out;
}
