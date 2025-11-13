const API_BASE = "https://api.football-data.org/v4";

export default async function handler(req, res) {
  try {
    const API_TOKEN = process.env.FOOTBALL_DATA_TOKEN;

    if (!API_TOKEN) {
      console.error("FOOTBALL_DATA_TOKEN is not set");
      return res
        .status(500)
        .json({ error: "Football API token not configured" });
    }

    // Build upstream URL
    const url = new URL(req.url, `https://${req.headers.host}`);
    const upstreamPath = url.pathname.replace(/^\/api\/football/, "") || "/";
    const upstreamUrl = API_BASE + upstreamPath + url.search;

    console.log("[Football proxy] ->", upstreamUrl);

    const upstreamRes = await fetch(upstreamUrl, {
      headers: { "X-Auth-Token": API_TOKEN },
    });

    const text = await upstreamRes.text();

    // Try to return JSON; fall back to plain text
    try {
      const json = JSON.parse(text);
      res.status(upstreamRes.status).json(json);
    } catch {
      console.error("Upstream returned non-JSON:", text);
      res
        .status(upstreamRes.status)
        .send(text || "Upstream returned non-JSON response");
    }
  } catch (err) {
    console.error("Proxy error:", err);
    res.status(500).json({ error: "Internal proxy error" });
  }
}
