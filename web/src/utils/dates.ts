// src/utils/dates.ts
export const UK_TZ = "Europe/London";

export function dayHeading(dateIso: string): string {
  const d = new Date(dateIso);
  return d.toLocaleString("en-GB", {
    timeZone: UK_TZ,
    weekday: "long",
    day: "2-digit",
    month: "long",
  }); // e.g. "Saturday, 22 November"
}

export function timeUK(dateIso: string): string {
  const d = new Date(dateIso);
  return d.toLocaleTimeString("en-GB", {
    timeZone: UK_TZ,
    hour: "2-digit",
    minute: "2-digit",
  }); // e.g. "12:30"
}

/** yyyy-mm-dd key in UK time (so midnight rollovers behave correctly) */
export function ymdUK(dateIso: string): string {
  const d = new Date(dateIso);
  const s = d.toLocaleString("en-GB", { timeZone: UK_TZ, year: "numeric", month: "2-digit", day: "2-digit" });
  const [dd, mm, yyyy] = s.split("/");
  return `${yyyy}-${mm}-${dd}`;
}
