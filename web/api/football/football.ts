import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const path = req.url!.replace("/api/football", "");
  const targetUrl = `https://api.football-data.org/v4${path}`;

  try {
    const upstream = await fetch(targetUrl, {
      headers: {
        "X-Auth-Token": process.env.FOOTBALL_DATA_TOKEN!,
      },
    });

    const body = await upstream.text();
    res.status(upstream.status).send(body);
  } catch (err: any) {
    res.status(500).json({
      error: "Proxy error",
      message: err.message || String(err),
    });
  }
}
