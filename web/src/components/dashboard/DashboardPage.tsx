import React from "react";
import { Link } from "react-router-dom";
import type { User } from "firebase/auth";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../firebase";
import { useLiveFixtures } from "../../context/LiveFixturesContext";
import { getNextPremierLeagueGameweekFixtures, type Fixture } from "../../api/football";
import { scorePrediction } from "../../utils/scoring";
import { timeUK, UK_TZ } from "../../utils/dates";
import {
  getFixtureStatusLabel,
  hasFixtureStarted,
  hasFixtureScore,
  isFixtureFinished,
  isFixtureLive,
  isFixturePostponed,
} from "../../utils/fixtures";

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

const ResultBreakdownChart: React.FC<{
  data: { round: string; exact: number; result: number }[];
}> = ({ data }) => {
  if (data.length === 0) {
    return (
      <div className="sparkline-empty">
        <span>No results yet</span>
      </div>
    );
  }

  const maxTotal = Math.max(
    ...data.map((entry) => entry.exact + entry.result)
  );

  return (
    <div className="result-chart" role="img" aria-label="Exact scores and results by gameweek">
      {data.map((entry) => {
        const total = entry.exact + entry.result;
        const exactHeight = maxTotal ? (entry.exact / maxTotal) * 100 : 0;
        const resultHeight = maxTotal ? (entry.result / maxTotal) * 100 : 0;
        const roundNumber = parseRoundNumber(entry.round);
        const label = Number.isNaN(roundNumber)
          ? entry.round.replace("Matchday", "MD")
          : `MD ${roundNumber}`;

        return (
          <div className="result-bar" key={entry.round}>
            <div className="result-bar__stack" aria-hidden="true">
              <div
                className="result-bar__segment result-bar__segment--exact"
                style={{ height: `${exactHeight}%` }}
              />
              <div
                className="result-bar__segment result-bar__segment--result"
                style={{ height: `${resultHeight}%` }}
              />
            </div>
            <span className="result-bar__value">{total}</span>
            <span className="result-bar__label">{label}</span>
          </div>
        );
      })}
      <div className="result-chart__legend">
        <span>
          <span className="legend-swatch legend-swatch--exact" />
          Exact score
        </span>
        <span>
          <span className="legend-swatch legend-swatch--result" />
          Correct result
        </span>
      </div>
    </div>
  );
};

