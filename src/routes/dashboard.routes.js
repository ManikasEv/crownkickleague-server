import { Router } from "express";
import { requireAuth } from "@clerk/express";

import { getDashboard } from "../controllers/dashboard.controller.js";

const router = Router();

router.get("/", requireAuth(), getDashboard);

export default router;
