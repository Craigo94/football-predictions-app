// web/api/football/[...proxy].js

export default async function handler(req, res) {
  try {
    const token = process.env.FOOTBALL_DATA_TOKEN;
    if (!token) {
      res.status(500).json({ error: "Missing FOOTBALL_DATA_TOKEN env var" });
      return;
    }

    // Example req.url:
    //   /api/football/competitions/PL/matches?dateFrom=...&dateTo=...
    const url = req.url || "/api/football";

    // Remove the "/api/football" prefix
    const withoutPrefix = url.replace(/^\/api\/football/, "") || "/";

    // Build the Football-Data.org URL
    const targetUrl = `https://api.football-data.org/v4${withoutPrefix}`;

    console.log("[Proxy] ->", targetUrl);

    const response = await fetch(targetUrl, {
      headers: {
        "X-Auth-Token": token,
      },
    });

    const text = await response.text();

    // Forward status + content-type
    res.status(response.status);
    const contentType = response.headers.get("content-type");
    if (contentType) {
      res.setHeader("content-type", contentType);
    }

    res.send(text);
  } catch (err) {
    console.error("Football proxy error", err);
    res.status(500).json({ error: "Proxy error", message: String(err) });
  }
}
