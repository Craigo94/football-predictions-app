import React from "react";
import {
  arrayRemove,
  arrayUnion,
  doc,
  setDoc,
} from "firebase/firestore";
import {
  deleteToken,
  getMessaging,
  getToken,
  isSupported,
} from "firebase/messaging";
import {
  getPremierLeagueMatchesForRange,
  type Fixture,
} from "../api/football";
import { CURRENT_SEASON } from "../config/football";
import { db, firebaseApp } from "../firebase";

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
  typeof window !== "undefined" &&
  "Notification" in window &&
  "serviceWorker" in navigator;

const getStoredPreference = () => {
  if (!hasBaseNotificationSupport) return false;
  return window.localStorage.getItem(NOTIFICATION_PREF_KEY) === "true";
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
  const [notificationsSupported, setNotificationsSupported] =
    React.useState(hasBaseNotificationSupport);

  React.useEffect(() => {
    setNotificationsEnabled(getStoredPreference());

    let cancelled = false;
    if (hasBaseNotificationSupport) {
      isSupported().then((supported) => {
        if (!cancelled) setNotificationsSupported(supported);
      });
    }

    return () => {
      cancelled = true;
    };
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

  const requestNotificationPermission = React.useCallback(async () => {
    if (!notificationsSupported) return;

    const vapidPublicKey = import.meta.env.VITE_WEB_PUSH_PUBLIC_KEY;
    if (!vapidPublicKey) {
      throw new Error("Missing VITE_WEB_PUSH_PUBLIC_KEY env var.");
    }

    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);

    if (permission !== "granted") {
      setNotificationsEnabled(false);
      window.localStorage.setItem(NOTIFICATION_PREF_KEY, "false");
      return;
    }

    const registration = await navigator.serviceWorker.ready;
    const messaging = getMessaging(firebaseApp);
    const token = await getToken(messaging, {
      vapidKey: vapidPublicKey,
      serviceWorkerRegistration: registration,
    });

    if (!token) {
      throw new Error("Failed to create a push token for this device.");
    }

    await setDoc(
      doc(db, "users", userId),
      {
        notificationTokens: arrayUnion(token),
      },
      { merge: true }
    );

    setNotificationsEnabled(true);
    window.localStorage.setItem(NOTIFICATION_PREF_KEY, "true");
  }, [notificationsSupported, userId]);

  const disableNotifications = React.useCallback(async () => {
    setNotificationsEnabled(false);
    if (!notificationsSupported) return;

    try {
      const registration = await navigator.serviceWorker.ready;
      const messaging = getMessaging(firebaseApp);
      const token = await getToken(messaging, {
        vapidKey: import.meta.env.VITE_WEB_PUSH_PUBLIC_KEY,
        serviceWorkerRegistration: registration,
      });

      if (token) {
        await setDoc(
          doc(db, "users", userId),
          {
            notificationTokens: arrayRemove(token),
          },
          { merge: true }
        );
      }

      await deleteToken(messaging);
    } catch (error) {
      console.error("Failed to disable notifications", error);
    }

    window.localStorage.setItem(NOTIFICATION_PREF_KEY, "false");
  }, [notificationsSupported, userId]);

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
