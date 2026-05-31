import { env } from "../config/env.js";

const oddsCache = new Map();

function isApiFootballReady() {
  return Boolean(env.FOOTBALL_API_BASE_URL && env.FOOTBALL_API_KEY && env.FOOTBALL_API_HOST);
}

function normalizeKey(value) {
  return String(value || "").trim().toLowerCase();
}

function parseOutcomeLabel(value, homeTeam, awayTeam) {
  const label = normalizeKey(value);
  if (!label) return null;
  if (label === "1" || label === "home" || label === normalizeKey(homeTeam)) return "1";
  if (label === "x" || label === "draw" || label === "tie") return "X";
  if (label === "2" || label === "away" || label === normalizeKey(awayTeam)) return "2";
  return null;
}

function parseApiFootballOdds(payload, homeTeam, awayTeam) {
  const response = Array.isArray(payload?.response) ? payload.response : [];
  const fixtureBlock = response[0];
  if (!fixtureBlock) return null;

  const bookmakers = Array.isArray(fixtureBlock.bookmakers) ? fixtureBlock.bookmakers : [];
  for (const bookmaker of bookmakers) {
    const bets = Array.isArray(bookmaker.bets) ? bookmaker.bets : [];
    const matchWinnerBet = bets.find((bet) => {
      const name = normalizeKey(bet?.name);
      return name.includes("match winner") || name === "1x2";
    });

    if (!matchWinnerBet || !Array.isArray(matchWinnerBet.values)) continue;

    const odds = { "1": null, X: null, "2": null };
    for (const row of matchWinnerBet.values) {
      const key = parseOutcomeLabel(row?.value, homeTeam, awayTeam);
      const odd = Number(row?.odd);
      if (key && Number.isFinite(odd)) {
        odds[key] = odd;
      }
    }

    if (odds["1"] !== null && odds.X !== null && odds["2"] !== null) {
      return {
        home: odds["1"],
        draw: odds.X,
        away: odds["2"],
        bookmaker: bookmaker?.name || "bookmaker",
      };
    }
  }

  return null;
}

async function fetchApiFootballOddsForFixture(match) {
  if (!Number.isFinite(match.externalFixtureId)) return null;

  const cacheEntry = oddsCache.get(match.externalFixtureId);
  const now = Date.now();
  if (cacheEntry && now - cacheEntry.cachedAt < env.ODDS_CACHE_TTL_SECONDS * 1000) {
    return cacheEntry.data;
  }

  const url = new URL(`${env.FOOTBALL_API_BASE_URL}/odds`);
  url.searchParams.set("fixture", String(match.externalFixtureId));

  const response = await fetch(url.toString(), {
    headers: {
      "x-apisports-key": env.FOOTBALL_API_KEY,
      "x-apisports-host": env.FOOTBALL_API_HOST,
    },
  });

  if (!response.ok) {
    return null;
  }

  const payload = await response.json();
  const parsed = parseApiFootballOdds(payload, match.homeTeam, match.awayTeam);
  if (!parsed) return null;

  const data = {
    ...parsed,
    updatedAt: new Date().toISOString(),
  };
  oddsCache.set(match.externalFixtureId, { data, cachedAt: now });
  return data;
}

export async function getOddsForMatches(matches) {
  if (env.ODDS_PROVIDER !== "api-football" || !isApiFootballReady()) {
    return new Map();
  }

  const candidates = matches.filter(
    (match) => match.source === "api-football" && Number.isFinite(match.externalFixtureId),
  );
  if (candidates.length === 0) {
    return new Map();
  }

  const oddsEntries = await Promise.all(
    candidates.map(async (match) => {
      const odds = await fetchApiFootballOddsForFixture(match);
      return [match.id, odds];
    }),
  );

  return new Map(oddsEntries.filter(([, odds]) => Boolean(odds)));
}
