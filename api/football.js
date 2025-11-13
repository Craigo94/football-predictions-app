// api/football.js

export default async function handler(req, res) {
  const realUrl = req.url.replace('/api/football', '');

  const target = `https://api.football-data.org/v4${realUrl}`;

  try {
    const response = await fetch(target, {
      headers: {
        "X-Auth-Token": process.env.FOOTBALL_DATA_TOKEN
      }
    });

    const text = await response.text();
    res.status(response.status).send(text);

  } catch (err) {
    res.status(500).json({ error: "Proxy error", message: String(err) });
  }
}
