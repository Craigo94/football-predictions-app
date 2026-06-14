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
import { useUsers } from "../../hooks/useUsers";

const ENTRY_FEE = 20; // £ per player

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
  const { users } = useUsers();

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

  // Everyone who plays pays the same entry fee, so the pot is simply the number
  // of players times the fee. Count players marked as paid if anyone has been,
  // otherwise fall back to everyone signed up.
  const paidPlayers = users.filter((u) => u.hasPaid).length;
  const playerCount = paidPlayers > 0 ? paidPlayers : users.length;
  const pot = playerCount * ENTRY_FEE;

  // Once the final has been played, whoever has the most points wins the pot.
  const finalStageGroup = fixturesByStage.find((stage) => stage.stage === "Final");
  const tournamentComplete = Boolean(
    finalStageGroup &&
      finalStageGroup.fixtures.length > 0 &&
      finalStageGroup.fixtures
        .filter((fixture) => !isFixturePostponed(fixture))
        .every((fixture) => isFixtureFinished(fixture)),
  );
  const champions =
    tournamentComplete && leagueRows.length && leagueRows[0].totalPoints > 0
      ? leagueRows.filter((row) => row.totalPoints === leagueRows[0].totalPoints)
      : [];

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
    <div className="world-cup-page">
      <div className="card gw-header-card world-cup-hero" style={{ marginBottom: 12 }}>
        <div className="gw-header-top">
          <div>
            <p className="gw-header-text">
              £{ENTRY_FEE} to enter, winner takes all. Predict every game from the group stage right
              through to the final — your points build up across the whole tournament and whoever has
              the most points when the final is played wins the pot.
            </p>
            <p className="gw-header-text">
              Group-stage predictions are open now. Each knockout round opens automatically as soon as
              the previous round has finished, then locks when that round&apos;s first game kicks off.
            </p>
            <p className="gw-round-label">Current open round: {currentStageName}</p>
          </div>
        </div>
        <div className="gw-points-row">
          <span className="gw-points-label">Prize pot</span>
          <span className="gw-points-value">
            £{pot}
            {playerCount > 0
              ? ` · ${playerCount} ${playerCount === 1 ? "player" : "players"}`
              : ""}
          </span>
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
        {champions.length > 0 && (
          <div
            style={{
              background: "rgba(34,197,94,0.12)",
              border: "1px solid var(--green)",
              borderRadius: 8,
              padding: "10px 12px",
              margin: "8px 0 12px",
              fontSize: 14,
            }}
          >
            🏆 <strong>{champions.map((c) => c.userDisplayName).join(" & ")}</strong>{" "}
            {champions.length > 1 ? "win" : "wins"} the £{pot} pot with {champions[0].totalPoints}{" "}
            points!
          </div>
        )}
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

      <nav className="world-cup-stage-nav" aria-label="World Cup stages">
        {fixturesByStage.map((stage) => {
          const stageIsCurrent = stage.stage === currentStageName;
          const status = stageStatusLabel(stage, currentStageName);

          return (
            <a
              key={stage.stage}
              className={`world-cup-stage-chip ${stageIsCurrent ? "world-cup-stage-chip--current" : ""}`}
              href={`#world-cup-stage-${stage.stage.toLowerCase().replaceAll(" ", "-").replaceAll("/", "-")}`}
            >
              <span>{stage.stage}</span>
              <small>{status}</small>
            </a>
          );
        })}
      </nav>

      <div className="world-cup-stage-list">
        {fixturesByStage.map((stage) => {
          const stageIsCurrent = stage.stage === currentStageName;
          const stageLocked = stage.fixtures.some((fixture) => hasFixtureStarted(fixture));
          const gameweekLocked = !stageIsCurrent || stageLocked;
          const revealPredictions = stageLocked;
          const groupedFixtures = groupFixturesForStage(stage.stage, stage.fixtures);
          const status = stageStatusLabel(stage, currentStageName);

          return (
            <details
              key={stage.stage}
              id={`world-cup-stage-${stage.stage.toLowerCase().replaceAll(" ", "-").replaceAll("/", "-")}`}
              className={`card world-cup-stage-card ${stageIsCurrent ? "world-cup-stage-card--current" : ""}`}
              open={stageIsCurrent}
            >
              <summary className="world-cup-stage-summary">
                <span className="world-cup-stage-summary__title">{stage.stage}</span>
                <span className="world-cup-stage-summary__meta">
                  {status} · {stage.fixtures.length} games
                </span>
              </summary>

              <p className="world-cup-stage-window">
                {formatStageWindow(stage.fixtures)}
              </p>

              <details className="world-cup-predictions-panel">
                <summary className="world-cup-subsummary">
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
                      const fixtureStarted = hasFixtureStarted(fixture);
                      const hasScore = fixture.homeGoals != null && fixture.awayGoals != null;
                      const fixtureDetail = fixtureStarted
                        ? hasScore
                          ? `${isFixtureFinished(fixture) ? "FT" : "Score"} · ${fixture.homeGoals} - ${fixture.awayGoals}`
                          : "Score pending"
                        : dateTimeUK(fixture.kickoff);

                      return (
                        <div key={fixture.id} className="world-cup-prediction-fixture">
                          <div className="world-cup-prediction-fixture__header">
                            <p className="world-cup-prediction-fixture__teams">
                              {fixture.homeTeam} vs {fixture.awayTeam}
                            </p>
                            <span
                              className={`world-cup-prediction-fixture__detail ${
                                fixtureStarted ? "world-cup-prediction-fixture__detail--started" : ""
                              }`}
                            >
                              {fixtureDetail}
                            </span>
                          </div>
                          {fixturePredictions.length === 0 ? (
                            <p className="world-cup-prediction-fixture__empty">
                              No predictions entered yet.
                            </p>
                          ) : (
                            <div className="world-cup-prediction-list">
                              {fixturePredictions.map((prediction) => {
                                const predictionStatus = fixtureStarted
                                  ? scorePrediction(
                                      prediction.predHome,
                                      prediction.predAway,
                                      fixture.homeGoals,
                                      fixture.awayGoals,
                                    ).status
                                  : "pending";

                                return (
                                  <div
                                    key={`${prediction.userId}_${prediction.fixtureId}`}
                                    className="world-cup-prediction-row"
                                  >
                                    <span>{prediction.userDisplayName}</span>
                                    <strong
                                      className={`world-cup-prediction-score world-cup-prediction-score--${predictionStatus}`}
                                      title={
                                        predictionStatus === "exact"
                                          ? "Correct score"
                                          : predictionStatus === "result"
                                            ? "Correct result"
                                            : predictionStatus === "wrong"
                                              ? "Wrong result"
                                              : "Awaiting kickoff"
                                      }
                                    >
                                      {prediction.predHome} - {prediction.predAway}
                                    </strong>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </details>

              <details className="world-cup-my-predictions" open={stageIsCurrent}>
                <summary className="world-cup-subsummary">
                  My predictions ({stage.stage})
                </summary>
                {groupedFixtures.map(({ groupLabel, fixtures: groupedStageFixtures }) => (
                  <details key={groupLabel} className="world-cup-fixture-group" open={stageIsCurrent}>
                    <summary className="world-cup-subsummary">
                      {groupLabel}
                    </summary>
                    <div className="fixtures-list world-cup-fixtures-list">
                      {groupedStageFixtures.map((fixture) => {
                        const fixtureCard = (
                          <FixtureCard
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
                        );

                        if (!isFixtureFinished(fixture)) {
                          return <React.Fragment key={fixture.id}>{fixtureCard}</React.Fragment>;
                        }

                        return (
                          <details key={fixture.id} className="world-cup-completed-fixture">
                            <summary
                              className="world-cup-completed-fixture__summary"
                              aria-label={`${fixture.homeTeam} ${fixture.homeGoals} to ${fixture.awayGoals} ${fixture.awayTeam}. Expand match details.`}
                            >
                              <span className="world-cup-completed-fixture__team world-cup-completed-fixture__team--home">
                                {fixture.homeShort}
                              </span>
                              <strong className="world-cup-completed-fixture__score">
                                {fixture.homeGoals} - {fixture.awayGoals}
                              </strong>
                              <span className="world-cup-completed-fixture__team world-cup-completed-fixture__team--away">
                                {fixture.awayShort}
                              </span>
                              <span className="world-cup-completed-fixture__hint">Details</span>
                            </summary>
                            <div className="world-cup-completed-fixture__details">{fixtureCard}</div>
                          </details>
                        );
                      })}
                    </div>
                  </details>
                ))}
              </details>
            </details>
          );
        })}
      </div>
    </div>
  );
};

export default WorldCupPage;
