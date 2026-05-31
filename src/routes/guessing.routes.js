import { Router } from "express";
import { requireAuth } from "@clerk/express";

import {
  getGroupStandings,
  getLiveMatches,
  getKnockoutMatches,
  postPrediction,
  postSyncLiveFixtures,
} from "../controllers/guessing.controller.js";

const router = Router();

router.get("/matches", requireAuth(), getKnockoutMatches);
router.get("/groups", requireAuth(), getGroupStandings);
router.get("/live", requireAuth(), getLiveMatches);
router.post("/predictions", requireAuth(), postPrediction);
router.post("/sync/live", requireAuth(), postSyncLiveFixtures);

export default router;
