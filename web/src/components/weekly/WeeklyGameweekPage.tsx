// src/components/weekly/WeeklyGameweekPage.tsx
import React from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "../../firebase";
import { scorePrediction } from "../../utils/scoring";
import { useLiveFixtures } from "../../context/LiveFixturesContext";
import {
  getNextPremierLeagueGameweekFixtures,
  type Fixture,
} from "../../api/football";
import { formatFirstName } from "../../utils/displayName";
import { useUsers } from "../../hooks/useUsers";
import { formatCurrencyGBP } from "../../utils/currency";
import {
  hasFixtureStarted,
  isFixtureFinished,
  isFixturePostponed,
  isFixtureLive,
} from "../../utils/fixtures";
import { timeUK } from "../../utils/dates";

interface PredictionDoc {
  userId: string;
  userDisplayName: string;
  fixtureId: number;
  predHome: number | null;
  predAway: number | null;
  kickoff: string;
  round: string;
}

interface WeeklyRow {
  userId: string;
  userDisplayName: string;
  totalPoints: number;
}

interface RoundData {
  fixturesList: Fixture[];
  earliestKickoff: Date | null;
  revealPredictions: boolean;
  weeklyRows: WeeklyRow[];
  predsByUserFixture: Record<string, PredictionDoc>;
  leaderPoints: number;
}

const hasCompletedPrediction = (prediction?: PredictionDoc): boolean =>
  Boolean(prediction && prediction.predHome != null && prediction.predAway != null);

