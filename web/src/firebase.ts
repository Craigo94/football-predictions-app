import { initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from "firebase/firestore";

const firebaseEnv = {
  apiKey: {
    envValue: import.meta.env.VITE_FIREBASE_API_KEY,
    name: "VITE_FIREBASE_API_KEY",
  },
  authDomain: {
    envValue: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    name: "VITE_FIREBASE_AUTH_DOMAIN",
  },
  projectId: {
    envValue: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    name: "VITE_FIREBASE_PROJECT_ID",
  },
  storageBucket: {
    envValue: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    name: "VITE_FIREBASE_STORAGE_BUCKET",
  },
  messagingSenderId: {
    envValue: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    name: "VITE_FIREBASE_MESSAGING_SENDER_ID",
  },
  appId: {
    envValue: import.meta.env.VITE_FIREBASE_APP_ID,
    name: "VITE_FIREBASE_APP_ID",
  },
};

const rawConfig = Object.fromEntries(
  Object.entries(firebaseEnv).map(([key, { envValue }]) => [key, envValue])
) as Record<keyof typeof firebaseEnv, string | undefined>;

const missingKeys = Object.values(firebaseEnv)
  .filter(({ envValue }) => typeof envValue !== "string" || envValue.trim() === "")
  .map(({ name }) => name);

let firebaseInitializationError: Error | null = null;
let app: FirebaseApp | null = null;

try {
  if (missingKeys.length) {
    throw new Error(
      "Missing Firebase configuration. Please check your VITE_FIREBASE_* env vars. Missing: " +
        missingKeys.join(", ")
    );
  }

  const firebaseConfig = rawConfig as Record<keyof typeof rawConfig, string>;
  app = initializeApp(firebaseConfig);
} catch (err) {
  firebaseInitializationError = err instanceof Error ? err : new Error(String(err));
  console.error(firebaseInitializationError.message);
}

// Persist Firestore data in IndexedDB so re-attaching a listener (e.g. when
// navigating between pages) only downloads documents that changed, instead of
// re-reading whole collections. This is the main defence against burning
// through the free-tier daily read quota. Falls back to the in-memory cache
// on browsers without IndexedDB.
const createFirestore = (firebaseApp: FirebaseApp): Firestore => {
  try {
    return initializeFirestore(firebaseApp, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch (err) {
    console.warn("Persistent Firestore cache unavailable, using memory cache", err);
    return getFirestore(firebaseApp);
  }
};

export const firebaseApp: FirebaseApp = app as FirebaseApp;
export const auth: Auth = app ? getAuth(app) : (null as unknown as Auth);
export const db: Firestore = app ? createFirestore(app) : (null as unknown as Firestore);
export const isFirebaseConfigured = Boolean(app && !firebaseInitializationError);
export { firebaseInitializationError };

// Export the specific keys we couldn't read so the UI can provide actionable guidance
export const missingFirebaseKeys = missingKeys;
