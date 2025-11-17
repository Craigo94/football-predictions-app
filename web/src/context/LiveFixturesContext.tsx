import React from "react";
import {
  getPremierLeagueMatchesForRange,
  type Fixture,
} from "../api/football";

interface LiveFixturesContextValue {
  fixturesById: Record<number, Fixture>;
  loadingFixtures: boolean;
  fixturesError: string | null;
  lastUpdated: number | null;
}

const LiveFixturesContext = React.createContext<
  LiveFixturesContextValue | undefined
>(undefined);

const WINDOW_PAST_DAYS = 2;
const WINDOW_FUTURE_DAYS = 10;
const POLL_INTERVAL_MS = 120_000; // 2 minutes is enough for a small group

export const LiveFixturesProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [fixturesById, setFixturesById] = React.useState<Record<number, Fixture>>(
    {}
  );
  const [loadingFixtures, setLoadingFixtures] = React.useState(true);
  const [fixturesError, setFixturesError] = React.useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = React.useState<number | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    let intervalId: number | null = null;
    const firstRun = { current: true } as { current: boolean };

    const fetchWindowFixtures = async () => {
      try {
        if (firstRun.current) {
          setLoadingFixtures(true);
        }

        const fixtures = await getPremierLeagueMatchesForRange(
          new Date(Date.now() - WINDOW_PAST_DAYS * 24 * 60 * 60 * 1000),
          new Date(Date.now() + WINDOW_FUTURE_DAYS * 24 * 60 * 60 * 1000)
        );
        if (cancelled) return;

        const map: Record<number, Fixture> = {};
        fixtures.forEach((f) => {
          map[f.id] = f;
        });

        setFixturesById(map);
        setFixturesError(null);
        setLastUpdated(Date.now());
      } catch (err: any) {
        console.error("[LiveFixtures] Failed to load fixtures", err);
        if (!cancelled) {
          setFixturesError(
            err?.message || "Failed to load live scores from the Football API."
          );
        }
      } finally {
        if (!cancelled) {
          setLoadingFixtures(false);
          firstRun.current = false;
        }
      }
    };

    // First fetch now
    fetchWindowFixtures();

    // Then poll on a slower cadence (no need to hammer the API for a small group)
    intervalId = window.setInterval(fetchWindowFixtures, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (intervalId != null) {
        window.clearInterval(intervalId);
      }
    };
  }, []);

  const value: LiveFixturesContextValue = {
    fixturesById,
    loadingFixtures,
    fixturesError,
    lastUpdated,
  };

  return (
    <LiveFixturesContext.Provider value={value}>
      {children}
    </LiveFixturesContext.Provider>
  );
};

export const useLiveFixtures = (): LiveFixturesContextValue => {
  const ctx = React.useContext(LiveFixturesContext);
  if (!ctx) {
    throw new Error("useLiveFixtures must be used within LiveFixturesProvider");
  }
  return ctx;
};
