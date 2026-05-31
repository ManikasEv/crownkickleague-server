import cors from "cors";
import compression from "compression";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { clerkMiddleware } from "@clerk/express";

import { env } from "./config/env.js";
import authRoutes from "./routes/auth.routes.js";
import dashboardRoutes from "./routes/dashboard.routes.js";
import healthRoutes from "./routes/health.routes.js";
import rankingsRoutes from "./routes/rankings.routes.js";
import teamsRoutes from "./routes/teams.routes.js";
import guessingRoutes from "./routes/guessing.routes.js";
import { errorHandler, notFoundHandler } from "./middlewares/error.middleware.js";

const app = express();
const allowedOrigins = String(env.CLIENT_URL || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

app.use(helmet());
app.use(compression());
app.use(
  cors({
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  }),
);
app.use(express.json());
if (env.NODE_ENV !== "production") {
  app.use(morgan("dev"));
}
app.use(clerkMiddleware());

app.get("/api", (_req, res) => {
  res.json({ message: "Welcome to CrownLeague API" });
});

app.use("/api/health", healthRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/rankings", rankingsRoutes);
app.use("/api/teams", teamsRoutes);
app.use("/api/guessing", guessingRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
