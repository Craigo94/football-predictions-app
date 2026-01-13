import React from "react";
import type { User } from "firebase/auth";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../firebase";
import { useLiveFixtures } from "../../context/LiveFixturesContext";
import type { Fixture } from "../../api/football";
import { scorePrediction } from "../../utils/scoring";
import { timeUK } from "../../utils/dates";

interface Props {
  user: User;
}

interface PredictionDoc {
  fixtureId: number;
  predHome: number | null;
  predAway: number | null;
  kickoff: string;
  round: string;
}

interface RoundSummary {
  round: string;
  fixtures: Fixture[];
  earliestKickoff: number;
  latestKickoff: number;
}

const parseRoundNumber = (round: string) => {
  const match = round.match(/(\d+)/);
  return match ? Number(match[1]) : Number.NaN;
};

const Sparkline: React.FC<{ values: number[] }> = ({ values }) => {
  if (values.length === 0) {
    return (
      <div className="sparkline-empty">
        <span>No points yet</span>
      </div>
    );
  }

  const width = 220;
  const height = 64;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;

  const points = values.map((value, index) => {
    const x = (index / Math.max(values.length - 1, 1)) * (width - 12) + 6;
    const y = height - 10 - ((value - min) / range) * (height - 20);
    return `${x},${y}`;
  });

  return (
    <svg
      className="sparkline"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Points trend"
    >
      <defs>
        <linearGradient id="sparklineFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(0, 200, 83, 0.4)" />
          <stop offset="100%" stopColor="rgba(0, 200, 83, 0)" />
        </linearGradient>
      </defs>
      <polyline
        fill="none"
        stroke="rgba(0, 200, 83, 0.85)"
        strokeWidth={3}
        points={points.join(" ")}
      />
      <polygon
        fill="url(#sparklineFill)"
        points={`${points.join(" ")} ${width - 6},${height - 8} 6,${height - 8}`}
      />
    </svg>
  );
};

