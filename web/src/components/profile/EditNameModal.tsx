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
import { auth, db } from "../../firebase";
import { formatFirstName } from "../../utils/displayName";

interface Props {
  open: boolean;
  user: User;
  onClose: () => void;
  onSaved?: () => void | Promise<void>;
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

const EditNameModal: React.FC<Props> = ({ open, user, onClose, onSaved }) => {
  const [firstName, setFirstName] = React.useState("");
  const [lastName, setLastName] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const initialFullName = React.useRef<string>("");

  React.useEffect(() => {
    if (!open) return;

    const { first, last } = parseName(user.displayName || user.email);
    setFirstName(first);
    setLastName(last);
    setError(null);
    initialFullName.current = `${first} ${last}`.trim().toLowerCase();
  }, [open, user.displayName, user.email]);

  const updatePredictionNames = React.useCallback(
    async (uid: string, fullName: string) => {
      const q = query(collection(db, "predictions"), where("userId", "==", uid));
      const snap = await getDocs(q);

      if (snap.empty) return;

      const batch = writeBatch(db);
      const userDisplayName = formatFirstName(fullName);

      snap.forEach((docSnap) => {
        batch.set(docSnap.ref, { userDisplayName }, { merge: true });
      });

      await batch.commit();
    },
    []
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedFirst = firstName.trim();
    const trimmedLast = lastName.trim();

    if (!trimmedFirst || !trimmedLast) {
      setError("Please provide both a first and last name.");
      return;
    }

    const normalizedInput = `${trimmedFirst} ${trimmedLast}`.trim().toLowerCase();

    if (normalizedInput === initialFullName.current) {
      onClose();
      return;
    }

    if (!auth.currentUser) {
      setError("You must be signed in to update your name.");
      return;
    }

    setLoading(true);

    let didSave = false;

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

      await updatePredictionNames(auth.currentUser.uid, fullName);

      await auth.currentUser.reload();
      didSave = true;

      if (onSaved) {
        try {
          await onSaved();
        } catch (callbackError) {
          console.error("Error running post-save callback", callbackError);
        }
      }
    } catch (err) {
      console.error(err);
      const message =
        err instanceof Error
          ? err.message
          : "Unable to update your name right now.";
      setError(message);
    } finally {
      setLoading(false);
      if (didSave) onClose();
    }
  };

  if (!open) return null;

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={() => {
        if (!loading) onClose();
      }}
    >
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-name-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <p className="modal-eyebrow">Profile</p>
            <h2 id="edit-name-title">Edit display name</h2>
            <p className="modal-description">
              Update the name shown across your predictions and leaderboard.
            </p>
          </div>
          <button
            type="button"
            className="button-secondary"
            onClick={onClose}
            aria-label="Close edit name dialog"
          >
            ✕
          </button>
        </div>

        <form className="modal-body" onSubmit={handleSubmit}>
          <div className="modal-field">
            <label htmlFor="edit-first-name">First name</label>
            <input
              id="edit-first-name"
              className="modal-input"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              autoComplete="given-name"
              disabled={loading}
              required
            />
          </div>

          <div className="modal-field">
            <label htmlFor="edit-last-name">Last name</label>
            <input
              id="edit-last-name"
              className="modal-input"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              autoComplete="family-name"
              disabled={loading}
              required
            />
          </div>

          {error && <div className="modal-error">{error}</div>}

          <div className="modal-actions">
            <button
              type="button"
              className="button-secondary"
              onClick={onClose}
              disabled={loading}
            >
              Cancel
            </button>
            <button type="submit" disabled={loading}>
              {loading ? "Saving..." : "Save changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default EditNameModal;
