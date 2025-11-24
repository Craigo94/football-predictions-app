import type { NextApiRequest, NextApiResponse } from "next";

const API_BASE = "https://api.football-data.org/v4";
const CACHE_TTL_MS = 60 * 1000;

type CacheEntry = {
  expiresAt: number;
  body: unknown;
  status: number;
};

const cache = new Map<string, CacheEntry>();

export default async function handler(
  request: NextApiRequest,
  response: NextApiResponse,
) {
  try {
    const token = process.env.FOOTBALL_DATA_TOKEN;

    if (!token) {
      console.error("FOOTBALL_DATA_TOKEN is not set in Vercel env");
      return response
        .status(500)
        .json({ error: "Missing Football API token on the server" });
    }

    const url = new URL(
      request.url ?? "/api/football/competitions/PL/matches",
      `https://${request.headers.host ?? "localhost"}`,
    );
    const competitionQuery = request.query?.competition;
    const competition = Array.isArray(competitionQuery)
      ? competitionQuery[0]
      : competitionQuery;

    if (!competition) {
      return response.status(400).json({ error: "Competition is required" });
    }

    const cacheKey = `${url.pathname}${url.search}`;
    const cached = cache.get(cacheKey);

    if (cached && cached.expiresAt > Date.now()) {
      console.log(`[Football proxy][cache hit] ${cacheKey}`);
      return response.status(cached.status).json(cached.body);
    }

    console.log(`[Football proxy][cache miss] ${cacheKey}`);

    const upstreamUrl = `${API_BASE}/competitions/${competition}/matches${url.search}`;
    console.log("[Football proxy] →", upstreamUrl);

    const upstreamRes = await fetch(upstreamUrl, {
      headers: {
        "X-Auth-Token": token,
      },
    });

    const text = await upstreamRes.text();

    // Try JSON first
    try {
      const json = JSON.parse(text);
      cache.set(cacheKey, {
        body: json,
        status: upstreamRes.status,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });
      return response.status(upstreamRes.status).json(json);
    } catch {
      // Fallback: plain text/HTML (for debugging)
      cache.set(cacheKey, {
        body: text,
        status: upstreamRes.status,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });
      return response.status(upstreamRes.status).send(text);
    }
  } catch (err) {
    console.error("Proxy error:", err);
    return response.status(500).json({ error: "Internal proxy error" });
  }
}
