import React from "react";
import type { User } from "firebase/auth";
import { updateProfile } from "firebase/auth";
import {
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { useNavigate } from "react-router-dom";
import { auth, db } from "../../firebase";
import { formatFirstName } from "../../utils/displayName";

interface Props {
  user: User;
  onUserUpdated?: () => Promise<User | null>;
}

const parseName = (raw?: string | null) => {
  if (!raw) return { first: "", last: "" };

  let value = raw.trim();
  if (!value) return { first: "", last: "" };

  if (value.includes("@")) {
    [value] = value.split("@");
  }

  const parts = value.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: "", last: "" };
  if (parts.length === 1) return { first: parts[0], last: "" };

  return { first: parts[0], last: parts.slice(1).join(" ") };
};

const EditNamePage: React.FC<Props> = ({ user, onUserUpdated }) => {
  const [firstName, setFirstName] = React.useState("");
  const [lastName, setLastName] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const initialFullName = React.useRef<string>("");
  const navigate = useNavigate();

  if (!auth || !db) {
    return (
      <div className="card profile-card">
        <h2>Configuration error</h2>
        <p style={{ color: "#9fb0a2" }}>
          Firebase is not configured. Please provide the VITE_FIREBASE_* environment variables
          and restart the app.
        </p>
      </div>
    );
  }

  React.useEffect(() => {
    const { first, last } = parseName(user.displayName || user.email);
    setFirstName(first);
    setLastName(last);
    setError(null);
    setSuccess(null);
    initialFullName.current = `${first} ${last}`.trim().toLowerCase();
  }, [user.displayName, user.email]);

  const updatePredictionNames = React.useCallback(async (uid: string, fullName: string) => {
    const q = query(collection(db, "predictions"), where("userId", "==", uid));
    const snap = await getDocs(q);

    if (snap.empty) return;

    const userDisplayName = formatFirstName(fullName);
    const docs = snap.docs;
    const BATCH_LIMIT = 450; // keep under Firestore's 500-op limit per batch

    for (let i = 0; i < docs.length; i += BATCH_LIMIT) {
      const batch = writeBatch(db);
      docs.slice(i, i + BATCH_LIMIT).forEach((docSnap) => {
        batch.set(docSnap.ref, { userDisplayName }, { merge: true });
      });
      await batch.commit();
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const trimmedFirst = firstName.trim();
    const trimmedLast = lastName.trim();

    if (!trimmedFirst || !trimmedLast) {
      setError("Please provide both a first and last name.");
      return;
    }

    const normalizedInput = `${trimmedFirst} ${trimmedLast}`.trim().toLowerCase();

    if (normalizedInput === initialFullName.current) {
      setSuccess("No changes to save – your name is already up to date.");
      return;
    }

    if (!auth.currentUser) {
      setError("You must be signed in to update your name.");
      return;
    }

    setLoading(true);

    try {
      const fullName = `${trimmedFirst} ${trimmedLast}`.trim();

      await updateProfile(auth.currentUser, { displayName: fullName });
      await setDoc(
        doc(db, "users", auth.currentUser.uid),
        {
          firstName: trimmedFirst,
          lastName: trimmedLast,
          displayName: fullName,
          email: auth.currentUser.email?.toLowerCase() || "",
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      try {
        await updatePredictionNames(auth.currentUser.uid, fullName);
      } catch (predictionsError) {
        console.error("Failed to update prediction names", predictionsError);
      }

      await auth.currentUser.reload();
      initialFullName.current = normalizedInput;

      if (onUserUpdated) {
        try {
          await onUserUpdated();
        } catch (callbackError) {
          console.error("Error running post-save callback", callbackError);
        }
      }

      setSuccess("Name updated! Your changes will show everywhere in a few moments.");
    } catch (err) {
      console.error(err);
      const message =
        err instanceof Error ? err.message : "Unable to update your name right now.";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="profile-page">
      <div className="card profile-card">
        <div className="profile-header">
          <p className="eyebrow">Profile</p>
          <h1>Edit display name</h1>
          <p className="profile-subtitle">
            Update the name that appears on your predictions, leaderboard, and stats.
          </p>
        </div>

        <form className="profile-form" onSubmit={handleSubmit}>
          <div className="form-grid">
            <label className="form-field">
              <span>First name</span>
              <input
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                autoComplete="given-name"
                disabled={loading}
                required
              />
            </label>

            <label className="form-field">
              <span>Last name</span>
              <input
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                autoComplete="family-name"
                disabled={loading}
                required
              />
            </label>
          </div>

          {error && <div className="form-error">{error}</div>}
          {success && <div className="form-success">{success}</div>}

          <div className="profile-actions">
            <button
              type="button"
              className="button-secondary"
              onClick={() => navigate(-1)}
              disabled={loading}
            >
              Go back
            </button>
            <button type="submit" disabled={loading}>
              {loading ? "Saving..." : "Save name"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default EditNamePage;
