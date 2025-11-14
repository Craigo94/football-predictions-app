// web/api/football.js

const API_BASE = "https://api.football-data.org/v4";

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

    // Full URL that the function was called with (after rewrite)
    const url = new URL(request.url, `https://${request.headers.host}`);

    // From rewrite: /api/football/(.*) -> /api/football?path=$1
    const rawPath = (request.query?.path || "").toString();

    // Normalise path so we end up with e.g. "/competitions/PL/matches"
    const upstreamPath = rawPath
      ? rawPath.startsWith("/") ? rawPath : `/${rawPath}`
      : "/";

    // Keep the original query parameters (dateFrom, status, etc.)
    const search = url.search; // includes ?dateFrom=...&dateTo=...&status=...

    const upstreamUrl = API_BASE + upstreamPath + search;
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
      return response.status(upstreamRes.status).json(json);
    } catch {
      // Fallback: plain text/HTML (for debugging)
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
