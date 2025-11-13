// web/api/football.js
export default async function handler(req, res) {
  const token = process.env.FOOTBALL_DATA_TOKEN;

  if (!token) {
    res.status(500).json({ error: "FOOTBALL_DATA_TOKEN is not set" });
    return;
  }

  try {
    // req.url is like: /api/football/competitions/PL/matches?dateFrom=...
    const url = new URL(req.url, "https://example.com");
    const upstreamPath = url.pathname.replace(/^\/api\/football/, ""); // /competitions/PL/matches
    const upstreamUrl = new URL(
      `https://api.football-data.org/v4${upstreamPath}`
    );
    upstreamUrl.search = url.search; // copy ?query

    const upstreamRes = await fetch(upstreamUrl.toString(), {
      method: req.method,
      headers: {
        "X-Auth-Token": token,
      },
    });

    const body = await upstreamRes.text();

    res.status(upstreamRes.status);
    res.setHeader(
      "Content-Type",
      upstreamRes.headers.get("content-type") || "application/json"
    );
    res.send(body);
  } catch (err) {
    console.error("Error in Vercel football proxy:", err);
    res.status(500).json({ error: "Proxy request failed" });
  }
}
