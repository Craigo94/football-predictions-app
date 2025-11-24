import React from "react";
import { doc, setDoc, writeBatch } from "firebase/firestore";
import { db } from "../../firebase";
import { useUsers } from "../../hooks/useUsers";
import { formatCurrencyGBP } from "../../utils/currency";
import { PRIMARY_ADMIN_EMAIL } from "../../config/admin";

const AdminPage: React.FC = () => {
  const { users, loading, error } = useUsers();
  const [updatingId, setUpdatingId] = React.useState<string | null>(null);
  const [clearingPaid, setClearingPaid] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);

  const paidCount = React.useMemo(
    () => users.filter((u) => u.hasPaid).length,
    [users]
  );
  const prizePot = paidCount * 5;

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

  const handleClearAllPaid = async () => {
    const confirmClear = window.confirm(
      "Clear the paid status for all players? You can re-add payments after this is done.",
    );
    if (!confirmClear) return;

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
    } catch (err) {
      console.error("Failed to clear paid statuses", err);
      setActionError("Unable to clear paid statuses. Please try again.");
    } finally {
      setClearingPaid(false);
    }
  };

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <h2 style={{ margin: "0 0 4px" }}>Admin</h2>
        <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)" }}>
          Manage payments. Ticking <strong>Paid</strong> adds £5 to the prize pot.
          Admin access is locked to
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
          <div className="stat-label">Payout</div>
          <div className="stat-subtext">Winner takes all</div>
          <div className="stat-subtext">Top scorer: {formatShare(prizePot)} (100%)</div>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button onClick={handleClearAllPaid} disabled={clearingPaid}>
          {clearingPaid ? "Clearing…" : "Clear all paid"}
        </button>
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
              <th style={{ padding: "8px 4px" }}>Paid</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={2} style={{ padding: 12 }}>
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
                    <td style={{ padding: "10px 4px" }}>
                      <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <input
                          type="checkbox"
                          checked={user.hasPaid}
                          onChange={(e) =>
                            handleUpdatePaid(user.id, e.target.checked)
                          }
                          disabled={updatingId === user.id || clearingPaid}
                        />
                        <span>Paid</span>
                      </label>
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
