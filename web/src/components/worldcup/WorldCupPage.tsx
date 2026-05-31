import React from "react";
import type { User } from "firebase/auth";
import { collection, doc, onSnapshot, query, setDoc, where } from "firebase/firestore";
import { db } from "../../firebase";
import { getWorldCupFixtures, type Fixture } from "../../api/football";
import FixtureCard, { type Prediction } from "../predictions/FixtureCard";
import { hasFixtureStarted, isFixtureFinished, isFixturePostponed } from "../../utils/fixtures";
import { formatFirstName } from "../../utils/displayName";
import { scorePrediction } from "../../utils/scoring";
import { getTiedRank } from "../../utils/ranking";
import { dateTimeUK } from "../../utils/dates";

interface Props {
  user: User;
}

interface PredictionDoc extends Prediction {
  userId: string;
  userDisplayName: string;
  fixtureId: number;
  homeTeam: string;
  awayTeam: string;
  kickoff: string;
  round: string;
  competition: "WORLD_CUP";
}

interface LeagueRow {
  userId: string;
  userDisplayName: string;
  totalPoints: number;
  exactCount: number;
  resultCount: number;
}

type StageName =
  | "Group Stage"
  | "Round of 32"
  | "Round of 16"
  | "Quarter-finals"
  | "Semi-finals"
  | "Third-place play-off"
  | "Final";

interface StageGroup {
  stage: string;
  fixtures: Fixture[];
}

const STAGE_ORDER: StageName[] = [
  "Group Stage",
  "Round of 32",
  "Round of 16",
  "Quarter-finals",
  "Semi-finals",
  "Third-place play-off",
  "Final",
];

const STAGE_MATCH_NUMBER_START: Record<string, number> = {
  "Round of 32": 73,
  "Round of 16": 89,
  "Quarter-finals": 97,
  "Semi-finals": 101,
  "Third-place play-off": 103,
  Final: 104,
};

const KNOCKOUT_PLACEHOLDERS: Record<number, [string, string]> = {
  73: ["Group A runners-up", "Group B runners-up"],
  74: ["Group E winners", "Group A/B/C/D/F third place"],
  75: ["Group F winners", "Group C runners-up"],
  76: ["Group C winners", "Group F runners-up"],
  77: ["Group I winners", "Group C/D/F/G/H third place"],
  78: ["Group E runners-up", "Group I runners-up"],
  79: ["Group A winners", "Group C/E/F/H/I third place"],
  80: ["Group L winners", "Group E/H/I/J/K third place"],
  81: ["Group D winners", "Group B/E/F/I/J third place"],
  82: ["Group G winners", "Group A/E/H/I/J third place"],
  83: ["Group K runners-up", "Group L runners-up"],
  84: ["Group H winners", "Group J runners-up"],
  85: ["Group B winners", "Group E/F/G/I/J third place"],
  86: ["Group J winners", "Group H runners-up"],
  87: ["Group K winners", "Group D/E/I/J/L third place"],
  88: ["Group D runners-up", "Group G runners-up"],
  89: ["Winner Match 74", "Winner Match 77"],
  90: ["Winner Match 73", "Winner Match 75"],
  91: ["Winner Match 76", "Winner Match 78"],
  92: ["Winner Match 79", "Winner Match 80"],
  93: ["Winner Match 83", "Winner Match 84"],
  94: ["Winner Match 81", "Winner Match 82"],
  95: ["Winner Match 86", "Winner Match 88"],
  96: ["Winner Match 85", "Winner Match 87"],
  97: ["Winner Match 89", "Winner Match 90"],
  98: ["Winner Match 93", "Winner Match 94"],
  99: ["Winner Match 91", "Winner Match 92"],
  100: ["Winner Match 95", "Winner Match 96"],
  101: ["Winner Match 97", "Winner Match 98"],
  102: ["Winner Match 99", "Winner Match 100"],
  103: ["Loser Match 101", "Loser Match 102"],
  104: ["Winner Match 101", "Winner Match 102"],
};

