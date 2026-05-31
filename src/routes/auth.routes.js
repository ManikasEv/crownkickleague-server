import { Router } from "express";
import { requireAuth } from "@clerk/express";

import { getUsernameAvailability, postRegister, postSyncAuthenticatedUser } from "../controllers/auth.controller.js";

const router = Router();

router.get("/username-available", getUsernameAvailability);
router.post("/register", postRegister);
router.post("/sync", requireAuth(), postSyncAuthenticatedUser);

export default router;
