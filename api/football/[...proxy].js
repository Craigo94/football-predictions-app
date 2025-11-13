// api/football/[...proxy].js

// Node.js serverless function for Vercel
export default async function handler(req, res) {
  const token =
    process.env.FOOTBALL_DATA_TOKEN || process.env.VITE_FOOTBALL_DATA_TOKEN;

  if (!token) {
    console.error("Football API token missing (FOOTBALL_DATA_TOKEN / VITE_FOOTBALL_DATA_TOKEN)");
    res.status(500).json({ error: "Football-Data API token not configured" });
    return;
  }

  // "proxy" comes from the `[...proxy].js` filename
  // e.g. /api/football/competitions/PL/matches
  //  -> req.query.proxy = ["competitions", "PL", "matches"]
  const { proxy = [] } = req.query;
  const pathSegments = Array.isArray(proxy) ? proxy : [proxy];
  const apiPath = pathSegments.join("/"); // "competitions/PL/matches"

  const baseUrl = "https://api.football-data.org/v4";
  const url = new URL(`${baseUrl}/${apiPath}`);

  // Copy all query params *except* "proxy" to the upstream URL
  for (const [key, value] of Object.entries(req.query)) {
    if (key === "proxy") continue;

    if (Array.isArray(value)) {
      value.forEach((v) => url.searchParams.append(key, v));
    } else if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }

  console.log("[Vercel Football proxy] →", url.toString());

  try {
    const upstream = await fetch(url.toString(), {
      headers: {
        "X-Auth-Token": token,
        "Content-Type": "application/json",
      },
    });

    const text = await upstream.text();

    // Try to forward JSON; if not JSON, just return the raw text
    try {
      const json = JSON.parse(text);
      res.status(upstream.status).json(json);
    } catch {
      res.status(upstream.status).send(
        text || `Upstream error (status ${upstream.status})`
      );
    }
  } catch (err) {
    console.error("Error calling Football-Data:", err);
    res.status(500).json({ error: "Error calling Football-Data API" });
  }
}
