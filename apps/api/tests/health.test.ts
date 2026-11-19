import { beforeAll, describe, expect, it } from "vitest";

import { buildApp, type AppInstance } from "../src/app.js";

/**
 * Health probe regression test (CI/CD deploy gate).
 *
 * `scripts/deploy.sh` refuses to finish unless this endpoint returns 200.
 * The auth hook rejects every /api/* route without a bearer token, so if the
 * /api/health exemption in registerAuth ever regresses the deploy would fail
 * with a 401 — after the stack is already rebuilt. Pinning it here catches
 * that before it reaches the VPS.
 */
describe("GET /api/health", () => {
  let app: AppInstance;
  beforeAll(async () => {
    app = await buildApp({ logger: false });
  });

  it("is public (no bearer token) and reports ok with DB reachable", async () => {
    const response = await app.inject({ method: "GET", url: "/api/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "ok" });
  });

  it("tolerates a query string (probe tools append cache busters)", async () => {
    const response = await app.inject({ method: "GET", url: "/api/health?ts=1" });

    expect(response.statusCode).toBe(200);
  });

  it("does not make other API routes public", async () => {
    const response = await app.inject({ method: "GET", url: "/api/expenses" });

    expect(response.statusCode).toBe(401);
  });
});
