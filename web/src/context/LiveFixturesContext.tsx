import React from "react";
import {
  getPremierLeagueMatchesForRange,
  type Fixture,
} from "../api/football";
import { CURRENT_SEASON } from "../config/football";

interface LiveFixturesContextValue {
  fixturesById: Record<number, Fixture>;
  loadingFixtures: boolean;
  fixturesError: string | null;
  lastUpdated: number | null;
}

const LiveFixturesContext = React.createContext<
  LiveFixturesContextValue | undefined
>(undefined);

// Fetch the full Premier League season so the leaderboard can score predictions
// across all gameweeks (not just recent fixtures). This keeps historical
// results available even after many months have passed.
const seasonDateRange = (season: number) => {
  // Premier League seasons start in August and end in May. Use an inclusive
  // July 1 -> June 30 window to capture the whole season regardless of the
  // exact fixture calendar.
  const start = new Date(Date.UTC(season, 6, 1)); // July 1 of the season year
  const end = new Date(Date.UTC(season + 1, 5, 30, 23, 59, 59, 999)); // June 30 of next year
  return { start, end };
};
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

        const { start, end } = seasonDateRange(CURRENT_SEASON);
        const fixtures = await getPremierLeagueMatchesForRange(start, end);
        if (cancelled) return;

        const map: Record<number, Fixture> = {};
        fixtures.forEach((f) => {
          map[f.id] = f;
        });

        setFixturesById(map);
        setFixturesError(null);
        setLastUpdated(Date.now());
      } catch (err: unknown) {
        console.error("[LiveFixtures] Failed to load fixtures", err);
        if (!cancelled) {
          const message =
            err instanceof Error
              ? err.message
              : "Failed to load live scores from the Football API.";
          setFixturesError(message);
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

// eslint-disable-next-line react-refresh/only-export-components
export const useLiveFixtures = (): LiveFixturesContextValue => {
  const ctx = React.useContext(LiveFixturesContext);
  if (!ctx) {
    throw new Error("useLiveFixtures must be used within LiveFixturesProvider");
  }
  return ctx;
};
