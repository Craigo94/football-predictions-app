// src/config/football.ts
const calcDefaultSeason = () => {
  const d = new Date();
  // Premier League seasons start in Aug; before Aug use previous year
  const yr = d.getFullYear();
  return d.getMonth() >= 7 ? yr : yr - 1;
};

export const CURRENT_SEASON =
  Number(import.meta.env.VITE_FOOTBALL_SEASON) || calcDefaultSeason();
