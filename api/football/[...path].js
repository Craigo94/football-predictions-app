// Football/api/football/[...path].js

export default async function handler(req, res) {
  const url = req.url || "";

  // Strip the /api/football prefix:
  // /api/football/competitions/PL/matches?x=y
  // -> /competitions/PL/matches?x=y
  const upstreamPath = url.replace(/^\/api\/football/, "");

  const targetUrl = "https://api.football-data.org/v4" + upstreamPath;

  try {
    const upstreamResponse = await fetch(targetUrl, {
      headers: {
        "X-Auth-Token": process.env.FOOTBALL_DATA_TOKEN || "",
      },
    });

    const text = await upstreamResponse.text();
    res.status(upstreamResponse.status).send(text);
  } catch (err) {
    res.status(500).json({
      error: "Proxy error",
      message: String(err),
    });
  }
}
