// src/api/football.ts
import { CURRENT_SEASON } from "../config/football";

export const API_BASE =
  import.meta.env.DEV ? "/football-api" : "/football-api";

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
  homeShort: string;          // NEW: short label (TLA or shortName)
  awayShort: string;          // NEW: short label (TLA or shortName)
  homeLogo: string;
  awayLogo: string;
  homeGoals: number | null;
  awayGoals: number | null;
}

// ---- URL helpers -------------------------------------------------

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function makeUrl(path: string, params?: Record<string, string | number | undefined>) {
  const cleanPath = path.replace(/\\/g, "/");
  const url = new URL(cleanPath, window.location.origin);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

async function fetchJson(url: string) {
  const res = await fetch(url);
  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
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
  return data;
}

// ---- Public API --------------------------------------------------

/**
 * Return ALL fixtures for the next Premier League gameweek (entire matchday).
 * Step 1: use a small date window to find the next matchday number.
 * Step 2: fetch by matchday+season to get every fixture in that round (Fri–Mon).
 */
export async function getNextPremierLeagueGameweekFixtures(): Promise<Fixture[]> {
  // Step 1: detect next matchday using a near-term window
  const now = new Date();
  const dateFrom = formatDate(now);
  const dateTo   = formatDate(new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000)); // 14 days

  const detectUrl = makeUrl(`${API_BASE}/pl-matches`, { dateFrom, dateTo });
  console.log("[Football API] Detect next GW:", detectUrl);
  const detectData = await fetchJson(detectUrl);

  const upcoming = (detectData.matches || []) as any[];
  const matchdays = upcoming
    .map((m) => m.matchday)
    .filter((md) => typeof md === "number") as number[];

  if (!matchdays.length) {
    throw new Error("No upcoming PL matchdays found in the detection window.");
  }

  const nextMatchday = Math.min(...matchdays);
  const roundLabel = `Matchday ${nextMatchday}`;

  // Step 2: fetch the full round by matchday+season (no date slicing)
  const roundUrl = makeUrl(`${API_BASE}/pl-matches`, {
    matchday: nextMatchday,
    season: CURRENT_SEASON,
  });
  console.log("[Football API] Fetch full GW:", roundUrl);
  const roundData = await fetchJson(roundUrl);

  const matches = (roundData.matches || []) as any[];
  if (!matches.length) {
    throw new Error("No matches returned for the detected matchday.");
  }

  return matches.map(mapApiMatchToFixture(roundLabel, nextMatchday, CURRENT_SEASON));
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

  const url = makeUrl(`${API_BASE}/pl-matches`, { dateFrom, dateTo });
  console.log("[Football API] Requesting range:", url);

  const data = await fetchJson(url);
  const matches = (data.matches || []) as any[];

  return matches.map((m) => {
    const md = typeof m.matchday === "number" ? m.matchday : undefined;
    const roundLabel = md ? `Matchday ${md}` : m.group || "Premier League";
    return mapApiMatchToFixture(roundLabel, md, CURRENT_SEASON)(m);
  });
}

// ---- Mapping -----------------------------------------------------

function mapApiMatchToFixture(roundLabel: string, md?: number, season?: number) {
  return (m: any): Fixture => {
    const fullTime = m.score?.fullTime || {};
    const homeGoals = typeof fullTime.home === "number" ? fullTime.home : null;
    const awayGoals = typeof fullTime.away === "number" ? fullTime.away : null;

    let statusShort = "NS";
    if (m.status === "FINISHED") statusShort = "FT";
    else if (m.status === "IN_PLAY" || m.status === "PAUSED") statusShort = "LIVE";
    else if (m.status === "SUSPENDED") statusShort = "SUS";
    else if (m.status === "POSTPONED") statusShort = "PST";

    // Football-Data includes TLA/shortName on team objects
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