const WeeklyGameweekPage: React.FC = () => {
  const [predictions, setPredictions] = React.useState<PredictionDoc[]>([]);
  const [predictionsLoading, setPredictionsLoading] = React.useState(true);
  const [predictionsError, setPredictionsError] = React.useState<string | null>(null);
  const [currentGameweekFixtures, setCurrentGameweekFixtures] = React.useState<Fixture[]>([]);
  const [currentGameweekLoading, setCurrentGameweekLoading] = React.useState(true);
  const [currentGameweekError, setCurrentGameweekError] = React.useState<string | null>(null);

  const { fixturesById, loadingFixtures, fixturesError } = useLiveFixtures();
  const { users, loading: loadingUsers, error: usersError } = useUsers();

  /* 1) Listen to ALL predictions */
  React.useEffect(() => {
    const ref = collection(db, "predictions");
    const unsub = onSnapshot(
      ref,
      (snap) => {
        const list: PredictionDoc[] = [];
        snap.forEach((doc) => {
          const data = doc.data();
          list.push({
            userId: data.userId,
            userDisplayName: formatFirstName(
              data.userDisplayName ?? data.userEmail ?? "Unknown"
            ),
            fixtureId: data.fixtureId,
            predHome: data.predHome ?? null,
            predAway: data.predAway ?? null,
            kickoff: data.kickoff,
            round: data.round ?? "Unknown",
          });
        });
        setPredictions(list);
        setPredictionsLoading(false);
      },
      (err) => {
        console.error("Error loading predictions", err);
        setPredictionsError("Failed to load predictions.");
        setPredictionsLoading(false);
      }
    );
    return () => unsub();
  }, []);

  /* 2) Fetch current gameweek fixtures (polled every 60s) */
  React.useEffect(() => {
    let cancelled = false;
    const firstRun = { current: true } as { current: boolean };

    const loadCurrentGameweek = async () => {
      try {
        if (firstRun.current) setCurrentGameweekLoading(true);
        const fixtures = await getNextPremierLeagueGameweekFixtures();
        if (cancelled) return;
        fixtures.sort((a, b) => new Date(a.kickoff).getTime() - new Date(b.kickoff).getTime());
        setCurrentGameweekFixtures(fixtures);
        setCurrentGameweekError(null);
      } catch (err: unknown) {
        console.error("Failed to load weekly gameweek fixtures", err);
        if (!cancelled) {
          setCurrentGameweekError(
            err instanceof Error ? err.message : "Failed to load the current gameweek fixtures."
          );
        }
      } finally {
        if (!cancelled && firstRun.current) {
          setCurrentGameweekLoading(false);
          firstRun.current = false;
        }
      }
    };

    loadCurrentGameweek();
    const intervalId = window.setInterval(loadCurrentGameweek, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  const detectedCurrentRound = currentGameweekFixtures[0]?.round ?? null;

  const parseMatchdayNum = (round: string): number => {
    const m = round.match(/(\d+)$/);
    return m ? parseInt(m[1], 10) : NaN;
  };

  const currentRound = detectedCurrentRound;

  const previousRound = React.useMemo(() => {
    if (!currentRound) return null;
    const currentNum = parseMatchdayNum(currentRound);
    if (!isNaN(currentNum) && currentNum > 1) return `Matchday ${currentNum - 1}`;
    return null;
  }, [currentRound]);

  const buildRoundData = React.useCallback(
    (roundName: string | null): RoundData => {
      if (!roundName) {
        return {
          fixturesList: [],
          earliestKickoff: null,
          revealPredictions: false,
          weeklyRows: [],
          predsByUserFixture: {},
          leaderPoints: 0,
        };
      }

      let fixturesForRound: Fixture[];
      if (roundName === detectedCurrentRound) {
        fixturesForRound = currentGameweekFixtures;
      } else {
        const byRound = Object.values(fixturesById).filter(
          (fixture) => fixture.round === roundName
        );
        if (byRound.length > 0) {
          fixturesForRound = byRound;
        } else {
          const roundPredictions = predictions.filter((p) => p.round === roundName);
          const predFixtureIds = new Set(roundPredictions.map((p) => p.fixtureId));
          fixturesForRound = Object.values(fixturesById).filter((f) => predFixtureIds.has(f.id));
        }

        if (fixturesForRound.length > 1) {
          const latestKickoff = Math.max(
            ...fixturesForRound.map((f) => new Date(f.kickoff).getTime())
          );
          const CLUSTER_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
          fixturesForRound = fixturesForRound.filter(
            (f) => latestKickoff - new Date(f.kickoff).getTime() <= CLUSTER_WINDOW_MS
          );
        }
      }

      const fixturesList = fixturesForRound.sort(
        (a, b) => new Date(a.kickoff).getTime() - new Date(b.kickoff).getTime()
      );

      const earliestKickoff = fixturesList.length
        ? new Date(Math.min(...fixturesList.map((f) => new Date(f.kickoff).getTime())))
        : null;

      const roundPreds = predictions.filter((p) => p.round === roundName);

      const revealPredictions =
        fixturesList.some((f) => hasFixtureStarted(f)) ||
        roundPreds.some((p) => new Date(p.kickoff).getTime() <= Date.now());

      const activeUserIds = new Set(users.map((u) => u.id));

      const byUser: Record<string, WeeklyRow> = {};
      const predsByUserFixture: Record<string, PredictionDoc> = {};

      for (const p of roundPreds) {
        if (!loadingUsers && !activeUserIds.has(p.userId)) continue;
        predsByUserFixture[`${p.userId}_${p.fixtureId}`] = p;

        const fixture: Fixture | undefined =
          fixturesById[p.fixtureId] ??
          currentGameweekFixtures.find((candidate) => candidate.id === p.fixtureId);

        let points: number | null = null;
        if (fixture) {
          const scored = scorePrediction(p.predHome, p.predAway, fixture.homeGoals, fixture.awayGoals);
          points = scored.points;
        }

        if (!byUser[p.userId]) {
          byUser[p.userId] = { userId: p.userId, userDisplayName: p.userDisplayName, totalPoints: 0 };
        }
        if (points != null) byUser[p.userId].totalPoints += points;
      }

      const weeklyRows = Object.values(byUser).sort((a, b) => b.totalPoints - a.totalPoints);
      const leaderPoints = weeklyRows.length > 0 ? weeklyRows[0].totalPoints : 0;

      return { fixturesList, earliestKickoff, revealPredictions, weeklyRows, predsByUserFixture, leaderPoints };
    },
    [currentGameweekFixtures, detectedCurrentRound, fixturesById, predictions, users, loadingUsers]
  );

  const currentRoundData = React.useMemo(() => buildRoundData(currentRound), [buildRoundData, currentRound]);
  const previousRoundData = React.useMemo(() => buildRoundData(previousRound), [buildRoundData, previousRound]);

  const loading = predictionsLoading || loadingFixtures || currentGameweekLoading;
  const combinedError = predictionsError || fixturesError || currentGameweekError || usersError;

  if (loading) {
    return (
      <div style={{ padding: 16, color: "var(--text-muted)", fontSize: 14 }}>
        Loading gameweek…
      </div>
    );
  }

  if (!currentRound) {
    return (
      <div className="card">
        <h2 style={{ marginTop: 0 }}>This Gameweek</h2>
        <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
          No gameweek predictions found yet. Once everyone starts predicting,
          this view will show the live weekly race.
        </p>
      </div>
    );
  }

  const fmtKickoff = (d: Date | null) =>
    d?.toLocaleString("en-GB", {
      timeZone: "Europe/London",
      weekday: "short",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }) ?? null;

  const kickoffLabel = fmtKickoff(currentRoundData.earliestKickoff);
  const previousKickoffLabel = fmtKickoff(previousRoundData.earliestKickoff);

  const paidCount = users.filter((u) => u.hasPaid).length;
  const prizePot = paidCount * 5;

  const isRoundComplete = (roundData: RoundData) =>
    roundData.fixturesList.length > 0 &&
    roundData.fixturesList.every((f) => isFixtureFinished(f));

  const rankOrdinal = (n: number) => {
    const s = ["th", "st", "nd", "rd"];
    const v = n % 100;
    return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
  };

  // ─── Player card ──────────────────────────────────────────────────────────
  const renderPlayerCard = (row: WeeklyRow, rank: number, roundData: RoundData) => {
    const isLeader = roundData.leaderPoints > 0 && row.totalPoints === roundData.leaderPoints;

    return (
      <details key={row.userId} open className={`card gw-player-card${isLeader ? " gw-player-card--leader" : ""}`}>
        {/* Summary: rank · name · points · chevron */}
        <summary className="gw-player-summary">
          <span className="gw-rank-badge">{isLeader ? "🏆" : rankOrdinal(rank)}</span>
          <span className="gw-player-name">{row.userDisplayName}</span>
          <span className="gw-player-pts">
            <strong>{row.totalPoints}</strong>
            <span className="gw-pts-label">pts</span>
          </span>
          <span className="gw-chevron">▾</span>
        </summary>

        {/* One row per fixture */}
        <div className="gw-fixture-list">
          {roundData.fixturesList.map((f) => {
            const pred = roundData.predsByUserFixture[`${row.userId}_${f.id}`];
            const postponed = isFixturePostponed(f);
            const live = isFixtureLive(f);
            const hasScore = f.homeGoals != null && f.awayGoals != null;

            const { points, status } = pred
              ? scorePrediction(pred.predHome, pred.predAway, f.homeGoals, f.awayGoals)
              : { points: null, status: "pending" as const };

            const chipBg =
              status === "exact"  ? "rgba(34,197,94,0.18)"   :
              status === "result" ? "rgba(59,130,246,0.16)"  :
              status === "wrong"  ? "rgba(148,163,184,0.1)"  : "transparent";

            const chipColor =
              status === "exact"  ? "#b7ffd1" :
              status === "result" ? "#93c5fd" :
              "var(--text-muted)";

            return (
              <div key={f.id} className="gw-fixture-row">
                {/* Team crests + TLAs */}
                <div className="gw-fixture-teams">
                  <img src={f.homeLogo} alt={f.homeTeam} className="gw-badge-sm" />
                  <span className="gw-team-tla">{f.homeShort}</span>
                  <span className="gw-fixture-sep">–</span>
                  <span className="gw-team-tla">{f.awayShort}</span>
                  <img src={f.awayLogo} alt={f.awayTeam} className="gw-badge-sm" />
                </div>

                {/* Actual score / status */}
                <div className="gw-actual-result">
                  {postponed ? (
                    <span className="gw-status-chip gw-status-chip--pst">PST</span>
                  ) : live ? (
                    <span className="gw-status-chip gw-status-chip--live">LIVE</span>
                  ) : hasScore ? (
                    <span className="gw-score">{f.homeGoals}–{f.awayGoals}</span>
                  ) : (
                    <span className="gw-time">{timeUK(f.kickoff)}</span>
                  )}
                </div>

                {/* Prediction chip */}
                <div className="gw-pred-chip" style={{ background: chipBg }}>
                  {pred ? (
                    <>
                      {status === "exact" && <span className="gw-exact-star">★</span>}
                      <span style={{ color: chipColor, fontWeight: 700, fontSize: 13 }}>
                        {pred.predHome ?? "–"}–{pred.predAway ?? "–"}
                      </span>
                      {points != null && (
                        <span className="gw-pts-badge" style={{ color: chipColor }}>
                          +{points}
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="gw-no-pred">—</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </details>
    );
  };

  // ─── Round section ────────────────────────────────────────────────────────
  const renderRound = (
    title: string,
    roundName: string | null,
    roundData: RoundData,
    kickoffLabelText: string | null,
    isCollapsible = false,
    showPrizePot = false
  ) => {
    if (!roundName) return null;

    const leaders = roundData.weeklyRows.filter((r) => r.totalPoints === roundData.leaderPoints);
    const isJoint = leaders.length > 1;
    const roundComplete = isRoundComplete(roundData);
    const leaderLabel = roundComplete
      ? isJoint ? "Joint winners" : "Winner"
      : isJoint ? "Joint leaders" : "Leading";

    // Header card
    const headerCard = (
      <div className="card gw-header-card">
        <div className="gw-header-top">
          <div className="gw-header-text">
            <p className="eyebrow" style={{ margin: "0 0 2px" }}>{roundName}</p>
            <h2 style={{ margin: 0 }}>{title}</h2>
            {kickoffLabelText && (
              <p className="gw-kickoff-meta">First kick-off: {kickoffLabelText}</p>
            )}
          </div>
          {showPrizePot && prizePot > 0 && (
            <div className="gw-prize-pill">
              <span className="gw-prize-amount">{formatCurrencyGBP(prizePot)}</span>
              <span className="gw-prize-sub">{paidCount} paid</span>
            </div>
          )}
        </div>

        {roundData.leaderPoints > 0 && leaders.length > 0 && (
          <div className="gw-leader-banner">
            <span className="gw-leader-label">{leaderLabel}</span>
            <strong className="gw-leader-names">
              {leaders.map((l) => l.userDisplayName).join(" & ")}
            </strong>
            <span className="gw-leader-pts">{roundData.leaderPoints} pts</span>
          </div>
        )}

        {combinedError && (
          <p style={{ fontSize: 12, color: "var(--red)", margin: "8px 0 0" }}>{combinedError}</p>
        )}
      </div>
    );

    // Main content: rankings or hidden-predictions view
    const mainContent = roundData.revealPredictions ? (
      <div className="gw-player-list">
        {roundData.weeklyRows.length === 0 ? (
          <div className="card">
            <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>
              No predictions submitted yet.
            </p>
          </div>
        ) : (
          roundData.weeklyRows.map((row, index) => renderPlayerCard(row, index + 1, roundData))
        )}
      </div>
    ) : (
      // Pre-kickoff: show who has submitted predictions
      <div className="card gw-hidden-card">
        <p className="gw-hidden-title">Predictions locked until kick-off</p>
        <p className="gw-hidden-sub">
          Everyone&apos;s picks are hidden until the first fixture starts.
        </p>

        {users.length > 0 && (() => {
          const countableFixtures = roundData.fixturesList.filter((f) => !isFixturePostponed(f));
          const usersWithCounts = users
            .map((u) => ({
              userId: u.id,
              displayName: u.displayName,
              completed: countableFixtures.reduce((count, fixture) => {
                const pred = roundData.predsByUserFixture[`${u.id}_${fixture.id}`];
                return hasCompletedPrediction(pred) ? count + 1 : count;
              }, 0),
              total: countableFixtures.length,
            }))
            .sort((a, b) => b.completed - a.completed);

          return (
            <div className="gw-progress-grid">
              {usersWithCounts.map((u) => {
                const done = u.completed === u.total && u.total > 0;
                const partial = u.completed > 0 && !done;
                return (
                  <div
                    key={u.userId}
                    className={`gw-progress-item${done ? " gw-progress-item--done" : partial ? " gw-progress-item--partial" : ""}`}
                  >
                    <span className="gw-progress-name">{u.displayName}</span>
                    <span className="gw-progress-count">{u.completed}/{u.total}</span>
                    <div className="gw-progress-bar">
                      <div
                        className="gw-progress-bar__fill"
                        style={{ width: `${u.total > 0 ? (u.completed / u.total) * 100 : 0}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}

        {kickoffLabelText && (
          <p className="gw-hidden-kickoff">Unlocks at {kickoffLabelText}</p>
        )}
      </div>
    );

    if (isCollapsible) {
      return (
        <details className="gw-previous-section">
          <summary className="gw-previous-summary">
            <span className="gw-previous-title">{title}</span>
            {roundComplete && leaders.length > 0 && (
              <span className="gw-previous-winner">
                {isJoint ? "Joint: " : ""}{leaders.map((l) => l.userDisplayName).join(" & ")} · {roundData.leaderPoints} pts
              </span>
            )}
          </summary>
          <div className="gw-previous-body">
            {headerCard}
            {mainContent}
          </div>
        </details>
      );
    }

    return (
      <div className="gw-section">
        {headerCard}
        {mainContent}
      </div>
    );
  };

  return (
    <div className="gw-page">
      {renderRound("This Gameweek", currentRound, currentRoundData, kickoffLabel, false, true)}
      {renderRound("Previous Gameweek", previousRound, previousRoundData, previousKickoffLabel, true)}
    </div>
  );
};

export default WeeklyGameweekPage;
