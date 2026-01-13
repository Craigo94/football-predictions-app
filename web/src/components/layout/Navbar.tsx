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


const Navbar: React.FC<Props> = ({ user, isAdmin = false }) => {
  const [currentUser, setCurrentUser] = React.useState(user);
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
    { to: "/predictions", icon: "🎯", label: "Predictions" },
    { to: "/weekly", icon: "🗓️", label: "Gameweek" },
    { to: "/leaderboard", icon: "🏆", label: "Leaderboard" },
    { to: "/league-table", icon: "📋", label: "Table" },
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

  return (
    <header className="navbar" role="banner">
      {/* Top section: brand + user, stacked and centred */}
      <div className="navbar-top">
        {/* Brand row */}
        <div className="navbar-brand" aria-label="App brand">
          <div className="navbar-logo" aria-hidden="true">
            <span role="img" aria-label="football">⚽</span>
          </div>
          <div className="navbar-text">
            <div className="navbar-title">Family Premier League Picks</div>
            <div className="navbar-subtitle">Predict the scores, beat the family</div>
          </div>
        </div>

        {/* User row */}
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
    </header>
  );
};

export default Navbar;
