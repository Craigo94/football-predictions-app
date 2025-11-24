export function formatFirstName(raw?: string | null): string {
  if (!raw) return "Unknown";

  let value = raw.trim();
  if (!value) return "Unknown";

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

  const tokens = value
    .split(/[._\s]+/)
    .filter(Boolean)
    .map(formatSegment)
    .filter(Boolean);

  return tokens.length ? tokens[0] : "Unknown";
}
