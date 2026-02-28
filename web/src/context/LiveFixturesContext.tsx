import React from "react";
import {
  getPremierLeagueMatchesForRange,
  type Fixture,
} from "../api/football";
import { CURRENT_SEASON } from "../config/football";

interface LiveFixturesProviderProps {
  children: React.ReactNode;
  userId: string;
}

interface LiveFixturesContextValue {
  fixturesById: Record<number, Fixture>;
  loadingFixtures: boolean;
  fixturesError: string | null;
  lastUpdated: number | null;
  notificationsSupported: boolean;
  notificationPermission: NotificationPermission | "unsupported";
  notificationsEnabled: boolean;
  requestNotificationPermission: () => Promise<void>;
  disableNotifications: () => Promise<void>;
}

const LiveFixturesContext = React.createContext<
  LiveFixturesContextValue | undefined
>(undefined);

const seasonDateRange = (season: number) => {
  const start = new Date(Date.UTC(season, 6, 1));
  const end = new Date(Date.UTC(season + 1, 5, 30, 23, 59, 59, 999));
  return { start, end };
};

const POLL_INTERVAL_MS = 120_000;
const NOTIFICATION_PREF_KEY = "fp-live-notifications-enabled";

const hasBaseNotificationSupport =
  typeof window !== "undefined" && "Notification" in window;

const getStoredPreference = () => {
  if (!hasBaseNotificationSupport) return false;
  return window.localStorage.getItem(NOTIFICATION_PREF_KEY) === "true";
};

export const LiveFixturesProvider: React.FC<LiveFixturesProviderProps> = ({
  children,
}) => {
  const [fixturesById, setFixturesById] = React.useState<Record<number, Fixture>>(
    {}
  );
  const [loadingFixtures, setLoadingFixtures] = React.useState(true);
  const [fixturesError, setFixturesError] = React.useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = React.useState<number | null>(null);
  const [notificationsEnabled, setNotificationsEnabled] = React.useState(false);
  const [notificationPermission, setNotificationPermission] = React.useState<
    NotificationPermission | "unsupported"
  >(hasBaseNotificationSupport ? Notification.permission : "unsupported");
  const [notificationsSupported] = React.useState(hasBaseNotificationSupport);
  const previousFixturesRef = React.useRef<Record<number, Fixture>>({});
  const deliveredEventsRef = React.useRef<Set<string>>(new Set());

  React.useEffect(() => {
    setNotificationsEnabled(getStoredPreference());
  }, []);

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

    fetchWindowFixtures();
    intervalId = window.setInterval(fetchWindowFixtures, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (intervalId != null) {
        window.clearInterval(intervalId);
      }
    };
  }, []);

  React.useEffect(() => {
    const previousFixtures = previousFixturesRef.current;

    if (!Object.keys(previousFixtures).length) {
      previousFixturesRef.current = fixturesById;
      return;
    }

    if (!notificationsEnabled || notificationPermission !== "granted") {
      previousFixturesRef.current = fixturesById;
      return;
    }

    Object.values(fixturesById).forEach((fixture) => {
      const previous = previousFixtures[fixture.id];
      if (!previous) return;

      const scoreChanged =
        fixture.homeGoals != null &&
        fixture.awayGoals != null &&
        (fixture.homeGoals !== previous.homeGoals ||
          fixture.awayGoals !== previous.awayGoals);

      if (scoreChanged) {
        const scoreTag = `score-${fixture.id}-${fixture.homeGoals}-${fixture.awayGoals}`;
        if (!deliveredEventsRef.current.has(scoreTag)) {
          deliveredEventsRef.current.add(scoreTag);
          new Notification(
            `Goal: ${fixture.homeShort} ${fixture.homeGoals}–${fixture.awayGoals} ${fixture.awayShort}`,
            {
              body: `${fixture.homeTeam} vs ${fixture.awayTeam}`,
              tag: scoreTag,
              icon: "/128px-Soccer_ball.png",
            }
          );
        }
      }

      const movedToFullTime =
        previous.statusShort !== "FT" && fixture.statusShort === "FT";
      if (movedToFullTime) {
        const fullTimeTag = `fulltime-${fixture.id}`;
        if (!deliveredEventsRef.current.has(fullTimeTag)) {
          deliveredEventsRef.current.add(fullTimeTag);
          new Notification(
            `Full-time: ${fixture.homeShort} ${fixture.homeGoals ?? "-"}–${fixture.awayGoals ?? "-"} ${fixture.awayShort}`,
            {
              body: `${fixture.homeTeam} vs ${fixture.awayTeam}`,
              tag: fullTimeTag,
              icon: "/128px-Soccer_ball.png",
            }
          );
        }
      }
    });

    previousFixturesRef.current = fixturesById;
  }, [fixturesById, notificationsEnabled, notificationPermission]);

  const requestNotificationPermission = React.useCallback(async () => {
    if (!notificationsSupported) return;

    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);

    const enabled = permission === "granted";
    setNotificationsEnabled(enabled);
    window.localStorage.setItem(NOTIFICATION_PREF_KEY, enabled ? "true" : "false");
  }, [notificationsSupported]);

  const disableNotifications = React.useCallback(async () => {
    setNotificationsEnabled(false);
    window.localStorage.setItem(NOTIFICATION_PREF_KEY, "false");
  }, []);

  const value: LiveFixturesContextValue = {
    fixturesById,
    loadingFixtures,
    fixturesError,
    lastUpdated,
    notificationsSupported,
    notificationPermission,
    notificationsEnabled,
    requestNotificationPermission,
    disableNotifications,
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
