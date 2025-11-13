const API_BASE = "https://api.football-data.org/v4";

export default async function handler(req, res) {
  try {
    const token = process.env.FOOTBALL_DATA_TOKEN;

    if (!token) {
      return res.status(500).json({ error: "Missing Football API token" });
    }

    // Reconstruct upstream URL
    const url = new URL(req.url, `https://${req.headers.host}`);
    const path = url.pathname.replace(/^\/api\/football/, "") || "/";
    const upstream = API_BASE + path + url.search;

    console.log("Proxy ->", upstream);

    const response = await fetch(upstream, {
      headers: { "X-Auth-Token": token },
    });

    const text = await response.text();

    try {
      const json = JSON.parse(text);
      return res.status(response.status).json(json);
    } catch {
      return res.status(response.status).send(text);
    }
  } catch (err) {
    console.error("Proxy error:", err);
    return res.status(500).json({ error: "Proxy crashed" });
  }
}
