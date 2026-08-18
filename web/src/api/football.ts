// web/src/api/football.ts
import {
  FALLBACK_SEASON,
  SEASON_OVERRIDE,
  seasonLabel,
} from "../config/football";
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
  group?: string;
  homeTeam?: ApiTeam;
  awayTeam?: ApiTeam;
  score?: {
    fullTime?: {
      home?: number | null;
      away?: number | null;
    };
    // Score after 90 minutes. Only present when a match went to extra time /
    // penalties; omitted for games decided in regular time (where fullTime is
    // already the 90-minute score).
    regularTime?: {
      home?: number | null;
      away?: number | null;
    };
  };
}

interface ApiMatchResponse {
  matches?: ApiMatch[];
  error?: unknown;
}

const CURRENT_GAMEWEEK_STATUSES = "TIMED,SCHEDULED,IN_PLAY,PAUSED";
const STALE_FIXTURE_BUFFER_MS = 8 * 24 * 60 * 60 * 1000;

interface ApiStandingsTeam {
  id: number;
  name?: string;
  shortName?: string;
  tla?: string;
  crest?: string;
}

interface ApiStandingsRow {
  position: number;
  team: ApiStandingsTeam;
  playedGames: number;
  form?: string;
  won: number;
  draw: number;
  lost: number;
  points: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
}

interface ApiStandingsEntry {
  type?: string;
  table?: ApiStandingsRow[];
}

interface ApiStandingsResponse {
  standings?: ApiStandingsEntry[];
  error?: unknown;
}

export interface Fixture {
  id: number;
  kickoff: string;            // ISO datetime string (UTC)
  statusShort: string;        // "NS" | "FT" | "LIVE" etc for our UI
  statusLong: string;         // original status from API
  round: string;              // e.g. "Matchday 13"
  matchday?: number;          // numeric matchday
  season?: number;            // season start year (e.g. 2026 for 2026/27)
  homeTeam: string;
  awayTeam: string;
  homeShort: string;
  awayShort: string;
  homeLogo: string;
  awayLogo: string;
  homeGoals: number | null;
  awayGoals: number | null;
}

export interface LeagueTableRow {
  position: number;
  team: {
    id: number;
    name: string;
    shortName: string;
    tla: string;
    crest: string;
  };
  playedGames: number;
  form: string;
  won: number;
  draw: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
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
function buildMatchesUrl(params: Record<string, string | number | undefined>): string {
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

function buildStandingsUrl(
  params: Record<string, string | number | undefined>
): string {
  const basePath = "/api/football/competitions/PL/standings";
  const search = new URLSearchParams();

  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) {
      search.set(k, String(v));
    }
  }

  const query = search.toString();
  return query ? `${basePath}?${query}` : basePath;
}

/**
 * Turn an upstream failure into something a person can act on. The raw body
 * football-data returns is a bare `{"message": "..."}` that told us nothing
 * about which of the usual causes we had hit.
 */
function describeApiError(status: number, body: unknown): string {
  const upstream =
    (body && typeof body === "object" && "message" in body
      ? String((body as { message?: unknown }).message ?? "")
      : "") || JSON.stringify(body);

  if (status === 400) {
    return `Football API rejected the request (400). ${upstream}`;
  }
  if (status === 403) {
    return (
      "Football API denied the request (403). The free plan only covers the " +
      "competition's current season, so this usually means the season being " +
      `requested is not the live one. ${upstream}`
    );
  }
  if (status === 429) {
    return (
      "Football API rate limit reached (429). The free plan allows 10 requests " +
      "per minute; scores will reappear on the next poll."
    );
  }
  if (status === 404) {
    return `Football API has no data at that path (404). ${upstream}`;
  }
  return `Football API error ${status}: ${upstream}`;
}

async function requestJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  const text = await res.text();

  let data: T;
  try {
    data = JSON.parse(text) as T;
  } catch {
    console.error("Non-JSON response from Football API:", text.slice(0, 500));
    throw new Error(
      "Football API returned a non-JSON response. The fixtures proxy is " +
        "probably misconfigured or missing FOOTBALL_DATA_TOKEN."
    );
  }

  if (!res.ok) {
    console.error("Football API HTTP error:", res.status, data);
    throw new Error(describeApiError(res.status, data));
  }

  return data;
}

async function fetchMatches(
  params: Record<string, string | number | undefined>
): Promise<ApiMatch[]> {
  const data = await requestJson<ApiMatchResponse>(buildMatchesUrl(params));

  if (!Array.isArray(data.matches)) {
    console.error("Football API returned unexpected payload", data);
    throw new Error("Football API returned an unexpected response shape.");
  }

  return data.matches;
}

async function fetchStandings(
  params: Record<string, string | number | undefined>
): Promise<ApiStandingsEntry[]> {
  const data = await requestJson<ApiStandingsResponse>(buildStandingsUrl(params));

  if (!Array.isArray(data.standings)) {
    console.error("Football API returned unexpected payload", data);
    throw new Error("Football API returned an unexpected response shape.");
  }

  return data.standings;
}

