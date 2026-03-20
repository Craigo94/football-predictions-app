import type { Fixture } from "../api/football";

export const isFixtureFinished = (fixture: Fixture): boolean =>
  fixture.statusShort === "FT";

export const isFixturePostponed = (fixture: Fixture): boolean =>
  fixture.statusShort === "PST";

export const isFixtureSuspended = (fixture: Fixture): boolean =>
  fixture.statusShort === "SUS";

export const isFixtureLive = (fixture: Fixture): boolean =>
  fixture.statusShort === "LIVE";

export const isFixtureUpcoming = (fixture: Fixture): boolean =>
  fixture.statusShort === "NS";

export const hasFixtureScore = (fixture: Fixture): boolean =>
  fixture.homeGoals != null && fixture.awayGoals != null;

export const hasFixtureStarted = (fixture: Fixture): boolean => {
  if (isFixturePostponed(fixture)) return false;
  if (isFixtureLive(fixture) || isFixtureFinished(fixture) || isFixtureSuspended(fixture)) {
    return true;
  }

  const kickoffTime = new Date(fixture.kickoff).getTime();
  return Number.isFinite(kickoffTime) && Date.now() >= kickoffTime;
};

export const getFixtureStatusLabel = (fixture: Fixture, kickoffLabel?: string): string => {
  if (isFixturePostponed(fixture)) return "Postponed";
  if (isFixtureSuspended(fixture)) return "Suspended";
  if (isFixtureFinished(fixture)) return "Full time";
  if (isFixtureLive(fixture)) return "LIVE";
  return kickoffLabel ? `KO ${kickoffLabel}` : "Upcoming";
};
