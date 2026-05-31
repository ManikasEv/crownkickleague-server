import app from "../src/app.js";
import { ensureDatabaseInitialized } from "../src/db/init.js";

export default async function handler(req, res) {
  await ensureDatabaseInitialized();
  return app(req, res);
}
