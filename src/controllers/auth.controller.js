import { getAuth } from "@clerk/express";
import { z } from "zod";

import {
  checkUsernameAvailability,
  registerUser,
  syncUserFromClerk,
  validateUsernameShape,
} from "../services/auth.service.js";

const usernameSchema = z.object({
  username: z.string().min(3).max(30),
});

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  username: z.string().min(3).max(30),
});

const syncSchema = z.object({
  username: z.string().min(3).max(30).optional(),
});

export async function getUsernameAvailability(req, res) {
  const parsed = usernameSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid username query" });
  }

  const rawUsername = parsed.data.username;
  if (!validateUsernameShape(rawUsername.trim().toLowerCase())) {
    return res.status(400).json({
      message: "Username must be 3-30 chars with letters, numbers, or underscore",
    });
  }

  const result = await checkUsernameAvailability(rawUsername);
  return res.json(result);
}

export async function postRegister(req, res) {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      message: "Invalid registration payload",
      errors: parsed.error.flatten().fieldErrors,
    });
  }

  const normalizedUsername = parsed.data.username.trim().toLowerCase();
  if (!validateUsernameShape(normalizedUsername)) {
    return res.status(400).json({
      message: "Username must be 3-30 chars with letters, numbers, or underscore",
    });
  }

  const result = await registerUser({
    email: parsed.data.email,
    password: parsed.data.password,
    username: normalizedUsername,
  });

  if (!result.ok) {
    return res.status(result.status).json({ message: result.message });
  }

  return res.status(201).json(result.data);
}

export async function postSyncAuthenticatedUser(req, res) {
  const { userId } = getAuth(req);
  const parsed = syncSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid sync payload" });
  }

  const normalizedUsername = parsed.data.username?.trim().toLowerCase();
  if (normalizedUsername && !validateUsernameShape(normalizedUsername)) {
    return res.status(400).json({
      message: "Username must be 3-30 chars with letters, numbers, or underscore",
    });
  }

  const result = await syncUserFromClerk(userId, normalizedUsername);

  if (!result.ok) {
    return res.status(result.status).json({ message: result.message });
  }

  return res.status(200).json(result.data);
}
