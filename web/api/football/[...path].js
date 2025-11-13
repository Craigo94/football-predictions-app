export default async function handler(req, res) {
  const API_BASE = "https://api.football-data.org/v4";
  const API_TOKEN = process.env.FOOTBALL_DATA_TOKEN;

  if (!API_TOKEN) {
    return res.status(500).json({ error: "Missing FOOTBALL_DATA_TOKEN" });
  }

  try {
    // Build full proxied URL
    const url = new URL(req.url, `http://${req.headers.host}`);
    const upstreamPath = url.pathname.replace(/^\/api\/football/, "");
    const upstreamUrl = API_BASE + upstreamPath + url.search;

    console.log("[Proxy → Football API]", upstreamUrl);

    const upstreamRes = await fetch(upstreamUrl, {
      headers: { "X-Auth-Token": API_TOKEN }
    });

    const body = await upstreamRes.text();

    try {
      return res.status(upstreamRes.status).json(JSON.parse(body));
    } catch {
      return res.status(upstreamRes.status).send(body);
    }

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Proxy failed", details: err.message });
  }
}
