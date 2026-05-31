import { Router } from "express";
import { requireAuth } from "@clerk/express";

import { getGlobalRanking } from "../controllers/rankings.controller.js";

const router = Router();

router.get("/global", requireAuth(), getGlobalRanking);

export default router;
