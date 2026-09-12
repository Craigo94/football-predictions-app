/**
 * Firestore hands back timestamps as a Timestamp object, but the same field can
 * arrive as a plain ISO string (older documents, or an offline write that has
 * not been acknowledged yet). Normalise both shapes to an ISO string.
 */
export const toIsoString = (value: unknown): string | null => {
  if (!value) return null;

  if (typeof value === "string") return value;

  if (
    typeof value === "object" &&
    typeof (value as { toDate?: () => Date }).toDate === "function"
  ) {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }

  return null;
};

/** "12 Sep 2026", or null when the timestamp is missing or unreadable. */
export const formatDayMonthYear = (value: unknown): string | null => {
  const iso = toIsoString(value);
  if (!iso) return null;

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;

  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};
