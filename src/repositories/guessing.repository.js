import { pool } from "../config/db.js";

const KNOWN_MATCHDAYS = [
  { matchday: 1, stage: "group", matches: [["Unknown", "Unknown"], ["Unknown", "Unknown"], ["Unknown", "Unknown"]] },
  { matchday: 2, stage: "group", matches: [["Unknown", "Unknown"], ["Unknown", "Unknown"], ["Unknown", "Unknown"]] },
  { matchday: 3, stage: "group", matches: [["Unknown", "Unknown"], ["Unknown", "Unknown"], ["Unknown", "Unknown"]] },
  { matchday: 4, stage: "group", matches: [["Unknown", "Unknown"], ["Unknown", "Unknown"], ["Unknown", "Unknown"]] },
  { matchday: 5, stage: "group", matches: [["Unknown", "Unknown"], ["Unknown", "Unknown"], ["Unknown", "Unknown"]] },
  { matchday: 6, stage: "group", matches: [["Unknown", "Unknown"], ["Unknown", "Unknown"], ["Unknown", "Unknown"]] },
  { matchday: 7, stage: "group", matches: [["Unknown", "Unknown"], ["Unknown", "Unknown"], ["Unknown", "Unknown"]] },
  { matchday: 8, stage: "group", matches: [["Unknown", "Unknown"], ["Unknown", "Unknown"], ["Unknown", "Unknown"]] },
  { matchday: 9, stage: "group", matches: [["Unknown", "Unknown"], ["Unknown", "Unknown"], ["Unknown", "Unknown"]] },
  { matchday: 10, stage: "group", matches: [["Unknown", "Unknown"], ["Unknown", "Unknown"], ["Unknown", "Unknown"]] },
  { matchday: 11, stage: "group", matches: [["Unknown", "Unknown"], ["Unknown", "Unknown"], ["Unknown", "Unknown"]] },
  { matchday: 12, stage: "group", matches: [["Unknown", "Unknown"], ["Unknown", "Unknown"], ["Unknown", "Unknown"]] },
];

const FUTURE_MATCHDAY_TEMPLATE = [
  { matchday: 13, stage: "round_of_32", matches: 4 },
  { matchday: 14, stage: "round_of_32", matches: 4 },
  { matchday: 15, stage: "round_of_32", matches: 4 },
  { matchday: 16, stage: "round_of_32", matches: 4 },
  { matchday: 17, stage: "round_of_16", matches: 4 },
  { matchday: 18, stage: "round_of_16", matches: 4 },
  { matchday: 19, stage: "quarterfinals", matches: 2 },
  { matchday: 20, stage: "quarterfinals", matches: 2 },
  { matchday: 21, stage: "semifinals", matches: 2 },
  { matchday: 22, stage: "third_place", matches: 1 },
  { matchday: 23, stage: "final", matches: 1 },
];

let templateEnsurePromise = null;

