import { env } from "../config/env.js";

export function notFoundHandler(_req, res) {
  res.status(404).json({ message: "Route not found" });
}

export function errorHandler(err, _req, res, _next) {
  if (env.NODE_ENV !== "production") {
    console.error(err);
  }

  const status = err.status || 500;
  const message =
    status >= 500 && env.NODE_ENV === "production"
      ? "Internal server error"
      : err.message || "Internal server error";

  res.status(status).json({ message });
}
