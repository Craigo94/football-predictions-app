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

  React.useEffect(() => {
    setCurrentUser(user);
  }, [user]);

  const displayName = getDisplayName(currentUser);

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
            onClick={() => signOut(auth)}
            aria-label="Log out"
          >
            Log out
          </button>
        </div>
      </div>

      {/* Nav links row */}
      <nav className="navbar-links" aria-label="Primary navigation">
        <NavLink
          to="/predictions"
          className={({ isActive }) =>
            "nav-link" + (isActive ? " nav-link-active" : "")
          }
        >
          <span className="nav-icon" aria-hidden="true">🎯</span>
          <span className="nav-label">Predictions</span>
        </NavLink>
        <NavLink
          to="/leaderboard"
          className={({ isActive }) =>
            "nav-link" + (isActive ? " nav-link-active" : "")
          }
        >
          <span className="nav-icon" aria-hidden="true">🏆</span>
          <span className="nav-label">Leaderboard</span>
        </NavLink>

        <NavLink
          to="/weekly"
          className={({ isActive }) =>
            "nav-link" + (isActive ? " nav-link-active" : "")
          }
        >
          <span className="nav-icon" aria-hidden="true">🗓️</span>
          <span className="nav-label">Gameweek</span>
        </NavLink>

        <NavLink
          to="/stats"
          className={({ isActive }) =>
            "nav-link" + (isActive ? " nav-link-active" : "")
          }
        >
          <span className="nav-icon" aria-hidden="true">📊</span>
          <span className="nav-label">My Stats</span>
        </NavLink>

        {isAdmin && (
          <NavLink
            to="/admin"
            className={({ isActive }) =>
              "nav-link" + (isActive ? " nav-link-active" : "")
            }
          >
            <span className="nav-icon" aria-hidden="true">🛠️</span>
            <span className="nav-label">Admin</span>
          </NavLink>
        )}
      </nav>
    </header>
  );
};

export default Navbar;
