export default async function handler(req, res) {
  const API_BASE = "https://api.football-data.org/v4";
  const API_TOKEN = process.env.FOOTBALL_DATA_TOKEN;

  if (!API_TOKEN) {
    return res.status(500).json({ error: "Missing API token" });
  }

  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const upstreamPath = url.pathname.replace(/^\/api\/football/, "");
    const upstreamUrl = API_BASE + upstreamPath + url.search;

    const upstreamRes = await fetch(upstreamUrl, {
      headers: { "X-Auth-Token": API_TOKEN },
    });

    const text = await upstreamRes.text();

    try {
      return res.status(upstreamRes.status).json(JSON.parse(text));
    } catch (e) {
      return res.status(upstreamRes.status).send(text);
    }

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
