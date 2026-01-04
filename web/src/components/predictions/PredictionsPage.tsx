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
  const [saveNotice, setSaveNotice] = React.useState<string | null>(null);
  const [lastAttempt, setLastAttempt] = React.useState<{
    fixture: Fixture;
    prediction: Prediction;
  } | null>(null);
  const saveNoticeTimeout = React.useRef<number | null>(null);
  const fixturesPollInterval = React.useRef<number | null>(null);

  React.useEffect(() => {
    return () => {
      if (saveNoticeTimeout.current) {
        window.clearTimeout(saveNoticeTimeout.current);
      }
      if (fixturesPollInterval.current) {
        window.clearInterval(fixturesPollInterval.current);
      }
    };
  }, []);

  // Load ALL fixtures in the next gameweek (entire matchday)
  React.useEffect(() => {
    let cancelled = false;
    const firstRun = { current: true } as { current: boolean };
    const loadFixtures = async () => {
      try {
        if (firstRun.current) {
          setLoading(true);
        }
        const data = await getNextPremierLeagueGameweekFixtures();
        if (cancelled) return;
        // sort by kickoff just in case
        data.sort((a, b) => new Date(a.kickoff).getTime() - new Date(b.kickoff).getTime());
        setFixtures(data);
        setError(null);
      } catch (err: unknown) {
        console.error(err);
        const message =
          err instanceof Error
            ? err.message
            : "Failed to load fixtures from the Football API. Check your API key or plan.";
        if (!cancelled) {
          setError(message);
        }
      } finally {
        if (!cancelled && firstRun.current) {
          setLoading(false);
          firstRun.current = false;
        }
      }
    };
    loadFixtures();

    fixturesPollInterval.current = window.setInterval(loadFixtures, 60_000);

    return () => {
      cancelled = true;
    };
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

    setLastAttempt({ fixture, prediction: p });

    // Optimistic update
    let previousValue: PredictionDoc | null = null;
    setPredictions((prev) => {
      previousValue = prev[fixture.id] ?? null;
      return { ...prev, [fixture.id]: data };
    });

    try {
      await setDoc(doc(db, "predictions", docId), data, { merge: true });
      setSaveError(null);
      if (saveNoticeTimeout.current) {
        window.clearTimeout(saveNoticeTimeout.current);
      }
      setSaveNotice("Prediction saved");
      saveNoticeTimeout.current = window.setTimeout(() => {
        setSaveNotice(null);
      }, 2500);
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

  const retryLastAttempt = () => {
    if (!lastAttempt) return;
    handleChangePrediction(lastAttempt.fixture, lastAttempt.prediction);
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

  // Lock all predictions once the first fixture of the gameweek kicks off
  const gameweekLocked = React.useMemo(() => {
    if (!fixtures.length) return false;
    const firstFixture = fixtures[0];
    const kickoffTime = new Date(firstFixture.kickoff).getTime();
    const startedByTime = Number.isFinite(kickoffTime) && Date.now() >= kickoffTime;
    const startedByStatus = firstFixture.statusShort !== "NS";
    return startedByStatus || startedByTime;
  }, [fixtures]);

  const completion = React.useMemo(() => {
    const missing = fixtures.filter((f) => {
      const p = predictions[f.id];
      return !(p && p.predHome !== null && p.predAway !== null);
    });
    return {
      missing,
      completed: fixtures.length - missing.length,
      total: fixtures.length,
    };
  }, [fixtures, predictions]);

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
      {saveNotice && (
        <div
          className="card alert-banner alert-banner--success"
          role="status"
          style={{ marginBottom: 12 }}
        >
          <div className="alert-row">
            <strong>{saveNotice}</strong>
            <button className="fx-btn" onClick={() => setSaveNotice(null)}>
              Dismiss
            </button>
          </div>
        </div>
      )}

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
            <div style={{ display: "flex", gap: 8 }}>
              {lastAttempt && (
                <button className="fx-btn" onClick={retryLastAttempt}>
                  Retry save
                </button>
              )}
              <button className="fx-btn" onClick={() => setSaveError(null)}>
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {completion.missing.length > 0 && (
        <div
          className="card alert-banner alert-banner--incomplete"
          role="alert"
          style={{ marginBottom: 12 }}
        >
          <div className="alert-row">
            <div>
              <strong>Predictions needed</strong>
              <p style={{ margin: "4px 0 0", fontSize: 13, color: "#334155" }}>
                {completion.missing.length} of {completion.total} fixtures still need scores before kickoff.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Gameweek header */}
      <div className="card gw-header-card">
        <div className="gw-header-top">
          <div>
            <p className="gw-header-text">
              Predict the next Premier League matches. Once games kick off,
              predictions lock.
            </p>
            {fixtures[0] && <p className="gw-round-label">{fixtures[0].round}</p>}
          </div>
        </div>
        <div className="gw-points-row">
          <span className="gw-points-label">This gameweek</span>
          <span className="gw-points-value">{totalPoints} pts</span>
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
                gameweekLocked={gameweekLocked}
                required={completion.missing.some((m) => m.id === f.id)}
              />
            ))}
          </div>
        </section>
      ))}

      {completion.total > 0 && completion.missing.length > 0 && (
        <div
          className="sticky-cta alert-banner alert-banner--incomplete"
          role="alert"
        >
          <div className="alert-row">
            <div>
              <strong>Predictions needed</strong>
              <p style={{ margin: "4px 0 0", fontSize: 13, color: "#334155" }}>
                {completion.missing.length} of {completion.total} fixtures still need scores before kickoff.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PredictionsPage;
