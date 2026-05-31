import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  CLIENT_URL: z.string().url(),
  DATABASE_URL: z.string().min(1),
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().min(1),
  CLERK_PUBLISHABLE_KEY: z.string().optional(),
  CLERK_SECRET_KEY: z.string().min(1),
  LIVE_DATA_PROVIDER: z.enum(["football-data", "worldcupapi", "api-football"]).default("football-data"),
  FOOTBALL_DATA_BASE_URL: z.string().url().optional(),
  FOOTBALL_DATA_TOKEN: z.string().optional(),
  FOOTBALL_DATA_COMPETITION_CODE: z.string().default("WC"),
  FOOTBALL_DATA_SEASON: z.coerce.number().default(2026),
  WORLDCUP_API_BASE_URL: z.string().url().optional(),
  WORLDCUP_API_KEY: z.string().optional(),
  ODDS_PROVIDER: z.enum(["none", "api-football"]).default("api-football"),
  ODDS_CACHE_TTL_SECONDS: z.coerce.number().int().min(10).max(3600).default(180),
  FOOTBALL_API_BASE_URL: z.string().url().optional(),
  FOOTBALL_API_KEY: z.string().optional(),
  FOOTBALL_API_HOST: z.string().optional(),
  FOOTBALL_API_LEAGUE_ID: z.coerce.number().optional(),
  FOOTBALL_API_SEASON: z.coerce.number().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

if (!process.env.CLERK_PUBLISHABLE_KEY) {
  process.env.CLERK_PUBLISHABLE_KEY = parsed.data.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
}

export const env = parsed.data;
