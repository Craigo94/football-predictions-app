import { parseRoundNumber } from "./weeklyWinners";

/**
 * Every gameweek a player has paid for is kept on their user document as
 * `paidGameweeks`, one "<season>:<matchday>" key each (e.g. "2026:13"). The
 * season is part of the key so Matchday 5 this year is never mistaken for
 * Matchday 5 last year.
 *
 * `hasPaid` only says whether they have paid for the gameweek being played now
 * and is wiped once it finishes; `paidGameweeks` is the history that decides
 * whose scores count in which week.
 */
export const gameweekKey = (season: number, roundNumber: number) =>
  `${season}:${roundNumber}`;

export const PAID_GAMEWEEKS_FIELD = "paidGameweeks";

/**
 * First gameweek where only paid players count, from `settings/payments`.
 * Gameweeks before it were played before payments were tracked per gameweek,
 * so everybody's predictions count there.
 */
export interface PaidGameweekGate {
  season: number;
  round: number;
}

export const GATE_FIELD = "paidGameweeksFrom";

export const parseGate = (value: unknown): PaidGameweekGate | null => {
  if (typeof value !== "string") return null;
  const match = value.match(/^(\d+):(\d+)$/);
  if (!match) return null;
  return { season: Number(match[1]), round: Number(match[2]) };
};

export const parsePaidGameweeks = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];

/**
 * Whether a round only counts for players who paid for it. With no gate set
 * (no admin has opened the Admin page since this shipped, or the settings
 * document cannot be read) nothing is held back, which is how the app behaved
 * before.
 */
export const roundRequiresPayment = (
  gate: PaidGameweekGate | null,
  season: number,
  round: string,
) => {
  if (!gate) return false;
  const roundNumber = parseRoundNumber(round);
  if (Number.isNaN(roundNumber)) return false;
  if (season !== gate.season) return season > gate.season;
  return roundNumber >= gate.round;
};
