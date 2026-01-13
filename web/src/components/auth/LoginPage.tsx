import React from "react";
import { useNavigate } from "react-router-dom";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
  type User,
} from "firebase/auth";
import { auth, db } from "../../firebase";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import "./LoginPage.css";

const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const [isRegister, setIsRegister] = React.useState(false);
  const [firstName, setFirstName] = React.useState("");
  const [lastName, setLastName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  if (!auth || !db) {
    return (
      <div className="login-page">
        <div className="login-container">
          <h1 className="login-title">Configuration error</h1>
          <p className="login-subtitle">
            Firebase is not configured. Please provide the VITE_FIREBASE_* environment variables
            and restart the app.
          </p>
        </div>
      </div>
    );
  }

  const ensureUserProfile = async (user: User) => {
    const ref = doc(db, "users", user.uid);
    const snap = await getDoc(ref);

    const displayName = user.displayName?.trim();
    const email = user.email?.toLowerCase() || "";

    if (snap.exists()) {
      const updates: Record<string, unknown> = {
        lastLoginAt: serverTimestamp(),
      };

      if (displayName) {
        updates.displayName = displayName;
      }

      if (email) {
        updates.email = email;
      }

      await setDoc(ref, updates, { merge: true });
      return;
    }

    await setDoc(
      ref,
      {
        displayName: displayName || undefined,
        email,
        isAdmin: false,
        hasPaid: false,
        createdAt: serverTimestamp(),
        lastLoginAt: serverTimestamp(),
      },
      { merge: true }
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (isRegister) {
        // Validation
        if (!firstName.trim() || !lastName.trim()) {
          setError("Please enter your first and last name.");
          setLoading(false);
          return;
        }

        // Create account
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();

        // Set Firebase Auth display name
        await updateProfile(cred.user, { displayName: fullName });

        // Optional: save user profile in Firestore
        await setDoc(doc(db, "users", cred.user.uid), {
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          displayName: fullName,
          email: email.toLowerCase(),
          isAdmin: false,
          hasPaid: false,
          createdAt: serverTimestamp(),
          lastLoginAt: serverTimestamp(),
        });
      } else {
        const cred = await signInWithEmailAndPassword(auth, email, password);
        await ensureUserProfile(cred.user);
      }
      navigate("/dashboard", { replace: true });
    } catch (err: unknown) {
      console.error(err);
      const message = err instanceof Error ? err.message : "Something went wrong";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-overlay" />
      <div className="login-container">
        <h1 className="login-title">🏆 Football Predictor</h1>
        <p className="login-subtitle">
          {isRegister
            ? "Create an account to join your family league."
            : "Sign in to make your predictions."}
        </p>

        <form onSubmit={handleSubmit} className="login-form">
          {isRegister && (
            <div className="name-fields">
              <input
                type="text"
                placeholder="First name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                required
              />
              <input
                type="text"
                placeholder="Last name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                required
              />
            </div>
          )}

          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />

          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />

          {error && <div className="login-error">{error}</div>}

          <button type="submit" disabled={loading}>
            {loading
              ? "Please wait..."
              : isRegister
              ? "Create Account"
              : "Sign In"}
          </button>
        </form>

        <p className="toggle-text">
          {isRegister ? "Already have an account?" : "New here?"}{" "}
          <span onClick={() => setIsRegister(!isRegister)}>
            {isRegister ? "Sign In" : "Create One"}
          </span>
        </p>

        <p className="login-footer">
          © {new Date().getFullYear()} Football Predictor
        </p>
      </div>
    </div>
  );
};

export default LoginPage;
