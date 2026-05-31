import { getAuth } from "@clerk/express";

import { findUserByClerkId } from "../repositories/users.repository.js";
import { syncUserFromClerk } from "../services/auth.service.js";

export async function getDashboard(req, res) {
  const { userId } = getAuth(req);

  let appUser = await findUserByClerkId(userId);
  if (!appUser) {
    const syncResult = await syncUserFromClerk(userId);
    if (!syncResult.ok) {
      return res.status(syncResult.status).json({ message: syncResult.message });
    }

    appUser = {
      id: syncResult.data.id,
      email: syncResult.data.email,
      username: syncResult.data.username,
    };
  }

  return res.json({
    message: "Dashboard API is ready",
    user: {
      id: appUser.id,
      email: appUser.email,
      username: appUser.username,
    },
  });
}