// ---- Season resolution ---------------------------------------------

interface ApiCompetitionResponse {
  currentSeason?: {
    startDate?: string;
    endDate?: string;
    currentMatchday?: number | null;
  };
}

export interface SeasonInfo {
  /** Season start year, e.g. 2026 for 2026/27. */
  season: number;
  /** The competition's own idea of the live matchday, when it publishes one. */
  currentMatchday: number | null;
  startDate: string | null;
  endDate: string | null;
  /** Where the number came from, for diagnostics. */
  source: "override" | "api" | "clock";
}

let seasonInfoPromise: Promise<SeasonInfo> | null = null;

/**
 * Which season are we actually in?
 *
 * This used to be inferred from the clock ("month >= August, so use this
 * year"). When that guess disagreed with reality — most easily by leaving
 * VITE_FOOTBALL_SEASON pinned to a finished season — fixture lookups asked for
 * the right matchday of the wrong season, every result fell outside the
 * date window, and the app rendered an empty list with no error.
 *
 * football-data publishes the answer on the competition itself, so use that
 * and keep the clock only as a fallback for when the call fails.
 */
export async function getSeasonInfo(forceRefresh = false): Promise<SeasonInfo> {
  if (!forceRefresh && seasonInfoPromise) return seasonInfoPromise;

  seasonInfoPromise = (async (): Promise<SeasonInfo> => {
    try {
      const data = await requestJson<ApiCompetitionResponse>(
        "/api/football/competitions/PL"
      );
      const startDate = data.currentSeason?.startDate ?? null;
      const parsed = startDate ? new Date(startDate).getUTCFullYear() : Number.NaN;

      if (Number.isFinite(parsed)) {
        if (SEASON_OVERRIDE && SEASON_OVERRIDE !== parsed) {
          console.warn(
            `[Football API] VITE_FOOTBALL_SEASON is pinned to ${seasonLabel(
              SEASON_OVERRIDE
            )} but the Premier League's live season is ${seasonLabel(parsed)}. ` +
              "Using the pinned value — unset VITE_FOOTBALL_SEASON to follow the live season."
          );
        }
        return {
          season: SEASON_OVERRIDE ?? parsed,
          currentMatchday: data.currentSeason?.currentMatchday ?? null,
          startDate,
          endDate: data.currentSeason?.endDate ?? null,
          source: SEASON_OVERRIDE ? "override" : "api",
        };
      }
    } catch (err) {
      console.warn(
        "[Football API] Could not read the live season from the competition " +
          "endpoint; falling back to the date-based guess.",
        err
      );
      // Don't cache a failure — the next caller should try the API again.
      seasonInfoPromise = null;
    }

    return {
      season: SEASON_OVERRIDE ?? FALLBACK_SEASON,
      currentMatchday: null,
      startDate: null,
      endDate: null,
      source: SEASON_OVERRIDE ? "override" : "clock",
    };
  })();

  return seasonInfoPromise;
}

// ---- Public API ----------------------------------------------------

/**
 * Return ALL fixtures for the next Premier League gameweek (entire matchday).
 */
