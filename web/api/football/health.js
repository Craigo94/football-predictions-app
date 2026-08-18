// web/api/football/health.js
//
// Answers "is the fixtures API working, and for which season?" from inside the
// deployment, where FOOTBALL_DATA_TOKEN actually exists. Returns only public
// fixture metadata and booleans — never the token itself.
//
// GET /api/football/health

const API_BASE = "https://api.football-data.org/v4";
const COMPETITION = "PL";
const RESULT_TTL_MS = 30 * 1000;

let cached = null;

const isoDate = (d) => d.toISOString().slice(0, 10);

const call = async (path, token) => {
  const started = Date.now();
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { "X-Auth-Token": token },
    });
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = { nonJson: text.slice(0, 200) };
    }
    return {
      path,
      status: res.status,
      ok: res.ok,
      ms: Date.now() - started,
      requestsRemaining: res.headers.get("x-requests-available-minute"),
      body,
    };
  } catch (err) {
    return { path, status: 0, ok: false, ms: Date.now() - started, error: String(err) };
  }
};

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  const token = process.env.FOOTBALL_DATA_TOKEN;
  if (!token) {
    return res.status(500).json({
      ok: false,
      tokenPresent: false,
      diagnosis:
        "FOOTBALL_DATA_TOKEN is not set on this deployment. Add it in Vercel → " +
        "Project Settings → Environment Variables, then redeploy (env vars only " +
        "apply to new deployments).",
    });
  }

  if (cached && cached.expiresAt > Date.now()) {
    return res.status(200).json({ ...cached.payload, cached: true });
  }

  const now = new Date();
  const dateTo = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000);

  // 1. Which season does the competition say is live?
  const competition = await call(`/competitions/${COMPETITION}`, token);
  const currentSeason = competition.body?.currentSeason ?? null;
  const liveSeason = currentSeason?.startDate
    ? new Date(currentSeason.startDate).getUTCFullYear()
    : null;

  // 2. What is actually scheduled in the next 10 days?
  const upcoming = await call(
    `/competitions/${COMPETITION}/matches?dateFrom=${isoDate(now)}&dateTo=${isoDate(
      dateTo
    )}&status=TIMED,SCHEDULED,IN_PLAY,PAUSED`,
    token
  );
  const upcomingMatches = Array.isArray(upcoming.body?.matches)
    ? upcoming.body.matches
    : [];
  const nextMatchday = upcomingMatches
    .slice()
    .sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate))[0]?.matchday ?? null;

  // 3. Does fetching that round *by season* return the same fixtures? This is
  //    the call the app makes, and the one that silently returns the wrong
  //    season's games when the season number is wrong.
  let roundBySeason = null;
  if (nextMatchday != null && liveSeason != null) {
    roundBySeason = await call(
      `/competitions/${COMPETITION}/matches?matchday=${nextMatchday}&season=${liveSeason}`,
      token
    );
  }
  const roundMatches = Array.isArray(roundBySeason?.body?.matches)
    ? roundBySeason.body.matches
    : [];

  const sameSeason =
    roundMatches.length > 0 &&
    upcomingMatches.length > 0 &&
    roundMatches.some((m) =>
      upcomingMatches.some((u) => u.id === m.id)
    );

  const problems = [];
  if (!competition.ok) problems.push(`Competition lookup failed (${competition.status}).`);
  if (!upcoming.ok) problems.push(`Upcoming fixtures lookup failed (${upcoming.status}).`);
  if (roundBySeason && !roundBySeason.ok)
    problems.push(`Matchday lookup failed (${roundBySeason.status}).`);
  if (!upcomingMatches.length)
    problems.push("No fixtures scheduled in the next 10 days.");
  if (roundMatches.length && !sameSeason)
    problems.push(
      "The by-season matchday lookup returned a different set of fixtures than " +
        "the date lookup — the season number is wrong."
    );

  const payload = {
    ok: problems.length === 0,
    tokenPresent: true,
    checkedAt: now.toISOString(),
    season: {
      liveSeason,
      liveSeasonLabel:
        liveSeason == null ? null : `${liveSeason}/${String((liveSeason + 1) % 100).padStart(2, "0")}`,
      currentMatchday: currentSeason?.currentMatchday ?? null,
      startDate: currentSeason?.startDate ?? null,
      endDate: currentSeason?.endDate ?? null,
    },
    upcoming: {
      count: upcomingMatches.length,
      nextMatchday,
      sample: upcomingMatches.slice(0, 5).map((m) => ({
        utcDate: m.utcDate,
        matchday: m.matchday,
        status: m.status,
        match: `${m.homeTeam?.shortName ?? m.homeTeam?.name} v ${m.awayTeam?.shortName ?? m.awayTeam?.name}`,
      })),
    },
    roundBySeason: {
      count: roundMatches.length,
      matchesTheDateLookup: sameSeason,
      firstKickoff: roundMatches[0]?.utcDate ?? null,
    },
    requestsRemainingThisMinute:
      roundBySeason?.requestsRemaining ?? upcoming.requestsRemaining ?? null,
    problems,
  };

  cached = { payload, expiresAt: Date.now() + RESULT_TTL_MS };
  return res.status(payload.ok ? 200 : 503).json(payload);
}
