// web/api/football/[...path].js

export default async function handler(req, res) {
  const API_BASE = "https://api.football-data.org/v4";
  const API_TOKEN = process.env.FOOTBALL_DATA_TOKEN;

  if (!API_TOKEN) {
    return res.status(500).json({ error: "API key missing" });
  }

  // Extract the path after /api/football/
  const upstreamPath = "/" + req.query.path.join("/");
  const url = API_BASE + upstreamPath + (req.url.includes("?") ? req.url.split("?")[1] : "");

  console.log("➡️ Proxying:", url);

  const upstream = await fetch(url, {
    headers: { "X-Auth-Token": API_TOKEN }
  });

  const text = await upstream.text();
  try {
    res.status(upstream.status).json(JSON.parse(text));
  } catch {
    res.status(upstream.status).send(text);
  }
}
