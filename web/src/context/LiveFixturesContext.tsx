import React from "react";
import { getPremierLeagueMatchesForRange, type Fixture } from "../api/football";
import { arrayRemove, arrayUnion, doc, setDoc } from "firebase/firestore";
import { CURRENT_SEASON } from "../config/football";
import { db, firebaseApp } from "../firebase";
import {
  deleteToken,
  getMessaging,
  getToken,
  isSupported,
  onMessage,
} from "firebase/messaging";

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
  backgroundPushEnabled: boolean;
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
const FCM_TOKEN_STORAGE_KEY = "fp-fcm-token";
const firebaseVapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY?.trim() || "";

const hasBaseNotificationSupport =
  typeof window !== "undefined" && "Notification" in window;

const getStoredPreference = () => {
  if (!hasBaseNotificationSupport) return false;
  return window.localStorage.getItem(NOTIFICATION_PREF_KEY) === "true";
};

const formatScoreLine = (fixture: Fixture) => {
  const homeGoals = fixture.homeGoals ?? "-";
  const awayGoals = fixture.awayGoals ?? "-";
  return `${fixture.homeTeam} ${homeGoals} - ${awayGoals} ${fixture.awayTeam}`;
};

const resolveScoringTeam = (previous: Fixture, next: Fixture) => {
  const homeIncreased =
    previous.homeGoals != null &&
    next.homeGoals != null &&
    next.homeGoals > previous.homeGoals;
  const awayIncreased =
    previous.awayGoals != null &&
    next.awayGoals != null &&
    next.awayGoals > previous.awayGoals;

  if (homeIncreased) return next.homeTeam;
  if (awayIncreased) return next.awayTeam;
  return "Goal update";
};

export const LiveFixturesProvider: React.FC<LiveFixturesProviderProps> = ({
  children,
  userId,
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
  const [pushTokenActive, setPushTokenActive] = React.useState(false);
  const previousFixturesRef = React.useRef<Record<number, Fixture>>({});
  const deliveredEventsRef = React.useRef<Set<string>>(new Set());
  const onMessageUnsubscribeRef = React.useRef<(() => void) | null>(null);

  const syncTokenToUser = React.useCallback(
    async (token: string, mode: "add" | "remove") => {
      if (!db) return;
      await setDoc(
        doc(db, "users", userId),
        {
          notificationTokens:
            mode === "add" ? arrayUnion(token) : arrayRemove(token),
        },
        { merge: true }
      );
    },
    [userId]
  );

  const registerPushToken = React.useCallback(async () => {
    if (!firebaseVapidKey) {
      console.warn("[Notifications] VITE_FIREBASE_VAPID_KEY missing, using in-app alerts only.");
      setPushTokenActive(false);
      return;
    }

    const messagingSupported = await isSupported();
    if (!messagingSupported || !("serviceWorker" in navigator)) {
      setPushTokenActive(false);
      return;
    }

    const registration = await navigator.serviceWorker.ready;
    const messaging = getMessaging(firebaseApp);
    const token = await getToken(messaging, {
      vapidKey: firebaseVapidKey,
      serviceWorkerRegistration: registration,
    });

    if (!token) {
      setPushTokenActive(false);
      return;
    }

    const previousToken = window.localStorage.getItem(FCM_TOKEN_STORAGE_KEY);
    if (previousToken && previousToken !== token) {
      await syncTokenToUser(previousToken, "remove");
    }

    await syncTokenToUser(token, "add");
    window.localStorage.setItem(FCM_TOKEN_STORAGE_KEY, token);
    setPushTokenActive(true);

    onMessageUnsubscribeRef.current?.();
    onMessageUnsubscribeRef.current = onMessage(messaging, (payload) => {
      const title = payload.notification?.title || "Live score update";
      const body = payload.notification?.body || "A score changed in a live match.";
      registration.showNotification(title, {
        body,
        icon: "/128px-Soccer_ball.png",
        badge: "/64px-Soccer_ball.png",
        tag: payload.data?.tag || "live-score",
        data: {
          url: payload.data?.link || "/dashboard",
        },
      });
    });
  }, [syncTokenToUser]);

  const unregisterPushToken = React.useCallback(async () => {
    const existingToken = window.localStorage.getItem(FCM_TOKEN_STORAGE_KEY);

    const messagingSupported = await isSupported();
    if (messagingSupported) {
      const messaging = getMessaging(firebaseApp);
      await deleteToken(messaging);
    }

    if (existingToken) {
      await syncTokenToUser(existingToken, "remove");
      window.localStorage.removeItem(FCM_TOKEN_STORAGE_KEY);
    }

    onMessageUnsubscribeRef.current?.();
    onMessageUnsubscribeRef.current = null;
    setPushTokenActive(false);
  }, [syncTokenToUser]);

  React.useEffect(() => {
    setNotificationsEnabled(getStoredPreference());
  }, []);

  React.useEffect(() => {
    const shouldEnablePush =
      getStoredPreference() && hasBaseNotificationSupport && Notification.permission === "granted";

    if (!shouldEnablePush) return;

    registerPushToken().catch((error) =>
      console.error("[Notifications] Failed to restore push token", error)
    );
  }, [registerPushToken]);

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

    if (!notificationsEnabled || notificationPermission !== "granted" || pushTokenActive) {
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
          const scoringTeam = resolveScoringTeam(previous, fixture);
          new Notification(`${scoringTeam} scores!`, {
            body: formatScoreLine(fixture),
            tag: scoreTag,
            icon: "/128px-Soccer_ball.png",
          });
        }
      }

      const movedToFullTime =
        previous.statusShort !== "FT" && fixture.statusShort === "FT";
      if (movedToFullTime) {
        const fullTimeTag = `fulltime-${fixture.id}`;
        if (!deliveredEventsRef.current.has(fullTimeTag)) {
          deliveredEventsRef.current.add(fullTimeTag);
          new Notification("Full-time", {
            body: formatScoreLine(fixture),
            tag: fullTimeTag,
            icon: "/128px-Soccer_ball.png",
          });
        }
      }
    });

    previousFixturesRef.current = fixturesById;
  }, [fixturesById, notificationsEnabled, notificationPermission, pushTokenActive]);

  const requestNotificationPermission = React.useCallback(async () => {
    if (!notificationsSupported) return;

    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);

    const enabled = permission === "granted";
    setNotificationsEnabled(enabled);
    window.localStorage.setItem(NOTIFICATION_PREF_KEY, enabled ? "true" : "false");

    if (enabled) {
      await registerPushToken();
    }
  }, [notificationsSupported, registerPushToken]);

  const disableNotifications = React.useCallback(async () => {
    setNotificationsEnabled(false);
    window.localStorage.setItem(NOTIFICATION_PREF_KEY, "false");
    await unregisterPushToken();
  }, [unregisterPushToken]);

  React.useEffect(() => {
    return () => {
      onMessageUnsubscribeRef.current?.();
      onMessageUnsubscribeRef.current = null;
    };
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
    backgroundPushEnabled: pushTokenActive,
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
