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

    // 👇 One wide season window (adjust season years if needed)
    const from = new Date("2025-08-01T00:00:00Z");
    const to = new Date("2026-06-01T00:00:00Z");

    const fetchAllSeasonFixtures = async () => {
      try {
        if (firstRun.current) {
          setLoadingFixtures(true);
        }

        const fixtures = await getPremierLeagueMatchesForRange(from, to);
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
    fetchAllSeasonFixtures();

    // Then poll every 60s
    intervalId = window.setInterval(fetchAllSeasonFixtures, 60_000);

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
