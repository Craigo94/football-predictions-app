// src/config/football.ts
const calcDefaultSeason = () => {
  const d = new Date();
  // Premier League seasons start in Aug; before Aug use previous year
  const yr = d.getFullYear();
  return d.getMonth() >= 7 ? yr : yr - 1;
};

/**
 * Season the app is playing. football-data.org identifies a season by the year
 * it starts in, so 2026 is the 2026/27 campaign.
 */
export const CURRENT_SEASON =
  Number(import.meta.env.VITE_FOOTBALL_SEASON) || calcDefaultSeason();

/** Human-readable form of the current season, e.g. "2026/27". */
export const CURRENT_SEASON_LABEL = `${CURRENT_SEASON}/${String((CURRENT_SEASON + 1) % 100).padStart(2, "0")}`;

/** Competition tag stored on prediction documents. */
export const PREMIER_LEAGUE_COMPETITION = "PREMIER_LEAGUE";

/** Entry fee per player, in pounds. The whole pot goes to the season winner. */
export const ENTRY_FEE_GBP = 5;
