// api-proxy.mjs
import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import dotenv from "dotenv";

// Load .env.local for local dev
dotenv.config({ path: ".env.local" });

// Try both names, in case you use Vite-style env vars
const API_KEY =
  process.env.FOOTBALL_API_KEY ?? process.env.VITE_FOOTBALL_API_KEY;

if (!API_KEY) {
  console.warn(
    "⚠️  FOOTBALL_API_KEY / VITE_FOOTBALL_API_KEY is not set in .env.local – Football proxy will fail without it."
  );
}

const app = express();
const PORT = 4000;

app.use(
  cors({
    origin: "http://localhost:5173", // your Vite dev origin
  })
);

/**
 * GET /api/pl-next-fixtures
 *
 * - Calls Football-Data: /v4/competitions/PL/matches
 *   with status=SCHEDULED (all upcoming fixtures)
 * - Streams back JSON to the frontend
 *
 * Your frontend then:
 *   - finds the smallest matchday number
 *   - uses that as the "next" gameweek
 */
app.get("/api/pl-next-fixtures", async (req, res) => {
  if (!API_KEY) {
    return res.status(500).json({
      error: "FOOTBALL_API_KEY / VITE_FOOTBALL_API_KEY not configured on server",
    });
  }

  // Request all upcoming scheduled matches in the current season
  const params = new URLSearchParams({
    status: "SCHEDULED",
    // Optionally pin to a specific season:
    // season: "2024",
  });

  const url = `https://api.football-data.org/v4/competitions/PL/matches?${params.toString()}`;

  console.log("[Proxy] Fetching:", url);

  try {
    const apiRes = await fetch(url, {
      headers: {
        "X-Auth-Token": API_KEY,
      },
    });

    const text = await apiRes.text();
    let data;

    try {
      data = JSON.parse(text);
    } catch {
      console.error("[Proxy] Non-JSON response from Football-Data:", text);
      return res
        .status(502)
        .json({ error: "Football API returned non-JSON response" });
    }

    if (!apiRes.ok) {
      console.error(
        "[Proxy] Football API error",
        apiRes.status,
        apiRes.statusText,
        data
      );
      return res.status(apiRes.status).json(data);
    }

    // Pass the JSON straight back to the frontend
    res.json(data);
  } catch (err) {
    console.error("[Proxy] Error calling Football API:", err);
    res.status(500).json({ error: "Error calling Football API" });
  }
});

// Get PL matches for a given date range (used by leaderboard)
app.get("/api/pl-matches", async (req, res) => {
  if (!API_KEY) {
    return res.status(500).json({
      error:
        "FOOTBALL_API_KEY / VITE_FOOTBALL_API_KEY not configured on server",
    });
  }

  const { dateFrom, dateTo, status } = req.query;

  const params = new URLSearchParams();
  if (dateFrom) params.set("dateFrom", String(dateFrom));
  if (dateTo) params.set("dateTo", String(dateTo));
  if (status) params.set("status", String(status));

  const url = `https://api.football-data.org/v4/competitions/PL/matches?${params.toString()}`;

  console.log("[Proxy] Fetching (leaderboard):", url);

  try {
    const apiRes = await fetch(url, {
      headers: {
        "X-Auth-Token": API_KEY,
      },
    });

    const text = await apiRes.text();
    let data;

    try {
      data = JSON.parse(text);
    } catch {
      console.error("[Proxy] Non-JSON response from Football-Data:", text);
      return res
        .status(502)
        .json({ error: "Football API returned non-JSON response" });
    }

    if (!apiRes.ok) {
      console.error(
        "[Proxy] Football API error",
        apiRes.status,
        apiRes.statusText,
        data
      );
      return res.status(apiRes.status).json(data);
    }

    res.json(data);
  } catch (err) {
    console.error("[Proxy] Error calling Football API (leaderboard):", err);
    res.status(500).json({ error: "Error calling Football API" });
  }
});

app.listen(PORT, () => {
  console.log(`⚽ Football API proxy running at http://localhost:${PORT}`);
});
