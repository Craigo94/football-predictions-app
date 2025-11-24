import React from "react";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { onAuthStateChanged, type User } from "firebase/auth";
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import {
  auth,
  db,
  firebaseInitializationError,
  isFirebaseConfigured,
  missingFirebaseKeys,
} from "./firebase";
import Navbar from "./components/layout/Navbar";
import PredictionsPage from "./components/predictions/PredictionsPage";
import LeaderboardPage from "./components/leaderboard/LeaderboardPage";
import WeeklyGameweekPage from "./components/weekly/WeeklyGameweekPage";
import MyStatsPage from "./components/stats/MyStatsPage";
import LoginPage from "./components/auth/LoginPage";
import { LiveFixturesProvider } from "./context/LiveFixturesContext";
import EditNamePage from "./components/profile/EditNamePage";
import AdminPage from "./components/admin/AdminPage";
import { PRIMARY_ADMIN_EMAIL, normalizeEmail } from "./config/admin";

interface UserProfile {
  displayName?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  isAdmin?: boolean;
  hasPaid?: boolean;
}

const App: React.FC = () => {
  const [user, setUser] = React.useState<User | null>(null);
  const [authLoading, setAuthLoading] = React.useState(true);
  const [userProfile, setUserProfile] = React.useState<UserProfile | null>(null);
  const [profileLoading, setProfileLoading] = React.useState(false);
  const firebaseReady = isFirebaseConfigured && !firebaseInitializationError;

  const refreshUser = React.useCallback(async () => {
    if (!auth?.currentUser) return null;

    await auth.currentUser.reload();
    const updatedUser = auth.currentUser;
    setUser(updatedUser ? ({ ...updatedUser } as User) : null);
    return updatedUser;
  }, []);

  React.useEffect(() => {
    if (!auth || !firebaseReady) return;
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthLoading(false);
    });
    return () => unsub();
  }, [firebaseReady]);

  React.useEffect(() => {
    if (!user) {
      setUserProfile(null);
      setProfileLoading(false);
      return;
    }

    if (!db || !firebaseReady) return;

    setProfileLoading(true);
    const ref = doc(db, "users", user.uid);

    const unsub = onSnapshot(
      ref,
      (snap) => {
        const data = snap.data();
        const mapped: UserProfile | null = data
          ? {
              displayName: data.displayName,
              firstName: data.firstName,
              lastName: data.lastName,
              email: data.email,
              isAdmin: Boolean(data.isAdmin),
              hasPaid: Boolean(data.hasPaid),
            }
          : null;
        setUserProfile(mapped);
        setProfileLoading(false);
      },
      (err) => {
        console.error("Error loading user profile", err);
        setUserProfile(null);
        setProfileLoading(false);
      }
    );

    return () => unsub();
  }, [db, firebaseReady, user]);

  if (!firebaseReady) {
    return (
      <div className="config-error">
        <div className="config-error__card">
          <h2>Configuration error</h2>
          <p className="config-error__message">
            We couldn&apos;t start Firebase because the client credentials are missing.
          </p>

          <div className="config-error__details">
            <p className="config-error__label">Missing environment variables:</p>
            <ul>
              {missingFirebaseKeys.length ? (
                missingFirebaseKeys.map((key) => <li key={key}>{`VITE_FIREBASE_${key}`}</li>)
              ) : (
                <li>VITE_FIREBASE_* keys were not provided</li>
              )}
            </ul>
          </div>

          <p className="config-error__hint">
            Create a <code>.env.local</code> file in <code>web/</code> (next to package.json) and
            supply all <code>VITE_FIREBASE_*</code> values exactly as shown in your Firebase
            project. Restart the build/dev server after adding them.
          </p>

          {firebaseInitializationError?.message && (
            <p className="config-error__technical">{firebaseInitializationError.message}</p>
          )}
        </div>
      </div>
    );
  }

  if (authLoading || (user && profileLoading)) {
    return <div style={{ padding: 16 }}>Loading…</div>;
  }

  const normalizedUserEmail = normalizeEmail(user?.email);
  const normalizedPrimaryAdmin = normalizeEmail(PRIMARY_ADMIN_EMAIL);
  const matchesPrimaryAdmin =
    normalizedPrimaryAdmin === "" || normalizedUserEmail === normalizedPrimaryAdmin;

  React.useEffect(() => {
    if (!user || !userProfile || !matchesPrimaryAdmin) return;

    if (!userProfile.isAdmin) {
      setDoc(doc(db, "users", user.uid), { isAdmin: true }, { merge: true }).catch(
        (err) => console.error("Failed to sync primary admin flag", err)
      );
    }
  }, [user, userProfile, matchesPrimaryAdmin]);

  const isAdmin = Boolean(userProfile?.isAdmin && matchesPrimaryAdmin);

  return (
    <Router>
      {user ? (
        <LiveFixturesProvider>
          <div className="app-shell">
            <Navbar user={user} isAdmin={isAdmin} />
            <Routes>
              <Route
                path="/predictions"
                element={<PredictionsPage user={user} />}
              />
              <Route path="/leaderboard" element={<LeaderboardPage />} />
              <Route path="/weekly" element={<WeeklyGameweekPage />} />
              <Route path="/stats" element={<MyStatsPage user={user} />} />
              <Route
                path="/admin"
                element={
                  isAdmin ? (
                    <AdminPage />
                  ) : (
                    <Navigate to="/predictions" replace />
                  )
                }
              />
              <Route
                path="/profile/name"
                element={
                  <EditNamePage user={user} onUserUpdated={refreshUser} />
                }
              />
              <Route path="*" element={<Navigate to="/predictions" replace />} />
            </Routes>
          </div>
        </LiveFixturesProvider>
      ) : (
        <Routes>
          <Route path="*" element={<LoginPage />} />
        </Routes>
      )}
    </Router>
  );
};

export default App;
