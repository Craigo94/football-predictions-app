import { initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";

const rawConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const missingKeys = Object.entries(rawConfig)
  .filter(([, value]) => typeof value !== "string" || value.trim() === "")
  .map(([key]) => key);

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

export const auth: Auth = app ? getAuth(app) : (null as unknown as Auth);
export const db: Firestore = app ? getFirestore(app) : (null as unknown as Firestore);
export const isFirebaseConfigured = Boolean(app && !firebaseInitializationError);
export { firebaseInitializationError };
