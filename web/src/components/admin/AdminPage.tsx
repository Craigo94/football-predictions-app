import React from "react";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { auth, db } from "../../firebase";
import { useUsers, type UserRecord } from "../../hooks/useUsers";
import { formatCurrencyGBP } from "../../utils/currency";
import { formatFirstName } from "../../utils/displayName";

// ─── Helpers ────────────────────────────────────────────────────────────────

const updatePredictionNames = async (uid: string, fullName: string) => {
  if (!db) return;
  const q = query(collection(db, "predictions"), where("userId", "==", uid));
  const snap = await getDocs(q);
  if (snap.empty) return;

  const userDisplayName = formatFirstName(fullName);
  const docs = snap.docs;
  const BATCH_LIMIT = 450;

  for (let i = 0; i < docs.length; i += BATCH_LIMIT) {
    const batch = writeBatch(db);
    docs.slice(i, i + BATCH_LIMIT).forEach((docSnap) => {
      batch.set(docSnap.ref, { userDisplayName }, { merge: true });
    });
    await batch.commit();
  }
};

const callAdminApi = async (endpoint: string, body: Record<string, unknown>) => {
  const currentUser = auth?.currentUser;
  if (!currentUser) throw new Error("Not signed in");

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, callerUid: currentUser.uid }),
  });

  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
};

