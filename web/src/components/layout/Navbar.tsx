import React from "react";
import type { User } from "firebase/auth";
import { signOut } from "firebase/auth";
import { auth } from "../../firebase";
import { NavLink, useNavigate } from "react-router-dom";
import { formatFirstName } from "../../utils/displayName";

interface Props {
  user: User;
  isAdmin?: boolean;
}

const getDisplayName = (user: User) =>
  formatFirstName(user.displayName || user.email || "User");

const LogoMark = () => (
  <svg
    className="navbar-logo"
    width="36"
    height="36"
    viewBox="0 0 64 64"
    role="img"
    aria-label="Football predictions"
  >
    <circle cx="32" cy="32" r="28" fill="none" stroke="currentColor" strokeWidth="3" />
    <path
      d="M32 14l10 6v12l-10 6-10-6V20l10-6z"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinejoin="round"
    />
    <path
      d="M22 32l-8 6m36-6l8 6M32 38v10"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
    />
  </svg>
);

const Navbar: React.FC<Props> = ({ user, isAdmin = false }) => {
  const [currentUser, setCurrentUser] = React.useState(user);
  const [showMore, setShowMore] = React.useState(false);
  const navigate = useNavigate();

  const handleSignOut = React.useCallback(() => {
    if (!auth) return;
    signOut(auth);
  }, []);

  React.useEffect(() => {
    setCurrentUser(user);
  }, [user]);

  const displayName = getDisplayName(currentUser);

  const navItems = [
    { to: "/dashboard", icon: "🏠", label: "Home" },
    { to: "/predictions", icon: "🎯", label: "Predictions" },
    { to: "/weekly", icon: "🗓️", label: "Gameweek" },
    { to: "/league-table", icon: "📋", label: "Table" },
    { to: "/leaderboard", icon: "🏆", label: "Leaderboard" },
    { to: "/stats", icon: "📊", label: "My Stats" },
  ];

  if (isAdmin) {
    navItems.push({ to: "/admin", icon: "🛠️", label: "Admin" });
  }

  const navStyleVars: React.CSSProperties & Record<`--${string}`, string | number> = {
    // Helps the CSS evenly size items on narrow screens (with or without Admin)
    "--nav-count": navItems.length,
    "--nav-icon-size": navItems.length > 4 ? "30px" : "32px",
    "--nav-font-size": navItems.length > 4 ? "11px" : "12px",
  };

  const primaryRoutes = ["/dashboard", "/predictions", "/weekly", "/league-table"];
  const primaryNavItems = navItems.filter((item) => primaryRoutes.includes(item.to));
  const overflowNavItems = navItems.filter((item) => !primaryRoutes.includes(item.to));

  const handleMobileNavigate = (to: string) => {
    navigate(to);
    setShowMore(false);
  };

  return (
    <header className="navbar" role="banner">
      <div className="navbar-shell">
        <div className="navbar-brand" aria-label="App brand">
          <LogoMark />
        </div>
        <div className="navbar-user">
          <button
            className="userbox__chip"
            title={displayName}
            onClick={() => navigate("/profile/name")}
            aria-label="Edit your display name"
            type="button"
          >
            {displayName}
          </button>
          <button
            className="navbar-logout"
            onClick={handleSignOut}
            aria-label="Log out"
            type="button"
          >
            Log out
          </button>
        </div>
      </div>

      {/* Nav links row */}
      <nav
        className="navbar-links"
        aria-label="Primary navigation"
        style={navStyleVars}
      >
        {navItems.map(({ to, icon, label }) => (
          <NavLink
            key={to}
            to={to}
            aria-label={label}
            className={({ isActive }) =>
              "nav-link" + (isActive ? " nav-link-active" : "")
            }
          >
            <span className="nav-icon" aria-hidden="true">{icon}</span>
            <span className="nav-label">{label}</span>
          </NavLink>
        ))}
      </nav>

      <nav className="mobile-nav" aria-label="Primary navigation">
        {primaryNavItems.map(({ to, icon, label }) => (
          <button
            key={to}
            type="button"
            className="mobile-nav__item"
            onClick={() => handleMobileNavigate(to)}
            aria-label={label}
          >
            <span className="mobile-nav__icon" aria-hidden="true">
              {icon}
            </span>
            <span className="mobile-nav__label">{label}</span>
          </button>
        ))}
        <button
          type="button"
          className="mobile-nav__item"
          onClick={() => setShowMore((prev) => !prev)}
          aria-expanded={showMore}
          aria-controls="mobile-nav-overflow"
        >
          <span className="mobile-nav__icon" aria-hidden="true">
            ✨
          </span>
          <span className="mobile-nav__label">More</span>
        </button>
      </nav>

      {showMore && (
        <div className="mobile-nav__overlay" onClick={() => setShowMore(false)}>
          <div
            className="mobile-nav__sheet"
            id="mobile-nav-overflow"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
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
              {overflowNavItems.map(({ to, icon, label }) => (
                <button
                  key={to}
                  type="button"
                  className="mobile-nav__sheet-item"
                  onClick={() => handleMobileNavigate(to)}
                >
                  <span aria-hidden="true">{icon}</span>
                  <span>{label}</span>
                </button>
              ))}
              <button
                type="button"
                className="mobile-nav__sheet-item"
                onClick={() => handleMobileNavigate("/profile/name")}
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
    </header>
  );
};

export default Navbar;
