import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { pool } from "../config/db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
let initializationPromise = null;

export async function initializeDatabase() {
  const schemaPath = path.join(__dirname, "schema.sql");
  const sql = await readFile(schemaPath, "utf8");
  await pool.query(sql);
}

export async function ensureDatabaseInitialized() {
  if (!initializationPromise) {
    initializationPromise = initializeDatabase().catch((error) => {
      initializationPromise = null;
      throw error;
    });
  }
  await initializationPromise;
}
