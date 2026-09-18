import cors from "@fastify/cors";
import Fastify from "fastify";

import { registerAuth } from "./auth.js";
import { loadEnv } from "./env.js";
import { prisma } from "./prisma.js";
import { expenseRoutes } from "./routes/expenses.js";

export interface BuildAppOptions {
  /** Override the app timezone (used by tests); defaults to APP_TIMEZONE env. */
  appTimezone?: string;
  logger?: boolean;
}

/** Build the Fastify instance. Stateless — no in-memory session or cache. */
export async function buildApp(options: BuildAppOptions = {}) {
  const env = loadEnv();
  const appTimezone = options.appTimezone ?? env.appTimezone;

  const app = Fastify({ logger: options.logger ?? false });

  await app.register(cors, { origin: true });
  registerAuth(app, env.jwtSecret);
  await app.register(expenseRoutes, { prisma, appTimezone });

  return app;
}

export type AppInstance = Awaited<ReturnType<typeof buildApp>>;
