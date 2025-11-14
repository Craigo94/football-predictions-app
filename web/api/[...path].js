// web/api/football/[...path].js

const API_BASE = "https://api.football-data.org/v4";

export default async function handler(req, res) {
  try {
    const token = process.env.FOOTBALL_DATA_TOKEN;

    if (!token) {
      return res.status(500).json({ error: "Missing Football API token" });
    }

    // Example incoming path:
    //   /api/football/competitions/PL/matches?dateFrom=...&dateTo=...&status=SCHEDULED
    const url = new URL(req.url, `https://${req.headers.host}`);

    // Strip "/api/football" from the front
    const upstreamPath = url.pathname.replace(/^\/api\/football/, "") || "/";

    // Build Football-Data URL
    const upstreamUrl = API_BASE + upstreamPath + url.search;

    console.log("[Football proxy] Upstream:", upstreamUrl);

    const upstreamRes = await fetch(upstreamUrl, {
      headers: {
        "X-Auth-Token": token,
      },
    });

    const text = await upstreamRes.text();

    try {
      const json = JSON.parse(text);
      return res.status(upstreamRes.status).json(json);
    } catch {
      // Upstream returned HTML or other non-JSON
      return res.status(upstreamRes.status).send(text);
    }
  } catch (err) {
    console.error("Proxy error:", err);
    return res.status(500).json({ error: "Internal proxy error" });
  }
}
