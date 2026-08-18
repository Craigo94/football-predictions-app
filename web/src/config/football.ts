// src/config/football.ts

/**
 * Clock-based guess at the season. football-data.org identifies a season by the
 * year it starts in, so 2026 means the 2026/27 campaign. Premier League seasons
 * start in August, so before August we are still in the previous one.
 *
 * This is only a fallback: the API publishes the authoritative answer, and
 * `getSeasonInfo()` in src/api/football.ts prefers that. A guess is wrong
 * whenever the season starts late, ends late, or a competition is rescheduled.
 */
const calcSeasonFromClock = () => {
  const d = new Date();
  const yr = d.getFullYear();
  return d.getMonth() >= 7 ? yr : yr - 1;
};

/**
 * Explicit pin from the environment. Leave this unset in normal operation — a
 * stale value silently points the whole app at a finished season.
 */
export const SEASON_OVERRIDE =
  Number(import.meta.env.VITE_FOOTBALL_SEASON) || null;

/** Best guess available without a network round-trip. */
export const FALLBACK_SEASON = calcSeasonFromClock();

/**
 * Synchronous best-effort season, for code that cannot await. Anything talking
 * to the football API should await `getSeasonInfo()` instead.
 */
export const CURRENT_SEASON = SEASON_OVERRIDE ?? FALLBACK_SEASON;

/** "2026" -> "2026/27" */
export const seasonLabel = (season: number) =>
  `${season}/${String((season + 1) % 100).padStart(2, "0")}`;

export const CURRENT_SEASON_LABEL = seasonLabel(CURRENT_SEASON);

/** Competition tag stored on prediction documents. */
export const PREMIER_LEAGUE_COMPETITION = "PREMIER_LEAGUE";

/** Entry fee per player, in pounds. The whole pot goes to the season winner. */
export const ENTRY_FEE_GBP = 5;