async function runEnsureFixtureTemplateMatches() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    for (const day of KNOWN_MATCHDAYS) {
      for (let i = 0; i < day.matches.length; i += 1) {
        const [homeTeam, awayTeam] = day.matches[i];
        const kickoffAt = new Date(Date.UTC(2026, 5, 10 + day.matchday, 14 + i * 3, 0, 0));
        await client.query(
          `INSERT INTO tournament_fixtures (matchday, stage, match_order, home_team, away_team, status)
           VALUES ($1, $2, $3, $4, $5, 'scheduled')
           ON CONFLICT (matchday, match_order)
           DO UPDATE SET
             stage = EXCLUDED.stage,
             home_team = EXCLUDED.home_team,
             away_team = EXCLUDED.away_team,
             kickoff_at = COALESCE(tournament_fixtures.kickoff_at, $6),
             updated_at = NOW()`,
          [day.matchday, day.stage, i + 1, homeTeam, awayTeam, kickoffAt.toISOString()],
        );
      }
    }

    for (const day of FUTURE_MATCHDAY_TEMPLATE) {
      for (let i = 1; i <= day.matches; i += 1) {
        const kickoffAt = new Date(Date.UTC(2026, 5, 10 + day.matchday, 14 + (i - 1) * 3, 0, 0));
        await client.query(
          `INSERT INTO tournament_fixtures (matchday, stage, match_order, home_team, away_team, status)
           VALUES ($1, $2, $3, 'Unknown', 'Unknown', 'scheduled')
           ON CONFLICT (matchday, match_order)
           DO UPDATE SET
             stage = EXCLUDED.stage,
             kickoff_at = COALESCE(tournament_fixtures.kickoff_at, $4),
             updated_at = NOW()`,
          [day.matchday, day.stage, i, kickoffAt.toISOString()],
        );
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function ensureFixtureTemplateMatches() {
  if (!templateEnsurePromise) {
    templateEnsurePromise = runEnsureFixtureTemplateMatches().catch((error) => {
      templateEnsurePromise = null;
      throw error;
    });
  }
  await templateEnsurePromise;
}

export async function getMaxMatchday() {
  const { rows } = await pool.query(`SELECT COALESCE(MAX(matchday), 1) AS max_day FROM tournament_fixtures`);
  return Number(rows[0]?.max_day ?? 1);
}

export async function hasSyncedTournamentFixtures() {
  const { rows } = await pool.query(
    `SELECT 1
     FROM tournament_fixtures
     WHERE source IS NOT NULL
     LIMIT 1`,
  );
  return Boolean(rows[0]);
}

export async function getMatchdayFirstKickoff(matchday) {
  const { rows } = await pool.query(
    `SELECT MIN(kickoff_at) AS first_kickoff
     FROM tournament_fixtures
     WHERE matchday = $1`,
    [matchday],
  );
  return rows[0]?.first_kickoff ?? null;
}

export async function listFixturesByMatchday(matchday) {
  const { rows } = await pool.query(
    `SELECT id, external_fixture_id, source, matchday, stage, group_label, match_order, home_team, away_team, kickoff_at, status, home_score, away_score
     FROM tournament_fixtures
     WHERE matchday = $1
     ORDER BY match_order ASC`,
    [matchday],
  );
  return rows;
}

export async function listLiveFixtures() {
  const { rows } = await pool.query(
    `SELECT id, matchday, stage, group_label, match_order, home_team, away_team, kickoff_at, status, home_score, away_score
     FROM tournament_fixtures
     WHERE status = 'live'
     ORDER BY kickoff_at ASC NULLS LAST, match_order ASC`,
  );
  return rows;
}

export async function getStartedMatchdayCount() {
  const { rows } = await pool.query(
    `SELECT COUNT(DISTINCT matchday) AS started_count
     FROM tournament_fixtures
     WHERE kickoff_at IS NOT NULL
       AND kickoff_at <= NOW()`,
  );
  return Number(rows[0]?.started_count ?? 0);
}

export async function findFixtureById(fixtureId) {
  const { rows } = await pool.query(
    `SELECT id, external_fixture_id, source, matchday, stage, group_label, match_order, home_team, away_team, kickoff_at, status, home_score, away_score
     FROM tournament_fixtures
     WHERE id = $1
     LIMIT 1`,
    [fixtureId],
  );
  return rows[0] ?? null;
}

export async function listPredictionsByUserId(userId) {
  const { rows } = await pool.query(
    `SELECT fixture_id, prediction_type, predicted_outcome, predicted_home_score, predicted_away_score, points_awarded
     FROM fixture_predictions
     WHERE user_id = $1`,
    [userId],
  );
  return rows;
}

export async function listPredictionsByUserIdForMatchday(userId, matchday) {
  const { rows } = await pool.query(
    `SELECT fp.fixture_id, fp.prediction_type, fp.predicted_outcome, fp.predicted_home_score, fp.predicted_away_score, fp.points_awarded
     FROM fixture_predictions fp
     JOIN tournament_fixtures tf ON tf.id = fp.fixture_id
     WHERE fp.user_id = $1
       AND tf.matchday = $2`,
    [userId, matchday],
  );
  return rows;
}

export async function createOrUpdateFixturePrediction({
  userId,
  fixtureId,
  predictionType,
  predictedOutcome,
  predictedHomeScore,
  predictedAwayScore,
  pointsAwarded,
}) {
  const { rows } = await pool.query(
    `INSERT INTO fixture_predictions (
      user_id,
      fixture_id,
      prediction_type,
      predicted_outcome,
      predicted_home_score,
      predicted_away_score,
      points_awarded
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (user_id, fixture_id)
    DO UPDATE SET
      prediction_type = EXCLUDED.prediction_type,
      predicted_outcome = EXCLUDED.predicted_outcome,
      predicted_home_score = EXCLUDED.predicted_home_score,
      predicted_away_score = EXCLUDED.predicted_away_score,
      points_awarded = EXCLUDED.points_awarded,
      updated_at = NOW()
    RETURNING id, user_id, fixture_id, prediction_type, predicted_outcome, predicted_home_score, predicted_away_score, points_awarded`,
    [userId, fixtureId, predictionType, predictedOutcome, predictedHomeScore, predictedAwayScore, pointsAwarded],
  );
  return rows[0];
}

export async function sumPointsForUser(userId) {
  const { rows } = await pool.query(
    `SELECT
       COALESCE((SELECT SUM(points_awarded) FROM fixture_predictions WHERE user_id = $1), 0)
       +
       COALESCE((SELECT SUM(points_awarded) FROM winner_bonus_predictions WHERE user_id = $1), 0)
       AS total`,
    [userId],
  );
  return Number(rows[0]?.total ?? 0);
}

export async function getWinnerBonusPredictionByUserId(userId) {
  const { rows } = await pool.query(
    `SELECT id, user_id, predicted_team, potential_points, points_awarded, created_at, updated_at
     FROM winner_bonus_predictions
     WHERE user_id = $1
     LIMIT 1`,
    [userId],
  );
  return rows[0] ?? null;
}

export async function upsertWinnerBonusPrediction({ userId, predictedTeam, potentialPoints }) {
  const { rows } = await pool.query(
    `INSERT INTO winner_bonus_predictions (user_id, predicted_team, potential_points, points_awarded)
     VALUES ($1, $2, $3, 0)
     ON CONFLICT (user_id)
     DO UPDATE SET
       predicted_team = EXCLUDED.predicted_team,
       potential_points = EXCLUDED.potential_points,
       points_awarded = CASE
         WHEN winner_bonus_predictions.points_awarded > 0 THEN winner_bonus_predictions.points_awarded
         ELSE 0
       END,
       updated_at = NOW()
     RETURNING id, user_id, predicted_team, potential_points, points_awarded, created_at, updated_at`,
    [userId, predictedTeam, potentialPoints],
  );
  return rows[0];
}

export async function getFinalFixtureResult() {
  const { rows } = await pool.query(
    `SELECT id, home_team, away_team, home_score, away_score, status
     FROM tournament_fixtures
     WHERE stage = 'final'
     ORDER BY kickoff_at DESC NULLS LAST
     LIMIT 1`,
  );
  return rows[0] ?? null;
}

export async function upsertTournamentFixtures(fixtures) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Drop static template rows once real provider data is available.
    await client.query(`DELETE FROM tournament_fixtures WHERE source IS NULL`);

    for (const fixture of fixtures) {
      await client.query(
        `INSERT INTO tournament_fixtures (
          external_fixture_id,
          source,
          matchday,
          stage,
          group_label,
          match_order,
          home_team,
          away_team,
          kickoff_at,
          status,
          home_score,
          away_score,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
        ON CONFLICT (matchday, match_order)
        DO UPDATE SET
          external_fixture_id = EXCLUDED.external_fixture_id,
          source = EXCLUDED.source,
          matchday = EXCLUDED.matchday,
          stage = EXCLUDED.stage,
          group_label = EXCLUDED.group_label,
          match_order = EXCLUDED.match_order,
          home_team = EXCLUDED.home_team,
          away_team = EXCLUDED.away_team,
          kickoff_at = EXCLUDED.kickoff_at,
          status = CASE
            WHEN EXCLUDED.status = 'scheduled' AND tournament_fixtures.status IN ('live', 'finished')
              THEN tournament_fixtures.status
            ELSE EXCLUDED.status
          END,
          home_score = COALESCE(EXCLUDED.home_score, tournament_fixtures.home_score),
          away_score = COALESCE(EXCLUDED.away_score, tournament_fixtures.away_score),
          updated_at = NOW()`,
        [
          fixture.externalFixtureId,
          fixture.source,
          fixture.matchday,
          fixture.stage,
          fixture.groupLabel ?? null,
          fixture.matchOrder,
          fixture.homeTeam,
          fixture.awayTeam,
          fixture.kickoffAt,
          fixture.status,
          fixture.homeScore,
          fixture.awayScore,
        ],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function refreshPredictionPointsFromFinishedFixtures() {
  await pool.query(
    `UPDATE fixture_predictions fp
     SET points_awarded = CASE
       WHEN tf.home_score IS NULL OR tf.away_score IS NULL THEN fp.points_awarded
       WHEN fp.prediction_type = 'outcome' THEN
         CASE
           WHEN fp.predicted_outcome =
             CASE
               WHEN tf.home_score > tf.away_score THEN '1'
               WHEN tf.home_score < tf.away_score THEN '2'
               ELSE 'X'
             END
           THEN 1 ELSE 0
         END
       WHEN fp.prediction_type = 'score' THEN
         CASE
           WHEN fp.predicted_home_score = tf.home_score
             AND fp.predicted_away_score = tf.away_score
           THEN 3 ELSE 0
         END
       ELSE 0
     END,
     updated_at = NOW()
     FROM tournament_fixtures tf
     WHERE tf.id = fp.fixture_id`,
  );
}

export async function refreshWinnerBonusPoints() {
  const finalFixture = await getFinalFixtureResult();
  if (!finalFixture) return;

  if (
    String(finalFixture.status || "").toLowerCase() !== "finished" ||
    finalFixture.home_score === null ||
    finalFixture.away_score === null
  ) {
    return;
  }

  const homeScore = Number(finalFixture.home_score);
  const awayScore = Number(finalFixture.away_score);
  if (homeScore === awayScore) {
    return;
  }
  const winnerTeam = homeScore > awayScore ? finalFixture.home_team : finalFixture.away_team;

  await pool.query(
    `UPDATE winner_bonus_predictions
     SET points_awarded = CASE
       WHEN LOWER(predicted_team) = LOWER($1) THEN potential_points
       ELSE 0
     END,
     updated_at = NOW()`,
    [winnerTeam],
  );
}
