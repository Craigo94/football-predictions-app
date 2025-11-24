import React from "react";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { onAuthStateChanged, type User } from "firebase/auth";
import { auth } from "./firebase";
import Navbar from "./components/layout/Navbar";
import PredictionsPage from "./components/predictions/PredictionsPage";
import LeaderboardPage from "./components/leaderboard/LeaderboardPage";
import WeeklyGameweekPage from "./components/weekly/WeeklyGameweekPage";
import MyStatsPage from "./components/stats/MyStatsPage";
import LoginPage from "./components/auth/LoginPage";
import { LiveFixturesProvider } from "./context/LiveFixturesContext";

const App: React.FC = () => {
  const [user, setUser] = React.useState<User | null>(null);
  const [authLoading, setAuthLoading] = React.useState(true);

  const refreshUser = React.useCallback(async () => {
    if (!auth.currentUser) return null;

    await auth.currentUser.reload();
    const updatedUser = auth.currentUser;
    setUser(updatedUser ? ({ ...updatedUser } as User) : null);
    return updatedUser;
  }, []);

  React.useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthLoading(false);
    });
    return () => unsub();
  }, []);

  if (authLoading) {
    return <div style={{ padding: 16 }}>Loading…</div>;
  }

  return (
    <Router>
      {user ? (
        <LiveFixturesProvider>
          <div className="app-shell">
            <Navbar user={user} onUserUpdated={refreshUser} />
            <Routes>
              <Route
                path="/predictions"
                element={<PredictionsPage user={user} />}
              />
              <Route path="/leaderboard" element={<LeaderboardPage />} />
              <Route path="/weekly" element={<WeeklyGameweekPage />} />
              <Route path="/stats" element={<MyStatsPage user={user} />} />
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
