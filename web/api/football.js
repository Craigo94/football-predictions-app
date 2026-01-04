// web/api/football.js

const API_BASE = "https://api.football-data.org/v4";
const CACHE_TTL_MS = 60 * 1000;

const cache = new Map();

/**
 * Vercel Node.js Function
 * Route: /api/football   (plus rewrites for /api/football/... -> see vercel.json)
 */
export default async function handler(request, response) {
  try {
    const token = process.env.FOOTBALL_DATA_TOKEN;

    if (!token) {
      console.error("FOOTBALL_DATA_TOKEN is not set in Vercel env");
      return response
        .status(500)
        .json({ error: "Missing Football API token on the server" });
    }

    response.setHeader(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, max-age=0"
    );

    // Full URL that the function was called with (after rewrite)
    const url = new URL(request.url, `https://${request.headers.host}`);

    // From rewrite: /api/football/(.*) -> /api/football?path=$1
    const rawPath = (request.query?.path || "").toString();

    // Normalise path so we end up with e.g. "/competitions/PL/matches"
    const upstreamPath = rawPath
      ? rawPath.startsWith("/") ? rawPath : `/${rawPath}`
      : "/";

    // Keep the original query parameters (dateFrom, status, etc.) but drop
    // the internal `path` parameter used by the rewrite, otherwise the
    // upstream API receives `?path=competitions/PL/matches` and rejects the
    // request.
    const params = new URLSearchParams(url.searchParams);
    params.delete("path");

    const search = params.toString();
    const upstreamUrl = search
      ? `${API_BASE}${upstreamPath}?${search}`
      : `${API_BASE}${upstreamPath}`;
    const cacheKey = `${upstreamPath}${search ? `?${search}` : ""}`;
    const cached = cache.get(cacheKey);

    if (cached && cached.expiresAt > Date.now()) {
      console.log(`[Football proxy][cache hit] ${cacheKey}`);
      return response.status(cached.status).json(cached.body);
    }

    console.log(`[Football proxy][cache miss] ${cacheKey}`);
    console.log("[Football proxy] →", upstreamUrl);

    const upstreamRes = await fetch(upstreamUrl, {
      headers: {
        "X-Auth-Token": token,
      },
    });

    const text = await upstreamRes.text();

    // Try JSON first
    try {
      const json = JSON.parse(text);
      cache.set(cacheKey, {
        body: json,
        status: upstreamRes.status,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });
      return response.status(upstreamRes.status).json(json);
    } catch {
      // Fallback: plain text/HTML (for debugging)
      cache.set(cacheKey, {
        body: text,
        status: upstreamRes.status,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });
      return response
        .status(upstreamRes.status)
        .send(text);
    }
  } catch (err) {
    console.error("Proxy error:", err);
    return response
      .status(500)
      .json({ error: "Internal proxy error" });
  }
}
