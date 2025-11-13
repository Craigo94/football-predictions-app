export default async function handler(req, res) {
  const API_BASE = "https://api.football-data.org/v4";
  const API_TOKEN = process.env.FOOTBALL_DATA_TOKEN;

  if (!API_TOKEN) {
    return res.status(500).json({ error: "API key missing" });
  }

  const dynamicPath = req.query.path.join("/");

  const qs = req.url.includes("?") ? "?" + req.url.split("?")[1] : "";
  const upstreamUrl = `${API_BASE}/${dynamicPath}${qs}`;

  console.log("➡️ Proxy:", upstreamUrl);

  try {
    const upstreamRes = await fetch(upstreamUrl, {
      headers: { "X-Auth-Token": API_TOKEN },
    });

    const text = await upstreamRes.text();

    try {
      const json = JSON.parse(text);
      return res.status(upstreamRes.status).json(json);
    } catch {
      return res.status(upstreamRes.status).send(text);
    }
  } catch (err) {
    return res.status(500).json({ error: "Internal proxy error" });
  }
}
