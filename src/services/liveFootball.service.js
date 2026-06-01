import { env } from "../config/env.js";

let latestFixturesCache = {
  provider: null,
  cachedAt: 0,
  data: [],
};
let latestGroupsCache = {
  provider: null,
  cachedAt: 0,
  data: [],
};

const LIVE_CACHE_MS = 45 * 1000;

function assertFootballDataConfigured() {
  if (!env.FOOTBALL_DATA_BASE_URL || !env.FOOTBALL_DATA_TOKEN) {
    throw new Error(
      "football-data is not configured. Set FOOTBALL_DATA_BASE_URL and FOOTBALL_DATA_TOKEN in .env.",
    );
  }
}

function assertApiFootballConfigured() {
  if (!env.FOOTBALL_API_BASE_URL || !env.FOOTBALL_API_KEY || !env.FOOTBALL_API_HOST) {
    throw new Error(
      "Live API is not configured. Set FOOTBALL_API_BASE_URL, FOOTBALL_API_KEY, FOOTBALL_API_HOST in .env.",
    );
  }

  if (!env.FOOTBALL_API_LEAGUE_ID || !env.FOOTBALL_API_SEASON) {
    throw new Error("Set FOOTBALL_API_LEAGUE_ID and FOOTBALL_API_SEASON in .env.");
  }
}

function assertWorldCupApiConfigured() {
  if (!env.WORLDCUP_API_BASE_URL || !env.WORLDCUP_API_KEY) {
    throw new Error(
      "World Cup API is not configured. Set WORLDCUP_API_BASE_URL and WORLDCUP_API_KEY in .env.",
    );
  }
}

function mapRoundToStage(roundLabel) {
  const label = (roundLabel || "").toLowerCase();
  if (label.includes("round of 32")) return "round_of_32";
  if (label.includes("round of 16")) return "round_of_16";
  if (label.includes("quarter")) return "quarterfinals";
  if (label.includes("semi")) return "semifinals";
  if (label.includes("third")) return "third_place";
  if (label.includes("final")) return "final";
  return "group";
}

function normalizeStatus(status) {
  const value = String(status || "").toLowerCase();
  if (["ft", "finished", "full-time", "ended", "completed"].includes(value)) return "finished";
  if (
    [
      "live",
      "1h",
      "2h",
      "et",
      "ht",
      "inplay",
      "in-play",
      "playing",
      "halftime",
      "half-time",
    ].includes(value)
  )
    return "live";
  return "scheduled";
}

function normalizeFootballDataStatus(status) {
  const value = String(status || "").toUpperCase();
  if (["FINISHED"].includes(value)) return "finished";
  if (["LIVE", "IN_PLAY", "PAUSED"].includes(value)) return "live";
  return "scheduled";
}

function mapFootballDataStage(stageCode) {
  const code = String(stageCode || "").toUpperCase();
  if (code === "GROUP_STAGE") return "group";
  if (code === "LAST_32") return "round_of_32";
  if (code === "LAST_16") return "round_of_16";
  if (code === "QUARTER_FINALS") return "quarterfinals";
  if (code === "SEMI_FINALS") return "semifinals";
  if (code === "THIRD_PLACE") return "third_place";
  if (code === "FINAL") return "final";
  return "group";
}