export async function getNextPremierLeagueGameweekFixtures(): Promise<Fixture[]> {
  const now = new Date();
  const dateFrom = formatDate(now);
  const dateTo = formatDate(
    new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
  ); // 30 days ahead — wide enough to cover international-break gaps (up to ~3 weeks)

  console.log("[Football API] Detect next GW (range):", { dateFrom, dateTo });

  // Include TIMED fixtures (most scheduled PL matches), plus matches already
  // underway (IN_PLAY/PAUSED), so we don't skip the current weekend.
  //
  // Football-Data marks most upcoming fixtures as TIMED rather than SCHEDULED.
  // If TIMED is missing here, matchday detection can jump ahead to a later
  // round that still has SCHEDULED status entries.
  //
  // Include fixtures that have already kicked off (IN_PLAY/PAUSED) so that
  // once a gameweek begins we still treat it as the "current" one until the
  // next scheduled matchday arrives. If we only fetch SCHEDULED games then as
  // soon as the first fixture starts, the API stops returning the active
  // matchday and we would incorrectly jump ahead to the following round.
  const upcoming = await fetchMatches({
    dateFrom,
    dateTo,
    status: CURRENT_GAMEWEEK_STATUSES,
  });

  const { season, currentMatchday, source } = await getSeasonInfo();

  const nextKickoffMatch = [...upcoming]
    .filter((m) => typeof m.matchday === "number")
    .sort(
      (a, b) =>
        new Date(a.utcDate).getTime() - new Date(b.utcDate).getTime()
    )[0];

  // If nothing is scheduled in the detection window (an international break at
  // the edge of it, say), fall back to the matchday the competition itself
  // reports rather than giving up.
  const nextMatchday =
    typeof nextKickoffMatch?.matchday === "number"
      ? nextKickoffMatch.matchday
      : currentMatchday;

  if (typeof nextMatchday !== "number") {
    throw new Error(
      `No upcoming Premier League matchdays found between ${dateFrom} and ${dateTo}, ` +
        `and the competition did not report a current matchday for ${seasonLabel(season)}.`
    );
  }

  const roundLabel = `Matchday ${nextMatchday}`;

  console.log("[Football API] Fetch full GW:", {
    matchday: nextMatchday,
    season,
    seasonSource: source,
  });

  const matches = await fetchMatches({ matchday: nextMatchday, season });

  if (!matches.length) {
    throw new Error(
      `The Football API returned no fixtures for ${roundLabel} of ${seasonLabel(season)}.`
    );
  }

  // Matchdays can occasionally contain a much older rearranged fixture.
  // Keep only fixtures close to the first upcoming kickoff for this matchday
  // so "next gameweek" doesn't get anchored to stale dates.
  const firstUpcomingKickoff = [...upcoming]
    .filter((m) => m.matchday === nextMatchday)
    .sort(
      (a, b) =>
        new Date(a.utcDate).getTime() - new Date(b.utcDate).getTime()
    )[0]?.utcDate;

  const filteredMatches = firstUpcomingKickoff
    ? matches.filter((m) => {
        const kickoff = new Date(m.utcDate).getTime();
        const cutoff =
          new Date(firstUpcomingKickoff).getTime() - STALE_FIXTURE_BUFFER_MS;
        return kickoff >= cutoff;
      })
    : matches;

  // Every fixture being filtered out means the round we fetched sits in a
  // different season from the one kicking off — the symptom of a season
  // mismatch. Say so, instead of handing back an empty list that reads as
  // "no games this week".
  if (!filteredMatches.length) {
    throw new Error(
      `${roundLabel} of ${seasonLabel(season)} came back with no fixtures near ` +
        `${firstUpcomingKickoff?.slice(0, 10)}. The app is looking at the wrong season` +
        (source === "override"
          ? " because VITE_FOOTBALL_SEASON is pinned — unset it to follow the live season."
          : ".")
    );
  }

  return filteredMatches.map(
    mapApiMatchToFixture(roundLabel, nextMatchday, season)
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

  const [matches, { season }] = await Promise.all([
    fetchMatches({ dateFrom, dateTo }),
    getSeasonInfo(),
  ]);

  return matches.map((m) => {
    const md = typeof m.matchday === "number" ? m.matchday : undefined;
    const roundLabel = md ? `Matchday ${md}` : m.group || "Premier League";
    return mapApiMatchToFixture(roundLabel, md, season)(m);
  });
}

/**
 * Fetch Premier League standings for the current season.
 */
export async function getPremierLeagueTable(): Promise<LeagueTableRow[]> {
  const { season } = await getSeasonInfo();
  const standings = await fetchStandings({ season, standingType: "TOTAL" });

  const totalTable = standings.find((entry) => entry.type === "TOTAL");

  if (!totalTable?.table?.length) {
    throw new Error(
      `No Premier League standings returned for ${seasonLabel(season)}.`
    );
  }

  return totalTable.table.map((row) => ({
    position: row.position,
    team: {
      id: row.team.id,
      name: row.team.name ?? "Unknown",
      shortName: row.team.shortName ?? row.team.name ?? "Unknown",
      tla: row.team.tla ?? row.team.shortName ?? row.team.name ?? "",
      crest: row.team.crest ?? "/badge-fallback.png",
    },
    playedGames: row.playedGames,
    form: row.form ?? "",
    won: row.won,
    draw: row.draw,
    lost: row.lost,
    goalsFor: row.goalsFor,
    goalsAgainst: row.goalsAgainst,
    goalDifference: row.goalDifference,
    points: row.points,
  }));
}

// ---- Mapping -------------------------------------------------------

function mapApiMatchToFixture(roundLabel: string, md?: number, season?: number) {
  return (m: ApiMatch): Fixture => {
    // Predictions are scored on the score after 90 minutes only — extra time
    // and penalty shootouts are ignored. In the football-data v4 API the
    // 90-minute score lives in `regularTime` for games that went to extra time
    // / penalties; for everything else (group games, ties settled in normal
    // time, and live in-play scores) that field is omitted and `fullTime` is
    // already the 90-minute score, so we fall back to it.
    const regularTime = m.score?.regularTime || {};
    const fullTime = m.score?.fullTime || {};
    const homeGoals =
      typeof regularTime.home === "number"
        ? regularTime.home
        : typeof fullTime.home === "number"
          ? fullTime.home
          : null;
    const awayGoals =
      typeof regularTime.away === "number"
        ? regularTime.away
        : typeof fullTime.away === "number"
          ? fullTime.away
          : null;

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
