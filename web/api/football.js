// web/api/football.js

const API_BASE = "https://api.football-data.org/v4";

export default async function handler(req, res) {
  try {
    const token = process.env.FOOTBALL_DATA_TOKEN;

    if (!token) {
      return res.status(500).json({ error: "Missing Football API token" });
    }

    // Parse the incoming URL
    const url = new URL(req.url, `https://${req.headers.host}`);

    // We expect either:
    //   /api/football?path=/competitions/PL/matches&...
    // or (after Vercel rewrite):
    //   /api/football.js?path=/competitions/PL/matches&...
    const upstreamPath = url.searchParams.get("path") || "/";
    url.searchParams.delete("path");

    // Build upstream Football-Data URL
    const search = url.searchParams.toString();
    const upstreamUrl =
      API_BASE + upstreamPath + (search ? `?${search}` : "");

    console.log("[Football proxy] Upstream:", upstreamUrl);

    const upstreamRes = await fetch(upstreamUrl, {
      headers: { "X-Auth-Token": token },
    });

    const text = await upstreamRes.text();

    try {
      const json = JSON.parse(text);
      return res.status(upstreamRes.status).json(json);
    } catch {
      // Non-JSON (e.g. HTML error from upstream)
      return res.status(upstreamRes.status).send(text);
    }
  } catch (err) {
    console.error("Proxy error:", err);
    return res.status(500).json({ error: "Internal proxy error" });
  }
}
