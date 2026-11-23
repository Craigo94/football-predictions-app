import React from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";
import { useLiveFixtures } from "../context/LiveFixturesContext";
import {
  GATE_FIELD,
  gameweekKey,
  parseGate,
  roundRequiresPayment,
  type PaidGameweekGate,
} from "../utils/payments";
import { parseRoundNumber } from "../utils/weeklyWinners";

export const paymentsSettingsDoc = () => doc(db, "settings", "payments");

interface PlayerPayments {
  id: string;
  paidGameweeks: string[];
}

/**
 * Decides whose predictions count in which gameweek. A player only appears in
 * a gameweek — and only has that week added to their stats — once the admin
 * has marked them as paid for it. Marking them paid part-way through brings in
 * every point they have scored that week so far.
 */
export const usePaidGameweeks = (players: PlayerPayments[]) => {
  const { season } = useLiveFixtures();
  const [gate, setGate] = React.useState<PaidGameweekGate | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    const unsub = onSnapshot(
      paymentsSettingsDoc(),
      (snap) => {
        setGate(parseGate(snap.data()?.[GATE_FIELD]));
        setLoading(false);
      },
      (err) => {
        // Without the settings document nobody is held back, as before.
        console.error("Failed to read payment settings", err);
        setGate(null);
        setLoading(false);
      }
    );
    return () => unsub();
  }, []);

  const paidByPlayer = React.useMemo(
    () => new Map(players.map((p) => [p.id, new Set(p.paidGameweeks)])),
    [players]
  );

  const requiresPayment = React.useCallback(
    (round: string) => roundRequiresPayment(gate, season, round),
    [gate, season]
  );

  const isPaidFor = React.useCallback(
    (userId: string, round: string) => {
      if (!requiresPayment(round)) return true;
      const key = gameweekKey(season, parseRoundNumber(round));
      return paidByPlayer.get(userId)?.has(key) ?? false;
    },
    [paidByPlayer, requiresPayment, season]
  );

  return { isPaidFor, requiresPayment, loading };
};
