import { getAuth } from "@clerk/express";
import { z } from "zod";

import {
  createOrUpdateFixturePrediction,
  ensureFixtureTemplateMatches,
  findFixtureById,
  getMatchdayFirstKickoff,
  getMaxMatchday,
  hasSyncedTournamentFixtures,
  listLiveFixtures,
  listFixturesByMatchday,
  listPredictionsByUserIdForMatchday,
  refreshPredictionPointsFromFinishedFixtures,
  sumPointsForUser,
  upsertTournamentFixtures,
} from "../repositories/guessing.repository.js";
import { refreshAllUserPointsFromPredictions, updateUserPoints } from "../repositories/users.repository.js";
import { getOrCreateAppUserByClerkId } from "../services/users.service.js";
import {
  fetchWorldCupFixturesLive,
  fetchWorldCupGroupStandingsLive,
} from "../services/liveFootball.service.js";
import { env } from "../config/env.js";
import { getOddsForMatches } from "../services/odds.service.js";

const outcomePredictionSchema = z.object({
  matchId: z.coerce.number().int().positive(),
  predictionType: z.literal("outcome"),
  predictedOutcome: z.enum(["1", "X", "2"]),
});

const scorePredictionSchema = z.object({
  matchId: z.coerce.number().int().positive(),
  predictionType: z.literal("score"),
  predictedHomeScore: z.coerce.number().int().min(0).max(30),
  predictedAwayScore: z.coerce.number().int().min(0).max(30),
});

const predictionSchema = z.union([outcomePredictionSchema, scorePredictionSchema]);

function getOutcomeFromScore(homeScore, awayScore) {
  if (homeScore > awayScore) return "1";
  if (homeScore < awayScore) return "2";
  return "X";
}

function calculatePoints({ match, predictionType, predictedOutcome, predictedHomeScore, predictedAwayScore }) {
  const hasFinalScore = match.home_score !== null && match.away_score !== null;
  if (!hasFinalScore) return 0;

  const actualHome = Number(match.home_score);
  const actualAway = Number(match.away_score);

  if (predictionType === "outcome") {
    const actualOutcome = getOutcomeFromScore(actualHome, actualAway);
    return predictedOutcome === actualOutcome ? 1 : 0;
  }

  return predictedHomeScore === actualHome && predictedAwayScore === actualAway ? 3 : 0;
}

function getMatchdayLockState(firstKickoff) {
  if (!firstKickoff) {
    return {
      firstKickoff: null,
      lockAt: null,
      locked: false,
    };
  }

  const firstKickoffDate = new Date(firstKickoff);
  const lockAtDate = new Date(firstKickoffDate.getTime() - 3 * 60 * 60 * 1000);
  const now = new Date();
  return {
    firstKickoff: firstKickoffDate.toISOString(),
    lockAt: lockAtDate.toISOString(),
    locked: now >= lockAtDate,
  };
}

export async function getKnockoutMatches(req, res) {
  const requestedMatchday = Number(req.query.matchday);
  const { userId } = getAuth(req);
  const userResult = await getOrCreateAppUserByClerkId(userId);
  if (!userResult.ok) {
    return res.status(userResult.status).json({ message: userResult.message });
  }

  const hasSyncedFixtures = await hasSyncedTournamentFixtures();
  if (!hasSyncedFixtures) {
    await ensureFixtureTemplateMatches();
  }
  const maxMatchday = await getMaxMatchday();
  const selectedMatchday =
    Number.isFinite(requestedMatchday) && requestedMatchday >= 1
      ? Math.min(Math.max(1, requestedMatchday), maxMatchday)
      : 1;

  const [matches, predictions, firstKickoff] = await Promise.all([
    listFixturesByMatchday(selectedMatchday),
    listPredictionsByUserIdForMatchday(userResult.user.id, selectedMatchday),
    getMatchdayFirstKickoff(selectedMatchday),
  ]);

  const predictionMap = new Map(
    predictions.map((prediction) => [
      Number(prediction.fixture_id),
      {
        predictionType: prediction.prediction_type,
        predictedOutcome: prediction.predicted_outcome,
        predictedHomeScore:
          prediction.predicted_home_score === null ? null : Number(prediction.predicted_home_score),
        predictedAwayScore:
          prediction.predicted_away_score === null ? null : Number(prediction.predicted_away_score),
        pointsAwarded: Number(prediction.points_awarded ?? 0),
      },
    ]),
  );

  const mappedMatches = matches.map((match) => ({
    id: Number(match.id),
    externalFixtureId:
      match.external_fixture_id === null ? null : Number(match.external_fixture_id),
    source: match.source ?? "template",
    matchday: Number(match.matchday),
    stage: match.stage,
    matchOrder: Number(match.match_order),
    homeTeam: match.home_team ?? "Unknown",
    awayTeam: match.away_team ?? "Unknown",
    status: match.status,
    homeScore: match.home_score === null ? null : Number(match.home_score),
    awayScore: match.away_score === null ? null : Number(match.away_score),
    kickoffAt: match.kickoff_at,
    prediction: predictionMap.get(Number(match.id)) ?? null,
  }));
  const oddsByMatchId = await getOddsForMatches(mappedMatches);

  const lockState = getMatchdayLockState(firstKickoff);

  return res.json({
    matchday: selectedMatchday,
    maxMatchday,
    firstKickoff: lockState.firstKickoff,
    lockAt: lockState.lockAt,
    locked: lockState.locked,
    matches: mappedMatches.map((match) => ({
      id: match.id,
      matchday: match.matchday,
      stage: match.stage,
      matchOrder: match.matchOrder,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      status: match.status,
      homeScore: match.homeScore,
      awayScore: match.awayScore,
      kickoffAt: match.kickoffAt,
      prediction: match.prediction,
      odds: oddsByMatchId.get(match.id) ?? null,
    })),
  });
}

