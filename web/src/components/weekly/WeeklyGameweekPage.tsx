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
import { hasFixtureStarted, isFixtureFinished, isFixturePostponed } from "../../utils/fixtures";

interface PredictionDoc {
  userId: string;
  userDisplayName: string;
  fixtureId: number;
  predHome: number | null;
  predAway: number | null;
  kickoff: string; // ISO date string
  round: string;   // e.g. "Matchday 12"
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
  Boolean(
    prediction &&
      prediction.predHome != null &&
      prediction.predAway != null
  );

// Fixed column widths so sticky cols don't overlap
const PLAYER_COL_WIDTH = 100;
const PTS_COL_WIDTH = 60;
const FIXTURE_COL_WIDTH = 76;

// Slightly narrower widths for compact/mobile layouts
const COMPACT_PLAYER_COL_WIDTH = 70;
const COMPACT_PTS_COL_WIDTH = 40;

const WeeklyGameweekPage: React.FC = () => {
  const [predictions, setPredictions] = React.useState<PredictionDoc[]>([]);
  const [predictionsLoading, setPredictionsLoading] = React.useState(true);
  const [predictionsError, setPredictionsError] = React.useState<string | null>(
    null
  );
  const [isCompactLayout, setIsCompactLayout] = React.useState(false);
  const [currentGameweekFixtures, setCurrentGameweekFixtures] = React.useState<
    Fixture[]
  >([]);
  const [currentGameweekLoading, setCurrentGameweekLoading] = React.useState(true);
  const [currentGameweekError, setCurrentGameweekError] = React.useState<string | null>(null);

  // Use narrower sticky columns on smaller screens so fixture columns stay visible
  React.useEffect(() => {
    const mq = window.matchMedia("(max-width: 720px)");
    const handleChange = (event: MediaQueryListEvent) => {
      setIsCompactLayout(event.matches);
    };

    setIsCompactLayout(mq.matches);
    mq.addEventListener("change", handleChange);

    return () => mq.removeEventListener("change", handleChange);
  }, []);

  // Shared fixtures & polling from context
  const {
    fixturesById,
    loadingFixtures,
    fixturesError,
  } = useLiveFixtures();
  const { users, loading: loadingUsers, error: usersError } = useUsers();

  const playerColWidth = isCompactLayout
    ? COMPACT_PLAYER_COL_WIDTH
    : PLAYER_COL_WIDTH;
  const ptsColWidth = isCompactLayout ? COMPACT_PTS_COL_WIDTH : PTS_COL_WIDTH;

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

  React.useEffect(() => {
    let cancelled = false;
    const firstRun = { current: true } as { current: boolean };

    const loadCurrentGameweek = async () => {
      try {
        if (firstRun.current) {
          setCurrentGameweekLoading(true);
        }

        const fixtures = await getNextPremierLeagueGameweekFixtures();
        if (cancelled) return;

        fixtures.sort(
          (a, b) => new Date(a.kickoff).getTime() - new Date(b.kickoff).getTime()
        );
        setCurrentGameweekFixtures(fixtures);
        setCurrentGameweekError(null);
      } catch (err: unknown) {
        console.error("Failed to load weekly gameweek fixtures", err);
        if (!cancelled) {
          setCurrentGameweekError(
            err instanceof Error
              ? err.message
              : "Failed to load the current gameweek fixtures."
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

  // Extract the numeric matchday from a round label e.g. "Matchday 31" → 31
  const parseMatchdayNum = (round: string): number => {
    const m = round.match(/(\d+)$/);
    return m ? parseInt(m[1], 10) : NaN;
  };

  // "This Gameweek" = the round currently in progress or most recently completed.
  //
  // getNextPremierLeagueGameweekFixtures (detectedCurrentRound) returns:
  //   - the active round  when any fixture is IN_PLAY / PAUSED / still TIMED this weekend
  //   - the NEXT upcoming round once all fixtures in the current round are FINISHED
  //
  // So when the detected round has already started we show it; otherwise the previous
  // matchday (detected - 1) just finished and that is "This Gameweek".
  //
  // We avoid relying on orderedRounds sorting here because a rearranged fixture
  // assigned to a later matchday can have an old kickoff date, which corrupts the
  // sort order and causes the wrong round to be selected.
  const currentRound = React.useMemo(() => {
    if (!detectedCurrentRound) return null;

    const detectedHasStarted = currentGameweekFixtures.some((f) => hasFixtureStarted(f));
    if (detectedHasStarted) return detectedCurrentRound;

    // Detected round not started yet → previous matchday is "This Gameweek"
    const nextNum = parseMatchdayNum(detectedCurrentRound);
    if (!isNaN(nextNum) && nextNum > 1) return `Matchday ${nextNum - 1}`;

    return detectedCurrentRound;
  }, [detectedCurrentRound, currentGameweekFixtures]);

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

      // Prefer the dedicated gameweek fetch for the detected (upcoming) round.
      // For other rounds, filter fixturesById by round label; if that yields nothing
      // (the Football-Data date-range API sometimes omits the matchday field, causing
      // fixtures to land as "Premier League" instead of "Matchday N"), fall back to
      // looking up fixtures by the IDs stored in predictions.
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
          fixturesForRound = Object.values(fixturesById).filter((f) =>
            predFixtureIds.has(f.id)
          );
        }

        // Strip stale rearranged fixtures that sit far outside the main gameweek
        // cluster. A match reassigned to a later matchday often keeps its original
        // (old) kickoff date, pulling it weeks away from the rest of the fixtures.
        // Keep only fixtures within 7 days of the latest kickoff in the set.
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

      const fixturesList = fixturesForRound
        .sort(
          (a, b) =>
            new Date(a.kickoff).getTime() - new Date(b.kickoff).getTime()
        );

      const earliestKickoff = fixturesList.length
        ? new Date(
            Math.min(...fixturesList.map((f) => new Date(f.kickoff).getTime()))
          )
        : null;

      const roundPreds = predictions.filter((p) => p.round === roundName);

      // Reveal predictions once any fixture has started. When fixturesList is empty
      // (fixture data not yet available) fall back to prediction kickoff times.
      const revealPredictions =
        fixturesList.some((f) => hasFixtureStarted(f)) ||
        roundPreds.some((p) => new Date(p.kickoff).getTime() <= Date.now());

      const byUser: Record<string, WeeklyRow> = {};
      const predsByUserFixture: Record<string, PredictionDoc> = {};

      for (const p of roundPreds) {
        predsByUserFixture[`${p.userId}_${p.fixtureId}`] = p;

        const fixture: Fixture | undefined =
          fixturesById[p.fixtureId] ??
          currentGameweekFixtures.find((candidate) => candidate.id === p.fixtureId);

        let points: number | null = null;
        if (fixture) {
          const scored = scorePrediction(
            p.predHome,
            p.predAway,
            fixture.homeGoals,
            fixture.awayGoals
          );
          points = scored.points;
        }

        if (!byUser[p.userId]) {
          byUser[p.userId] = {
            userId: p.userId,
            userDisplayName: p.userDisplayName,
            totalPoints: 0,
          };
        }

        if (points != null) {
          byUser[p.userId].totalPoints += points;
        }
      }

      const weeklyRows = Object.values(byUser).sort(
        (a, b) => b.totalPoints - a.totalPoints
      );

      const leaderPoints =
        weeklyRows.length > 0 ? weeklyRows[0].totalPoints : 0;

      return {
        fixturesList,
        earliestKickoff,
        revealPredictions,
        weeklyRows,
        predsByUserFixture,
        leaderPoints,
      };
    },
    [currentGameweekFixtures, detectedCurrentRound, fixturesById, predictions]
  );

  const currentRoundData = React.useMemo(
    () => buildRoundData(currentRound),
    [buildRoundData, currentRound]
  );
  const previousRoundData = React.useMemo(
    () => buildRoundData(previousRound),
    [buildRoundData, previousRound]
  );

  const loading = predictionsLoading || loadingFixtures || currentGameweekLoading;
  const combinedError =
    predictionsError || fixturesError || currentGameweekError || usersError;

  if (loading) {
    return <div>Loading weekly gameweek view…</div>;
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

  const kickoffLabel =
    currentRoundData.earliestKickoff &&
    currentRoundData.earliestKickoff.toLocaleString("en-GB", {
      timeZone: "Europe/London",
      weekday: "short",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });

  const previousKickoffLabel =
    previousRoundData.earliestKickoff &&
    previousRoundData.earliestKickoff.toLocaleString("en-GB", {
      timeZone: "Europe/London",
      weekday: "short",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });

  const paidCount = users.filter((u) => u.hasPaid).length;
  const prizePot = paidCount * 5;

  const prizePotLabel = loadingUsers
    ? "…"
    : formatCurrencyGBP(prizePot);
  const prizePotSubtext = loadingUsers
    ? "Loading players…"
    : `${paidCount} paid player${paidCount === 1 ? "" : "s"}`;

  const isRoundComplete = (roundData: RoundData) =>
    roundData.fixturesList.length > 0 &&
    roundData.fixturesList.every((f) => isFixtureFinished(f));

  const renderRoundTable = (
    title: string,
    roundName: string | null,
    roundData: RoundData,
    kickoffLabelText: string | null,
    subtitle: React.ReactNode,
    isCollapsible = false,
    showPrizePot = false
  ) => {
    if (!roundName) {
      return (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>{title}</h2>
          <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
            No gameweek predictions found yet. Once everyone starts predicting,
            this view will show the live weekly race.
          </p>
        </div>
      );
    }

    const content = (
      <div
        className="card"
        style={{
          marginBottom: 16,
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        <h2 style={{ margin: 0 }}>{title}</h2>
        <p
          style={{
            fontSize: 13,
            color: "var(--text-muted)",
            margin: 0,
          }}
        >
          {subtitle}
        </p>

        {kickoffLabelText && (
          <p
            style={{
              fontSize: 11,
              color: "var(--text-muted)",
              margin: 0,
            }}
          >
            First kick-off: {kickoffLabelText}
          </p>
        )}

        {showPrizePot && (
          <div
            style={{
              display: "flex",
              gap: 12,
              flexWrap: "wrap",
              marginTop: 6,
            }}
          >
            <div
              style={{
                padding: "10px 12px",
                borderRadius: 12,
                background: "rgba(59,130,246,0.08)",
                minWidth: 200,
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  color: "var(--text-muted)",
                  marginBottom: 4,
                }}
              >
                Total prize pot (this gameweek)
              </div>
              <div style={{ fontWeight: 700 }}>{prizePotLabel}</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                {prizePotSubtext}
              </div>
              {usersError && (
                <div
                  style={{
                    marginTop: 6,
                    fontSize: 12,
                    color: "var(--red)",
                  }}
                  role="alert"
                >
                  Failed to load prize pot.
                </div>
              )}
            </div>
          </div>
        )}

        {roundData.leaderPoints > 0 && roundData.weeklyRows.length > 0 && (
          <div
            style={{
              fontSize: 12,
              color: "var(--text-muted)",
              marginTop: 6,
              padding: "10px 12px",
              borderRadius: 12,
              background: "linear-gradient(90deg, rgba(34,197,94,0.12), rgba(34,197,94,0.06))",
            }}
          >
            {isRoundComplete(roundData) ? "Winner" : "Winning"}:{" "}
            <strong>{roundData.weeklyRows[0].userDisplayName}</strong> (
            {roundData.weeklyRows[0].totalPoints} pts)
          </div>
        )}

        {combinedError && (
          <p
            style={{
              fontSize: 12,
              color: "var(--red)",
              margin: 0,
            }}
          >
            {combinedError}
          </p>
        )}
      </div>
    );

    const tableContent = roundData.revealPredictions ? (
      <div className="card" style={{ padding: 0 }}>
        {/* Horizontal scroll container */}
        <div style={{ overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              minWidth: 500,
              borderCollapse: "collapse",
              fontSize: 13,
            }}
          >
            <thead>
              <tr
                style={{
                  textAlign: "left",
                  color: "var(--text-muted)",
                  fontSize: 11,
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                }}
              >
                <th
                  style={{
                    padding: "10px 12px",
                    position: "sticky",
                    left: 0,
                    background: "var(--card-bg)",
                    width: playerColWidth,
                    minWidth: playerColWidth,
                    zIndex: 3,
                  }}
                >
                  Player
                </th>
                <th
                  style={{
                    padding: "10px 8px",
                    textAlign: "right",
                    position: "sticky",
                    left: playerColWidth,
                    background: "var(--card-bg)",
                    width: ptsColWidth,
                    minWidth: ptsColWidth,
                    zIndex: 3,
                  }}
                >
                  Pts
                </th>
                {roundData.fixturesList.map((f) => {
                  const hasScore = f.homeGoals != null && f.awayGoals != null;
                  const postponed = isFixturePostponed(f);

                  return (
                    <th
                      key={f.id}
                      style={{
                        padding: "8px 4px",
                        textAlign: "center",
                        borderLeft: "1px solid rgba(148,163,184,0.18)",
                        width: FIXTURE_COL_WIDTH,
                        minWidth: FIXTURE_COL_WIDTH,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        {/* team badge row */}
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: 6,
                          }}
                        >
                          {f.homeLogo && (
                            <img
                              src={f.homeLogo}
                              alt={f.homeTeam}
                              style={{ width: 24, height: 24, opacity: postponed ? 0.4 : 1 }}
                            />
                          )}
                          <span style={{ fontSize: 11, opacity: 0.8 }}>vs</span>
                          {f.awayLogo && (
                            <img
                              src={f.awayLogo}
                              alt={f.awayTeam}
                              style={{ width: 24, height: 24, opacity: postponed ? 0.4 : 1 }}
                            />
                          )}
                        </div>

                        {/* score / postponed label */}
                        <div
                          style={{
                            fontSize: postponed ? 10 : 13,
                            fontWeight: 700,
                            color: postponed
                              ? "var(--text-muted)"
                              : hasScore
                              ? "var(--text)"
                              : "var(--text-muted)",
                          }}
                        >
                          {postponed
                            ? "PST"
                            : hasScore
                            ? `${f.homeGoals}–${f.awayGoals}`
                            : "–"}
                        </div>
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {roundData.weeklyRows.map((row) => {
                const isLeader =
                  roundData.leaderPoints > 0 &&
                  row.totalPoints === roundData.leaderPoints;

                return (
                  <tr
                    key={row.userId}
                    style={{
                      borderTop: "1px solid rgba(148,163,184,0.18)",
                      background: isLeader
                        ? "linear-gradient(to right, rgba(34,197,94,0.12), transparent)"
                        : "transparent",
                    }}
                  >
                    {/* Player cell with trophy for leader */}
                    <td
                      style={{
                        padding: "8px 12px",
                        position: "sticky",
                        left: 0,
                        background: "var(--card-bg)",
                        width: playerColWidth,
                        minWidth: playerColWidth,
                        zIndex: 2,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          fontWeight: 600,
                        }}
                      >
                        {isLeader && (
                          <span
                            style={{
                              fontSize: 16,
                            }}
                          >
                            🏆
                          </span>
                        )}
                        <span>{row.userDisplayName}</span>
                      </div>
                    </td>

                    {/* Weekly points */}
                    <td
                      style={{
                        padding: "8px 8px",
                        textAlign: "right",
                        position: "sticky",
                        left: playerColWidth,
                        background: "var(--card-bg)",
                        fontWeight: 700,
                        width: ptsColWidth,
                        minWidth: ptsColWidth,
                        zIndex: 2,
                      }}
                    >
                      {row.totalPoints}
                    </td>

                    {/* Predictions for each fixture */}
                    {roundData.fixturesList.map((f) => {
                      const key = `${row.userId}_${f.id}`;
                      const p = roundData.predsByUserFixture[key];

                      if (!p) {
                        return (
                          <td
                            key={f.id}
                            style={{
                              padding: "6px 4px",
                              textAlign: "center",
                              fontSize: 12,
                              color: "var(--text-muted)",
                              borderLeft: "1px solid rgba(148,163,184,0.18)",
                              width: FIXTURE_COL_WIDTH,
                              minWidth: FIXTURE_COL_WIDTH,
                            }}
                          >
                            –
                          </td>
                        );
                      }

                      const { points, status } = scorePrediction(
                        p.predHome,
                        p.predAway,
                        f.homeGoals,
                        f.awayGoals
                      );

                      let bg = "transparent";
                      let badge = "";
                      if (status === "exact") {
                        bg = "rgba(34,197,94,0.22)";
                        badge = "★"; // star for exact score
                      } else if (status === "result") {
                        bg = "rgba(59,130,246,0.18)";
                      } else if (status === "wrong") {
                        bg = "rgba(148,163,184,0.08)";
                      }

                      return (
                        <td
                          key={f.id}
                          style={{
                            padding: "6px 4px",
                            textAlign: "center",
                            borderLeft: "1px solid rgba(148,163,184,0.18)",
                            width: FIXTURE_COL_WIDTH,
                            minWidth: FIXTURE_COL_WIDTH,
                          }}
                        >
                          {/* Prediction pill */}
                          <div
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              gap: 4,
                              padding:
                                status === "pending" ? "0" : "4px 10px",
                              borderRadius: 999,
                              background: bg,
                              fontSize: 13,
                            }}
                          >
                            {badge && (
                              <span
                                style={{
                                  fontSize: 12,
                                  marginRight: 2,
                                }}
                              >
                                {badge}
                              </span>
                            )}
                            <span>
                              {p.predHome ?? "–"}–{p.predAway ?? "–"}
                            </span>
                          </div>

                          {/* Points (only once matches have started/finished) */}
                          {points != null && (
                            <div
                              style={{
                                fontSize: 11,
                                color: "var(--text-muted)",
                                marginTop: 2,
                              }}
                            >
                              <strong>
                                {points} pt{points === 1 ? "" : "s"}
                              </strong>
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    ) : (
      <div className="card" style={{ marginTop: 8 }}>
        <h3 style={{ marginTop: 0, marginBottom: 8 }}>Predictions hidden</h3>
        <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>
          Predictions stay hidden until the first fixture of the gameweek starts.
        </p>
        {roundData.weeklyRows.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>
              Players who have submitted predictions:
            </p>
            <div
              style={{
                marginTop: 8,
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
              }}
            >
              {roundData.weeklyRows.map((row) => {
                const countableFixtures = roundData.fixturesList.filter(
                  (fixture) => !isFixturePostponed(fixture)
                );
                const completedPredictionCount = countableFixtures.reduce(
                  (count, fixture) => {
                    const prediction =
                      roundData.predsByUserFixture[`${row.userId}_${fixture.id}`];
                    return hasCompletedPrediction(prediction) ? count + 1 : count;
                  },
                  0
                );

                return (
                  <span
                    key={row.userId}
                    style={{
                      padding: "5px 10px",
                      borderRadius: 999,
                      background: "rgba(148,163,184,0.14)",
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    {row.userDisplayName} {completedPredictionCount}/
                    {countableFixtures.length}
                  </span>
                );
              })}
            </div>
          </div>
        )}
        {kickoffLabelText && (
          <p
            style={{
              fontSize: 12,
              color: "var(--text-muted)",
              marginTop: 4,
            }}
          >
            They&apos;ll unlock once the early kick-off starts.
          </p>
        )}
      </div>
    );

    if (isCollapsible) {
      return (
        <details style={{ marginTop: 16 }}>
          <summary
            style={{
              cursor: "pointer",
              fontWeight: 700,
              marginBottom: 12,
            }}
          >
            {title}
          </summary>
          {content}
          {tableContent}
        </details>
      );
    }

    return (
      <div>
        {content}
        {tableContent}
      </div>
    );
  };

  return (
    <div>
      {renderRoundTable(
        "This Gameweek",
        currentRound,
        currentRoundData,
        kickoffLabel,
        (
          <>
            Live points for <strong>{currentRound}</strong>. Whoever tops this
            table takes the week.
          </>
        ),
        false,
        true
      )}

      {renderRoundTable(
        "Previous Gameweek",
        previousRound,
        previousRoundData,
        previousKickoffLabel,
        previousRound ? (
          <>
            Final points for <strong>{previousRound}</strong>. Relive how the
            week finished.
          </>
        ) : (
          "No previous gameweek yet. Once a matchday finishes you can revisit it here."
        ),
        true
      )}
    </div>
  );
};

export default WeeklyGameweekPage;
