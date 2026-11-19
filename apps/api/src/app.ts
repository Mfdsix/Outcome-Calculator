import cors from "@fastify/cors";
import Fastify from "fastify";

import { registerAuth } from "./auth.js";
import { loadEnv } from "./env.js";
import { prisma } from "./prisma.js";
import { budgetRoutes } from "./routes/budgets.js";
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

  // NOTE: @fastify/cors defaults to `GET,HEAD,POST` only. The web client
  // also sends PATCH (expense edit) and DELETE (expense/budget remove) with
  // Authorization + JSON bodies, which trigger OPTIONS preflights. Without
  // the explicit list below, every edit/delete replay from the offline
  // outbox dies at preflight (browser "CORS error" → OfflineError status 0
  // → op kept forever, "Menunggu N" badge stuck with zero feedback).
  await app.register(cors, {
    origin: true,
    methods: ["GET", "HEAD", "POST", "PATCH", "DELETE"],
  });
  // Liveness/readiness probe for CI/CD + uptime monitoring. Registered here so
  // it exists regardless of auth setup; the auth hook in auth.ts explicitly
  // exempts it from the bearer-token requirement. Checks the DB too, so a
  // green deploy means the API can actually serve requests.
  app.get("/api/health", async (_request, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return {
        status: "ok",
        commit: process.env.GIT_COMMIT ?? "unknown",
        uptime: Math.round(process.uptime()),
      };
    } catch {
      return reply.code(503).send({ status: "db_down" });
    }
  });

  registerAuth(app, env.jwtSecret);
  await app.register(expenseRoutes, { prisma, appTimezone });
  await app.register(budgetRoutes, { prisma, appTimezone });

  return app;
}

export type AppInstance = Awaited<ReturnType<typeof buildApp>>;