const DashboardPage: React.FC<Props> = ({ user }) => {
  const { fixturesById, loadingFixtures, fixturesError, lastUpdated } =
    useLiveFixtures();
  const [predictions, setPredictions] = React.useState<PredictionDoc[]>([]);
  const [predictionsLoading, setPredictionsLoading] = React.useState(true);
  const [predictionsError, setPredictionsError] = React.useState<string | null>(
    null
  );
  const [selectedFixture, setSelectedFixture] = React.useState<Fixture | null>(
    null
  );

  React.useEffect(() => {
    const ref = query(collection(db, "predictions"), where("userId", "==", user.uid));
    const unsub = onSnapshot(
      ref,
      (snap) => {
        const list: PredictionDoc[] = [];
        snap.forEach((doc) => {
          const data = doc.data();
          list.push({
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
        console.error("Failed to load predictions", err);
        setPredictionsError("Failed to load your predictions.");
        setPredictionsLoading(false);
      }
    );

    return () => unsub();
  }, [user.uid]);

  const roundSummaries = React.useMemo(() => {
    const grouped: Record<string, RoundSummary> = {};
    Object.values(fixturesById).forEach((fixture) => {
      if (!fixture.round) return;
      if (!grouped[fixture.round]) {
        grouped[fixture.round] = {
          round: fixture.round,
          fixtures: [],
          earliestKickoff: Number.POSITIVE_INFINITY,
          latestKickoff: 0,
        };
      }
      const kickoffTime = new Date(fixture.kickoff).getTime();
      grouped[fixture.round].fixtures.push(fixture);
      grouped[fixture.round].earliestKickoff = Math.min(
        grouped[fixture.round].earliestKickoff,
        kickoffTime
      );
      grouped[fixture.round].latestKickoff = Math.max(
        grouped[fixture.round].latestKickoff,
        kickoffTime
      );
    });

    return Object.values(grouped).sort(
      (a, b) => a.earliestKickoff - b.earliestKickoff
    );
  }, [fixturesById]);

  const currentRound = React.useMemo(() => {
    const now = Date.now();
    const active = roundSummaries.find((round) =>
      round.fixtures.some((fixture) => fixture.statusShort !== "FT")
    );

    if (active) return active;

    const future = roundSummaries.find((round) => round.latestKickoff >= now);
    return future ?? roundSummaries[roundSummaries.length - 1] ?? null;
  }, [roundSummaries]);

  const fixturesForRound = React.useMemo(() => {
    if (!currentRound) return [] as Fixture[];
    return [...currentRound.fixtures].sort(
      (a, b) => new Date(a.kickoff).getTime() - new Date(b.kickoff).getTime()
    );
  }, [currentRound]);

  const nextFixture = fixturesForRound.find(
    (fixture) => fixture.statusShort === "NS"
  );

  const liveFixtures = fixturesForRound.filter(
    (fixture) => fixture.statusShort !== "NS" && fixture.statusShort !== "FT"
  );
  const finishedFixtures = fixturesForRound.filter(
    (fixture) => fixture.statusShort === "FT"
  );

  const predictionStatus = React.useMemo(() => {
    if (!currentRound) return null;
    const roundPredictions = predictions.filter(
      (prediction) => prediction.round === currentRound.round
    );
    const predictedCount = roundPredictions.filter(
      (prediction) => prediction.predHome != null && prediction.predAway != null
    ).length;

    return {
      predictedCount,
      total: fixturesForRound.length,
    };
  }, [currentRound, fixturesForRound.length, predictions]);

  const trendValues = React.useMemo(() => {
    if (!predictions.length) return [] as number[];

    const pointsByRound = new Map<string, number>();

    predictions.forEach((prediction) => {
      const fixture = fixturesById[prediction.fixtureId];
      if (!fixture) return;

      const scored = scorePrediction(
        prediction.predHome,
        prediction.predAway,
        fixture.homeGoals,
        fixture.awayGoals
      );

      if (scored.points == null) return;

      const current = pointsByRound.get(prediction.round) ?? 0;
      pointsByRound.set(prediction.round, current + scored.points);
    });

    const ordered = Array.from(pointsByRound.entries()).sort((a, b) => {
      const numA = parseRoundNumber(a[0]);
      const numB = parseRoundNumber(b[0]);
      if (Number.isNaN(numA) || Number.isNaN(numB)) {
        return a[0].localeCompare(b[0]);
      }
      return numA - numB;
    });

    return ordered.slice(-6).map(([, value]) => value);
  }, [fixturesById, predictions]);

  const kickoffLabel = nextFixture
    ? `${nextFixture.homeShort} vs ${nextFixture.awayShort} • ${timeUK(
        nextFixture.kickoff
      )}`
    : "No upcoming fixture";

  const completionPercent = predictionStatus
    ? Math.round(
        (predictionStatus.predictedCount /
          Math.max(predictionStatus.total, 1)) *
          100
      )
    : 0;

  const lastUpdatedLabel = lastUpdated
    ? new Date(lastUpdated).toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "–";

  const loading = loadingFixtures || predictionsLoading;

  const getTeamRecentFixtures = React.useCallback(
    (team: string) =>
      Object.values(fixturesById)
        .filter(
          (fixture) =>
            fixture.statusShort === "FT" &&
            (fixture.homeTeam === team || fixture.awayTeam === team)
        )
        .sort(
          (a, b) => new Date(b.kickoff).getTime() - new Date(a.kickoff).getTime()
        )
        .slice(0, 5),
    [fixturesById]
  );

  const getHeadToHead = React.useCallback(
    (homeTeam: string, awayTeam: string) =>
      Object.values(fixturesById)
        .filter(
          (fixture) =>
            fixture.statusShort === "FT" &&
            ((fixture.homeTeam === homeTeam &&
              fixture.awayTeam === awayTeam) ||
              (fixture.homeTeam === awayTeam &&
                fixture.awayTeam === homeTeam))
        )
        .sort(
          (a, b) => new Date(b.kickoff).getTime() - new Date(a.kickoff).getTime()
        )
        .slice(0, 5),
    [fixturesById]
  );

  const renderFormBadge = (
    fixture: Fixture,
    team: string
  ): { label: string; result: string } => {
    const isHome = fixture.homeTeam === team;
    const teamGoals = isHome ? fixture.homeGoals : fixture.awayGoals;
    const oppGoals = isHome ? fixture.awayGoals : fixture.homeGoals;

    if (teamGoals == null || oppGoals == null) {
      return { label: "—", result: "pending" };
    }

    if (teamGoals > oppGoals) {
      return { label: "W", result: "win" };
    }

    if (teamGoals < oppGoals) {
      return { label: "L", result: "loss" };
    }

    return { label: "D", result: "draw" };
  };

  const selectedTeamHome = selectedFixture?.homeTeam ?? "";
  const selectedTeamAway = selectedFixture?.awayTeam ?? "";
  const selectedHomeRecent = selectedFixture
    ? getTeamRecentFixtures(selectedTeamHome)
    : [];
  const selectedAwayRecent = selectedFixture
    ? getTeamRecentFixtures(selectedTeamAway)
    : [];
  const selectedHeadToHead = selectedFixture
    ? getHeadToHead(selectedTeamHome, selectedTeamAway)
    : [];

  return (
    <div className="dashboard">
      <section className="dashboard-hero card">
        <div className="dashboard-hero__left">
          <p className="eyebrow">Your matchday hub</p>
          <h2>Welcome back, ready for the next kick-off?</h2>
          <p className="dashboard-hero__subtitle">
            Track live action, keep predictions up to date, and see how the
            week is unfolding in real time.
          </p>
          {currentRound && (
            <div className="dashboard-hero__meta">
              <span className="pill">{currentRound.round}</span>
              <span className="pill pill--ghost">
                Live update {lastUpdatedLabel}
              </span>
            </div>
          )}
        </div>
        <div className="dashboard-hero__right">
          <div className="hero-highlight">
            <span className="hero-label">Next fixture</span>
            <span className="hero-value">{kickoffLabel}</span>
            <span className="hero-sub">Stay ahead of lock-in deadlines.</span>
          </div>
          <div className="hero-progress">
            <span className="hero-label">Predictions complete</span>
            <div className="progress-bar" role="progressbar" aria-valuenow={completionPercent} aria-valuemin={0} aria-valuemax={100}>
              <div className="progress-bar__fill" style={{ width: `${completionPercent}%` }} />
            </div>
            <span className="hero-sub">
              {predictionStatus
                ? `${predictionStatus.predictedCount}/${predictionStatus.total} fixtures predicted`
                : "No gameweek loaded"}
            </span>
          </div>
        </div>
      </section>

      {(fixturesError || predictionsError) && (
        <section className="card dashboard-alert" role="alert">
          {fixturesError || predictionsError}
        </section>
      )}

      <section className="dashboard-grid">
        <div className="card stat-card">
          <span className="stat-label">Live matches</span>
          <span className="stat-value">
            {loading ? "…" : liveFixtures.length}
          </span>
          <span className="stat-subtext">Matches happening now</span>
        </div>
        <div className="card stat-card">
          <span className="stat-label">Finished</span>
          <span className="stat-value">
            {loading ? "…" : finishedFixtures.length}
          </span>
          <span className="stat-subtext">Results locked in</span>
        </div>
        <div className="card stat-card">
          <span className="stat-label">Prediction pace</span>
          <span className="stat-value">{completionPercent}%</span>
          <span className="stat-subtext">Stay on top of entries</span>
        </div>
      </section>

      <section className="dashboard-panels">
        <div className="card dashboard-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Live gameweek flow</p>
              <h3>Timeline</h3>
            </div>
            <span className="pill pill--live">
              {liveFixtures.length ? "Live" : "Upcoming"}
            </span>
          </div>
          <div className="timeline">
            {fixturesForRound.length === 0 && (
              <p className="dashboard-empty">No fixtures loaded yet.</p>
            )}
            {fixturesForRound.map((fixture) => {
              const hasScore =
                fixture.homeGoals != null && fixture.awayGoals != null;
              const isLive =
                fixture.statusShort !== "NS" && fixture.statusShort !== "FT" && hasScore;
              const isFinished = fixture.statusShort === "FT";
              const statusLabel = isLive
                ? "LIVE"
                : isFinished
                ? "FT"
                : "UPCOMING";
              const kickoffTime = timeUK(fixture.kickoff);
              const scoreLabel = hasScore
                ? `${fixture.homeGoals}–${fixture.awayGoals}`
                : `KO ${kickoffTime}`;
              const scoreClassName = `timeline-score${
                hasScore ? "" : " timeline-score--upcoming"
              }`;
              const subLabel = isLive
                ? `Live now • ${kickoffTime}`
                : isFinished
                ? `Full time • ${kickoffTime}`
                : `Kickoff ${kickoffTime}`;

              return (
                <button
                  type="button"
                  className="timeline-item"
                  key={fixture.id}
                  onClick={() => setSelectedFixture(fixture)}
                >
                  <div className={`timeline-dot ${isLive ? "is-live" : isFinished ? "is-finished" : ""}`} />
                  <div className="timeline-content">
                    <div className="timeline-row">
                      <span className="timeline-fixture" title={`${fixture.homeTeam} vs ${fixture.awayTeam}`}>
                        <span className="timeline-teams">
                          <span className="timeline-team">
                            <img src={fixture.homeLogo} alt={fixture.homeTeam} />
                            <span>{fixture.homeShort}</span>
                          </span>
                          <span className="timeline-vs">vs</span>
                          <span className="timeline-team">
                            <img src={fixture.awayLogo} alt={fixture.awayTeam} />
                            <span>{fixture.awayShort}</span>
                          </span>
                        </span>
                      </span>
                      <span className={`timeline-status ${isLive ? "is-live" : isFinished ? "is-finished" : ""}`}>
                        {statusLabel}
                      </span>
                    </div>
                    <div className="timeline-sub">{subLabel}</div>
                  </div>
                  <div className={scoreClassName}>{scoreLabel}</div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="card dashboard-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Your momentum</p>
              <h3>Points trend</h3>
            </div>
            <span className="pill pill--ghost">Last 6 gameweeks</span>
          </div>
          <Sparkline values={trendValues} />
          <div className="trend-metrics">
            <span>
              {trendValues.length ? Math.max(...trendValues) : 0} pts best week
            </span>
            <span>
              {trendValues.length
                ? Math.round(
                    trendValues.reduce((sum, value) => sum + value, 0) /
                      trendValues.length
                  )
                : 0} avg
            </span>
          </div>
        </div>
      </section>

      {selectedFixture && (
        <div className="modal-backdrop" onClick={() => setSelectedFixture(null)}>
          <div
            className="modal-card dashboard-modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="modal-header">
              <div>
                <p className="modal-eyebrow">Match preview</p>
                <h3>
                  {selectedFixture.homeTeam} vs {selectedFixture.awayTeam}
                </h3>
                <p className="modal-description">
                  {timeUK(selectedFixture.kickoff)} • {selectedFixture.round}
                </p>
              </div>
              <button
                className="fx-btn"
                type="button"
                onClick={() => setSelectedFixture(null)}
              >
                Close
              </button>
            </div>

            <div className="dashboard-modal__grid">
              <div className="dashboard-modal__panel">
                <h4>{selectedTeamHome} form</h4>
                <ul>
                  {selectedHomeRecent.length === 0 && (
                    <li>No finished matches yet.</li>
                  )}
                  {selectedHomeRecent.map((fixture) => {
                    const badge = renderFormBadge(fixture, selectedTeamHome);
                    const opponent =
                      fixture.homeTeam === selectedTeamHome
                        ? fixture.awayTeam
                        : fixture.homeTeam;
                    const score = `${fixture.homeGoals ?? "–"}-${
                      fixture.awayGoals ?? "–"
                    }`;
                    return (
                      <li key={fixture.id}>
                        <span className={`form-pill form-pill--${badge.result}`}>
                          {badge.label}
                        </span>
                        <span className="form-team">vs {opponent}</span>
                        <span className="form-score">{score}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>

              <div className="dashboard-modal__panel">
                <h4>{selectedTeamAway} form</h4>
                <ul>
                  {selectedAwayRecent.length === 0 && (
                    <li>No finished matches yet.</li>
                  )}
                  {selectedAwayRecent.map((fixture) => {
                    const badge = renderFormBadge(fixture, selectedTeamAway);
                    const opponent =
                      fixture.homeTeam === selectedTeamAway
                        ? fixture.awayTeam
                        : fixture.homeTeam;
                    const score = `${fixture.homeGoals ?? "–"}-${
                      fixture.awayGoals ?? "–"
                    }`;
                    return (
                      <li key={fixture.id}>
                        <span className={`form-pill form-pill--${badge.result}`}>
                          {badge.label}
                        </span>
                        <span className="form-team">vs {opponent}</span>
                        <span className="form-score">{score}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>

            <div className="dashboard-modal__panel">
              <h4>Recent head-to-heads</h4>
              <ul>
                {selectedHeadToHead.length === 0 && (
                  <li>No recent head-to-head fixtures.</li>
                )}
                {selectedHeadToHead.map((fixture) => (
                  <li key={fixture.id}>
                    <span className="form-team">
                      {fixture.homeTeam} vs {fixture.awayTeam}
                    </span>
                    <span className="form-score">
                      {fixture.homeGoals ?? "–"}-{fixture.awayGoals ?? "–"}
                    </span>
                    <span className="form-meta">
                      {timeUK(fixture.kickoff)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DashboardPage;
