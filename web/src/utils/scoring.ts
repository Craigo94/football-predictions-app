/**
 * Score calculation helper for the prediction game.
 * 
 *  - 20 points  → correct scoreline
 *  - 6 points   → correct result (win/draw/lose)
 *  - 0 points   → wrong prediction
 *  - null       → no points yet (match not started)
 */

export type PredictionStatus = "pending" | "exact" | "result" | "wrong";

/**
 * Calculates the points for a prediction given actual goals.
 */
export function scorePrediction(
  predHome: number | null,
  predAway: number | null,
  homeGoals: number | null,
  awayGoals: number | null
): { points: number | null; status: PredictionStatus } {
  // If either prediction or actual scores are missing → pending
  if (
    predHome == null ||
    predAway == null ||
    homeGoals == null ||
    awayGoals == null
  ) {
    return { points: null, status: "pending" };
  }

  // Exact score match → 20 points
  if (predHome === homeGoals && predAway === awayGoals) {
    return { points: 20, status: "exact" };
  }

  // Helper to calculate W/D/L result
  const result = (h: number, a: number) =>
    h > a ? "H" : h < a ? "A" : "D";

  // Same outcome (e.g., both predicted home win) → 6 points
  if (result(predHome, predAway) === result(homeGoals, awayGoals)) {
    return { points: 6, status: "result" };
  }

  // Otherwise wrong
  return { points: 0, status: "wrong" };
}
