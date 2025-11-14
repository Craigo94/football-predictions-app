// web/api/[...path].js
const API_BASE = "https://api.football-data.org/v4";

export default async function handler(req, res) {
  try {
    const token = process.env.FOOTBALL_DATA_TOKEN;

    // Build URL from the incoming request
    const url = new URL(req.url, `https://${req.headers.host}`);
    const pathname = url.pathname;

    // -----------------------------
    // HEALTH CHECK ENDPOINT
    // -----------------------------
    if (pathname === "/api/football/health") {
      return res.status(200).json({
        ok: true,
        message: "Football API proxy is running",
        envHasToken: !!token,
        timestamp: new Date().toISOString()
      });
    }

    // -----------------------------
    // ONLY HANDLE /api/football/* ROUTES
    // -----------------------------
    if (!pathname.startsWith("/api/football")) {
      return res.status(404).json({ error: "Not handled by football proxy" });
    }

    if (!token) {
      console.error("❌ FOOTBALL_DATA_TOKEN is missing in environment variables");
      return res.status(500).json({ error: "Missing Football API token" });
    }

    // -----------------------------
    // BUILD UPSTREAM FOOTBALL-DATA URL
    // -----------------------------
    const upstreamPath = pathname.replace("/api/football", "") || "/";
    const upstreamUrl = API_BASE + upstreamPath + url.search;

    console.log("🔁 Proxying →", upstreamUrl);

    // -----------------------------
    // FORWARD REQUEST TO FOOTBALL-DATA API
    // -----------------------------
    const upstreamRes = await fetch(upstreamUrl, {
      method: req.method,
      headers: {
        "X-Auth-Token": token,
      },
    });

    const raw = await upstreamRes.text();

    // -----------------------------
    // TRY TO RETURN JSON IF POSSIBLE
    // -----------------------------
    try {
      const json = JSON.parse(raw);
      return res.status(upstreamRes.status).json(json);
    } catch {
      console.warn("⚠️ Upstream returned non-JSON. Passing through raw text.");
      return res.status(upstreamRes.status).send(raw);
    }
  } catch (err) {
    console.error("🔥 Proxy error:", err);
    return res.status(500).json({ error: "Internal proxy error" });
  }
}
