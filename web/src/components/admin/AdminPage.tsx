import React from "react";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { auth, db } from "../../firebase";
import { useUsers, type UserRecord } from "../../hooks/useUsers";
import { useLiveFixtures } from "../../context/LiveFixturesContext";
import { formatCurrencyGBP } from "../../utils/currency";
import { ENTRY_FEE_GBP } from "../../config/football";
import { formatFirstName } from "../../utils/displayName";
import { formatDayMonthYear, toIsoString } from "../../utils/timestamps";
import { getLatestCompletedRound } from "../../utils/weeklyWinners";

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

/**
 * Records the last gameweek whose completion cleared everybody's paid status,
 * so the reset runs once for the whole group rather than once per admin device.
 */
const paidResetDoc = () => doc(db, "settings", "payments");

const clearPaidStatuses = async (users: UserRecord[]) => {
  const paidUsers = users.filter((user) => user.hasPaid);
  if (paidUsers.length === 0) return 0;

  const batch = writeBatch(db);
  paidUsers.forEach((user) => {
    batch.set(
      doc(db, "users", user.id),
      { hasPaid: false, paidAt: null },
      { merge: true }
    );
  });
  await batch.commit();

  return paidUsers.length;
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

interface PaidResetMarker {
  /** Round number of the last finished gameweek we have acted on. */
  round: number | null;
  roundLabel: string | null;
  /** Set only when a reset actually cleared statuses. */
  clearedAt: string | null;
}

const AdminPage: React.FC = () => {
  const { users, loading, error } = useUsers();
  const { fixturesById, loadingFixtures } = useLiveFixtures();

  const [search, setSearch] = React.useState("");
  const [updatingId, setUpdatingId] = React.useState<string | null>(null);
  const [clearingPaid, setClearingPaid] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [successMsg, setSuccessMsg] = React.useState<string | null>(null);
  const [editNameUser, setEditNameUser] = React.useState<UserRecord | null>(null);
  const [setPasswordUser, setSetPasswordUser] = React.useState<UserRecord | null>(null);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);
  const [paidReset, setPaidReset] = React.useState<PaidResetMarker>({
    round: null,
    roundLabel: null,
    clearedAt: null,
  });
  const [paidResetLoaded, setPaidResetLoaded] = React.useState(false);
  const [paidResetUnavailable, setPaidResetUnavailable] = React.useState(false);
  const autoResetRound = React.useRef<number | null>(null);

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
  const prizePot = paidCount * ENTRY_FEE_GBP;

  const filteredUsers = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    const matching = q
      ? users.filter(
          (u) =>
            u.displayName.toLowerCase().includes(q) ||
            u.email.toLowerCase().includes(q)
        )
      : users;

    // Firestore hands documents back in ID order, which looks random in a list
    // of people. Sort on what the Name column actually shows, then fall back to
    // the surname and email so players sharing a first name keep a fixed order.
    const byName = (a: string, b: string) =>
      a.localeCompare(b, undefined, { sensitivity: "base" });

    return [...matching].sort(
      (a, b) =>
        byName(a.displayName, b.displayName) ||
        byName(a.lastName, b.lastName) ||
        byName(a.email, b.email)
    );
  }, [users, search]);

  const latestCompletedRound = React.useMemo(
    () => getLatestCompletedRound(fixturesById),
    [fixturesById]
  );

  React.useEffect(() => {
    const unsub = onSnapshot(
      paidResetDoc(),
      (snap) => {
        const data = snap.data();
        setPaidReset({
          round:
            typeof data?.lastResetRoundNumber === "number"
              ? data.lastResetRoundNumber
              : null,
          roundLabel:
            typeof data?.lastResetRound === "string" ? data.lastResetRound : null,
          clearedAt: toIsoString(data?.lastResetAt),
        });
        setPaidResetUnavailable(false);
        setPaidResetLoaded(true);
      },
      (err) => {
        console.error("Failed to read the paid-reset marker", err);
        setPaidResetUnavailable(true);
        setPaidResetLoaded(false);
      }
    );

    return () => unsub();
  }, []);

  /**
   * Once a gameweek finishes, everyone owes again for the next one — so clear
   * every paid status and record the round, which stops it running twice.
   *
   * The very first run only records where we are. Clearing then would wipe
   * payments the admin has already taken for the gameweek coming up, since the
   * gameweek that triggers it finished before this ever ran.
   */
  React.useEffect(() => {
    if (loading || loadingFixtures || !paidResetLoaded) return;
    if (!latestCompletedRound) return;
    if (paidReset.round != null && latestCompletedRound.number <= paidReset.round) {
      return;
    }
    if (autoResetRound.current === latestCompletedRound.number) return;

    autoResetRound.current = latestCompletedRound.number;
    const isFirstRun = paidReset.round == null;

    const run = async () => {
      try {
        const cleared = isFirstRun ? 0 : await clearPaidStatuses(users);

        await setDoc(
          paidResetDoc(),
          {
            lastResetRound: latestCompletedRound.round,
            lastResetRoundNumber: latestCompletedRound.number,
            ...(isFirstRun ? {} : { lastResetAt: serverTimestamp() }),
          },
          { merge: true }
        );

        if (!isFirstRun) {
          showSuccess(
            `${latestCompletedRound.round} has finished — ${cleared} player${
              cleared === 1 ? "" : "s"
            } marked as not paid for the next gameweek.`
          );
        }
      } catch (err) {
        console.error("Failed to reset paid statuses automatically", err);
        showError(
          `Unable to clear paid statuses after ${latestCompletedRound.round}. Use "Clear all paid" to do it by hand.`
        );
        // Let the next render try again.
        autoResetRound.current = null;
      }
    };

    run();
  }, [
    latestCompletedRound,
    loading,
    loadingFixtures,
    paidReset.round,
    paidResetLoaded,
    users,
  ]);

  const handleUpdatePaid = async (user: UserRecord, hasPaid: boolean) => {
    setUpdatingId(user.id);
    setActionError(null);
    try {
      // paidAt lets the player see when they were marked off, so clear it again
      // whenever the status is reversed.
      await setDoc(
        doc(db, "users", user.id),
        { hasPaid, paidAt: hasPaid ? serverTimestamp() : null },
        { merge: true }
      );
      showSuccess(
        `${user.displayName} marked as ${hasPaid ? "paid" : "unpaid"}.`
      );
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
      await clearPaidStatuses(users);
      showSuccess("All paid statuses cleared.");
    } catch (err) {
      showError("Unable to clear paid statuses.");
      console.error(err);
    } finally {
      setClearingPaid(false);
    }
  };

  const autoResetStatus = React.useMemo(() => {
    if (paidResetUnavailable) {
      return "Automatic resets are off: the settings/payments document could not be read. Check your Firestore rules, or use \u201cClear all paid\u201d after each gameweek.";
    }

    if (!paidResetLoaded || loadingFixtures) {
      return "Checking whether a gameweek has finished…";
    }

    if (!latestCompletedRound) {
      return "No gameweek has finished yet. Everyone is marked as not paid automatically once one does.";
    }

    if (!paidReset.clearedAt) {
      return `${latestCompletedRound.round} had already finished when automatic resets were set up, so nobody was cleared. Everyone will be marked as not paid when the next gameweek finishes.`;
    }

    const clearedOn = formatDayMonthYear(paidReset.clearedAt);

    return `Everyone was marked as not paid after ${
      paidReset.roundLabel ?? "the last gameweek"
    }${clearedOn ? ` on ${clearedOn}` : ""}. It happens again when the next gameweek finishes.`;
  }, [
    latestCompletedRound,
    loadingFixtures,
    paidReset.clearedAt,
    paidReset.roundLabel,
    paidResetLoaded,
    paidResetUnavailable,
  ]);

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
            className="admin-search"
            type="text"
            placeholder="Search players…"
            aria-label="Search players"
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

        {/* What the automatic end-of-gameweek reset is doing. */}
        <p
          style={{
            margin: 0,
            fontSize: 12,
            color: paidResetUnavailable ? "var(--yellow)" : "var(--text-muted)",
          }}
        >
          {autoResetStatus}
        </p>

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
                        {formatDayMonthYear(user.createdAt) ?? "—"}
                      </td>
                      <td style={{ padding: "10px 6px", textAlign: "center" }}>
                        <button
                          onClick={() => handleUpdatePaid(user, !user.hasPaid)}
                          disabled={isBusy}
                          title={
                            user.hasPaid
                              ? `Mark ${user.displayName} as unpaid — they will see "Not paid"`
                              : `Mark ${user.displayName} as paid — they will see "Paid"`
                          }
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
                        {user.hasPaid && user.paidAt && (
                          <div
                            style={{
                              marginTop: 4,
                              fontSize: 10,
                              color: "var(--text-muted)",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {formatDayMonthYear(user.paidAt)}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: "10px 6px", textAlign: "center" }}>
                        {/* The label gives the 22px checkbox a 44px tap area
                            and names the control for screen readers. */}
                        <label className="admin-toggle">
                          <input
                            type="checkbox"
                            checked={user.isAdmin}
                            disabled={isBusy}
                            onChange={(e) =>
                              handleToggleAdmin(user.id, e.target.checked)
                            }
                          />
                          <span className="visually-hidden">
                            {user.isAdmin
                              ? `Revoke admin for ${user.displayName}`
                              : `Grant admin to ${user.displayName}`}
                          </span>
                        </label>
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
