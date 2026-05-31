import { clerkClient } from "@clerk/express";

import {
  createUser,
  findUserByClerkId,
  findUserByEmail,
  findUserByUsername,
  upsertUserByClerkId,
} from "../repositories/users.repository.js";

function normalizeUsername(username) {
  return username.trim().toLowerCase();
}

function buildUsernameCandidateFromEmail(email) {
  const localPart = (email.split("@")[0] || "player").toLowerCase();
  const compact = localPart.replace(/[^a-z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  const base = compact || "player";
  const withMinLength = base.length < 3 ? `${base}play` : base;
  return withMinLength.slice(0, 30);
}

async function ensureUniqueUsername(baseUsername) {
  const normalizedBase = normalizeUsername(baseUsername).slice(0, 30) || "player";
  const exact = await findUserByUsername(normalizedBase);
  if (!exact) {
    return normalizedBase;
  }

  for (let i = 1; i <= 500; i += 1) {
    const suffix = `_${i}`;
    const candidate = `${normalizedBase.slice(0, 30 - suffix.length)}${suffix}`;
    const existing = await findUserByUsername(candidate);
    if (!existing) {
      return candidate;
    }
  }

  throw new Error("Unable to generate a unique username");
}

export function validateUsernameShape(username) {
  return /^[a-z0-9_]{3,30}$/.test(username);
}

export async function checkUsernameAvailability(username) {
  const normalizedUsername = normalizeUsername(username);
  const existing = await findUserByUsername(normalizedUsername);
  return {
    available: !existing,
    normalizedUsername,
  };
}

export async function registerUser({ email, password, username }) {
  const normalizedEmail = email.trim().toLowerCase();
  const normalizedUsername = normalizeUsername(username);

  const existingByUsername = await findUserByUsername(normalizedUsername);
  if (existingByUsername) {
    return {
      ok: false,
      status: 409,
      message: "Username is already taken",
    };
  }

  const existingByEmail = await findUserByEmail(normalizedEmail);
  if (existingByEmail) {
    return {
      ok: false,
      status: 409,
      message: "Email is already registered. Please login instead.",
    };
  }

  let createdClerkUserId = null;

  try {
    const clerkUser = await clerkClient.users.createUser({
      emailAddress: [normalizedEmail],
      password,
      skipPasswordChecks: false,
      skipPasswordRequirement: false,
    });
    createdClerkUserId = clerkUser.id;

    const dbUser = await createUser({
      clerkUserId: clerkUser.id,
      email: normalizedEmail,
      username: normalizedUsername,
    });

    return {
      ok: true,
      status: 201,
      data: {
        id: dbUser.id,
        email: dbUser.email,
        username: dbUser.username,
        clerkUserId: dbUser.clerk_user_id,
      },
    };
  } catch (error) {
    if (error?.code === "23505") {
      if (createdClerkUserId) {
        try {
          await clerkClient.users.deleteUser(createdClerkUserId);
        } catch {
          // Ignore rollback failure; we still return meaningful app error.
        }
      }

      if (error?.constraint === "app_users_email_key") {
        return {
          ok: false,
          status: 409,
          message: "Email is already registered. Please login instead.",
        };
      }

      if (error?.constraint === "app_users_username_key") {
        return {
          ok: false,
          status: 409,
          message: "Username is already taken",
        };
      }
    }

    const clerkErrorMessage =
      (Array.isArray(error?.errors) &&
        (error.errors[0]?.longMessage || error.errors[0]?.message || error.errors[0]?.code)) ||
      error?.message;

    return {
      ok: false,
      status: clerkErrorMessage ? 400 : 500,
      message: clerkErrorMessage || "Unable to create account in Clerk",
    };
  }
}

export async function syncUserFromClerk(clerkUserId, preferredUsername) {
  try {
    const clerkUser = await clerkClient.users.getUser(clerkUserId);
    const primaryEmail = clerkUser.emailAddresses.find((emailAddress) => emailAddress.id === clerkUser.primaryEmailAddressId)
      ?.emailAddress;
    const existingUser = await findUserByClerkId(clerkUserId);
    let username = preferredUsername ? normalizeUsername(preferredUsername) : existingUser?.username;

    if (!primaryEmail) {
      return {
        ok: false,
        status: 400,
        message: "Your Clerk account does not have a primary email yet.",
      };
    }

    if (!username) {
      username = buildUsernameCandidateFromEmail(primaryEmail);
    }

    const uniqueUsername =
      existingUser?.username && existingUser.username === username ? username : await ensureUniqueUsername(username);

    const user = await upsertUserByClerkId({
      clerkUserId,
      email: primaryEmail.toLowerCase(),
      username: uniqueUsername.toLowerCase(),
    });

    return {
      ok: true,
      status: 200,
      data: {
        id: user.id,
        email: user.email,
        username: user.username,
        clerkUserId: user.clerk_user_id,
      },
    };
  } catch (error) {
    if (error?.code === "23505") {
      if (error?.constraint === "app_users_email_key") {
        return {
          ok: false,
          status: 409,
          message: "Email is already linked to another account.",
        };
      }

      if (error?.constraint === "app_users_username_key") {
        return {
          ok: false,
          status: 409,
          message: "Username is already linked to another account.",
        };
      }
    }

    return {
      ok: false,
      status: 500,
      message: "Failed to sync user profile with database.",
    };
  }
}
