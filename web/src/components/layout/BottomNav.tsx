import React from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { signOut } from "firebase/auth";
import { auth } from "../../firebase";

interface Props {
  isAdmin?: boolean;
}

const primaryItems = [
  { to: "/dashboard", icon: "🏠", label: "Home" },
  { to: "/predictions", icon: "🎯", label: "Predictions" },
  { to: "/weekly", icon: "🗓️", label: "Gameweek" },
  { to: "/world-cup", icon: "🌍", label: "World Cup" },
];

const BottomNav: React.FC<Props> = ({ isAdmin = false }) => {
  const [showMore, setShowMore] = React.useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  const handleSignOut = React.useCallback(() => {
    if (!auth) return;
    signOut(auth);
  }, []);

  const handleNavigate = (to: string) => {
    navigate(to);
    setShowMore(false);
  };

  const overflowItems = [
    { to: "/leaderboard", icon: "🏆", label: "Leaderboard" },
    { to: "/league-table", icon: "📋", label: "Table" },
    { to: "/stats", icon: "📊", label: "My Stats" },
    ...(isAdmin ? [{ to: "/admin", icon: "🛠️", label: "Admin" }] : []),
  ];

  const isActive = (to: string) => location.pathname === to;
  const overflowActive = overflowItems.some((item) => isActive(item.to));

  return (
    <>
      <nav className="bottom-nav-bar" aria-label="Primary navigation">
        {primaryItems.map(({ to, icon, label }) => (
          <button
            key={to}
            type="button"
            className={`bottom-nav-item${isActive(to) ? " bottom-nav-item--active" : ""}`}
            onClick={() => handleNavigate(to)}
            aria-label={label}
            aria-current={isActive(to) ? "page" : undefined}
          >
            <span className="bottom-nav-icon" aria-hidden="true">{icon}</span>
            <span className="bottom-nav-label">{label}</span>
          </button>
        ))}
        <button
          type="button"
          className={`bottom-nav-item${overflowActive ? " bottom-nav-item--active" : ""}`}
          onClick={() => setShowMore((prev) => !prev)}
          aria-expanded={showMore}
          aria-controls="bottom-nav-overflow"
        >
          <span className="bottom-nav-icon" aria-hidden="true">✨</span>
          <span className="bottom-nav-label">More</span>
        </button>
      </nav>

      {showMore && (
        <div className="mobile-nav__overlay" onClick={() => setShowMore(false)}>
          <div
            className="mobile-nav__sheet"
            id="bottom-nav-overflow"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mobile-nav__sheet-header">
              <span>More options</span>
              <button
                type="button"
                className="mobile-nav__close"
                onClick={() => setShowMore(false)}
                aria-label="Close menu"
              >
                ✕
              </button>
            </div>
            <div className="mobile-nav__sheet-grid">
              {overflowItems.map(({ to, icon, label }) => (
                <button
                  key={to}
                  type="button"
                  className="mobile-nav__sheet-item"
                  onClick={() => handleNavigate(to)}
                >
                  <span aria-hidden="true">{icon}</span>
                  <span>{label}</span>
                </button>
              ))}
              <button
                type="button"
                className="mobile-nav__sheet-item"
                onClick={() => handleNavigate("/profile/name")}
              >
                <span aria-hidden="true">🪪</span>
                <span>Profile</span>
              </button>
              <button
                type="button"
                className="mobile-nav__sheet-item"
                onClick={handleSignOut}
              >
                <span aria-hidden="true">🚪</span>
                <span>Log out</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default BottomNav;
