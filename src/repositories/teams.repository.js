import { pool } from "../config/db.js";

export async function findOwnedTeamByUserId(userId) {
  const { rows } = await pool.query(
    `SELECT id, name, owner_user_id, created_at
     FROM teams
     WHERE owner_user_id = $1
     LIMIT 1`,
    [userId],
  );
  return rows[0] ?? null;
}

export async function listOwnedTeamsByUserId(userId) {
  const { rows } = await pool.query(
    `SELECT id, name, owner_user_id, created_at
     FROM teams
     WHERE owner_user_id = $1
     ORDER BY created_at ASC`,
    [userId],
  );
  return rows;
}

export async function findTeamByMemberUserId(userId) {
  const { rows } = await pool.query(
    `SELECT t.id, t.name, t.owner_user_id, t.created_at
     FROM teams t
     INNER JOIN team_members tm ON tm.team_id = t.id
     WHERE tm.user_id = $1
     LIMIT 1`,
    [userId],
  );
  return rows[0] ?? null;
}

export async function listTeamsByMemberUserId(userId) {
  const { rows } = await pool.query(
    `SELECT t.id, t.name, t.owner_user_id, t.created_at
     FROM teams t
     INNER JOIN team_members tm ON tm.team_id = t.id
     WHERE tm.user_id = $1
     ORDER BY t.created_at ASC`,
    [userId],
  );
  return rows;
}

export async function listTeamsWithMembersByUserId(userId) {
  const { rows } = await pool.query(
    `SELECT t.id AS team_id,
            t.name AS team_name,
            t.owner_user_id AS owner_user_id,
            au.id AS member_id,
            au.username AS member_username,
            au.points AS member_points,
            tm.role AS member_role
     FROM team_members own_tm
     INNER JOIN teams t ON t.id = own_tm.team_id
     INNER JOIN team_members tm ON tm.team_id = t.id
     INNER JOIN app_users au ON au.id = tm.user_id
     WHERE own_tm.user_id = $1
     ORDER BY t.created_at ASC, au.points DESC, au.created_at ASC`,
    [userId],
  );
  return rows;
}

export async function findTeamById(teamId) {
  const { rows } = await pool.query(
    `SELECT id, name, owner_user_id, created_at
     FROM teams
     WHERE id = $1
     LIMIT 1`,
    [teamId],
  );
  return rows[0] ?? null;
}

export async function createTeam({ name, ownerUserId }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const teamResult = await client.query(
      `INSERT INTO teams (name, owner_user_id)
       VALUES ($1, $2)
       RETURNING id, name, owner_user_id, created_at`,
      [name, ownerUserId],
    );

    const team = teamResult.rows[0];
    await client.query(
      `INSERT INTO team_members (team_id, user_id, role)
       VALUES ($1, $2, 'owner')
       ON CONFLICT (team_id, user_id) DO NOTHING`,
      [team.id, ownerUserId],
    );

    await client.query("COMMIT");
    return team;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function listTeamMembers(teamId) {
  const { rows } = await pool.query(
    `SELECT au.id, au.username, au.points, tm.role
     FROM team_members tm
     INNER JOIN app_users au ON au.id = tm.user_id
     WHERE tm.team_id = $1
     ORDER BY au.points DESC, au.created_at ASC`,
    [teamId],
  );
  return rows;
}

export async function createInvite({ teamId, inviterUserId, inviteeUserId }) {
  const { rows } = await pool.query(
    `INSERT INTO team_invites (team_id, inviter_user_id, invitee_user_id, status)
     VALUES ($1, $2, $3, 'pending')
     RETURNING id, team_id, inviter_user_id, invitee_user_id, status, created_at`,
    [teamId, inviterUserId, inviteeUserId],
  );
  return rows[0];
}

export async function findPendingInvite({ teamId, inviteeUserId }) {
  const { rows } = await pool.query(
    `SELECT id
     FROM team_invites
     WHERE team_id = $1 AND invitee_user_id = $2 AND status = 'pending'
     LIMIT 1`,
    [teamId, inviteeUserId],
  );
  return rows[0] ?? null;
}

export async function isTeamMember(teamId, userId) {
  const { rows } = await pool.query(
    `SELECT 1
     FROM team_members
     WHERE team_id = $1 AND user_id = $2
     LIMIT 1`,
    [teamId, userId],
  );
  return Boolean(rows[0]);
}

export async function listPendingInvitesForUser(userId) {
  const { rows } = await pool.query(
    `SELECT ti.id,
            ti.team_id,
            ti.status,
            ti.created_at,
            t.name AS team_name,
            inviter.username AS inviter_username
     FROM team_invites ti
     INNER JOIN teams t ON t.id = ti.team_id
     INNER JOIN app_users inviter ON inviter.id = ti.inviter_user_id
     WHERE ti.invitee_user_id = $1 AND ti.status = 'pending'
     ORDER BY ti.created_at DESC`,
    [userId],
  );
  return rows;
}

export async function findInviteById(inviteId) {
  const { rows } = await pool.query(
    `SELECT id, team_id, invitee_user_id, status
     FROM team_invites
     WHERE id = $1
     LIMIT 1`,
    [inviteId],
  );
  return rows[0] ?? null;
}

export async function acceptInvite({ inviteId, inviteeUserId, teamId }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      `UPDATE team_invites
       SET status = 'accepted',
           responded_at = NOW()
       WHERE id = $1 AND invitee_user_id = $2 AND status = 'pending'`,
      [inviteId, inviteeUserId],
    );

    await client.query(
      `INSERT INTO team_members (team_id, user_id, role)
       VALUES ($1, $2, 'member')
       ON CONFLICT (team_id, user_id) DO NOTHING`,
      [teamId, inviteeUserId],
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
