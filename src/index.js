import app from "./app.js";
import { env } from "./config/env.js";
import { ensureDatabaseInitialized } from "./db/init.js";

async function bootstrap() {
  await ensureDatabaseInitialized();

  app.listen(env.PORT, () => {
    console.log(`Server running on http://localhost:${env.PORT}`);
  });
}

bootstrap().catch((error) => {
  console.error("Failed to start server");
  console.error(error);
  process.exit(1);
});
