// web/src/api/football.ts
import { CURRENT_SEASON } from "../config/football";
import { UK_TZ } from "../utils/dates";

interface ApiTeam {
  name?: string;
  shortName?: string;
  tla?: string;
  crest?: string;
}

interface ApiMatch {
  id: number;
  utcDate: string;
  status: string;
  matchday?: number;
  round?: string;
  group?: string;
  homeTeam?: ApiTeam;
  awayTeam?: ApiTeam;
  score?: {
    fullTime?: {
      home?: number | null;
      away?: number | null;
    };
  };
}

interface ApiMatchResponse {
  matches?: ApiMatch[];
  error?: unknown;
}

export interface Fixture {
  id: number;
  kickoff: string;            // ISO datetime string (UTC)
  statusShort: string;        // "NS" | "FT" | "LIVE" etc for our UI
  statusLong: string;         // original status from API
  round: string;              // e.g. "Matchday 13"
  matchday?: number;          // numeric matchday
  season?: number;            // season year (e.g. 2025)
  homeTeam: string;
  awayTeam: string;
  homeShort: string;
  awayShort: string;
  homeLogo: string;
  awayLogo: string;
  homeGoals: number | null;
  awayGoals: number | null;
}

// ---- helpers ------------------------------------------------------

const UK_DATE_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  timeZone: UK_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function formatDate(date: Date): string {
  const parts = UK_DATE_FORMATTER.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? "";
  const month = parts.find((part) => part.type === "month")?.value ?? "";
  const day = parts.find((part) => part.type === "day")?.value ?? "";
  return `${year}-${month}-${day}`;
}

/**
 * Build a URL for PL matches via our proxy:
 *   /api/football/competitions/PL/matches
 *
 * In dev: Vite proxies this to Football-Data with the token.
 * In prod (Vercel): our serverless function proxies it with the token.
 */
function buildMatchesUrl(
  params: Record<string, string | number | undefined>
): string {
  const basePath = "/api/football/competitions/PL/matches";
  const search = new URLSearchParams();

  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) {
      search.set(k, String(v));
    }
  }

  const query = search.toString();
  return query ? `${basePath}?${query}` : basePath;
}

async function fetchMatches(
  params: Record<string, string | number | undefined>
): Promise<ApiMatch[]> {
  const url = buildMatchesUrl(params);

  const res = await fetch(url);
  const text = await res.text();

  let data: ApiMatchResponse;
  try {
    data = JSON.parse(text) as ApiMatchResponse;
  } catch {
    console.error("Non-JSON response from Football API:", text);
    throw new Error("Football API returned non-JSON response");
  }

  if (!res.ok) {
    console.error("Football API HTTP error:", res.status, data);
    throw new Error(
      `Football API error ${res.status}: ${JSON.stringify(
        (data && data.error) || data
      )}`
    );
  }

  if (!Array.isArray(data.matches)) {
    console.error("Football API returned unexpected payload", data);
    throw new Error("Football API returned an unexpected response shape.");
  }

  return data.matches;
}

// ---- Public API ----------------------------------------------------

/**
 * Return ALL fixtures for the next Premier League gameweek (entire matchday).
 */
export async function getNextPremierLeagueGameweekFixtures(): Promise<Fixture[]> {
  const now = new Date();
  const dateFrom = formatDate(now);
  const dateTo = formatDate(
    new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000)
  ); // 14 days ahead

  console.log("[Football API] Detect next GW (range):", { dateFrom, dateTo });

  // Include fixtures that have already kicked off (IN_PLAY/PAUSED) so that
  // once a gameweek begins we still treat it as the "current" one until the
  // next scheduled matchday arrives. If we only fetch SCHEDULED games then as
  // soon as the first fixture starts, the API stops returning the active
  // matchday and we would incorrectly jump ahead to the following round.
  const upcoming = await fetchMatches({
    dateFrom,
    dateTo,
    status: "SCHEDULED,IN_PLAY,PAUSED",
  });

  const matchdays = upcoming
    .map((m) => m.matchday)
    .filter((md) => typeof md === "number") as number[];

  if (!matchdays.length) {
    throw new Error("No upcoming PL matchdays found in the detection window.");
  }

  const nextMatchday = Math.min(...matchdays);
  const roundLabel = `Matchday ${nextMatchday}`;

  console.log("[Football API] Fetch full GW:", {
    matchday: nextMatchday,
    season: CURRENT_SEASON,
  });

  const matches = await fetchMatches({
    matchday: nextMatchday,
    season: CURRENT_SEASON,
  });

  if (!matches.length) {
    throw new Error("No matches returned for the detected matchday.");
  }

  return matches.map(
    mapApiMatchToFixture(roundLabel, nextMatchday, CURRENT_SEASON)
  );
}

/**
 * Fetch PL matches for a given date range (used for leaderboard etc).
 */
export async function getPremierLeagueMatchesForRange(
  from: Date,
  to: Date
): Promise<Fixture[]> {
  const dateFrom = formatDate(from);
  const dateTo = formatDate(to);

  console.log("[Football API] Requesting range:", { dateFrom, dateTo });

  const matches = await fetchMatches({
    dateFrom,
    dateTo,
  });

  return matches.map((m) => {
    const md = typeof m.matchday === "number" ? m.matchday : undefined;
    const roundLabel = md ? `Matchday ${md}` : m.group || "Premier League";
    return mapApiMatchToFixture(roundLabel, md, CURRENT_SEASON)(m);
  });
}

// ---- Mapping -------------------------------------------------------

function mapApiMatchToFixture(roundLabel: string, md?: number, season?: number) {
  return (m: ApiMatch): Fixture => {
    const fullTime = m.score?.fullTime || {};
    const homeGoals = typeof fullTime.home === "number" ? fullTime.home : null;
    const awayGoals = typeof fullTime.away === "number" ? fullTime.away : null;

    let statusShort = "NS";
    if (m.status === "FINISHED") statusShort = "FT";
    else if (m.status === "IN_PLAY" || m.status === "PAUSED") statusShort = "LIVE";
    else if (m.status === "SUSPENDED") statusShort = "SUS";
    else if (m.status === "POSTPONED") statusShort = "PST";

    const h = m.homeTeam || {};
    const a = m.awayTeam || {};
    const homeShort = h.tla || h.shortName || h.name || "Home";
    const awayShort = a.tla || a.shortName || a.name || "Away";

    return {
      id: m.id,
      kickoff: m.utcDate,
      statusShort,
      statusLong: m.status,
      round: roundLabel,
      matchday: md ?? (typeof m.matchday === "number" ? m.matchday : undefined),
      season,
      homeTeam: h.name ?? "Home",
      awayTeam: a.name ?? "Away",
      homeShort,
      awayShort,
      homeLogo: h.crest ?? "/badge-fallback.png",
      awayLogo: a.crest ?? "/badge-fallback.png",
      homeGoals,
      awayGoals,
    };
  };
}
