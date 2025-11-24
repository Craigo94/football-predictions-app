// src/components/weekly/WeeklyGameweekPage.tsx
import React from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "../../firebase";
import { scorePrediction } from "../../utils/scoring";
import { useLiveFixtures } from "../../context/LiveFixturesContext";
import type { Fixture } from "../../api/football";
import { formatFirstName } from "../../utils/displayName";
import { useUsers } from "../../hooks/useUsers";
import { formatCurrencyGBP } from "../../utils/currency";

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

// Fixed column widths so sticky cols don't overlap
const PLAYER_COL_WIDTH = 100;
const PTS_COL_WIDTH = 60;
const FIXTURE_COL_WIDTH = 76;

// Slightly narrower widths for compact/mobile layouts
const COMPACT_PLAYER_COL_WIDTH = 70;
const COMPACT_PTS_COL_WIDTH = 40;

const WeeklyGameweekPage: React.FC = () => {
  const [predictions, setPredictions] = React.useState<PredictionDoc[]>([]);
  const [currentRound, setCurrentRound] = React.useState<string | null>(null);
  const [weeklyRows, setWeeklyRows] = React.useState<WeeklyRow[]>([]);
  const [earliestKickoff, setEarliestKickoff] = React.useState<Date | null>(null);
  const [revealPredictions, setRevealPredictions] = React.useState(false);
  const [predictionsLoading, setPredictionsLoading] = React.useState(true);
  const [predictionsError, setPredictionsError] = React.useState<string | null>(
    null
  );
  const [isCompactLayout, setIsCompactLayout] = React.useState(false);
  const { users: userProfiles, loading: usersLoading, error: usersError } =
    useUsers();

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

  /* 2) Decide which round is "current". */
  React.useEffect(() => {
    if (!predictions.length) {
      setCurrentRound(null);
      return;
    }

    const byRound: Record<string, { round: string; latestKickoff: number }> = {};

    for (const p of predictions) {
      const t = new Date(p.kickoff).getTime();
      if (isNaN(t)) continue;
      if (!byRound[p.round] || t > byRound[p.round].latestKickoff) {
        byRound[p.round] = { round: p.round, latestKickoff: t };
      }
    }

    const rounds = Object.values(byRound);
    if (!rounds.length) {
      setCurrentRound(null);
      return;
    }

    rounds.sort((a, b) => a.latestKickoff - b.latestKickoff);
    const current = rounds[rounds.length - 1];
    setCurrentRound(current.round);
  }, [predictions]);

  /* 3) For the current round, decide earliest kickoff and
        whether to reveal predictions, using shared fixturesById.
        ❗ Now we ONLY reveal when a match is actually not NS anymore.
  */
  React.useEffect(() => {
    if (!currentRound) {
      setEarliestKickoff(null);
      setRevealPredictions(false);
      return;
    }

    const roundFixtures = Object.values(fixturesById).filter(
      (f) => f.round === currentRound
    );

    if (!roundFixtures.length) {
      setEarliestKickoff(null);
      setRevealPredictions(false);
      return;
    }

    const earliest = Math.min(
      ...roundFixtures.map((f) => new Date(f.kickoff).getTime())
    );
    setEarliestKickoff(new Date(earliest));

    // Only unlock once at least one game is not NS (i.e. live or FT)
    const anyStarted = roundFixtures.some((f) => f.statusShort !== "NS");
    setRevealPredictions(anyStarted);
  }, [currentRound, fixturesById]);

  /* 4) Compute *this gameweek* totals per user */
  React.useEffect(() => {
    if (!currentRound) {
      setWeeklyRows([]);
      return;
    }

    const roundPreds = predictions.filter((p) => p.round === currentRound);
    if (!roundPreds.length) {
      setWeeklyRows([]);
      return;
    }

    const byUser: Record<string, WeeklyRow> = {};

    for (const p of roundPreds) {
      const fixture: Fixture | undefined = fixturesById[p.fixtureId];

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

    const sorted = Object.values(byUser).sort(
      (a, b) => b.totalPoints - a.totalPoints
    );
    setWeeklyRows(sorted);
  }, [currentRound, predictions, fixturesById]);

  // Fixtures for this round, in kickoff order
  const fixturesList = React.useMemo(() => {
    if (!currentRound) return [] as Fixture[];
    return Object.values(fixturesById)
      .filter((f) => f.round === currentRound)
      .sort(
        (a, b) =>
          new Date(a.kickoff).getTime() - new Date(b.kickoff).getTime()
    );
  }, [fixturesById, currentRound]);

  const paidCount = React.useMemo(
    () => userProfiles.filter((u) => u.hasPaid).length,
    [userProfiles]
  );
  const prizePot = paidCount * 5;
  const firstPrize = prizePot;

  // Lookup: user+fixture -> prediction
  const predsByUserFixture = React.useMemo(() => {
    const map: Record<string, PredictionDoc> = {};
    if (!currentRound) return map;
    for (const p of predictions) {
      if (p.round !== currentRound) continue;
      map[`${p.userId}_${p.fixtureId}`] = p;
    }
    return map;
  }, [predictions, currentRound]);

  const leaderPoints =
    weeklyRows.length > 0 ? weeklyRows[0].totalPoints : 0;

  const loading = predictionsLoading || loadingFixtures;
  const combinedError = predictionsError || fixturesError;

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
    earliestKickoff &&
    earliestKickoff.toLocaleString("en-GB", {
      timeZone: "Europe/London",
      weekday: "short",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });

  return (
    <div>
      {/* Header card */}
      <div
        className="card"
        style={{
          marginBottom: 16,
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        <h2 style={{ margin: 0 }}>This Gameweek</h2>
        <p
          style={{
            fontSize: 13,
            color: "var(--text-muted)",
            margin: 0,
          }}
        >
          Live points for <strong>{currentRound}</strong>. Weekly prize goes
          to whoever tops this table.
        </p>

        {kickoffLabel && (
          <p
            style={{
              fontSize: 11,
              color: "var(--text-muted)",
              margin: 0,
            }}
          >
            First kick-off: {kickoffLabel}
          </p>
        )}

        {leaderPoints > 0 && weeklyRows.length > 0 && (
          <p
            style={{
              fontSize: 12,
              color: "var(--text-muted)",
              marginTop: 6,
            }}
          >
            Current leader:{" "}
            <strong>{weeklyRows[0].userDisplayName}</strong> (
            {weeklyRows[0].totalPoints} pts)
          </p>
        )}

        <div className="gw-points-row">
          <div>
            <div className="gw-points-label">Prize pot</div>
            <div className="gw-points-value">
              {usersLoading ? "Loading…" : formatCurrencyGBP(prizePot)}
            </div>
            <div className="gw-round-label" style={{ marginTop: 2 }}>
              {usersLoading
                ? "Checking payments"
                : `${paidCount} paid player${paidCount === 1 ? "" : "s"}`}
            </div>
          </div>
          <div
            style={{
              textAlign: "right",
              fontSize: 12,
              color: "var(--text-muted)",
              lineHeight: 1.5,
            }}
          >
            <div>Winner takes all</div>
            <div>
              1st: {usersLoading ? "…" : formatCurrencyGBP(firstPrize)} (100%)
            </div>
          </div>
        </div>

        {usersError && (
          <p
            style={{
              fontSize: 12,
              color: "var(--red)",
              marginTop: 4,
            }}
          >
            {usersError}
          </p>
        )}

        {combinedError && (
          <p
            style={{
              fontSize: 12,
              color: "var(--red)",
              marginTop: 4,
            }}
          >
            {combinedError}
          </p>
        )}
      </div>

      {/* If we haven't actually kicked off yet, hide predictions */}
      {!revealPredictions ? (
        <div className="card">
          <p
            style={{
              fontSize: 13,
              color: "var(--text-muted)",
              marginBottom: 4,
            }}
          >
            Predictions are hidden until the first match of{" "}
            <strong>{currentRound}</strong> is live. No copying lineups
            this week 😉
          </p>
          {kickoffLabel && (
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
      ) : (
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
                  {fixturesList.map((f) => {
                    const hasScore =
                      f.homeGoals != null && f.awayGoals != null;

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
                          {/* bigger badges row only */}
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
                                style={{ width: 24, height: 24 }}
                              />
                            )}
                            <span style={{ fontSize: 11, opacity: 0.8 }}>vs</span>
                            {f.awayLogo && (
                              <img
                                src={f.awayLogo}
                                alt={f.awayTeam}
                                style={{ width: 24, height: 24 }}
                              />
                            )}
                          </div>

                          {/* current score under badges (actual, not predictions) */}
                          <div
                            style={{
                              fontSize: 13,
                              fontWeight: 700,
                              color: hasScore
                                ? "var(--text)"
                                : "var(--text-muted)",
                            }}
                          >
                            {hasScore
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
                {weeklyRows.map((row) => {
                  const isLeader =
                    leaderPoints > 0 &&
                    row.totalPoints === leaderPoints;

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
                      {fixturesList.map((f) => {
                        const key = `${row.userId}_${f.id}`;
                        const p = predsByUserFixture[key];

                        if (!p) {
                          return (
                            <td
                              key={f.id}
                              style={{
                                padding: "6px 4px",
                                textAlign: "center",
                                fontSize: 12,
                                color: "var(--text-muted)",
                                borderLeft:
                                  "1px solid rgba(148,163,184,0.18)",
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
                              borderLeft:
                                "1px solid rgba(148,163,184,0.18)",
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
                                  status === "pending"
                                    ? "0"
                                    : "4px 10px",
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
      )}
    </div>
  );
};

export default WeeklyGameweekPage;
