// web/api/football.ts

import type { IncomingMessage, ServerResponse } from "http";

export default async function handler(
  req: IncomingMessage & { url?: string },
  res: ServerResponse
) {
  let realUrl = req.url ?? "";

  // Remove ONLY the leading `/api/football`
  realUrl = realUrl.replace(/^\/api\/football/, "");

  const FOOTBALL_URL = `https://api.football-data.org/v4${realUrl}`;

  try {
    const response = await fetch(FOOTBALL_URL, {
      headers: {
        "X-Auth-Token": process.env.FOOTBALL_DATA_TOKEN!,
      },
    });

    const status = response.status;
    const body = await response.text();

    res.statusCode = status;
    res.setHeader("Content-Type", response.headers.get("content-type") || "application/json");
    res.end(body);
  } catch (err) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Proxy error", message: String(err) }));
  }
}