function normalizeFixtureFromUnknownShape(raw) {
  const fixtureId =
    raw?.id ??
    raw?.match_id ??
    raw?.fixture_id ??
    raw?.fixture?.id ??
    raw?.event_id ??
    raw?.game_id ??
    null;

  const dateValue =
    raw?.date ??
    raw?.kickoff ??
    raw?.kickoff_at ??
    raw?.start_time ??
    raw?.fixture?.date ??
    raw?.fixture?.kickoff ??
    null;

  const homeTeam =
    raw?.home_team?.name ??
    raw?.homeTeam?.name ??
    raw?.home_name ??
    raw?.home ??
    raw?.teams?.home?.name ??
    raw?.team_home?.name ??
    raw?.participants?.home?.name ??
    "Unknown";

  const awayTeam =
    raw?.away_team?.name ??
    raw?.awayTeam?.name ??
    raw?.away_name ??
    raw?.away ??
    raw?.teams?.away?.name ??
    raw?.team_away?.name ??
    raw?.participants?.away?.name ??
    "Unknown";

  const stage =
    mapRoundToStage(
      raw?.round ?? raw?.stage ?? raw?.league?.round ?? raw?.competition?.round ?? raw?.phase,
    ) || "group";

  const statusRaw =
    raw?.status ??
    raw?.state ??
    raw?.fixture?.status?.short ??
    raw?.fixture?.status?.long ??
    raw?.match_status;

  const homeScore =
    raw?.home_score ??
    raw?.score?.home ??
    raw?.scores?.home ??
    raw?.goals?.home ??
    raw?.result?.home ??
    null;

  const awayScore =
    raw?.away_score ??
    raw?.score?.away ??
    raw?.scores?.away ??
    raw?.goals?.away ??
    raw?.result?.away ??
    null;

  return {
    externalFixtureId: Number(fixtureId),
    kickoffAt: dateValue ? new Date(dateValue).toISOString() : null,
    dateKey: dateValue ? String(dateValue).slice(0, 10) : "unknown",
    stage,
    homeTeam,
    awayTeam,
    status: normalizeStatus(statusRaw),
    homeScore: homeScore === null || homeScore === undefined ? null : Number(homeScore),
    awayScore: awayScore === null || awayScore === undefined ? null : Number(awayScore),
  };
}

function stageSortWeight(stage) {
  const map = {
    group: 1,
    round_of_32: 2,
    round_of_16: 3,
    quarterfinals: 4,
    semifinals: 5,
    third_place: 6,
    final: 7,
  };
  return map[stage] ?? 99;
}

