import React from "react";
import type { User } from "firebase/auth";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../firebase";
import {
  getPremierLeagueMatchesForRange,
  type Fixture,
} from "../../api/football";
import { scorePrediction, type PredictionStatus } from "../../utils/scoring";

interface Props {
  user: User;
}

interface PredictionDoc {
  userId: string;
  userDisplayName: string;
  fixtureId: number;
  predHome: number | null;
  predAway: number | null;
  kickoff: string; // ISO date string
  round: string;   // e.g. "Matchday 12"
}

interface RoundFixtureRow {
  fixture: Fixture;
  prediction: PredictionDoc;
  points: number | null;
  status: PredictionStatus;
}

interface RoundStats {
  round: string;
  totalPoints: number;
  exactCount: number;
  resultCount: number;
  wrongCount: number;
  pendingCount: number;
  fixtures: RoundFixtureRow[];
  isComplete: boolean;
  start: Date;
}

const MyStatsPage: React.FC<Props> = ({ user }) => {
  const [predictions, setPredictions] = React.useState<PredictionDoc[]>([]);
  const [fixturesById, setFixturesById] = React.useState<Record<number, Fixture>>(
    {}
  );
  const [rounds, setRounds] = React.useState<RoundStats[]>([]);
  const [overallTotal, setOverallTotal] = React.useState(0);
  const [overallExact, setOverallExact] = React.useState(0);
  const [overallResult, setOverallResult] = React.useState(0);
  const [overallWrong, setOverallWrong] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [openRound, setOpenRound] = React.useState<string | null>(null);

  // 1) Listen to THIS USER'S predictions only
  React.useEffect(() => {
    const qPreds = query(
      collection(db, "predictions"),
      where("userId", "==", user.uid)
    );

    const unsub = onSnapshot(
      qPreds,
      (snap) => {
        const list: PredictionDoc[] = [];
        snap.forEach((docSnap) => {
          const data = docSnap.data();
          list.push({
            userId: data.userId,
            userDisplayName: data.userDisplayName ?? "Unknown",
            fixtureId: data.fixtureId,
            predHome: data.predHome ?? null,
            predAway: data.predAway ?? null,
            kickoff: data.kickoff,
            round: data.round ?? "Unknown",
          });
        });
        setPredictions(list);
        setLoading(false);
      },
      (err) => {
        console.error("Error loading user predictions", err);
        setError("Failed to load your predictions.");
        setLoading(false);
      }
    );

    return () => unsub();
  }, [user.uid]);

  // 2) Fetch all PL fixtures for the date span covering this user's predictions
  React.useEffect(() => {
    if (!predictions.length) {
      setFixturesById({});
      return;
    }

    let cancelled = false;

    const fetchFixtures = async () => {
      try {
        const times = predictions
          .map((p) => new Date(p.kickoff).getTime())
          .filter((t) => !isNaN(t));

        if (!times.length) return;

        const minTime = Math.min(...times);
        const maxTime = Math.max(...times);

        // pad by 1 day each side
        const from = new Date(minTime - 24 * 60 * 60 * 1000);
        const to = new Date(maxTime + 24 * 60 * 60 * 1000);

        const fixtures = await getPremierLeagueMatchesForRange(from, to);
        if (cancelled) return;

        const map: Record<number, Fixture> = {};
        fixtures.forEach((f) => {
          map[f.id] = f;
        });
        setFixturesById(map);
        setError(null);
      } catch (err: unknown) {
        console.error("Failed to load fixtures for stats page", err);
        if (!cancelled) {
          const message =
            err instanceof Error
              ? err.message
              : "Failed to load live scores from the Football API.";
          setError(message);
        }
      }
    };

    fetchFixtures();

    return () => {
      cancelled = true;
    };
  }, [predictions]);

  // 3) Compute per-round stats + overall totals
  React.useEffect(() => {
    if (!predictions.length) {
      setRounds([]);
      setOverallTotal(0);
      setOverallExact(0);
      setOverallResult(0);
      setOverallWrong(0);
      return;
    }

    // Group predictions by round
    const byRound: Record<string, PredictionDoc[]> = {};
    predictions.forEach((p) => {
      if (!byRound[p.round]) byRound[p.round] = [];
      byRound[p.round].push(p);
    });

    const roundStats: RoundStats[] = [];
    let totalOverall = 0;
    let exactOverall = 0;
    let resultOverall = 0;
    let wrongOverall = 0;

    for (const [round, preds] of Object.entries(byRound)) {
      const rows: RoundFixtureRow[] = [];

      let totalPoints = 0;
      let exactCount = 0;
      let resultCount = 0;
      let wrongCount = 0;
      let pendingCount = 0;

      let earliest: Date | null = null;
      let allFinished = true; // All *your* fixtures in this round finished

      for (const p of preds) {
        const fixture = fixturesById[p.fixtureId];
        if (!fixture) {
          // We don't have API data for this fixture yet
          allFinished = false;
          pendingCount += 1;
          continue;
        }

        const scored = scorePrediction(
          p.predHome,
          p.predAway,
          fixture.homeGoals,
          fixture.awayGoals
        );
        const { points, status } = scored;

        // Determine if fixture is finished
        const finished =
          fixture.statusShort === "FT" ||
          (fixture.homeGoals != null && fixture.awayGoals != null);

        if (!finished) {
          allFinished = false;
        }

        if (points != null) {
          totalPoints += points;
          totalOverall += points;
        }

        if (status === "exact") {
          exactCount += 1;
          exactOverall += 1;
        } else if (status === "result") {
          resultCount += 1;
          resultOverall += 1;
        } else if (status === "wrong") {
          wrongCount += 1;
          wrongOverall += 1;
        } else {
          pendingCount += 1;
        }

        const koDate = new Date(fixture.kickoff);
        if (!earliest || koDate < earliest) earliest = koDate;

        rows.push({
          fixture,
          prediction: p,
          points,
          status: scored.status as PredictionStatus,
        });
      }

      if (!earliest) earliest = new Date(preds[0].kickoff);

      // Sort fixtures within the round by kickoff
      rows.sort(
        (a, b) =>
          new Date(a.fixture.kickoff).getTime() -
          new Date(b.fixture.kickoff).getTime()
      );

      roundStats.push({
        round,
        totalPoints,
        exactCount,
        resultCount,
        wrongCount,
        pendingCount,
        fixtures: rows,
        isComplete: allFinished && rows.length > 0,
        start: earliest,
      });
    }

    // Only show rounds that are complete (all your fixtures for that round finished)
    const completed = roundStats
      .filter((r) => r.isComplete)
      .sort((a, b) => b.start.getTime() - a.start.getTime()); // latest first

    setRounds(completed);
    setOverallTotal(totalOverall);
    setOverallExact(exactOverall);
    setOverallResult(resultOverall);
    setOverallWrong(wrongOverall);

    // If no open round yet, open the most recent one
    if (!openRound && completed.length > 0) {
      setOpenRound(completed[0].round);
    }
  }, [predictions, fixturesById, openRound]);

  if (loading) {
    return <div>Loading your stats…</div>;
  }

  return (
    <div>
      {/* Overall summary */}
      <div
        className="card"
        style={{
          marginBottom: 16,
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <h2 style={{ margin: 0 }}>My Stats</h2>
        <p
          style={{
            fontSize: 13,
            color: "var(--text-muted)",
            margin: 0,
          }}
        >
          Completed Premier League gameweeks with your points at a glance.
        </p>

        <div
          style={{
            display: "flex",
            gap: 12,
            marginTop: 8,
            flexWrap: "wrap",
            fontSize: 12,
          }}
        >
          <div>
            <span style={{ color: "var(--text-muted)" }}>Total points: </span>
            <strong>{overallTotal}</strong>
          </div>
          <div>
            <span style={{ color: "var(--text-muted)" }}>Exact scores: </span>
            <strong>{overallExact}</strong>
          </div>
          <div>
            <span style={{ color: "var(--text-muted)" }}>Correct result: </span>
            <strong>{overallResult}</strong>
          </div>
          <div>
            <span style={{ color: "var(--text-muted)" }}>Wrong: </span>
            <strong>{overallWrong}</strong>
          </div>
        </div>

        {error && (
          <p
            style={{
              fontSize: 12,
              color: "var(--red)",
              marginTop: 4,
            }}
          >
            {error}
          </p>
        )}
      </div>

      {/* Gameweek breakdowns */}
      {rounds.length === 0 ? (
        <div className="card">
          <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
            No completed gameweeks yet. Once a full matchday you&apos;ve
            predicted is finished, it will appear here.
          </p>
        </div>
      ) : (
        rounds.map((round) => {
          const isOpen = openRound === round.round;

          const startLabel = round.start.toLocaleDateString("en-GB", {
            weekday: "short",
            day: "2-digit",
            month: "short",
          });

          return (
            <div
              key={round.round}
              className="card"
              style={{ marginBottom: 10, paddingBottom: isOpen ? 10 : 8 }}
            >
              {/* Header row (clickable) */}
              <button
                type="button"
                onClick={() =>
                  setOpenRound((prev) =>
                    prev === round.round ? null : round.round
                  )
                }
                style={{
                  all: "unset",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  width: "100%",
                  padding: "4px 0",
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                    }}
                  >
                    {round.round}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--text-muted)",
                    }}
                  >
                    {startLabel} • {round.fixtures.length} matches
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--text-muted)",
                    }}
                  >
                    Exact {round.exactCount} • Result {round.resultCount} • Wrong
                    {" "}
                    {round.wrongCount}
                  </div>
                </div>

                <div style={{ textAlign: "right" }}>
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--text-muted)",
                    }}
                  >
                    Total
                  </div>
                  <div
                    style={{
                      fontSize: 16,
                      fontWeight: 700,
                    }}
                  >
                    {round.totalPoints} pts
                  </div>
                  <div
                    style={{
                      fontSize: 16,
                      marginTop: 2,
                      transform: isOpen ? "rotate(90deg)" : "rotate(0deg)",
                      transition: "transform 120ms ease-out",
                    }}
                  >
                    ❯
                  </div>
                </div>
              </button>

              {/* Collapsible content */}
              {isOpen && (
                <div
                  style={{
                    marginTop: 10,
                    borderTop: "1px solid rgba(148,163,184,0.2)",
                    paddingTop: 8,
                  }}
                >
                  {round.fixtures.map((row) => {
                    const f = row.fixture;
                    const p = row.prediction;
                    const hasScore =
                      f.homeGoals != null && f.awayGoals != null;

                    let pillBg = "#4b5563";
                    let pillLabel = "Pending";
                    if (row.status === "exact") {
                      pillBg = "var(--green)";
                      pillLabel = "Exact";
                    } else if (row.status === "result") {
                      pillBg = "var(--blue)";
                      pillLabel = "Correct result";
                    } else if (row.status === "wrong") {
                      pillBg = "var(--red)";
                      pillLabel = "Wrong";
                    }

                    const kickoffDate = new Date(f.kickoff);
                    const koLabel = kickoffDate.toLocaleTimeString("en-GB", {
                      hour: "2-digit",
                      minute: "2-digit",
                    });
                    const dateLabel = kickoffDate.toLocaleDateString("en-GB", {
                      weekday: "short",
                      day: "2-digit",
                      month: "short",
                    });

                    return (
                      <div
                        key={f.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "6px 0",
                          borderBottom:
                            "1px solid rgba(148,163,184,0.12)",
                        }}
                      >
                        {/* Date/time */}
                        <div
                          style={{
                            width: 70,
                            textAlign: "left",
                            fontSize: 12,
                            color: "var(--text-muted)",
                          }}
                        >
                          <div style={{ fontWeight: 700 }}>
                            {koLabel}
                          </div>
                          <div>{dateLabel}</div>
                        </div>

                        {/* Teams and score */}
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 12,
                            flex: 1,
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 6,
                              minWidth: 120,
                            }}
                          >
                            <div
                              style={{
                                width: 28,
                                height: 28,
                                borderRadius: 999,
                                overflow: "hidden",
                              }}
                            >
                              <img
                                src={f.homeLogo}
                                alt={f.homeTeam}
                                style={{
                                  width: "100%",
                                  height: "100%",
                                  objectFit: "contain",
                                }}
                              />
                            </div>
                            <div
                              style={{
                                fontSize: 14,
                                fontWeight: 700,
                                letterSpacing: 0.3,
                              }}
                            >
                              {f.homeShort}
                            </div>
                          </div>

                          <div
                            style={{
                              fontSize: 13,
                              fontWeight: 700,
                              minWidth: 52,
                              textAlign: "center",
                            }}
                          >
                            {hasScore
                              ? `${f.homeGoals ?? "-"}  -  ${f.awayGoals ?? "-"}`
                              : "vs"}
                          </div>

                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 6,
                              minWidth: 120,
                              justifyContent: "flex-end",
                            }}
                          >
                            <div
                              style={{
                                fontSize: 14,
                                fontWeight: 700,
                                letterSpacing: 0.3,
                              }}
                            >
                              {f.awayShort}
                            </div>
                            <div
                              style={{
                                width: 28,
                                height: 28,
                                borderRadius: 999,
                                overflow: "hidden",
                              }}
                            >
                              <img
                                src={f.awayLogo}
                                alt={f.awayTeam}
                                style={{
                                  width: "100%",
                                  height: "100%",
                                  objectFit: "contain",
                                }}
                              />
                            </div>
                          </div>
                        </div>

                        {/* Prediction & points */}
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            minWidth: 170,
                            justifyContent: "flex-end",
                            textAlign: "right",
                          }}
                        >
                          <div style={{ minWidth: 70 }}>
                            <div
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                padding: "2px 8px",
                                borderRadius: 999,
                                background: pillBg,
                                fontSize: 11,
                                fontWeight: 600,
                                marginBottom: 4,
                                whiteSpace: "nowrap",
                              }}
                            >
                              {pillLabel}
                            </div>
                            <div
                              style={{
                                fontSize: 12,
                                color: "var(--text-muted)",
                              }}
                            >
                              Pred {p.predHome ?? "–"}-{p.predAway ?? "–"}
                            </div>
                            {hasScore && (
                              <div
                                style={{
                                  fontSize: 11,
                                  color: "var(--text-muted)",
                                  marginTop: 2,
                                }}
                              >
                                FT {f.homeGoals}–{f.awayGoals}
                              </div>
                            )}
                          </div>

                          {row.points != null && (
                            <div
                              style={{
                                fontSize: 16,
                                fontWeight: 700,
                                minWidth: 52,
                              }}
                            >
                              {row.points} pt
                              {row.points === 1 ? "" : "s"}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
};

export default MyStatsPage;
