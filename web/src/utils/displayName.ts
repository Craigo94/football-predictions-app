const tokenizeDisplayName = (raw?: string | null) => {
  if (!raw) return [] as string[];

  let value = raw.trim();
  if (!value) return [];

  if (value.includes("@")) {
    const [namePart] = value.split("@");
    value = namePart;
  }

  const formatSegment = (segment: string) =>
    segment
      .split(/([-'])/)
      .filter((part) => part.length > 0)
      .map((part) =>
        part === "-" || part === "'"
          ? part
          : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()
      )
      .join("");

  return value
    .split(/[._\s]+/)
    .filter(Boolean)
    .map(formatSegment)
    .filter(Boolean);
};

export function formatFirstName(raw?: string | null): string {
  const tokens = tokenizeDisplayName(raw);
  return tokens.length ? tokens[0] : "Unknown";
}

export function formatFullName(raw?: string | null): string {
  const tokens = tokenizeDisplayName(raw);
  return tokens.length ? tokens.join(" ") : "Unknown";
}
