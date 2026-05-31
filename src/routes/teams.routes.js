import { Router } from "express";
import { requireAuth } from "@clerk/express";

import {
  getMyInvites,
  getMyTeam,
  postAcceptInvite,
  postCreateTeam,
  postInviteByUsername,
} from "../controllers/teams.controller.js";

const router = Router();

router.get("/me", requireAuth(), getMyTeam);
router.post("/", requireAuth(), postCreateTeam);
router.post("/invite", requireAuth(), postInviteByUsername);
router.get("/invites", requireAuth(), getMyInvites);
router.post("/invites/:inviteId/accept", requireAuth(), postAcceptInvite);

export default router;
