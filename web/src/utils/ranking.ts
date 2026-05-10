export const getTiedRank = <T>(
  rows: T[],
  index: number,
  getPoints: (row: T) => number,
): number => {
  const current = rows[index];
  if (!current) return index + 1;

  const currentPoints = getPoints(current);
  return rows.slice(0, index).filter((row) => getPoints(row) > currentPoints).length + 1;
};

export const formatOrdinal = (rank: number): string => {
  const mod100 = rank % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${rank}th`;

  switch (rank % 10) {
    case 1:
      return `${rank}st`;
    case 2:
      return `${rank}nd`;
    case 3:
      return `${rank}rd`;
    default:
      return `${rank}th`;
  }
};
