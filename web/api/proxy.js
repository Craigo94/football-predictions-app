// web/api/football/[...proxy].js

const API_BASE = "https://api.football-data.org/v4";
const API_TOKEN = process.env.FOOTBALL_DATA_TOKEN;

module.exports = async (req, res) => {
  try {
    if (!API_TOKEN) {
      console.error("FOOTBALL_DATA_TOKEN is not set");
      return res
        .status(500)
        .json({ error: "Football API token not configured" });
    }

    const url = new URL(req.url, `https://${req.headers.host}`);
    const upstreamPath =
      url.pathname.replace(/^\/api\/football/, "") || "/";
    const upstreamUrl = API_BASE + upstreamPath + url.search;

    console.log("[Football proxy] ->", upstreamUrl);

    const upstreamRes = await fetch(upstreamUrl, {
      headers: { "X-Auth-Token": API_TOKEN },
    });

    const text = await upstreamRes.text();

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
};
