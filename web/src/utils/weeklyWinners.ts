import type { Fixture } from "../api/football";
import { isFixtureFinished, isFixturePostponed } from "./fixtures";
import { scorePrediction } from "./scoring";

export interface WeeklyWinnerPrediction {
  userId: string;
  fixtureId: number;
  predHome: number | null;
  predAway: number | null;
  round: string;
}

export interface WeeklyWinnerRound {
  round: string;
  topScore: number;
  winners: string[];
  scoresByUser: Map<string, number>;
}

export interface WeeklyWinnerCount {
  userId: string;
  wins: number;
  jointWins: number;
}

export const parseRoundNumber = (round: string) => {
  const match = round.match(/(\d+)/);
  return match ? Number(match[1]) : Number.NaN;
};

export const isRoundComplete = (
  round: string,
  fixturesById: Record<number, Fixture>,
) => {
  const roundFixtures = Object.values(fixturesById).filter(
    (fixture) => fixture.round === round,
  );
  const countableFixtures = roundFixtures.filter(
    (fixture) => !isFixturePostponed(fixture),
  );

  return (
    countableFixtures.length > 0 &&
    countableFixtures.every((fixture) => isFixtureFinished(fixture))
  );
};

export const getRoundSortValue = (round: string) => {
  const roundNumber = parseRoundNumber(round);
  return Number.isNaN(roundNumber) ? null : roundNumber;
};

export const sortRoundsAscending = (a: string, b: string) => {
  const numA = getRoundSortValue(a);
  const numB = getRoundSortValue(b);

  if (numA == null || numB == null) {
    return a.localeCompare(b);
  }

  return numA - numB;
};

export const sortRoundsDescending = (a: string, b: string) =>
  sortRoundsAscending(b, a);

export const getCompletedPredictionRounds = (
  predictions: WeeklyWinnerPrediction[],
  fixturesById: Record<number, Fixture>,
) => {
  const predictedRounds = new Set(
    predictions
      .map((prediction) => prediction.round)
      .filter((round): round is string => Boolean(round)),
  );

  return new Set(
    Array.from(predictedRounds).filter((round) =>
      isRoundComplete(round, fixturesById),
    ),
  );
};

export const getWeeklyWinnerRounds = (
  predictions: WeeklyWinnerPrediction[],
  fixturesById: Record<number, Fixture>,
) => {
  const completedRounds = getCompletedPredictionRounds(predictions, fixturesById);
  const scoresByRound = new Map<string, Map<string, number>>();

  predictions.forEach((prediction) => {
    if (!prediction.userId || !completedRounds.has(prediction.round)) return;

    const fixture = fixturesById[prediction.fixtureId];
    if (!fixture || isFixturePostponed(fixture)) return;

    const { points } = scorePrediction(
      prediction.predHome,
      prediction.predAway,
      fixture.homeGoals,
      fixture.awayGoals,
    );

    if (points == null) return;

    if (!scoresByRound.has(prediction.round)) {
      scoresByRound.set(prediction.round, new Map<string, number>());
    }

    const scoresByUser = scoresByRound.get(prediction.round)!;
    scoresByUser.set(
      prediction.userId,
      (scoresByUser.get(prediction.userId) ?? 0) + points,
    );
  });

  const rounds: WeeklyWinnerRound[] = [];

  scoresByRound.forEach((scoresByUser, round) => {
    if (scoresByUser.size === 0) return;

    const topScore = Math.max(...scoresByUser.values());
    const winners =
      topScore > 0
        ? Array.from(scoresByUser.entries())
            .filter(([, points]) => points === topScore)
            .map(([userId]) => userId)
        : [];

    rounds.push({ round, topScore, winners, scoresByUser });
  });

  return rounds.sort((a, b) => sortRoundsAscending(a.round, b.round));
};

export const getWeeklyWinnerCounts = (
  predictions: WeeklyWinnerPrediction[],
  fixturesById: Record<number, Fixture>,
) => {
  const rounds = getWeeklyWinnerRounds(predictions, fixturesById);
  const winCounts = new Map<string, WeeklyWinnerCount>();
  let jointRoundsCount = 0;

  rounds.forEach((round) => {
    if (round.winners.length === 0) return;

    const isJointWin = round.winners.length > 1;
    if (isJointWin) jointRoundsCount += 1;

    round.winners.forEach((userId) => {
      const current = winCounts.get(userId) ?? {
        userId,
        wins: 0,
        jointWins: 0,
      };

      current.wins += 1;
      if (isJointWin) current.jointWins += 1;
      winCounts.set(userId, current);
    });
  });

  return {
    rounds,
    weeksCounted: rounds.length,
    jointRoundsCount,
    winCounts,
  };
};
