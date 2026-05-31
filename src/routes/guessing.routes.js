import { Router } from "express";
import { requireAuth } from "@clerk/express";

import {
  getGroupStandings,
  getLiveMatches,
  getKnockoutMatches,
  getWinnerBonus,
  postPrediction,
  postSyncLiveFixtures,
  postWinnerBonus,
} from "../controllers/guessing.controller.js";

const router = Router();

router.get("/matches", requireAuth(), getKnockoutMatches);
router.get("/groups", requireAuth(), getGroupStandings);
router.get("/live", requireAuth(), getLiveMatches);
router.get("/bonus", requireAuth(), getWinnerBonus);
router.post("/predictions", requireAuth(), postPrediction);
router.post("/bonus", requireAuth(), postWinnerBonus);
router.post("/sync/live", requireAuth(), postSyncLiveFixtures);

export default router;
