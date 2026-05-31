import { pool } from "../config/db.js";

export async function findUserByUsername(username) {
  const { rows } = await pool.query("SELECT * FROM app_users WHERE username = $1 LIMIT 1", [username]);
  return rows[0] ?? null;
}

export async function findUserByEmail(email) {
  const { rows } = await pool.query("SELECT * FROM app_users WHERE email = $1 LIMIT 1", [email]);
  return rows[0] ?? null;
}

export async function findUserByClerkId(clerkUserId) {
  const { rows } = await pool.query("SELECT * FROM app_users WHERE clerk_user_id = $1 LIMIT 1", [clerkUserId]);
  return rows[0] ?? null;
}

export async function createUser({ clerkUserId, email, username }) {
  const { rows } = await pool.query(
    `INSERT INTO app_users (clerk_user_id, email, username, points)
     VALUES ($1, $2, $3, 0)
     RETURNING id, clerk_user_id, email, username, points, created_at, updated_at`,
    [clerkUserId, email, username],
  );
  return rows[0];
}

export async function upsertUserByClerkId({ clerkUserId, email, username }) {
  const { rows } = await pool.query(
    `INSERT INTO app_users (clerk_user_id, email, username, points)
     VALUES ($1, $2, $3, 0)
     ON CONFLICT (clerk_user_id)
     DO UPDATE SET
       email = EXCLUDED.email,
       username = EXCLUDED.username,
       updated_at = NOW()
     RETURNING id, clerk_user_id, email, username, points, created_at, updated_at`,
    [clerkUserId, email, username],
  );

  return rows[0];
}

export async function listGlobalRanking() {
  const { rows } = await pool.query(
    `SELECT username, points
     FROM app_users
     ORDER BY points DESC, created_at ASC`,
  );

  return rows;
}

export async function updateUserPoints(userId, points) {
  await pool.query(`UPDATE app_users SET points = $2, updated_at = NOW() WHERE id = $1`, [userId, points]);
}

export async function refreshAllUserPointsFromPredictions() {
  await pool.query(
    `UPDATE app_users au
     SET points = COALESCE(points_by_user.total_points, 0),
         updated_at = NOW()
     FROM (
       SELECT u.id AS user_id,
              COALESCE(SUM(fp.points_awarded), 0) AS total_points
       FROM app_users u
       LEFT JOIN fixture_predictions fp ON fp.user_id = u.id
       GROUP BY u.id
     ) AS points_by_user
     WHERE au.id = points_by_user.user_id`,
  );
}