function getIsoWeekKey(isoDateString) {
  if (!isoDateString) return "unknown-week";
  const date = new Date(isoDateString);
  if (Number.isNaN(date.getTime())) return "unknown-week";

  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((utc - yearStart) / 86400000 + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function assignMatchdayAndOrder(fixtures, source) {
  const sorted = fixtures
    .filter((item) => Number.isFinite(item.externalFixtureId))
    .sort((a, b) => {
      const stageDiff = stageSortWeight(a.stage) - stageSortWeight(b.stage);
      if (stageDiff !== 0) return stageDiff;
      const aTime = a.kickoffAt ? new Date(a.kickoffAt).getTime() : Number.MAX_SAFE_INTEGER;
      const bTime = b.kickoffAt ? new Date(b.kickoffAt).getTime() : Number.MAX_SAFE_INTEGER;
      return aTime - bTime;
    });

  const bucketToMatchday = new Map();
  let nextMatchday = 1;
  sorted.forEach((item) => {
    const weekKey = getIsoWeekKey(item.kickoffAt);
    const bucketKey = `${item.stage}:${weekKey}`;
    if (!bucketToMatchday.has(bucketKey)) {
      bucketToMatchday.set(bucketKey, nextMatchday);
      nextMatchday += 1;
    }
  });

  const dayOrderCounter = new Map();
  return sorted.map((item) => {
    const weekKey = getIsoWeekKey(item.kickoffAt);
    const bucketKey = `${item.stage}:${weekKey}`;
    const matchday = bucketToMatchday.get(bucketKey) || 1;
    const current = dayOrderCounter.get(matchday) || 0;
    const matchOrder = current + 1;
    dayOrderCounter.set(matchday, matchOrder);

    return {
      externalFixtureId: item.externalFixtureId,
      source,
      matchday,
      stage: item.stage,
      matchOrder,
      homeTeam: item.homeTeam,
      awayTeam: item.awayTeam,
      kickoffAt: item.kickoffAt,
      status: item.status,
      homeScore: item.homeScore,
      awayScore: item.awayScore,
    };
  });
}

async function fetchFromApiFootball() {
  assertApiFootballConfigured();

  const url = new URL(`${env.FOOTBALL_API_BASE_URL}/fixtures`);
  url.searchParams.set("league", String(env.FOOTBALL_API_LEAGUE_ID));
  url.searchParams.set("season", String(env.FOOTBALL_API_SEASON));

  const response = await fetch(url.toString(), {
    headers: {
      "x-apisports-key": env.FOOTBALL_API_KEY,
      "x-apisports-host": env.FOOTBALL_API_HOST,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Live API request failed (${response.status}): ${body}`);
  }

  const payload = await response.json();
  const fixtures = Array.isArray(payload.response) ? payload.response : [];

  const normalized = fixtures.map((fixture) => normalizeFixtureFromUnknownShape(fixture));
  return assignMatchdayAndOrder(normalized, "api-football");
}

function groupLabelToSortValue(groupLabel) {
  const normalized = String(groupLabel || "").toUpperCase();
  const letter = normalized.replace("GROUP_", "").replace("GROUP ", "").trim();
  const firstChar = letter[0];
  if (!firstChar || firstChar < "A" || firstChar > "Z") return 999;
  return firstChar.charCodeAt(0) - 65;
}

function normalizeGroupLabel(groupLabel) {
  const normalized = String(groupLabel || "").toUpperCase();
  return normalized.replace("GROUP_", "").replace("GROUP ", "").trim();
}

function createEmptyTeamStats(teamName) {
  return {
    teamName: teamName || "Unknown",
    played: 0,
    won: 0,
    draw: 0,
    lost: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    goalDifference: 0,
    points: 0,
  };
}

function applyMatchResultToStats(teamStats, goalsFor, goalsAgainst) {
  teamStats.played += 1;
  teamStats.goalsFor += goalsFor;
  teamStats.goalsAgainst += goalsAgainst;
  teamStats.goalDifference = teamStats.goalsFor - teamStats.goalsAgainst;
  if (goalsFor > goalsAgainst) {
    teamStats.won += 1;
    teamStats.points += 3;
    return;
  }
  if (goalsFor < goalsAgainst) {
    teamStats.lost += 1;
    return;
  }
  teamStats.draw += 1;
  teamStats.points += 1;
}

function toSortedGroupTable(teamStatsMap) {
  const rows = Array.from(teamStatsMap.values()).sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.goalDifference !== a.goalDifference) return b.goalDifference - a.goalDifference;
    if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
    return a.teamName.localeCompare(b.teamName);
  });
  return rows.map((row, index) => ({
    position: index + 1,
    ...row,
  }));
}

async function fetchGroupedStandingsFromFootballDataMatches() {
  assertFootballDataConfigured();
  const url = new URL(
    `${env.FOOTBALL_DATA_BASE_URL}/competitions/${env.FOOTBALL_DATA_COMPETITION_CODE}/matches`,
  );
  url.searchParams.set("season", String(env.FOOTBALL_DATA_SEASON));

  const response = await fetch(url.toString(), {
    headers: {
      "X-Auth-Token": env.FOOTBALL_DATA_TOKEN,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`football-data matches failed (${response.status}): ${body}`);
  }

  const payload = await response.json();
  const matches = Array.isArray(payload?.matches) ? payload.matches : [];
  const groupMatches = matches.filter(
    (match) => String(match?.stage || "").toUpperCase() === "GROUP_STAGE" && Boolean(match?.group),
  );
  if (groupMatches.length === 0) {
    throw new Error("football-data did not return group-stage matches for this season.");
  }

  const groupsMap = new Map();
  for (const match of groupMatches) {
    const groupLabel = normalizeGroupLabel(match?.group);
    if (!groupLabel) continue;

    const homeTeam = String(match?.homeTeam?.name || "Unknown");
    const awayTeam = String(match?.awayTeam?.name || "Unknown");
    if (!groupsMap.has(groupLabel)) {
      groupsMap.set(groupLabel, new Map());
    }
    const teamMap = groupsMap.get(groupLabel);
    if (!teamMap.has(homeTeam)) teamMap.set(homeTeam, createEmptyTeamStats(homeTeam));
    if (!teamMap.has(awayTeam)) teamMap.set(awayTeam, createEmptyTeamStats(awayTeam));

    const homeScore = match?.score?.fullTime?.home;
    const awayScore = match?.score?.fullTime?.away;
    const hasScore = Number.isFinite(homeScore) && Number.isFinite(awayScore);
    if (!hasScore) continue;

    applyMatchResultToStats(teamMap.get(homeTeam), Number(homeScore), Number(awayScore));
    applyMatchResultToStats(teamMap.get(awayTeam), Number(awayScore), Number(homeScore));
  }

  return Array.from(groupsMap.entries())
    .map(([group, teamMap]) => ({
      group,
      table: toSortedGroupTable(teamMap),
    }))
    .sort((a, b) => groupLabelToSortValue(a.group) - groupLabelToSortValue(b.group));
}

async function fetchGroupsFromFootballData() {
  assertFootballDataConfigured();
  const url = new URL(
    `${env.FOOTBALL_DATA_BASE_URL}/competitions/${env.FOOTBALL_DATA_COMPETITION_CODE}/standings`,
  );
  url.searchParams.set("season", String(env.FOOTBALL_DATA_SEASON));

  const response = await fetch(url.toString(), {
    headers: {
      "X-Auth-Token": env.FOOTBALL_DATA_TOKEN,
    },
  });

  if (response.status === 429 && latestGroupsCache.provider === "football-data") {
    return latestGroupsCache.data;
  }
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`football-data standings failed (${response.status}): ${body}`);
  }

  const payload = await response.json();
  const standings = Array.isArray(payload?.standings) ? payload.standings : [];
  const grouped = standings
    .filter((entry) => String(entry?.type || "").toUpperCase() === "TOTAL")
    .map((entry) => ({
      group: normalizeGroupLabel(entry?.group),
      table: (Array.isArray(entry?.table) ? entry.table : [])
        .map((row) => ({
          position: Number(row?.position ?? 0),
          teamName: row?.team?.name || "Unknown",
          played: Number(row?.playedGames ?? 0),
          won: Number(row?.won ?? 0),
          draw: Number(row?.draw ?? 0),
          lost: Number(row?.lost ?? 0),
          goalsFor: Number(row?.goalsFor ?? 0),
          goalsAgainst: Number(row?.goalsAgainst ?? 0),
          goalDifference: Number(row?.goalDifference ?? 0),
          points: Number(row?.points ?? 0),
        }))
        .sort((a, b) => a.position - b.position),
    }))
    .sort((a, b) => groupLabelToSortValue(a.group) - groupLabelToSortValue(b.group));

  const groupedWithLabels = grouped.filter((entry) => /^[A-Z]$/.test(entry.group));
  const finalGroups =
    groupedWithLabels.length > 0 ? groupedWithLabels : await fetchGroupedStandingsFromFootballDataMatches();

  latestGroupsCache = {
    provider: "football-data",
    cachedAt: Date.now(),
    data: finalGroups,
  };
  return finalGroups;
}

async function fetchGroupsFromApiFootball() {
  assertApiFootballConfigured();
  const url = new URL(`${env.FOOTBALL_API_BASE_URL}/standings`);
  url.searchParams.set("league", String(env.FOOTBALL_API_LEAGUE_ID));
  url.searchParams.set("season", String(env.FOOTBALL_API_SEASON));

  const response = await fetch(url.toString(), {
    headers: {
      "x-apisports-key": env.FOOTBALL_API_KEY,
      "x-apisports-host": env.FOOTBALL_API_HOST,
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`API-Football standings failed (${response.status}): ${body}`);
  }

  const payload = await response.json();
  const standingsBlocks = payload?.response?.[0]?.league?.standings;
  const groups = Array.isArray(standingsBlocks) ? standingsBlocks : [];
  const grouped = groups
    .map((groupRows) => {
      const rows = Array.isArray(groupRows) ? groupRows : [];
      const first = rows[0] || {};
      return {
        group: normalizeGroupLabel(first?.group || "Unknown"),
        table: rows
          .map((row) => ({
            position: Number(row?.rank ?? 0),
            teamName: row?.team?.name || "Unknown",
            played: Number(row?.all?.played ?? 0),
            won: Number(row?.all?.win ?? 0),
            draw: Number(row?.all?.draw ?? 0),
            lost: Number(row?.all?.lose ?? 0),
            goalsFor: Number(row?.all?.goals?.for ?? 0),
            goalsAgainst: Number(row?.all?.goals?.against ?? 0),
            goalDifference: Number(row?.goalsDiff ?? 0),
            points: Number(row?.points ?? 0),
          }))
          .sort((a, b) => a.position - b.position),
      };
    })
    .sort((a, b) => groupLabelToSortValue(a.group) - groupLabelToSortValue(b.group));

  latestGroupsCache = {
    provider: "api-football",
    cachedAt: Date.now(),
    data: grouped,
  };
  return grouped;
}

async function fetchFromFootballData() {
  assertFootballDataConfigured();

  const url = new URL(
    `${env.FOOTBALL_DATA_BASE_URL}/competitions/${env.FOOTBALL_DATA_COMPETITION_CODE}/matches`,
  );
  url.searchParams.set("season", String(env.FOOTBALL_DATA_SEASON));

  const response = await fetch(url.toString(), {
    headers: {
      "X-Auth-Token": env.FOOTBALL_DATA_TOKEN,
    },
  });

  if (response.status === 429 && latestFixturesCache.provider === "football-data") {
    return latestFixturesCache.data;
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`football-data request failed (${response.status}): ${body}`);
  }

  // Free plan is rate-limited; we cache aggressivey and reuse cached data.
  const remainingHeader = response.headers.get("X-Requests-Available-Minute");
  const remaining = Number(remainingHeader);
  const payload = await response.json();
  const matches = Array.isArray(payload?.matches) ? payload.matches : [];

  const normalized = matches
    .map((match) => ({
      externalFixtureId: Number(match?.id),
      kickoffAt: match?.utcDate || null,
      dateKey: match?.utcDate ? String(match.utcDate).slice(0, 10) : "unknown",
      stage: mapFootballDataStage(match?.stage),
      homeTeam: match?.homeTeam?.name || "Unknown",
      awayTeam: match?.awayTeam?.name || "Unknown",
      status: normalizeFootballDataStatus(match?.status),
      homeScore:
        match?.score?.fullTime?.home === null || match?.score?.fullTime?.home === undefined
          ? null
          : Number(match.score.fullTime.home),
      awayScore:
        match?.score?.fullTime?.away === null || match?.score?.fullTime?.away === undefined
          ? null
          : Number(match.score.fullTime.away),
    }))
    .filter((item) => Number.isFinite(item.externalFixtureId));

  const fixtures = assignMatchdayAndOrder(normalized, "football-data");
  latestFixturesCache = {
    provider: "football-data",
    cachedAt: Date.now(),
    data: fixtures,
  };

  if (Number.isFinite(remaining) && remaining <= 1) {
    return latestFixturesCache.data;
  }

  return fixtures;
}

async function fetchFromWorldCupApi() {
  assertWorldCupApiConfigured();

  const fixturesUrl = new URL(`${env.WORLDCUP_API_BASE_URL}/fixtures`);
  fixturesUrl.searchParams.set("key", env.WORLDCUP_API_KEY);
  const livescoresUrl = new URL(`${env.WORLDCUP_API_BASE_URL}/livescores`);
  livescoresUrl.searchParams.set("key", env.WORLDCUP_API_KEY);

  const [fixturesResponse, livescoresResponse] = await Promise.all([
    fetch(fixturesUrl.toString()),
    fetch(livescoresUrl.toString()),
  ]);

  if (!fixturesResponse.ok) {
    const body = await fixturesResponse.text();
    throw new Error(`World Cup API fixtures failed (${fixturesResponse.status}): ${body}`);
  }
  if (!livescoresResponse.ok) {
    const body = await livescoresResponse.text();
    throw new Error(`World Cup API livescores failed (${livescoresResponse.status}): ${body}`);
  }

  const [fixturesPayload, livescoresPayload] = await Promise.all([
    fixturesResponse.json(),
    livescoresResponse.json(),
  ]);

  const extractArray = (payload) => {
    if (Array.isArray(payload?.data)) return payload.data;
    if (Array.isArray(payload?.data?.fixtures)) return payload.data.fixtures;
    if (Array.isArray(payload?.data?.matches)) return payload.data.matches;
    if (Array.isArray(payload?.matches)) return payload.matches;
    return [];
  };

  const fixtures = extractArray(fixturesPayload);
  const lives = extractArray(livescoresPayload);

  const normalizedFixtures = fixtures.map((fixture) => normalizeFixtureFromUnknownShape(fixture));
  const liveById = new Map(
    lives
      .map((item) => normalizeFixtureFromUnknownShape(item))
      .filter((item) => Number.isFinite(item.externalFixtureId))
      .map((item) => [item.externalFixtureId, item]),
  );

  const merged = normalizedFixtures.map((fixture) => {
    const live = liveById.get(fixture.externalFixtureId);
    if (!live) return fixture;
    return {
      ...fixture,
      status: live.status || fixture.status,
      homeScore: live.homeScore ?? fixture.homeScore,
      awayScore: live.awayScore ?? fixture.awayScore,
    };
  });

  return assignMatchdayAndOrder(merged, "worldcupapi");
}

export async function fetchWorldCupFixturesLive() {
  if (
    latestFixturesCache.provider === env.LIVE_DATA_PROVIDER &&
    Date.now() - latestFixturesCache.cachedAt < LIVE_CACHE_MS
  ) {
    return latestFixturesCache.data;
  }

  if (env.LIVE_DATA_PROVIDER === "football-data") {
    return fetchFromFootballData();
  }
  if (env.LIVE_DATA_PROVIDER === "api-football") {
    return fetchFromApiFootball();
  }
  return fetchFromWorldCupApi();
}

export async function fetchWorldCupGroupStandingsLive() {
  if (
    latestGroupsCache.provider === env.LIVE_DATA_PROVIDER &&
    Date.now() - latestGroupsCache.cachedAt < LIVE_CACHE_MS
  ) {
    return latestGroupsCache.data;
  }

  if (env.LIVE_DATA_PROVIDER === "football-data") {
    return fetchGroupsFromFootballData();
  }
  if (env.LIVE_DATA_PROVIDER === "api-football") {
    return fetchGroupsFromApiFootball();
  }
  throw new Error("Group standings are not available for the selected live provider.");
}

export async function fetchWorldCupTeamsLive() {
  const groups = await fetchWorldCupGroupStandingsLive();
  const seen = new Set();
  const teams = [];

  groups.forEach((group) => {
    const table = Array.isArray(group?.table) ? group.table : [];
    table.forEach((row) => {
      const teamName = String(row?.teamName || "").trim();
      const key = teamName.toLowerCase();
      if (!teamName || seen.has(key)) return;
      seen.add(key);
      teams.push(teamName);
    });
  });

  teams.sort((a, b) => a.localeCompare(b));
  return teams;
}
