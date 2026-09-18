import "dotenv/config";

import { buildApp } from "./app.js";
import { closeDb, ensureDatabaseConstraints, prisma } from "./prisma.js";

async function main(): Promise<void> {
  const app = await buildApp({ logger: true });
  await ensureDatabaseConstraints(prisma);

  const port = Number(process.env.PORT ?? 3000);
  await app.listen({ port, host: "0.0.0.0" });

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, async () => {
      await app.close();
      await closeDb();
      process.exit(0);
    });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