const DashboardPage: React.FC<Props> = ({ user }) => {
  const {
    fixturesById,
    loadingFixtures,
    fixturesError,
    lastUpdated,
    notificationsSupported,
    notificationPermission,
    notificationsEnabled,
    requestNotificationPermission,
    disableNotifications,
    backgroundPushEnabled,
  } = useLiveFixtures();
  const [predictions, setPredictions] = React.useState<PredictionDoc[]>([]);
  const [predictionsLoading, setPredictionsLoading] = React.useState(true);
  const [predictionsError, setPredictionsError] = React.useState<string | null>(
    null
  );
  const [selectedFixture, setSelectedFixture] = React.useState<Fixture | null>(
    null
  );
  const [gameweekFixtures, setGameweekFixtures] = React.useState<Fixture[]>([]);
  const [gameweekLoading, setGameweekLoading] = React.useState(true);
  const [gameweekError, setGameweekError] = React.useState<string | null>(null);
  const [leaderboardRank, setLeaderboardRank] = React.useState<{
    rank: number;
    total: number;
    points: number;
  } | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    const firstRun = { current: true } as { current: boolean };

    const loadGameweek = async () => {
      try {
        if (firstRun.current) {
          setGameweekLoading(true);
        }
        const fixtures = await getNextPremierLeagueGameweekFixtures();
        if (cancelled) return;
        fixtures.sort(
          (a, b) => new Date(a.kickoff).getTime() - new Date(b.kickoff).getTime()
        );
        setGameweekFixtures(fixtures);
        setGameweekError(null);
      } catch (err: unknown) {
        console.error("Failed to load dashboard gameweek fixtures", err);
        if (!cancelled) {
          setGameweekError(
            err instanceof Error
              ? err.message
              : "Failed to load the next gameweek fixtures."
          );
        }
      } finally {
        if (!cancelled && firstRun.current) {
          setGameweekLoading(false);
          firstRun.current = false;
        }
      }
    };

    loadGameweek();
    const intervalId = window.setInterval(loadGameweek, 60_000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

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

  // Leaderboard rank: subscribe to ALL predictions, compute rank for current user
  React.useEffect(() => {
    const ref = collection(db, "predictions");
    const unsub = onSnapshot(ref, (snap) => {
      const pointsByUser: Record<string, number> = {};

      snap.forEach((docSnap) => {
        const data = docSnap.data();
        const uid: string = data.userId;
        if (!uid) return;
        const fixture = fixturesById[data.fixtureId];
        if (!fixture) return;
        const { points } = scorePrediction(
          data.predHome ?? null,
          data.predAway ?? null,
          fixture.homeGoals,
          fixture.awayGoals
        );
        if (points == null) return;
        pointsByUser[uid] = (pointsByUser[uid] ?? 0) + points;
      });

      const sorted = Object.entries(pointsByUser).sort((a, b) => b[1] - a[1]);
      const total = sorted.length;
      const rankIndex = sorted.findIndex(([uid]) => uid === user.uid);
      const myPoints = pointsByUser[user.uid] ?? 0;

      if (rankIndex !== -1) {
        setLeaderboardRank({ rank: rankIndex + 1, total, points: myPoints });
      } else if (total > 0) {
        setLeaderboardRank({ rank: total, total, points: 0 });
      } else {
        setLeaderboardRank(null);
      }
    });

    return () => unsub();
  }, [user.uid, fixturesById]);

  const fixturesForRound = React.useMemo(() => {
    return [...gameweekFixtures]
      .map((fixture) => fixturesById[fixture.id] ?? fixture)
      .sort(
      (a, b) => new Date(a.kickoff).getTime() - new Date(b.kickoff).getTime()
    );
  }, [fixturesById, gameweekFixtures]);

  const currentRoundLabel = fixturesForRound[0]?.round ?? null;

  const firstFixture = fixturesForRound[0] ?? null;
  const firstFixtureStarted = Boolean(firstFixture && hasFixtureStarted(firstFixture));

  const liveFixtures = fixturesForRound.filter(
    (fixture) => isFixtureLive(fixture)
  );
  const finishedFixtures = fixturesForRound.filter(
    (fixture) => isFixtureFinished(fixture)
  );
  const postponedFixtures = fixturesForRound.filter((fixture) => isFixturePostponed(fixture));
  const countableFixturesForRound = React.useMemo(
    () => fixturesForRound.filter((fixture) => !isFixturePostponed(fixture)),
    [fixturesForRound]
  );

  const predictionStatus = React.useMemo(() => {
    if (!countableFixturesForRound.length) return null;
    const fixtureIds = new Set(
      countableFixturesForRound.map((fixture) => fixture.id)
    );
    const predictedCount = predictions.filter(
      (prediction) => prediction.predHome != null && prediction.predAway != null
        && fixtureIds.has(prediction.fixtureId)
    ).length;

    return {
      predictedCount,
      total: fixtureIds.size,
    };
  }, [countableFixturesForRound, predictions]);

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

  const resultBreakdown = React.useMemo(() => {
    const countsByRound = new Map<string, { exact: number; result: number }>();

    predictions.forEach((prediction) => {
      const fixture = fixturesById[prediction.fixtureId];
      if (!fixture) return;

      const scored = scorePrediction(
        prediction.predHome,
        prediction.predAway,
        fixture.homeGoals,
        fixture.awayGoals
      );

      if (scored.status === "pending") return;

      const current = countsByRound.get(prediction.round) ?? {
        exact: 0,
        result: 0,
      };

      if (scored.status === "exact") current.exact += 1;
      if (scored.status === "result") current.result += 1;

      countsByRound.set(prediction.round, current);
    });

    const ordered = Array.from(countsByRound.entries()).sort((a, b) => {
      const numA = parseRoundNumber(a[0]);
      const numB = parseRoundNumber(b[0]);
      if (Number.isNaN(numA) || Number.isNaN(numB)) {
        return a[0].localeCompare(b[0]);
      }
      return numA - numB;
    });

    return ordered
      .slice(-6)
      .map(([round, values]) => ({ round, ...values }));
  }, [fixturesById, predictions]);

  const kickoffLabel = firstFixture
    ? `${firstFixture.homeShort} vs ${firstFixture.awayShort} • ${timeUK(
        firstFixture.kickoff
      )}`
    : "No fixtures loaded";

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

  const loading = loadingFixtures || predictionsLoading || gameweekLoading;

  const notificationHelperText = !notificationsSupported
    ? "This browser does not support notifications."
    : notificationPermission === "denied"
    ? "Notifications are blocked in browser settings for this device."
    : notificationsEnabled
    ? backgroundPushEnabled
      ? "Background push is active (works even when the app is closed)."
      : "Live alerts are on while this app is open."
    : "Turn on notifications to get free alerts for goals and full-time results.";

  const handleNotificationToggle = async () => {
    if (!notificationsSupported) return;

    if (notificationsEnabled) {
      await disableNotifications();
      return;
    }

    try {
      await requestNotificationPermission();
    } catch (error) {
      console.error("Failed to enable notifications", error);
    }
  };

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
  const selectedTeamHomeShort =
    selectedFixture?.homeShort ?? selectedTeamHome;
  const selectedTeamAwayShort =
    selectedFixture?.awayShort ?? selectedTeamAway;
  const selectedHomeRecent = selectedFixture
    ? getTeamRecentFixtures(selectedTeamHome)
    : [];
  const selectedAwayRecent = selectedFixture
    ? getTeamRecentFixtures(selectedTeamAway)
    : [];
  const selectedHeadToHead = selectedFixture
    ? getHeadToHead(selectedTeamHome, selectedTeamAway)
    : [];

  const formatFixtureDate = (kickoff: string) =>
    new Date(kickoff).toLocaleDateString("en-GB", {
      timeZone: UK_TZ,
      weekday: "short",
      day: "2-digit",
      month: "short",
    });

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
          {currentRoundLabel && (
            <div className="dashboard-hero__meta">
              <span className="pill">{currentRoundLabel}</span>
              <span className="pill pill--ghost">
                Live update {lastUpdatedLabel}
              </span>
            </div>
          )}
        </div>
        <div className="dashboard-hero__right">
          <div className="hero-highlight">
            <span className="hero-label">Prediction deadline</span>
            <span className="hero-value">{kickoffLabel}</span>
            <span className="hero-sub">
              {firstFixtureStarted
                ? "Deadline passed for new entries and amendments."
                : "This is the deadline for new entries and amendments."}
            </span>
          </div>
          <Link className="hero-progress hero-progress--link" to="/predictions">
            <span className="hero-label">Predictions complete</span>
            <div className="progress-bar" role="progressbar" aria-valuenow={completionPercent} aria-valuemin={0} aria-valuemax={100}>
              <div className="progress-bar__fill" style={{ width: `${completionPercent}%` }} />
            </div>
            <span className="hero-sub">
              {predictionStatus
                ? `${predictionStatus.predictedCount}/${predictionStatus.total} fixtures predicted`
                : "No gameweek loaded"}
            </span>
            <span className="hero-sub hero-sub--link">Go to predictions</span>
          </Link>
        </div>
      </section>

      {(fixturesError || predictionsError || gameweekError) && (
        <section className="card dashboard-alert" role="alert">
          {gameweekError || fixturesError || predictionsError}
        </section>
      )}

      <section className="card dashboard-alert dashboard-alert--notifications" role="status" aria-live="polite">
        <div>
          <strong>Live notifications</strong>
          <p>{notificationHelperText}</p>
        </div>
        <button
          type="button"
          className="button-secondary"
          onClick={handleNotificationToggle}
          disabled={!notificationsSupported}
        >
          {notificationsEnabled ? "Turn off" : "Turn on"}
        </button>
      </section>

      <section className="dashboard-grid">
        <div className="card stat-card">
          <div className="stat-card__header">
            <span className="stat-label">Live matches</span>
            <span className="stat-pill stat-pill--live">Now</span>
          </div>
          <div className="stat-card__body">
            <span className="stat-value">
              {loading ? "…" : liveFixtures.length}
            </span>
            <span className="stat-subtext">Matches happening now</span>
          </div>
        </div>
        <div className="card stat-card">
          <div className="stat-card__header">
            <span className="stat-label">Finished</span>
            <span className="stat-pill">Final</span>
          </div>
          <div className="stat-card__body">
            <span className="stat-value">
              {loading ? "…" : finishedFixtures.length}
            </span>
            <span className="stat-subtext">Results locked in</span>
          </div>
        </div>
        <div className="card stat-card">
          <div className="stat-card__header">
            <span className="stat-label">Postponed</span>
            <span className="stat-pill pill--ghost">PST</span>
          </div>
          <div className="stat-card__body">
            <span className="stat-value">
              {loading ? "…" : postponedFixtures.length}
            </span>
            <span className="stat-subtext">Matches moved to a later date</span>
          </div>
        </div>
        <div className="card stat-card">
          <div className="stat-card__header">
            <span className="stat-label">Your rank</span>
            <span className="stat-pill">Season</span>
          </div>
          <div className="stat-card__body">
            <span className="stat-value">
              {leaderboardRank
                ? `${leaderboardRank.rank}${
                    leaderboardRank.rank === 1
                      ? "st"
                      : leaderboardRank.rank === 2
                      ? "nd"
                      : leaderboardRank.rank === 3
                      ? "rd"
                      : "th"
                  }`
                : "—"}
            </span>
            <span className="stat-subtext">
              {leaderboardRank
                ? `${leaderboardRank.points} pts · of ${leaderboardRank.total} players`
                : "No predictions yet"}
            </span>
          </div>
        </div>
      </section>

      <section className="dashboard-panels">
        <div className="card dashboard-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Live gameweek flow</p>
              <h3>Timeline</h3>
              <p className="panel-subtitle">
                Click a game to view recent form.
              </p>
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
              const hasScore = hasFixtureScore(fixture);
              const isLive = isFixtureLive(fixture) && hasScore;
              const isFinished = isFixtureFinished(fixture);
              const isPostponed = isFixturePostponed(fixture);
              const statusLabel = isPostponed
                ? "PST"
                : isLive
                ? "LIVE"
                : isFinished
                ? "FT"
                : "UPCOMING";
              const kickoffTime = timeUK(fixture.kickoff);
              const kickoffDate = formatFixtureDate(fixture.kickoff);
              const scoreLabel = hasScore
                ? `${fixture.homeGoals}–${fixture.awayGoals}`
                : getFixtureStatusLabel(fixture, kickoffTime);
              const scoreClassName = `timeline-score${
                hasScore ? "" : " timeline-score--upcoming"
              }`;
              const subLabel = `${kickoffDate} • ${kickoffTime} • ${fixture.round}`;

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
            {firstFixtureStarted && (
              <p className="dashboard-empty">
                Predictions are now locked for this gameweek.
              </p>
            )}
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
          <div className="trend-secondary">
            <h4>Exact scores & results</h4>
            <ResultBreakdownChart data={resultBreakdown} />
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
                <h4>{selectedTeamHomeShort} form</h4>
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
                    const opponentShort =
                      fixture.homeTeam === selectedTeamHome
                        ? fixture.awayShort
                        : fixture.homeShort;
                    const score = `${fixture.homeGoals ?? "–"}-${
                      fixture.awayGoals ?? "–"
                    }`;
                    return (
                      <li key={fixture.id}>
                        <span className={`form-pill form-pill--${badge.result}`}>
                          {badge.label}
                        </span>
                        <span className="form-team">
                          vs {opponentShort || opponent}
                        </span>
                        <span className="form-score">{score}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>

              <div className="dashboard-modal__panel">
                <h4>{selectedTeamAwayShort} form</h4>
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
                    const opponentShort =
                      fixture.homeTeam === selectedTeamAway
                        ? fixture.awayShort
                        : fixture.homeShort;
                    const score = `${fixture.homeGoals ?? "–"}-${
                      fixture.awayGoals ?? "–"
                    }`;
                    return (
                      <li key={fixture.id}>
                        <span className={`form-pill form-pill--${badge.result}`}>
                          {badge.label}
                        </span>
                        <span className="form-team">
                          vs {opponentShort || opponent}
                        </span>
                        <span className="form-score">{score}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>

            <div className="dashboard-modal__panel">
              <h4>Recent head-to-heads</h4>
              <ul className="head-to-head-list">
                {selectedHeadToHead.length === 0 && (
                  <li>No recent head-to-head fixtures.</li>
                )}
                {selectedHeadToHead.map((fixture) => (
                  <li key={fixture.id} className="head-to-head-item">
                    <div className="head-to-head-row">
                      <span className="form-team">
                        {fixture.homeShort} vs {fixture.awayShort}
                      </span>
                      <span className="form-score">
                        {fixture.homeGoals ?? "–"}-{fixture.awayGoals ?? "–"}
                      </span>
                    </div>
                    <span className="form-meta">{timeUK(fixture.kickoff)}</span>
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
