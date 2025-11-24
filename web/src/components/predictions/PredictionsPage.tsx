import React from "react";
import type { User } from "firebase/auth";
import {
  collection,
  doc,
  onSnapshot,
  query,
  setDoc,
  where,
} from "firebase/firestore";
import { db } from "../../firebase";
import { getNextPremierLeagueGameweekFixtures } from "../../api/football";
import type { Fixture } from "../../api/football";
import FixtureCard, { type Prediction } from "./FixtureCard";
import { scorePrediction } from "../../utils/scoring";
import { formatFirstName } from "../../utils/displayName";
import { ymdUK, dayHeading } from "../../utils/dates";

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
}

const PredictionsPage: React.FC<Props> = ({ user }) => {
  const [fixtures, setFixtures] = React.useState<Fixture[]>([]);
  const [predictions, setPredictions] = React.useState<
    Record<number, PredictionDoc>
  >({});
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [saveError, setSaveError] = React.useState<string | null>(null);

  // Load ALL fixtures in the next gameweek (entire matchday)
  React.useEffect(() => {
    const loadFixtures = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await getNextPremierLeagueGameweekFixtures();
        // sort by kickoff just in case
        data.sort((a, b) => new Date(a.kickoff).getTime() - new Date(b.kickoff).getTime());
        setFixtures(data);
      } catch (err: any) {
        console.error(err);
        setError(
          err?.message ||
            "Failed to load fixtures from the Football API. Check your API key or plan."
        );
      } finally {
        setLoading(false);
      }
    };
    loadFixtures();
  }, []);

  // Subscribe to current user's predictions
  React.useEffect(() => {
    const q = query(
      collection(db, "predictions"),
      where("userId", "==", user.uid)
    );

    const unsub = onSnapshot(q, (snap) => {
      const map: Record<number, PredictionDoc> = {};
      snap.forEach((d) => {
        const data = d.data() as PredictionDoc;
        map[data.fixtureId] = data;
      });
      setPredictions(map);
    });

    return () => unsub();
  }, [user.uid]);

  const handleChangePrediction = async (fixture: Fixture, p: Prediction) => {
    const docId = `${user.uid}_${fixture.id}`;

    // Store the user's first name for display across leaderboards and stats
    const userDisplayName = formatFirstName(
      user.displayName || user.email || "Unknown"
    );

    const data: PredictionDoc = {
      userId: user.uid,
      userDisplayName,
      fixtureId: fixture.id,
      predHome: p.predHome,
      predAway: p.predAway,
      locked: p.locked ?? false,
      homeTeam: fixture.homeTeam,
      awayTeam: fixture.awayTeam,
      kickoff: fixture.kickoff,
      round: fixture.round,
    };

    // Optimistic update
    let previousValue: PredictionDoc | null = null;
    setPredictions((prev) => {
      previousValue = prev[fixture.id] ?? null;
      return { ...prev, [fixture.id]: data };
    });

    try {
      await setDoc(doc(db, "predictions", docId), data, { merge: true });
      setSaveError(null);
    } catch (err) {
      console.error("Failed to save prediction", err);
      setSaveError(
        "Could not save your prediction. Please check your connection and try again."
      );
      setPredictions((prev) => {
        if (previousValue) {
          return { ...prev, [fixture.id]: previousValue };
        }
        const next = { ...prev };
        delete next[fixture.id];
        return next;
      });
    }
  };

  const totalPoints = fixtures.reduce((sum, f) => {
    const pred = predictions[f.id];
    if (!pred) return sum;

    const { points } = scorePrediction(
      pred.predHome,
      pred.predAway,
      f.homeGoals,
      f.awayGoals
    );

    return sum + (points ?? 0);
  }, 0);

  // Group fixtures by UK calendar day for subheadings
  const groups = React.useMemo(() => {
    const map = new Map<string, { label: string; items: Fixture[] }>();
    for (const f of fixtures) {
      const key = ymdUK(f.kickoff);
      if (!map.has(key)) {
        map.set(key, { label: dayHeading(f.kickoff), items: [] });
      }
      map.get(key)!.items.push(f);
    }
    // chronological day order
    return Array.from(map.entries())
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([, v]) => {
        // ensure fixtures within a day are also sorted
        v.items.sort(
          (x, y) => new Date(x.kickoff).getTime() - new Date(y.kickoff).getTime()
        );
        return v;
      });
  }, [fixtures]);

  if (loading) {
    return <div>Loading fixtures…</div>;
  }

  if (error) {
    return (
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Next Gameweek</h2>
        <p style={{ fontSize: 13, color: "var(--text-muted)" }}>{error}</p>
      </div>
    );
  }

  if (!fixtures.length) {
    return (
      <div className="card">
        <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
          No upcoming Premier League fixtures were returned by the API.
          This might be because:
        </p>
        <ul style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 8 }}>
          <li>The free plan doesn’t include this league or season</li>
          <li>You’ve hit the daily request limit</li>
          <li>The API key is misconfigured</li>
        </ul>
      </div>
    );
  }

  return (
    <div>
      {saveError && (
        <div
          className="card"
          role="alert"
          style={{
            marginBottom: 12,
            borderColor: "var(--red)",
            background: "#fff6f6",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <div>
              <strong>Save issue</strong>
              <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--text-muted)" }}>
                {saveError}
              </p>
            </div>
            <button className="fx-btn" onClick={() => setSaveError(null)}>
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Gameweek header */}
      <div
        className="card"
        style={{
          marginBottom: 16,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div>
          <p
            style={{
              fontSize: 13,
              color: "var(--text-muted)",
              marginTop: 4,
              marginBottom: 0,
            }}
          >
            Predict the next Premier League matches. Once games kick off,
            predictions lock.
          </p>
          {fixtures[0] && (
            <p
              style={{
                fontSize: 11,
                color: "var(--text-muted)",
                marginTop: 4,
              }}
            >
              {fixtures[0].round}
            </p>
          )}
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
            This gameweek
          </div>
          <div style={{ fontWeight: 700, fontSize: 20 }}>{totalPoints} pts</div>
        </div>
      </div>

      {/* Per-day headings with fixtures */}
      {groups.map(({ label, items }) => (
        <section key={label} style={{ marginBottom: 16 }}>
          <h3
            style={{
              margin: "0 0 8px 4px",
              fontSize: 14,
              color: "var(--text-muted)",
            }}
          >
            {label}
          </h3>

          <div className="fixtures-list">
            {items.map((f) => (
              <FixtureCard
                key={f.id}
                fixture={f}
                prediction={predictions[f.id] || null}
                onChangePrediction={(p) => handleChangePrediction(f, p)}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
};

export default PredictionsPage;
