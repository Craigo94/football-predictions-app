import { CURRENT_SEASON, PREMIER_LEAGUE_COMPETITION } from "../config/football";

/**
 * Calendar window a Premier League season lives in. Seasons run Aug–May, so a
 * 1 July–30 June window comfortably covers rearranged fixtures at either end.
 */
export const getSeasonDateRange = (season: number) => ({
  start: new Date(Date.UTC(season, 6, 1)),
  end: new Date(Date.UTC(season + 1, 5, 30, 23, 59, 59, 999)),
});

export interface SeasonScopedPrediction {
  season?: number | null;
  competition?: string | null;
  kickoff?: string | null;
}

/**
 * Every prediction ever made lives in a single Firestore collection, so reads
 * have to exclude previous seasons (and the retired World Cup side-game)
 * themselves — otherwise old "Matchday 5" documents merge into this season's
 * round of the same name and inflate points and fixture lists.
 *
 * Documents written before this scoping existed carry neither `season` nor
 * `competition`, so fall back to the kick-off date for those.
 */
export const isCurrentSeasonPrediction = (
  prediction: SeasonScopedPrediction,
  season: number = CURRENT_SEASON,
): boolean => {
  if (prediction.competition && prediction.competition !== PREMIER_LEAGUE_COMPETITION) {
    return false;
  }

  if (typeof prediction.season === "number") {
    return prediction.season === season;
  }

  const kickoff = prediction.kickoff ? new Date(prediction.kickoff).getTime() : Number.NaN;
  if (!Number.isFinite(kickoff)) return false;

  const { start, end } = getSeasonDateRange(season);
  return kickoff >= start.getTime() && kickoff <= end.getTime();
};
