import React from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "../../firebase";
import { type Fixture } from "../../api/football";
import {
  scorePrediction,
  type PredictionStatus,
} from "../../utils/scoring";
import { useLiveFixtures } from "../../context/LiveFixturesContext";

interface PredictionDoc {
  userId: string;
  userDisplayName: string;
  fixtureId: number;
  predHome: number | null;
  predAway: number | null;
  kickoff: string; // ISO date string
}

interface LeaderboardRow {
  userId: string;
  userDisplayName: string;
  totalPoints: number;
  exactCount: number;
  resultCount: number;
  wrongCount: number;
}

const LeaderboardPage: React.FC = () => {
  const [predictions, setPredictions] = React.useState<PredictionDoc[]>([]);
  const [rows, setRows] = React.useState<LeaderboardRow[]>([]);
  const [loadingPreds, setLoadingPreds] = React.useState(true);
  const [predError, setPredError] = React.useState<string | null>(null);

  const {
    fixturesById,
    loadingFixtures,
    fixturesError,
  } = useLiveFixtures();

  /* 1) Listen to ALL predictions (all users, all gameweeks) */
  React.useEffect(() => {
    const ref = collection(db, "predictions");

    const unsub = onSnapshot(
      ref,
      (snap) => {
        const list: PredictionDoc[] = [];
        snap.forEach((doc) => {
          const data = doc.data() as any;
          list.push({
            userId: data.userId,
            userDisplayName: data.userDisplayName ?? "Unknown",
            fixtureId: data.fixtureId,
            predHome: data.predHome ?? null,
            predAway: data.predAway ?? null,
            kickoff: data.kickoff,
          });
        });
        setPredictions(list);
        setLoadingPreds(false);
      },
      (err) => {
        console.error("Error loading predictions", err);
        setPredError("Failed to load predictions.");
        setLoadingPreds(false);
      }
    );

    return () => unsub();
  }, []);

  /* 2) Compute leaderboard whenever predictions OR fixtures change */
  React.useEffect(() => {
    if (!predictions.length) {
      setRows([]);
      return;
    }

    const byUser: Record<string, LeaderboardRow> = {};

    for (const p of predictions) {
      const fixture: Fixture | undefined = fixturesById[p.fixtureId];

      let points: number | null = null;
      let status: PredictionStatus = "pending";

      if (fixture) {
        const scored = scorePrediction(
          p.predHome,
          p.predAway,
          fixture.homeGoals,
          fixture.awayGoals
        );
        points = scored.points;
        status = scored.status as PredictionStatus;
      }

      if (!byUser[p.userId]) {
        byUser[p.userId] = {
          userId: p.userId,
          userDisplayName: p.userDisplayName || "Unknown",
          totalPoints: 0,
          exactCount: 0,
          resultCount: 0,
          wrongCount: 0,
        };
      }

      const row = byUser[p.userId];

      if (points != null) {
        row.totalPoints += points;
      }

      if (status === "exact") row.exactCount += 1;
      else if (status === "result") row.resultCount += 1;
      else if (status === "wrong") row.wrongCount += 1;
    }

    const sorted = Object.values(byUser).sort(
      (a, b) => b.totalPoints - a.totalPoints
    );

    setRows(sorted);
  }, [predictions, fixturesById]);

  const loading = loadingPreds || loadingFixtures;
  const combinedError = predError || fixturesError;

  if (loading) {
    return <div>Loading leaderboard…</div>;
  }

  return (
    <div>
      <div
        className="card"
        style={{
          marginBottom: 16,
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        <h2 style={{ margin: 0 }}>Leaderboard</h2>
        <p
          style={{
            fontSize: 13,
            color: "var(--text-muted)",
            margin: 0,
          }}
        >
          Live points across all your Premier League predictions. Updates
          automatically while games are being played.
        </p>
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

      <div className="card">
        {rows.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
            No predictions yet. Once people start predicting, they&apos;ll
            appear here.
          </p>
        ) : (
          <table
            style={{
              width: "100%",
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
                <th style={{ paddingBottom: 8 }}>Rank</th>
                <th style={{ paddingBottom: 8 }}>Player</th>
                <th style={{ paddingBottom: 8, textAlign: "right" }}>Pts</th>
                <th style={{ paddingBottom: 8, textAlign: "right" }}>Exact</th>
                <th style={{ paddingBottom: 8, textAlign: "right" }}>
                  Result
                </th>
                <th style={{ paddingBottom: 8, textAlign: "right" }}>Wrong</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr
                  key={row.userId}
                  style={{
                    borderTop: "1px solid rgba(148,163,184,0.15)",
                  }}
                >
                  <td style={{ padding: "6px 0" }}>{index + 1}</td>
                  <td style={{ padding: "6px 0" }}>{row.userDisplayName}</td>
                  <td style={{ padding: "6px 0", textAlign: "right" }}>
                    <strong>{row.totalPoints}</strong>
                  </td>
                  <td style={{ padding: "6px 0", textAlign: "right" }}>
                    {row.exactCount}
                  </td>
                  <td style={{ padding: "6px 0", textAlign: "right" }}>
                    {row.resultCount}
                  </td>
                  <td style={{ padding: "6px 0", textAlign: "right" }}>
                    {row.wrongCount}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default LeaderboardPage;
