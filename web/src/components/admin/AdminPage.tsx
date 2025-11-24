import React from "react";
import { doc, setDoc, writeBatch } from "firebase/firestore";
import { db } from "../../firebase";
import { useUsers } from "../../hooks/useUsers";
import { formatCurrencyGBP } from "../../utils/currency";
import { PRIMARY_ADMIN_EMAIL, normalizeEmail } from "../../config/admin";

const AdminPage: React.FC = () => {
  const { users, loading, error } = useUsers();
  const [updatingId, setUpdatingId] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const normalizedPrimaryAdmin = normalizeEmail(PRIMARY_ADMIN_EMAIL);
  const isAdminLocked = normalizedPrimaryAdmin !== "";

  const lockedAdminUserId = React.useMemo(() => {
    if (!isAdminLocked) return null;
    return (
      users.find((user) => normalizeEmail(user.email) === normalizedPrimaryAdmin)?.id ||
      null
    );
  }, [isAdminLocked, normalizedPrimaryAdmin, users]);

  const paidCount = React.useMemo(
    () => users.filter((u) => u.hasPaid).length,
    [users]
  );
  const prizePot = paidCount * 5;

  const breakdown = React.useMemo(
    () => ({
      first: prizePot * 0.75,
      second: prizePot * 0.2,
      third: prizePot * 0.05,
    }),
    [prizePot]
  );

  const formatShare = React.useCallback(
    (value: number) => (loading ? "…" : formatCurrencyGBP(value)),
    [loading]
  );

  const paidLabel = loading
    ? "Loading players…"
    : `${paidCount} paid player${paidCount === 1 ? "" : "s"}`;

  const handleUpdatePaid = async (userId: string, hasPaid: boolean) => {
    setUpdatingId(userId);
    setActionError(null);
    try {
      await setDoc(doc(db, "users", userId), { hasPaid }, { merge: true });
    } catch (err) {
      console.error("Failed to update paid", err);
      setActionError(`Unable to update user. Please try again.`);
    } finally {
      setUpdatingId(null);
    }
  };

  const handleAssignAdmin = async (userId: string) => {
    if (isAdminLocked && userId !== lockedAdminUserId) {
      setActionError(
        lockedAdminUserId
          ? `Admin access is locked to ${PRIMARY_ADMIN_EMAIL || "the configured email"}.`
          : "No user matches the configured admin email."
      );
      return;
    }

    setUpdatingId(userId);
    setActionError(null);

    try {
      const batch = writeBatch(db);

      users.forEach((user) => {
        const targetIsAdmin = user.id === userId;

        if (user.isAdmin !== targetIsAdmin) {
          batch.set(doc(db, "users", user.id), { isAdmin: targetIsAdmin }, { merge: true });
        }
      });

      await batch.commit();
    } catch (err) {
      console.error("Failed to assign admin", err);
      setActionError("Unable to assign admin. Please try again.");
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <h2 style={{ margin: "0 0 4px" }}>Admin</h2>
        <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)" }}>
          Manage player access and payments. Ticking <strong>Paid</strong> adds £5
          to the prize pot. Admin access is locked to
          {" "}
          <strong>
            {PRIMARY_ADMIN_EMAIL || "the configured primary admin email"}
          </strong>
          {" "}
          so only that account can see this dashboard.
        </p>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 12,
        }}
      >
        <div className="stat-box">
          <div className="stat-label">Total prize pot</div>
          <div className="stat-value">{formatShare(prizePot)}</div>
          <div className="stat-subtext">{paidLabel}</div>
        </div>
        <div className="stat-box">
          <div className="stat-label">Breakdown</div>
          <div className="stat-subtext">1st: {formatShare(breakdown.first)} (75%)</div>
          <div className="stat-subtext">2nd: {formatShare(breakdown.second)} (20%)</div>
          <div className="stat-subtext">3rd: {formatShare(breakdown.third)} (5%)</div>
        </div>
      </div>

      {actionError && (
        <div className="form-error" role="alert">
          {actionError}
        </div>
      )}

      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}

      <div style={{ overflowX: "auto" }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: 14,
          }}
        >
          <thead>
            <tr style={{ textAlign: "left", color: "var(--text-muted)", fontSize: 12 }}>
              <th style={{ padding: "8px 4px" }}>Name</th>
              <th style={{ padding: "8px 4px" }}>Email</th>
              <th style={{ padding: "8px 4px" }}>Paid</th>
              <th style={{ padding: "8px 4px" }}>Admin</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={4} style={{ padding: 12 }}>
                  Loading users…
                </td>
              </tr>
            ) : (
              users.map((user) => {
                return (
                  <tr key={user.id} style={{ borderTop: "1px solid rgba(148,163,184,0.18)" }}>
                    <td style={{ padding: "10px 4px", fontWeight: 600 }}>
                      {user.displayName}
                    </td>
                    <td style={{ padding: "10px 4px", color: "var(--text-muted)" }}>
                      {user.email || "—"}
                    </td>
                    <td style={{ padding: "10px 4px" }}>
                      <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <input
                          type="checkbox"
                          checked={user.hasPaid}
                          onChange={(e) =>
                            handleUpdatePaid(user.id, e.target.checked)
                          }
                          disabled={updatingId === user.id}
                        />
                        <span>Paid</span>
                      </label>
                    </td>
                    <td style={{ padding: "10px 4px" }}>
                      {isAdminLocked ? (
                        <span style={{ color: "var(--text-muted)" }}>
                          {user.id === lockedAdminUserId
                            ? "Primary admin"
                            : "Admin locked"}
                        </span>
                      ) : (
                        <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                          <input
                            type="radio"
                            name="admin"
                            checked={user.isAdmin}
                            onChange={() => handleAssignAdmin(user.id)}
                            disabled={updatingId !== null}
                          />
                          <span>{user.isAdmin ? "Current admin" : "Make admin"}</span>
                        </label>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default AdminPage;