const UNKNOWN_TEAM_NAMES = new Set([
  "",
  "home",
  "away",
  "tbd",
  "to be decided",
  "to be determined",
  "unknown",
]);

const normalizeStage = (round: string): string => {
  const value = (round || "").toLowerCase().replaceAll("_", " ").replaceAll("-", " ");
  if (value.includes("group")) return "Group Stage";
  if (value.includes("round of 32") || value.includes("last 32")) return "Round of 32";
  if (value.includes("round of 16") || value.includes("last 16")) return "Round of 16";
  if (value.includes("quarter")) return "Quarter-finals";
  if (value.includes("semi")) return "Semi-finals";
  if (value.includes("third")) return "Third-place play-off";
  if (value.includes("final")) return "Final";
  return round || "Unknown stage";
};

const stageSortIndex = (stage: string): number => {
  const index = STAGE_ORDER.indexOf(stage as StageName);
  if (index >= 0) return index;
  return STAGE_ORDER.length + 1;
};

const extractGroupLabel = (round: string): string | null => {
  const match = round.match(/group[\s_]+([a-z])/i);
  if (!match) return null;
  return `Group ${match[1].toUpperCase()}`;
};

const isKnownTeamName = (name: string): boolean =>
  !UNKNOWN_TEAM_NAMES.has(name.trim().toLowerCase());

const stageStatusLabel = (stage: StageGroup, currentStageName: string | null): string => {
  const countable = stage.fixtures.filter((fixture) => !isFixturePostponed(fixture));
  if (countable.length && countable.every((fixture) => isFixtureFinished(fixture))) {
    return "Finished";
  }
  if (stage.stage === currentStageName) {
    return stage.fixtures.some((fixture) => hasFixtureStarted(fixture)) ? "Locked / in play" : "Open";
  }
  if (stage.fixtures.some((fixture) => hasFixtureStarted(fixture))) {
    return "Locked";
  }
  return "Opens after previous round";
};

const formatStageWindow = (fixtures: Fixture[]): string => {
  if (!fixtures.length) return "Dates TBC";
  const sorted = [...fixtures].sort(
    (a, b) => new Date(a.kickoff).getTime() - new Date(b.kickoff).getTime(),
  );
  const first = dateTimeUK(sorted[0].kickoff);
  const last = dateTimeUK(sorted[sorted.length - 1].kickoff);
  return first === last ? first : `${first} → ${last}`;
};

const getMatchNumber = (fixture: Fixture, stageFixtures: Fixture[], stage: string): number | null => {
  const start = STAGE_MATCH_NUMBER_START[stage];
  if (!start) return null;

  const explicit = fixture.matchday;
  if (typeof explicit === "number" && explicit >= start && explicit <= 104) {
    return explicit;
  }

  const index = stageFixtures.findIndex((candidate) => candidate.id === fixture.id);
  return index >= 0 ? start + index : null;
};

const getPlaceholderTeams = (matchNumber: number | null): [string, string] | null => {
  if (!matchNumber) return null;
  return KNOCKOUT_PLACEHOLDERS[matchNumber] ?? null;
};

const withDisplayTeams = (fixture: Fixture, stageFixtures: Fixture[], stage: string): Fixture => {
  if (stage === "Group Stage") return fixture;

  const placeholders = getPlaceholderTeams(getMatchNumber(fixture, stageFixtures, stage));
  if (!placeholders) return fixture;

  const homeTeam = isKnownTeamName(fixture.homeTeam) ? fixture.homeTeam : placeholders[0];
  const awayTeam = isKnownTeamName(fixture.awayTeam) ? fixture.awayTeam : placeholders[1];

  return {
    ...fixture,
    homeTeam,
    awayTeam,
    homeShort: isKnownTeamName(fixture.homeShort) ? fixture.homeShort : homeTeam,
    awayShort: isKnownTeamName(fixture.awayShort) ? fixture.awayShort : awayTeam,
  };
};

