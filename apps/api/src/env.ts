import { isValidTimeZone, pinSchema } from "@expense-app/shared";

/**
 * Environment for the API (spec §30). Values come from process.env, which is
 * populated from apps/api/.env via dotenv in server.ts / tests setup.
 */
export interface ApiEnv {
  databaseUrl: string;
  port: number;
  appTimezone: string;
  /** HMAC secret for pin lookup + token signing. Never leaves the server. */
  jwtSecret: string;
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): ApiEnv {
  const databaseUrl = source.DATABASE_URL ?? "";
  const port = Number.parseInt(source.PORT ?? "3000", 10);
  const appTimezone = source.APP_TIMEZONE ?? "Asia/Jakarta";

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required. Copy .env.example to .env and configure it.");
  }
  if (!Number.isFinite(port)) {
    throw new Error(`PORT must be a number, received: ${source.PORT}`);
  }
  if (!isValidTimeZone(appTimezone)) {
    throw new Error(`APP_TIMEZONE is not a valid IANA time zone: ${appTimezone}`);
  }

  // Breaking by design: APP_ACCESS_CODE is gone. All old tokens are dead and
  // every device re-logins with its PIN once.
  const jwtSecret = (source.APP_JWT_SECRET ?? "").trim();
  if (jwtSecret.length < 32) {
    throw new Error(
      "APP_JWT_SECRET is required (min 32 chars). Generate once: openssl rand -hex 32",
    );
  }

  return { databaseUrl, port, appTimezone, jwtSecret };
}