export async function postPrediction(req, res) {
  const parsed = predictionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid prediction payload." });
  }

  const { userId } = getAuth(req);
  const userResult = await getOrCreateAppUserByClerkId(userId);
  if (!userResult.ok) {
    return res.status(userResult.status).json({ message: userResult.message });
  }

  const hasSyncedFixtures = await hasSyncedTournamentFixtures();
  if (!hasSyncedFixtures) {
    await ensureFixtureTemplateMatches();
  }

  const fixture = await findFixtureById(parsed.data.matchId);
  if (!fixture) {
    return res.status(404).json({ message: "Match not found." });
  }

  const predictionType = parsed.data.predictionType;
  const predictedOutcome = predictionType === "outcome" ? parsed.data.predictedOutcome : null;
  const predictedHomeScore = predictionType === "score" ? parsed.data.predictedHomeScore : null;
  const predictedAwayScore = predictionType === "score" ? parsed.data.predictedAwayScore : null;
  const lockState = getMatchdayLockState(await getMatchdayFirstKickoff(fixture.matchday));
  if (lockState.locked) {
    return res.status(403).json({
      message: "Matchday is locked. Predictions are closed from 3 hours before first kickoff.",
    });
  }

  const pointsAwarded = calculatePoints({
    match: fixture,
    predictionType,
    predictedOutcome,
    predictedHomeScore,
    predictedAwayScore,
  });

  const prediction = await createOrUpdateFixturePrediction({
    userId: userResult.user.id,
    fixtureId: parsed.data.matchId,
    predictionType,
    predictedOutcome,
    predictedHomeScore,
    predictedAwayScore,
    pointsAwarded,
  });

  const totalPoints = await sumPointsForUser(userResult.user.id);
  await updateUserPoints(userResult.user.id, totalPoints);

  return res.status(201).json({
    id: Number(prediction.id),
    matchId: Number(prediction.fixture_id),
    predictionType: prediction.prediction_type,
    predictedOutcome: prediction.predicted_outcome,
    predictedHomeScore:
      prediction.predicted_home_score === null ? null : Number(prediction.predicted_home_score),
    predictedAwayScore:
      prediction.predicted_away_score === null ? null : Number(prediction.predicted_away_score),
    pointsAwarded: Number(prediction.points_awarded ?? 0),
  });
}

export async function postSyncLiveFixtures(_req, res) {
  try {
    const fixtures = await fetchWorldCupFixturesLive();
    await upsertTournamentFixtures(fixtures);
    await refreshPredictionPointsFromFinishedFixtures();
    await refreshAllUserPointsFromPredictions();

    return res.json({
      synced: fixtures.length,
      source: env.LIVE_DATA_PROVIDER,
    });
  } catch (error) {
    const message =
      env.NODE_ENV === "production"
        ? "Failed to sync live fixtures."
        : error?.message || "Failed to sync live fixtures.";
    return res.status(400).json({
      message,
    });
  }
}

export async function getLiveMatches(req, res) {
  const { userId } = getAuth(req);
  const userResult = await getOrCreateAppUserByClerkId(userId);
  if (!userResult.ok) {
    return res.status(userResult.status).json({ message: userResult.message });
  }

  const rows = await listLiveFixtures();
  return res.json({
    updatedAt: new Date().toISOString(),
    matches: rows.map((match) => ({
      id: Number(match.id),
      matchday: Number(match.matchday),
      stage: match.stage,
      matchOrder: Number(match.match_order),
      homeTeam: match.home_team ?? "Unknown",
      awayTeam: match.away_team ?? "Unknown",
      kickoffAt: match.kickoff_at,
      status: match.status,
      homeScore: match.home_score === null ? null : Number(match.home_score),
      awayScore: match.away_score === null ? null : Number(match.away_score),
    })),
  });
}

export async function getGroupStandings(_req, res) {
  try {
    const groups = await fetchWorldCupGroupStandingsLive();
    return res.json({
      source: env.LIVE_DATA_PROVIDER,
      updatedAt: new Date().toISOString(),
      groups,
    });
  } catch (error) {
    const message =
      env.NODE_ENV === "production"
        ? "Failed to load group standings."
        : error?.message || "Failed to load group standings.";
    return res.status(400).json({ message });
  }
}
