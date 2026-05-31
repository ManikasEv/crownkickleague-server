import { findUserByClerkId } from "../repositories/users.repository.js";
import { syncUserFromClerk } from "./auth.service.js";

export async function getOrCreateAppUserByClerkId(clerkUserId) {
  let appUser = await findUserByClerkId(clerkUserId);
  if (appUser) {
    return { ok: true, user: appUser };
  }

  const sync = await syncUserFromClerk(clerkUserId);
  if (!sync.ok) {
    return { ok: false, status: sync.status, message: sync.message };
  }

  appUser = await findUserByClerkId(clerkUserId);
  if (!appUser) {
    return { ok: false, status: 500, message: "Unable to load app user profile." };
  }

  return { ok: true, user: appUser };
}
