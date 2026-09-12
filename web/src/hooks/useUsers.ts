import React from "react";
import { collection, onSnapshot, type DocumentData } from "firebase/firestore";
import { db } from "../firebase";
import { formatFirstName } from "../utils/displayName";
import { toIsoString } from "../utils/timestamps";

interface UserDocData extends DocumentData {
  firstName?: string;
  lastName?: string;
  displayName?: string;
  email?: string;
  isAdmin?: boolean;
  hasPaid?: boolean;
  paidAt?: { toDate?: () => Date } | string | null;
  createdAt?: { toDate?: () => Date } | string | null;
}

export interface UserRecord {
  id: string;
  displayName: string;
  firstName: string;
  lastName: string;
  email: string;
  isAdmin: boolean;
  hasPaid: boolean;
  /** When the admin last marked this player as paid, if it was recorded. */
  paidAt: string | null;
  createdAt: string | null;
}

export const useUsers = () => {
  const [users, setUsers] = React.useState<UserRecord[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const ref = collection(db, "users");

    const unsub = onSnapshot(
      ref,
      (snap) => {
        const list: UserRecord[] = [];

        snap.forEach((docSnap) => {
          const data = docSnap.data() as UserDocData;
          const fallbackName = `${data.firstName ?? ""} ${
            data.lastName ?? ""
          }`.trim();

          const displayName = formatFirstName(
            data.displayName || fallbackName || data.email || "Unknown"
          );

          list.push({
            id: docSnap.id,
            displayName,
            firstName: data.firstName ?? "",
            lastName: data.lastName ?? "",
            email: data.email ?? "",
            isAdmin: Boolean(data.isAdmin),
            hasPaid: Boolean(data.hasPaid),
            paidAt: toIsoString(data.paidAt),
            createdAt: toIsoString(data.createdAt),
          });
        });

        setUsers(list);
        setLoading(false);
      },
      (err) => {
        console.error("Error loading users", err);
        setError("Failed to load users.");
        setLoading(false);
      }
    );

    return () => unsub();
  }, []);

  return { users, loading, error };
};