const formatJoined = (iso: string | null) => {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

// ─── Modals ─────────────────────────────────────────────────────────────────

interface EditNameModalProps {
  user: UserRecord;
  onClose: () => void;
  onSuccess: (msg: string) => void;
}

const EditNameModal: React.FC<EditNameModalProps> = ({ user, onClose, onSuccess }) => {
  const [firstName, setFirstName] = React.useState(user.firstName || "");
  const [lastName, setLastName] = React.useState(user.lastName || "");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const first = firstName.trim();
    const last = lastName.trim();

    if (!first || !last) {
      setError("Both first and last name are required.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const fullName = `${first} ${last}`.trim();
      await setDoc(
        doc(db, "users", user.id),
        {
          firstName: first,
          lastName: last,
          displayName: fullName,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      await updatePredictionNames(user.id, fullName);
      onSuccess(`${user.displayName}'s name updated to ${fullName}.`);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update name.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div
        className="modal-card"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 420 }}
      >
        <div className="modal-header">
          <div>
            <p className="modal-eyebrow">Admin</p>
            <h3 style={{ margin: 0 }}>Edit name</h3>
            <p className="modal-description">{user.email}</p>
          </div>
          <button className="fx-btn" type="button" onClick={onClose}>
            Close
          </button>
        </div>

        <form className="modal-body" onSubmit={handleSave}>
          <div className="modal-field">
            <label style={{ fontWeight: 600, fontSize: 13 }}>First name</label>
            <input
              className="modal-input"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              disabled={saving}
              required
            />
          </div>
          <div className="modal-field">
            <label style={{ fontWeight: 600, fontSize: 13 }}>Last name</label>
            <input
              className="modal-input"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              disabled={saving}
              required
            />
          </div>

          {error && <div className="modal-error">{error}</div>}

          <div className="modal-actions">
            <button
              type="button"
              className="button-secondary"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </button>
            <button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save name"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

interface SetPasswordModalProps {
  user: UserRecord;
  onClose: () => void;
  onSuccess: (msg: string) => void;
}

const SetPasswordModal: React.FC<SetPasswordModalProps> = ({ user, onClose, onSuccess }) => {
  const [password, setPassword] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();

    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await callAdminApi("/api/admin/set-password", {
        userId: user.id,
        newPassword: password,
      });
      onSuccess(`Password updated for ${user.displayName}.`);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to set password.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div
        className="modal-card"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 420 }}
      >
        <div className="modal-header">
          <div>
            <p className="modal-eyebrow">Admin</p>
            <h3 style={{ margin: 0 }}>Set password</h3>
            <p className="modal-description">{user.displayName} · {user.email}</p>
          </div>
          <button className="fx-btn" type="button" onClick={onClose}>
            Close
          </button>
        </div>

        <form className="modal-body" onSubmit={handleSave}>
          <div className="modal-field">
            <label style={{ fontWeight: 600, fontSize: 13 }}>New password</label>
            <input
              className="modal-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Min. 6 characters"
              disabled={saving}
              required
              minLength={6}
              autoComplete="new-password"
            />
          </div>

          {error && <div className="modal-error">{error}</div>}

          <div className="modal-actions">
            <button
              type="button"
              className="button-secondary"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </button>
            <button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Set password"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ─── Main admin page ─────────────────────────────────────────────────────────

const AdminPage: React.FC = () => {
  const { users, loading, error } = useUsers();

  const [search, setSearch] = React.useState("");
  const [updatingId, setUpdatingId] = React.useState<string | null>(null);
  const [clearingPaid, setClearingPaid] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [successMsg, setSuccessMsg] = React.useState<string | null>(null);
  const [editNameUser, setEditNameUser] = React.useState<UserRecord | null>(null);
  const [setPasswordUser, setSetPasswordUser] = React.useState<UserRecord | null>(null);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);

  const showSuccess = (msg: string) => {
    setSuccessMsg(msg);
    setActionError(null);
    setTimeout(() => setSuccessMsg(null), 4000);
  };

  const showError = (msg: string) => {
    setActionError(msg);
    setSuccessMsg(null);
  };

  const paidCount = React.useMemo(
    () => users.filter((u) => u.hasPaid).length,
    [users]
  );
  const prizePot = paidCount * 5;

  const filteredUsers = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        u.displayName.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q)
    );
  }, [users, search]);

  const handleUpdatePaid = async (userId: string, hasPaid: boolean) => {
    setUpdatingId(userId);
    setActionError(null);
    try {
      await setDoc(doc(db, "users", userId), { hasPaid }, { merge: true });
    } catch (err) {
      showError("Unable to update payment status.");
      console.error(err);
    } finally {
      setUpdatingId(null);
    }
  };

  const handleToggleAdmin = async (userId: string, isAdmin: boolean) => {
    setUpdatingId(userId);
    setActionError(null);
    try {
      await setDoc(doc(db, "users", userId), { isAdmin }, { merge: true });
    } catch (err) {
      showError("Unable to update admin status.");
      console.error(err);
    } finally {
      setUpdatingId(null);
    }
  };

  const handleClearAllPaid = async () => {
    if (!window.confirm("Clear paid status for all players?")) return;
    setClearingPaid(true);
    setActionError(null);
    try {
      const batch = writeBatch(db);
      users.forEach((user) => {
        if (user.hasPaid) {
          batch.set(doc(db, "users", user.id), { hasPaid: false }, { merge: true });
        }
      });
      await batch.commit();
      showSuccess("All paid statuses cleared.");
    } catch (err) {
      showError("Unable to clear paid statuses.");
      console.error(err);
    } finally {
      setClearingPaid(false);
    }
  };

  const handleDeleteUser = async (user: UserRecord) => {
    if (
      !window.confirm(
        `Remove ${user.displayName} from the app? Their profile and scores will be deleted. They may be able to re-register with the same email.`
      )
    )
      return;

    setDeletingId(user.id);
    setActionError(null);
    try {
      await deleteDoc(doc(db, "users", user.id));
      showSuccess(`${user.displayName} has been removed.`);
    } catch (err) {
      showError(
        err instanceof Error ? err.message : "Failed to delete user."
      );
      console.error(err);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <>
      <div className="card" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Header */}
        <div>
          <h2 style={{ margin: "0 0 4px" }}>Admin</h2>
          <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)" }}>
            Manage players, payments, and account settings.
          </p>
        </div>

        {/* Stats grid */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
            gap: 10,
          }}
        >
          <div className="stat-box">
            <div className="stat-label">Total players</div>
            <div className="stat-value">{loading ? "…" : users.length}</div>
          </div>
          <div className="stat-box">
            <div className="stat-label">Paid</div>
            <div className="stat-value" style={{ color: "var(--green)" }}>
              {loading ? "…" : paidCount}
            </div>
          </div>
          <div className="stat-box">
            <div className="stat-label">Unpaid</div>
            <div className="stat-value" style={{ color: "var(--red)" }}>
              {loading ? "…" : users.length - paidCount}
            </div>
          </div>
          <div className="stat-box">
            <div className="stat-label">Prize pot</div>
            <div className="stat-value">{loading ? "…" : formatCurrencyGBP(prizePot)}</div>
            <div className="stat-subtext">Winner takes all</div>
          </div>
        </div>

        {/* Actions row */}
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <input
            type="text"
            placeholder="Search players…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              flex: 1,
              minWidth: 160,
              padding: "8px 12px",
              borderRadius: 10,
              border: "1px solid var(--card-border)",
              background: "rgba(255,255,255,0.04)",
              color: "var(--text)",
              fontSize: 14,
              outline: "none",
            }}
          />
          <button
            className="button-secondary"
            onClick={handleClearAllPaid}
            disabled={clearingPaid}
            style={{ whiteSpace: "nowrap" }}
          >
            {clearingPaid ? "Clearing…" : "Clear all paid"}
          </button>
        </div>

        {/* Feedback banners */}
        {successMsg && (
          <div className="form-success" role="status">
            {successMsg}
          </div>
        )}
        {(actionError || error) && (
          <div className="form-error" role="alert">
            {actionError || error}
          </div>
        )}

        {/* User table */}
        <div style={{ overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 13,
              minWidth: 560,
            }}
          >
            <thead>
              <tr
                style={{
                  textAlign: "left",
                  color: "var(--text-muted)",
                  fontSize: 11,
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                }}
              >
                <th style={{ padding: "8px 6px" }}>#</th>
                <th style={{ padding: "8px 6px" }}>Name</th>
                <th style={{ padding: "8px 6px" }}>Email</th>
                <th style={{ padding: "8px 6px" }}>Joined</th>
                <th style={{ padding: "8px 6px", textAlign: "center" }}>Paid</th>
                <th style={{ padding: "8px 6px", textAlign: "center" }}>Admin</th>
                <th style={{ padding: "8px 6px" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} style={{ padding: 16, color: "var(--text-muted)" }}>
                    Loading players…
                  </td>
                </tr>
              ) : filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: 16, color: "var(--text-muted)" }}>
                    {search ? "No players match your search." : "No players yet."}
                  </td>
                </tr>
              ) : (
                filteredUsers.map((user, index) => {
                  const isBusy =
                    updatingId === user.id || deletingId === user.id || clearingPaid;

                  return (
                    <tr
                      key={user.id}
                      style={{
                        borderTop: "1px solid rgba(148,163,184,0.12)",
                        opacity: deletingId === user.id ? 0.4 : 1,
                        transition: "opacity 0.2s",
                      }}
                    >
                      <td style={{ padding: "10px 6px", color: "var(--text-muted)" }}>
                        {index + 1}
                      </td>
                      <td style={{ padding: "10px 6px", fontWeight: 600 }}>
                        {user.displayName}
                      </td>
                      <td
                        style={{
                          padding: "10px 6px",
                          color: "var(--text-muted)",
                          fontSize: 12,
                        }}
                      >
                        {user.email || "—"}
                      </td>
                      <td
                        style={{
                          padding: "10px 6px",
                          color: "var(--text-muted)",
                          fontSize: 12,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {formatJoined(user.createdAt)}
                      </td>
                      <td style={{ padding: "10px 6px", textAlign: "center" }}>
                        <button
                          onClick={() => handleUpdatePaid(user.id, !user.hasPaid)}
                          disabled={isBusy}
                          title={user.hasPaid ? "Mark as unpaid" : "Mark as paid"}
                          style={{
                            background: user.hasPaid
                              ? "rgba(46, 204, 113, 0.18)"
                              : "rgba(230, 57, 70, 0.15)",
                            border: `1px solid ${
                              user.hasPaid
                                ? "rgba(46, 204, 113, 0.45)"
                                : "rgba(230, 57, 70, 0.4)"
                            }`,
                            color: user.hasPaid ? "#b7ffd1" : "#ffcdd2",
                            borderRadius: 999,
                            padding: "3px 10px",
                            fontSize: 11,
                            fontWeight: 700,
                            cursor: "pointer",
                            boxShadow: "none",
                            transform: "none",
                          }}
                        >
                          {user.hasPaid ? "✓ Paid" : "✗ Unpaid"}
                        </button>
                      </td>
                      <td style={{ padding: "10px 6px", textAlign: "center" }}>
                        <input
                          type="checkbox"
                          checked={user.isAdmin}
                          disabled={isBusy}
                          title={user.isAdmin ? "Revoke admin" : "Grant admin"}
                          onChange={(e) =>
                            handleToggleAdmin(user.id, e.target.checked)
                          }
                        />
                      </td>
                      <td style={{ padding: "10px 6px" }}>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button
                            className="fx-btn"
                            onClick={() => setEditNameUser(user)}
                            disabled={isBusy}
                            title="Edit name"
                          >
                            Edit
                          </button>
                          <button
                            className="fx-btn"
                            onClick={() => setSetPasswordUser(user)}
                            disabled={isBusy}
                            title="Set password"
                          >
                            Pwd
                          </button>
                          <button
                            className="fx-btn"
                            onClick={() => handleDeleteUser(user)}
                            disabled={isBusy}
                            title="Delete user"
                            style={{
                              borderColor: "rgba(230, 57, 70, 0.4)",
                              color: "#ffcdd2",
                            }}
                          >
                            {deletingId === user.id ? "…" : "Del"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modals */}
      {editNameUser && (
        <EditNameModal
          user={editNameUser}
          onClose={() => setEditNameUser(null)}
          onSuccess={showSuccess}
        />
      )}

      {setPasswordUser && (
        <SetPasswordModal
          user={setPasswordUser}
          onClose={() => setSetPasswordUser(null)}
          onSuccess={showSuccess}
        />
      )}
    </>
  );
};

export default AdminPage;
