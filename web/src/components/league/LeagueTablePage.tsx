import React from "react";
import { useSearchParams } from "react-router-dom";
import { getPremierLeagueTable, type LeagueTableRow } from "../../api/football";

const normalizeTeamKey = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]/g, "");

const LeagueTablePage: React.FC = () => {
  const [table, setTable] = React.useState<LeagueTableRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [searchParams] = useSearchParams();

  const highlightedTeams = React.useMemo(() => {
    const home = searchParams.get("home");
    const away = searchParams.get("away");
    return [home, away]
      .filter((team): team is string => Boolean(team))
      .map((team) => normalizeTeamKey(team));
  }, [searchParams]);

  React.useEffect(() => {
    let cancelled = false;
    const loadTable = async () => {
      try {
        setLoading(true);
        const data = await getPremierLeagueTable();
        if (cancelled) return;
        setTable(data);
        setError(null);
      } catch (err: unknown) {
        console.error(err);
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Failed to load the Premier League table."
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };
    loadTable();

    return () => {
      cancelled = true;
    };
  }, []);

  const isHighlighted = React.useCallback(
    (row: LeagueTableRow) => {
      if (!highlightedTeams.length) return false;
      const candidates = [row.team.name, row.team.shortName, row.team.tla].map(
        normalizeTeamKey
      );
      return highlightedTeams.some((team) => candidates.includes(team));
    },
    [highlightedTeams]
  );

  if (loading) {
    return <div style={{ padding: 16 }}>Loading league table…</div>;
  }

  if (error) {
    return (
      <div style={{ padding: 16 }}>
        <h2>Premier League Table</h2>
        <p style={{ color: "#f87171" }}>{error}</p>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <header className="page-header">
        <h1>Premier League Table</h1>
        <p className="page-subtitle">
          Full standings with every stat from the Football Data API.
        </p>
        {highlightedTeams.length > 0 && (
          <p className="page-subtitle">Highlighted teams from your matchup.</p>
        )}
      </header>

      <div className="card league-table-card">
        <div className="league-table-scroll">
          <table className="league-table">
            <thead>
              <tr>
                <th scope="col">Pos</th>
                <th scope="col">Team</th>
                <th scope="col">PL</th>
                <th scope="col">Form</th>
                <th scope="col">W</th>
                <th scope="col">D</th>
                <th scope="col">L</th>
                <th scope="col">GF</th>
                <th scope="col">GA</th>
                <th scope="col">GD</th>
                <th scope="col">Pts</th>
              </tr>
            </thead>
            <tbody>
              {table.map((row) => (
                <tr
                  key={row.team.id}
                  className={
                    isHighlighted(row)
                      ? "league-table__row league-table__row--highlight"
                      : "league-table__row"
                  }
                >
                  <td>{row.position}</td>
                  <td className="league-table__team">
                    <img
                      className="league-table__crest"
                      src={row.team.crest}
                      alt={row.team.name}
                    />
                    <span>{row.team.name}</span>
                  </td>
                  <td>{row.playedGames}</td>
                  <td>{row.form ? row.form.split(",").join(" ") : "—"}</td>
                  <td>{row.won}</td>
                  <td>{row.draw}</td>
                  <td>{row.lost}</td>
                  <td>{row.goalsFor}</td>
                  <td>{row.goalsAgainst}</td>
                  <td>{row.goalDifference}</td>
                  <td className="league-table__points">{row.points}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default LeagueTablePage;
