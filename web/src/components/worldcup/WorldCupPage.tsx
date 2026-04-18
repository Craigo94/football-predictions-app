import React from "react";
import type { User } from "firebase/auth";
import { collection, doc, onSnapshot, query, setDoc, where } from "firebase/firestore";
import { db } from "../../firebase";
import { getWorldCupFixtures, type Fixture } from "../../api/football";
import FixtureCard, { type Prediction } from "../predictions/FixtureCard";
import { hasFixtureStarted, isFixtureFinished, isFixturePostponed } from "../../utils/fixtures";
import { formatFirstName } from "../../utils/displayName";
import { scorePrediction } from "../../utils/scoring";

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

const STAGE_ORDER = [
  "Group Stage",
  "Round of 16",
  "Quarter-finals",
  "Semi-finals",
  "Third-place play-off",
  "Final",
] as const;

const normalizeStage = (round: string): string => {
  const value = (round || "").toLowerCase();
  if (value.includes("group")) return "Group Stage";
  if (value.includes("round of 16") || value.includes("last 16")) return "Round of 16";
  if (value.includes("quarter")) return "Quarter-finals";
  if (value.includes("semi")) return "Semi-finals";
  if (value.includes("third")) return "Third-place play-off";
  if (value.includes("final")) return "Final";
  return round || "Unknown stage";
};

const stageSortIndex = (stage: string): number => {
  const index = STAGE_ORDER.indexOf(stage as (typeof STAGE_ORDER)[number]);
  if (index >= 0) return index;
  return STAGE_ORDER.length + 1;
};

const extractGroupLabel = (round: string): string | null => {
  const match = round.match(/group[\s_]+([a-z])/i);
  if (!match) return null;
  return `Group ${match[1].toUpperCase()}`;
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
      collection(db, "wcPredictions"),
      where("userId", "==", user.uid)
    );

    const unsub = onSnapshot(ownPredictionsQuery, (snap) => {
      const map: Record<number, PredictionDoc> = {};
      snap.forEach((snapshotDoc) => {
        const data = snapshotDoc.data() as PredictionDoc;
        map[data.fixtureId] = data;
      });
      setPredictions(map);
    });

    return () => unsub();
  }, [user.uid]);

  React.useEffect(() => {
    const allPredictionsQuery = query(
      collection(db, "wcPredictions"),
      where("competition", "==", "WORLD_CUP")
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

  const fixturesByStage = React.useMemo(() => {
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
      .map(([stage, stageFixtures]) => ({
        stage,
        fixtures: stageFixtures.sort(
          (x, y) => new Date(x.kickoff).getTime() - new Date(y.kickoff).getTime()
        ),
      }));
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

  const currentStageFixtures = React.useMemo(
    () => currentStage?.fixtures ?? [],
    [currentStage]
  );
  const currentStageFixturesByGroup = React.useMemo(() => {
    const grouped = new Map<string, Fixture[]>();
    let hasNamedGroups = false;

    currentStageFixtures.forEach((fixture) => {
      const groupLabel = extractGroupLabel(fixture.round) ?? "Other fixtures";
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
      .map(([groupLabel, fixtures]) => ({
        groupLabel,
        fixtures: fixtures.sort(
          (x, y) => new Date(x.kickoff).getTime() - new Date(y.kickoff).getTime()
        ),
      }))
      .filter((entry) => hasNamedGroups || entry.groupLabel !== "Other fixtures");
  }, [currentStageFixtures]);
  const currentStageName = currentStage?.stage ?? null;
  const currentStageLocked = currentStageFixtures.some((fixture) => hasFixtureStarted(fixture));
  const currentStageReveal = currentStageLocked;

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
    const userDisplayName = formatFirstName(user.displayName || user.email || "Unknown");
    const docId = `${user.uid}_${fixture.id}`;

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

    setPredictions((prev) => ({ ...prev, [fixture.id]: data }));
    setSaveError(null);
    await setDoc(doc(db, "wcPredictions", docId), data, { merge: true });
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
        fixture.awayGoals
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

    return Object.values(byUser).sort((a, b) => b.totalPoints - a.totalPoints);
  }, [allPredictions, fixtures]);

  const currentStagePredictionsByFixture = React.useMemo(() => {
    const byFixture = new Map<number, PredictionDoc[]>();
    const stageFixtureIds = new Set(currentStageFixtures.map((fixture) => fixture.id));

    allPredictions
      .filter((prediction) => stageFixtureIds.has(prediction.fixtureId))
      .forEach((prediction) => {
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
  }, [allPredictions, currentStageFixtures]);

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
              World Cup predictions run stage-by-stage. Each stage locks at first kick-off,
              and the next stage opens when the previous one is finished.
            </p>
            <p className="gw-round-label">Current stage: {currentStageName}</p>
          </div>
        </div>
        <div className="gw-points-row">
          <span className="gw-points-label">Your current stage progress</span>
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
        <h3 style={{ marginTop: 0 }}>World Cup League (all stages)</h3>
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
                  <td style={{ padding: "6px 0" }}>{index + 1}</td>
                  <td style={{ padding: "6px 0" }}>{row.userDisplayName}</td>
                  <td style={{ padding: "6px 0", textAlign: "right" }}><strong>{row.totalPoints}</strong></td>
                  <td style={{ padding: "6px 0", textAlign: "right" }}>{row.exactCount}</td>
                  <td style={{ padding: "6px 0", textAlign: "right" }}>{row.resultCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <h3 style={{ marginTop: 0 }}>Everyone&apos;s predictions ({currentStageName})</h3>
        {!currentStageReveal ? (
          <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 0 }}>
            Predictions are hidden until the first fixture kicks off.
          </p>
        ) : currentStagePredictionsByFixture.size === 0 ? (
          <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 0 }}>
            No predictions have been entered for this stage yet.
          </p>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {currentStageFixtures.map((fixture) => {
              const fixturePredictions = currentStagePredictionsByFixture.get(fixture.id) ?? [];
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
      </div>

      {currentStageFixturesByGroup.map(({ groupLabel, fixtures }) => (
        <div key={groupLabel} className="card" style={{ marginBottom: 12 }}>
          <h3 style={{ marginTop: 0 }}>{groupLabel}</h3>
          <div className="fixtures-list">
            {fixtures.map((fixture) => (
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
                gameweekLocked={currentStageLocked}
                required={
                  !isFixturePostponed(fixture) &&
                  !(predictions[fixture.id]?.predHome != null && predictions[fixture.id]?.predAway != null)
                }
                showLeagueTableLink={false}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};

export default WorldCupPage;
