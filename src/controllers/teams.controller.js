import { getAuth } from "@clerk/express";
import { z } from "zod";

import {
  acceptInvite,
  createInvite,
  createTeam,
  findInviteById,
  findTeamById,
  findPendingInvite,
  isTeamMember,
  listOwnedTeamsByUserId,
  listPendingInvitesForUser,
  listTeamMembers,
  listTeamsWithMembersByUserId,
} from "../repositories/teams.repository.js";
import { findUserByUsername } from "../repositories/users.repository.js";
import { validateUsernameShape } from "../services/auth.service.js";
import { getOrCreateAppUserByClerkId } from "../services/users.service.js";

const createTeamSchema = z.object({
  name: z.string().trim().min(2).max(50),
});

const inviteSchema = z.object({
  teamId: z.coerce.number().int().positive(),
  username: z.string().trim().min(3).max(30),
});

export async function getMyTeam(req, res) {
  const { userId } = getAuth(req);
  const userResult = await getOrCreateAppUserByClerkId(userId);
  if (!userResult.ok) {
    return res.status(userResult.status).json({ message: userResult.message });
  }

  const ownedTeams = await listOwnedTeamsByUserId(userResult.user.id);
  const rows = await listTeamsWithMembersByUserId(userResult.user.id);
  const teamMap = new Map();
  rows.forEach((row) => {
    const teamId = Number(row.team_id);
    if (!teamMap.has(teamId)) {
      teamMap.set(teamId, {
        id: teamId,
        name: row.team_name,
        ownerUserId: Number(row.owner_user_id),
        members: [],
      });
    }
    teamMap.get(teamId).members.push({
      id: Number(row.member_id),
      username: row.member_username,
      points: Number(row.member_points ?? 0),
      role: row.member_role,
    });
  });

  const teamsWithMembers = [...teamMap.values()];

  return res.json({
    teams: teamsWithMembers,
    ownedTeamIds: ownedTeams.map((team) => Number(team.id)),
  });
}

export async function postCreateTeam(req, res) {
  const parsed = createTeamSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid team payload." });
  }

  const { userId } = getAuth(req);
  const userResult = await getOrCreateAppUserByClerkId(userId);
  if (!userResult.ok) {
    return res.status(userResult.status).json({ message: userResult.message });
  }

  const created = await createTeam({
    name: parsed.data.name.trim(),
    ownerUserId: userResult.user.id,
  });

  const members = await listTeamMembers(created.id);
  return res.status(201).json({
    team: {
      id: Number(created.id),
      name: created.name,
      ownerUserId: Number(created.owner_user_id),
    },
    members: members.map((member) => ({
      id: Number(member.id),
      username: member.username,
      points: Number(member.points ?? 0),
      role: member.role,
    })),
  });
}

export async function postInviteByUsername(req, res) {
  const parsed = inviteSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid invite payload." });
  }

  const invitedUsername = parsed.data.username.trim().toLowerCase();
  const teamId = Number(parsed.data.teamId);
  if (!validateUsernameShape(invitedUsername)) {
    return res.status(400).json({ message: "Invalid username format." });
  }

  const { userId } = getAuth(req);
  const userResult = await getOrCreateAppUserByClerkId(userId);
  if (!userResult.ok) {
    return res.status(userResult.status).json({ message: userResult.message });
  }

  const inviter = userResult.user;
  const team = await findTeamById(teamId);
  if (!team || Number(team.owner_user_id) !== Number(inviter.id)) {
    return res.status(403).json({ message: "Only team owners can send invites." });
  }

  const invitee = await findUserByUsername(invitedUsername);
  if (!invitee) {
    return res.status(404).json({ message: "Username not found." });
  }

  if (Number(invitee.id) === Number(inviter.id)) {
    return res.status(400).json({ message: "You are already in your own team." });
  }

  const alreadyMember = await isTeamMember(team.id, invitee.id);
  if (alreadyMember) {
    return res.status(409).json({ message: "This player is already in this team." });
  }

  const pending = await findPendingInvite({ teamId: team.id, inviteeUserId: invitee.id });
  if (pending) {
    return res.status(409).json({ message: "Invite is already pending for this player." });
  }

  await createInvite({
    teamId: team.id,
    inviterUserId: inviter.id,
    inviteeUserId: invitee.id,
  });

  return res.status(201).json({ message: `Invite sent to @${invitee.username}.` });
}

export async function getMyInvites(req, res) {
  const { userId } = getAuth(req);
  const userResult = await getOrCreateAppUserByClerkId(userId);
  if (!userResult.ok) {
    return res.status(userResult.status).json({ message: userResult.message });
  }

  const invites = await listPendingInvitesForUser(userResult.user.id);
  return res.json({
    invites: invites.map((invite) => ({
      id: Number(invite.id),
      teamId: Number(invite.team_id),
      teamName: invite.team_name,
      inviterUsername: invite.inviter_username,
      createdAt: invite.created_at,
    })),
  });
}

export async function postAcceptInvite(req, res) {
  const inviteId = Number(req.params.inviteId);
  if (!Number.isFinite(inviteId)) {
    return res.status(400).json({ message: "Invalid invite id." });
  }

  const { userId } = getAuth(req);
  const userResult = await getOrCreateAppUserByClerkId(userId);
  if (!userResult.ok) {
    return res.status(userResult.status).json({ message: userResult.message });
  }

  const invite = await findInviteById(inviteId);
  if (!invite || invite.status !== "pending") {
    return res.status(404).json({ message: "Invite not found." });
  }

  if (Number(invite.invitee_user_id) !== Number(userResult.user.id)) {
    return res.status(403).json({ message: "You can only accept your own invite." });
  }

  await acceptInvite({
    inviteId,
    inviteeUserId: userResult.user.id,
    teamId: invite.team_id,
  });

  return res.json({ message: "Invite accepted." });
}
