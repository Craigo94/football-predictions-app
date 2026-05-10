import React from "react";
import { Link, useSearchParams } from "react-router-dom";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "../../firebase";
import { useLiveFixtures } from "../../context/LiveFixturesContext";
import { useUsers } from "../../hooks/useUsers";
import type { Fixture } from "../../api/football";
import { formatFirstName } from "../../utils/displayName";
import { scorePrediction, type PredictionStatus } from "../../utils/scoring";
import { hasFixtureScore, isFixturePostponed } from "../../utils/fixtures";
import { getTiedRank } from "../../utils/ranking";
import {
  getWeeklyWinnerCounts,
  isRoundComplete,
  parseRoundNumber,
  sortRoundsDescending,
} from "../../utils/weeklyWinners";

interface AllPredictionDoc {
  userId: string;
  userDisplayName: string;
  userEmail?: string;
  fixtureId: number;
  predHome: number | null;
  predAway: number | null;
  kickoff: string;
  round: string;
}

interface RoundPlayerScore {
  userId: string;
  name: string;
  points: number;
  exact: number;
  results: number;
  played: number;
}

interface RoundFixtureScore {
  id: number;
  home: string;
  away: string;
  homeLogo: string;
  awayLogo: string;
  scoreLabel: string;
  kickoff: string;
}

interface WeeklyHistoryRound {
  round: string;
  roundNumber: number;
  winners: RoundPlayerScore[];
  topScore: number;
  playerScores: RoundPlayerScore[];
  fixtures: RoundFixtureScore[];
}

const statusToCountKey = (status: PredictionStatus) => {
  if (status === "exact") return "exact";
  if (status === "result") return "results";
  return null;
};

const WinnersHistoryPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [predictions, setPredictions] = React.useState<AllPredictionDoc[]>([]);
  const [predictionsLoading, setPredictionsLoading] = React.useState(true);
  const [predictionsError, setPredictionsError] = React.useState<string | null>(
    null,
  );
  const { fixturesById, loadingFixtures, fixturesError } = useLiveFixtures();
  const { users, loading: usersLoading, error: usersError } = useUsers();

  const selectedWinnerId = searchParams.get("winner") ?? "";

  React.useEffect(() => {
    const ref = collection(db, "predictions");
    const unsub = onSnapshot(
      ref,
      (snap) => {
        const list: AllPredictionDoc[] = [];
        snap.forEach((docSnap) => {
          const data = docSnap.data();
          const fallbackName = data.userDisplayName || data.userEmail || "Unknown";
          list.push({
            userId: data.userId,
            userDisplayName: formatFirstName(fallbackName),
            userEmail: data.userEmail,
            fixtureId: data.fixtureId,
            predHome: data.predHome ?? null,
            predAway: data.predAway ?? null,
            kickoff: data.kickoff,
            round: data.round ?? "Unknown",
          });
        });
        setPredictions(list);
        setPredictionsLoading(false);
        setPredictionsError(null);
      },
      (err) => {
        console.error("Failed to load winners history", err);
        setPredictionsError("Failed to load winners history.");
        setPredictionsLoading(false);
      },
    );

    return () => unsub();
  }, []);

  const userNames = React.useMemo(() => {
    const names = new Map<string, string>();

    users.forEach((profile) => {
      names.set(profile.id, profile.displayName);
    });

    predictions.forEach((prediction) => {
      if (!prediction.userId || names.has(prediction.userId)) return;
      names.set(
        prediction.userId,
        formatFirstName(
          prediction.userDisplayName || prediction.userEmail || "Unknown",
        ),
      );
    });

    return names;
  }, [predictions, users]);

  const history = React.useMemo<WeeklyHistoryRound[]>(() => {
    const roundPredictions = new Map<string, AllPredictionDoc[]>();

    predictions.forEach((prediction) => {
      if (!isRoundComplete(prediction.round, fixturesById)) return;

      const fixture = fixturesById[prediction.fixtureId];
      if (!fixture || isFixturePostponed(fixture)) return;

      const scored = scorePrediction(
        prediction.predHome,
        prediction.predAway,
        fixture.homeGoals,
        fixture.awayGoals,
      );

      if (scored.points == null) return;

      if (!roundPredictions.has(prediction.round)) {
        roundPredictions.set(prediction.round, []);
      }
      roundPredictions.get(prediction.round)!.push(prediction);
    });

    const rounds: WeeklyHistoryRound[] = [];

    roundPredictions.forEach((items, round) => {
      const scoresByUser = new Map<string, RoundPlayerScore>();
      const fixtureIds = new Set<number>();

      items.forEach((prediction) => {
        const fixture = fixturesById[prediction.fixtureId];
        if (!fixture) return;
        fixtureIds.add(prediction.fixtureId);

        const scored = scorePrediction(
          prediction.predHome,
          prediction.predAway,
          fixture.homeGoals,
          fixture.awayGoals,
        );

        if (scored.points == null) return;

        const existing = scoresByUser.get(prediction.userId) ?? {
          userId: prediction.userId,
          name:
            userNames.get(prediction.userId) ??
            formatFirstName(
              prediction.userDisplayName || prediction.userEmail || "Unknown",
            ),
          points: 0,
          exact: 0,
          results: 0,
          played: 0,
        };

        existing.points += scored.points;
        existing.played += 1;
        const countKey = statusToCountKey(scored.status);
        if (countKey) existing[countKey] += 1;
        scoresByUser.set(prediction.userId, existing);
      });

      const playerScores = Array.from(scoresByUser.values()).sort((a, b) => {
        if (b.points !== a.points) return b.points - a.points;
        return a.name.localeCompare(b.name);
      });

      if (playerScores.length === 0) return;

      const topScore = playerScores[0].points;
      const winners =
        topScore > 0
          ? playerScores.filter((player) => player.points === topScore)
          : [];

      const fixturesForRound = Object.values(fixturesById).filter(
        (fixture) => fixture.round === round && fixtureIds.has(fixture.id),
      );

      const fixtures = fixturesForRound
        .sort(
          (a, b) =>
            new Date(a.kickoff).getTime() - new Date(b.kickoff).getTime(),
        )
        .map((fixture: Fixture) => ({
          id: fixture.id,
          home: fixture.homeShort || fixture.homeTeam,
          away: fixture.awayShort || fixture.awayTeam,
          homeLogo: fixture.homeLogo,
          awayLogo: fixture.awayLogo,
          scoreLabel: hasFixtureScore(fixture)
            ? `${fixture.homeGoals}–${fixture.awayGoals}`
            : "No score",
          kickoff: fixture.kickoff,
        }));

      rounds.push({
        round,
        roundNumber: parseRoundNumber(round),
        winners,
        topScore,
        playerScores,
        fixtures,
      });
    });

    return rounds.sort((a, b) => sortRoundsDescending(a.round, b.round));
  }, [fixturesById, predictions, userNames]);

  const winnerFilters = React.useMemo(() => {
    const { winCounts } = getWeeklyWinnerCounts(predictions, fixturesById);

    return Array.from(winCounts.values())
      .map((winnerCount) => ({
        userId: winnerCount.userId,
        name: userNames.get(winnerCount.userId) ?? "Unknown",
        wins: winnerCount.wins,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [fixturesById, predictions, userNames]);

  const selectedWinner = winnerFilters.find(
    (winner) => winner.userId === selectedWinnerId,
  );

  const filteredHistory = selectedWinnerId
    ? history.filter((round) =>
        round.winners.some((winner) => winner.userId === selectedWinnerId),
      )
    : history;

  const loading = predictionsLoading || loadingFixtures || usersLoading;
  const error = predictionsError || fixturesError || usersError;

  const updateWinnerFilter = (winnerId: string) => {
    if (!winnerId) {
      setSearchParams({});
      return;
    }
    setSearchParams({ winner: winnerId });
  };

  return (
    <div className="winners-history">
      <section className="card winners-history-hero">
        <div>
          <p className="eyebrow">Weekly winners</p>
          <h2>All winners history</h2>
          <p className="winners-history-hero__subtitle">
            Review every completed gameweek, the winning player score, the match
            results, and each player&apos;s weekly total.
          </p>
        </div>
        <Link className="button-secondary winners-history-back" to="/dashboard">
          Back to dashboard
        </Link>
      </section>

      {error && (
        <section className="card dashboard-alert" role="alert">
          {error}
        </section>
      )}

      <section className="card winners-history-filters">
        <label htmlFor="winner-filter">Filter by winner</label>
        <select
          id="winner-filter"
          value={selectedWinnerId}
          onChange={(event) => updateWinnerFilter(event.target.value)}
        >
          <option value="">All weekly winners</option>
          {winnerFilters.map((winner) => (
            <option key={winner.userId} value={winner.userId}>
              {winner.name} ({winner.wins})
            </option>
          ))}
        </select>
        {selectedWinner && (
          <button
            type="button"
            className="button-secondary"
            onClick={() => updateWinnerFilter("")}
          >
            Clear {selectedWinner.name}
          </button>
        )}
      </section>

      {loading ? (
        <div className="card winners-history-empty">Loading winners history…</div>
      ) : filteredHistory.length === 0 ? (
        <div className="card winners-history-empty">
          No completed weekly wins found{selectedWinner ? ` for ${selectedWinner.name}` : ""}.
        </div>
      ) : (
        <section className="winners-history-list">
          {filteredHistory.map((round) => (
            <article className="card winners-history-card" key={round.round}>
              <div className="winners-history-card__header">
                <div>
                  <p className="eyebrow">{round.round}</p>
                  <h3>
                    {round.winners.length
                      ? round.winners.map((winner) => winner.name).join(" & ")
                      : "No weekly winner"}
                  </h3>
                  <p className="panel-subtitle">
                    Winning score: {round.topScore} pts · {round.playerScores.length} players scored
                  </p>
                </div>
                <div className="winners-history-winner-chips">
                  {round.winners.map((winner) => (
                    <button
                      type="button"
                      className="pill winners-history-chip"
                      key={winner.userId}
                      onClick={() => updateWinnerFilter(winner.userId)}
                    >
                      {winner.name}
                    </button>
                  ))}
                </div>
              </div>

              <div className="winners-history-card__grid">
                <div>
                  <h4>Match scores</h4>
                  <div className="winners-history-fixtures">
                    {round.fixtures.map((fixture) => (
                      <div className="winners-history-fixture" key={fixture.id}>
                        <span className="winners-history-team">
                          <img src={fixture.homeLogo} alt={fixture.home} />
                          {fixture.home}
                        </span>
                        <strong>{fixture.scoreLabel}</strong>
                        <span className="winners-history-team winners-history-team--away">
                          {fixture.away}
                          <img src={fixture.awayLogo} alt={fixture.away} />
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h4>Player totals</h4>
                  <div className="winners-history-table" role="table">
                    {round.playerScores.map((player, index) => (
                      <div
                        className={`winners-history-row ${
                          round.winners.some((winner) => winner.userId === player.userId)
                            ? "is-winner"
                            : ""
                        }`}
                        role="row"
                        key={player.userId}
                      >
                        <span>{getTiedRank(round.playerScores, index, (playerScore) => playerScore.points)}</span>
                        <span>{player.name}</span>
                        <span>{player.exact} exact</span>
                        <span>{player.results} results</span>
                        <strong>{player.points} pts</strong>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </article>
          ))}
        </section>
      )}
    </div>
  );
};

export default WinnersHistoryPage;