const groupFixturesForStage = (stage: string, fixtures: Fixture[]) => {
  const grouped = new Map<string, Fixture[]>();
  let hasNamedGroups = false;

  fixtures.forEach((fixture) => {
    const groupLabel = stage === "Group Stage" ? extractGroupLabel(fixture.round) ?? "Other fixtures" : stage;
    if (groupLabel !== "Other fixtures") {
      hasNamedGroups = true;
    }

    if (!grouped.has(groupLabel)) {
      grouped.set(groupLabel, []);
    }
    grouped.get(groupLabel)?.push(fixture);
  });

  return Array.from(grouped.entries())
    .sort(([a], [b]) => {
      if (a === "Other fixtures") return 1;
      if (b === "Other fixtures") return -1;
      return a.localeCompare(b);
    })
    .map(([groupLabel, groupedFixtures]) => ({
      groupLabel,
      fixtures: groupedFixtures.sort(
        (x, y) => new Date(x.kickoff).getTime() - new Date(y.kickoff).getTime(),
      ),
    }))
    .filter((entry) => stage !== "Group Stage" || hasNamedGroups || entry.groupLabel !== "Other fixtures");
};

const WorldCupPage: React.FC<Props> = ({ user }) => {
  const [fixtures, setFixtures] = React.useState<Fixture[]>([]);
  const [predictions, setPredictions] = React.useState<Record<number, PredictionDoc>>({});
  const [allPredictions, setAllPredictions] = React.useState<PredictionDoc[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [saveError, setSaveError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    const firstRun = { current: true } as { current: boolean };

    const loadFixtures = async () => {
      try {
        if (firstRun.current) {
          setLoading(true);
        }

        const data = await getWorldCupFixtures();
        if (cancelled) return;
        setFixtures(data);
        setError(null);
      } catch (err: unknown) {
        console.error("Failed to load World Cup fixtures", err);
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load World Cup fixtures.");
        }
      } finally {
        if (!cancelled && firstRun.current) {
          setLoading(false);
          firstRun.current = false;
        }
      }
    };

    loadFixtures();
    const intervalId = window.setInterval(loadFixtures, 60_000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  React.useEffect(() => {
    const ownPredictionsQuery = query(
      collection(db, "predictions"),
      where("userId", "==", user.uid),
    );

    const unsub = onSnapshot(ownPredictionsQuery, (snap) => {
      const map: Record<number, PredictionDoc> = {};
      snap.forEach((snapshotDoc) => {
        const data = snapshotDoc.data() as PredictionDoc;
        if (data.competition !== "WORLD_CUP") return;
        map[data.fixtureId] = data;
      });
      setPredictions(map);
    });

    return () => unsub();
  }, [user.uid]);

  React.useEffect(() => {
    const allPredictionsQuery = query(
      collection(db, "predictions"),
      where("competition", "==", "WORLD_CUP"),
    );

    const unsub = onSnapshot(allPredictionsQuery, (snap) => {
      const list: PredictionDoc[] = [];
      snap.forEach((snapshotDoc) => {
        list.push(snapshotDoc.data() as PredictionDoc);
      });
      setAllPredictions(list);
    });

    return () => unsub();
  }, []);

  const fixturesByStage = React.useMemo<StageGroup[]>(() => {
    const grouped = new Map<string, Fixture[]>();

    fixtures.forEach((fixture) => {
      const stage = normalizeStage(fixture.round);
      if (!grouped.has(stage)) {
        grouped.set(stage, []);
      }
      grouped.get(stage)?.push(fixture);
    });

    return Array.from(grouped.entries())
      .sort(([a], [b]) => stageSortIndex(a) - stageSortIndex(b))
      .map(([stage, stageFixtures]) => {
        const sorted = stageFixtures.sort(
          (x, y) => new Date(x.kickoff).getTime() - new Date(y.kickoff).getTime(),
        );
        return {
          stage,
          fixtures: sorted.map((fixture) => withDisplayTeams(fixture, sorted, stage)),
        };
      });
  }, [fixtures]);

  const currentStage = React.useMemo(() => {
    for (const stage of fixturesByStage) {
      const nonPostponed = stage.fixtures.filter((fixture) => !isFixturePostponed(fixture));
      if (!nonPostponed.length) continue;
      const finished = nonPostponed.every((fixture) => isFixtureFinished(fixture));
      if (!finished) {
        return stage;
      }
    }

    return fixturesByStage[fixturesByStage.length - 1] ?? null;
  }, [fixturesByStage]);

  const currentStageName = currentStage?.stage ?? null;
  const currentStageFixtures = React.useMemo(() => currentStage?.fixtures ?? [], [currentStage]);
  const currentStageLocked = currentStageFixtures.some((fixture) => hasFixtureStarted(fixture));

  const currentStagePredictionCount = React.useMemo(() => {
    const countable = currentStageFixtures.filter((fixture) => !isFixturePostponed(fixture));
    const completed = countable.filter((fixture) => {
      const prediction = predictions[fixture.id];
      return prediction?.predHome != null && prediction?.predAway != null;
    });

    return {
      completed: completed.length,
      total: countable.length,
    };
  }, [currentStageFixtures, predictions]);

  const handleChangePrediction = async (fixture: Fixture, prediction: Prediction) => {
    if (currentStageName !== normalizeStage(fixture.round) || currentStageLocked) {
      throw new Error("This World Cup round is not open for predictions.");
    }

    const userDisplayName = formatFirstName(user.displayName || user.email || "Unknown");
    const docId = `wc_${user.uid}_${fixture.id}`;

    const data: PredictionDoc = {
      userId: user.uid,
      userDisplayName,
      fixtureId: fixture.id,
      predHome: prediction.predHome,
      predAway: prediction.predAway,
      locked: prediction.locked ?? false,
      homeTeam: fixture.homeTeam,
      awayTeam: fixture.awayTeam,
      kickoff: fixture.kickoff,
      round: normalizeStage(fixture.round),
      competition: "WORLD_CUP",
    };

    let previousValue: PredictionDoc | null = null;
    setPredictions((prev) => {
      previousValue = prev[fixture.id] ?? null;
      return { ...prev, [fixture.id]: data };
    });
    setSaveError(null);
    try {
      await setDoc(doc(db, "predictions", docId), data, { merge: true });
    } catch (err) {
      setPredictions((prev) => {
        if (previousValue) {
          return { ...prev, [fixture.id]: previousValue };
        }
        const next = { ...prev };
        delete next[fixture.id];
        return next;
      });
      throw err;
    }
  };

  const leagueRows = React.useMemo(() => {
    const byUser: Record<string, LeagueRow> = {};

    allPredictions.forEach((prediction) => {
      const fixture = fixtures.find((candidate) => candidate.id === prediction.fixtureId);
      if (!fixture) return;

      if (!byUser[prediction.userId]) {
        byUser[prediction.userId] = {
          userId: prediction.userId,
          userDisplayName: prediction.userDisplayName,
          totalPoints: 0,
          exactCount: 0,
          resultCount: 0,
        };
      }

      const row = byUser[prediction.userId];
      const scored = scorePrediction(
        prediction.predHome,
        prediction.predAway,
        fixture.homeGoals,
        fixture.awayGoals,
      );

      if (scored.points != null) {
        row.totalPoints += scored.points;
      }
      if (scored.status === "exact") {
        row.exactCount += 1;
      }
      if (scored.status === "result") {
        row.resultCount += 1;
      }
    });

    return Object.values(byUser).sort(
      (a, b) =>
        b.totalPoints - a.totalPoints ||
        a.userDisplayName.localeCompare(b.userDisplayName, undefined, { sensitivity: "base" }),
    );
  }, [allPredictions, fixtures]);

  const predictionsByFixture = React.useMemo(() => {
    const byFixture = new Map<number, PredictionDoc[]>();

    allPredictions.forEach((prediction) => {
      if (prediction.predHome == null || prediction.predAway == null) return;

      if (!byFixture.has(prediction.fixtureId)) {
        byFixture.set(prediction.fixtureId, []);
      }
      byFixture.get(prediction.fixtureId)?.push(prediction);
    });

    byFixture.forEach((fixturePredictions, fixtureId) => {
      fixturePredictions.sort((a, b) => {
        const byName = a.userDisplayName.localeCompare(b.userDisplayName);
        if (byName !== 0) return byName;
        return `${a.predHome}-${a.predAway}`.localeCompare(`${b.predHome}-${b.predAway}`);
      });
      byFixture.set(fixtureId, fixturePredictions);
    });

    return byFixture;
  }, [allPredictions]);

  if (loading) {
    return <div>Loading World Cup…</div>;
  }

  if (error) {
    return (
      <div className="card">
        <h2 style={{ marginTop: 0 }}>World Cup</h2>
        <p style={{ fontSize: 13, color: "var(--text-muted)" }}>{error}</p>
      </div>
    );
  }

  if (!fixtures.length || !currentStageName) {
    return (
      <div className="card">
        <h2 style={{ marginTop: 0 }}>World Cup</h2>
        <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
          No World Cup fixtures are available yet.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="card gw-header-card" style={{ marginBottom: 12 }}>
        <div className="gw-header-top">
          <div>
            <p className="gw-header-text">
              £20 World Cup pool: every player predicts each round, points accumulate from the group
              stage through the final, and the overall top scorer wins.
            </p>
            <p className="gw-header-text">
              Group-stage predictions are open now. Knockout rounds unlock automatically when the
              previous round is fully finished, then lock at that round&apos;s first kick-off.
            </p>
            <p className="gw-round-label">Current open round: {currentStageName}</p>
          </div>
        </div>
        <div className="gw-points-row">
          <span className="gw-points-label">Your current round progress</span>
          <span className="gw-points-value">
            {currentStagePredictionCount.completed}/{currentStagePredictionCount.total}
          </span>
        </div>
      </div>
      {saveError && (
        <div className="card" style={{ marginBottom: 12 }}>
          <p style={{ fontSize: 13, color: "var(--red)", margin: 0 }}>{saveError}</p>
        </div>
      )}

      <div className="card" style={{ marginBottom: 12 }}>
        <h3 style={{ marginTop: 0 }}>World Cup League (cumulative)</h3>
        <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: -4 }}>
          Scores are totalled across every World Cup fixture. Exact scores are worth 20 points;
          correct results are worth 6 points.
        </p>
        {leagueRows.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 0 }}>
            No World Cup predictions yet.
          </p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--text-muted)", fontSize: 11 }}>
                <th style={{ paddingBottom: 8 }}>Rank</th>
                <th style={{ paddingBottom: 8 }}>Player</th>
                <th style={{ paddingBottom: 8, textAlign: "right" }}>Pts</th>
                <th style={{ paddingBottom: 8, textAlign: "right" }}>Exact</th>
                <th style={{ paddingBottom: 8, textAlign: "right" }}>Result</th>
              </tr>
            </thead>
            <tbody>
              {leagueRows.map((row, index) => (
                <tr key={row.userId} style={{ borderTop: "1px solid rgba(148,163,184,0.15)" }}>
                  <td style={{ padding: "6px 0" }}>
                    {getTiedRank(leagueRows, index, (leagueRow) => leagueRow.totalPoints)}
                  </td>
                  <td style={{ padding: "6px 0" }}>{row.userDisplayName}</td>
                  <td style={{ padding: "6px 0", textAlign: "right" }}>
                    <strong>{row.totalPoints}</strong>
                  </td>
                  <td style={{ padding: "6px 0", textAlign: "right" }}>{row.exactCount}</td>
                  <td style={{ padding: "6px 0", textAlign: "right" }}>{row.resultCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <h3 style={{ marginTop: 0 }}>Data coverage</h3>
        <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 0 }}>
          Uses football-data.org&apos;s World Cup coverage for fixtures, schedules, scores and live-score
          status. Deep data such as line-ups, scorers, cards and substitutions is intentionally not
          required for this pool.
        </p>
      </div>

      <div style={{ display: "grid", gap: 12 }}>
        {fixturesByStage.map((stage) => {
          const stageIsCurrent = stage.stage === currentStageName;
          const stageLocked = stage.fixtures.some((fixture) => hasFixtureStarted(fixture));
          const gameweekLocked = !stageIsCurrent || stageLocked;
          const revealPredictions = stageLocked;
          const groupedFixtures = groupFixturesForStage(stage.stage, stage.fixtures);
          const status = stageStatusLabel(stage, currentStageName);

          return (
            <details key={stage.stage} className="card" open={stageIsCurrent}>
              <summary
                style={{
                  cursor: "pointer",
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  alignItems: "center",
                  fontWeight: 700,
                }}
              >
                <span>{stage.stage}</span>
                <span style={{ color: "var(--text-muted)", fontSize: 12, fontWeight: 500 }}>
                  {status} · {stage.fixtures.length} games
                </span>
              </summary>

              <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "10px 0" }}>
                {formatStageWindow(stage.fixtures)}
              </p>

              <details style={{ marginBottom: 12 }} open={stageIsCurrent && revealPredictions}>
                <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
                  Everyone&apos;s predictions ({stage.stage})
                </summary>
                {!revealPredictions ? (
                  <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 0 }}>
                    Predictions are hidden until this round kicks off.
                  </p>
                ) : (
                  <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
                    {stage.fixtures.map((fixture) => {
                      const fixturePredictions = predictionsByFixture.get(fixture.id) ?? [];
                      return (
                        <div
                          key={fixture.id}
                          style={{ borderTop: "1px solid rgba(148,163,184,0.15)", paddingTop: 8 }}
                        >
                          <p style={{ margin: "0 0 6px 0", fontSize: 13, fontWeight: 600 }}>
                            {fixture.homeTeam} vs {fixture.awayTeam}
                          </p>
                          {fixturePredictions.length === 0 ? (
                            <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 12 }}>
                              No predictions entered yet.
                            </p>
                          ) : (
                            <div style={{ display: "grid", gap: 4 }}>
                              {fixturePredictions.map((prediction) => (
                                <div
                                  key={`${prediction.userId}_${prediction.fixtureId}`}
                                  style={{
                                    display: "flex",
                                    justifyContent: "space-between",
                                    gap: 10,
                                    fontSize: 12,
                                  }}
                                >
                                  <span>{prediction.userDisplayName}</span>
                                  <strong>
                                    {prediction.predHome} - {prediction.predAway}
                                  </strong>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </details>

              {groupedFixtures.map(({ groupLabel, fixtures: groupedStageFixtures }) => (
                <details key={groupLabel} open={stageIsCurrent} style={{ marginTop: 10 }}>
                  <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
                    {groupLabel}
                  </summary>
                  <div className="fixtures-list" style={{ marginTop: 10 }}>
                    {groupedStageFixtures.map((fixture) => (
                      <FixtureCard
                        key={fixture.id}
                        fixture={fixture}
                        prediction={predictions[fixture.id] || null}
                        onChangePrediction={(prediction) => {
                          handleChangePrediction(fixture, prediction).catch((err) => {
                            console.error("Failed to save World Cup prediction", err);
                            setSaveError("Could not save your World Cup prediction. Please try again.");
                          });
                        }}
                        gameweekLocked={gameweekLocked}
                        required={
                          stageIsCurrent &&
                          !isFixturePostponed(fixture) &&
                          !(predictions[fixture.id]?.predHome != null && predictions[fixture.id]?.predAway != null)
                        }
                        showLeagueTableLink={false}
                      />
                    ))}
                  </div>
                </details>
              ))}
            </details>
          );
        })}
      </div>
    </div>
  );
};

export default WorldCupPage;
