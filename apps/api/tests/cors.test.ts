import { beforeAll, describe, expect, it } from "vitest";

import { buildApp, type AppInstance } from "../src/app.js";

/**
 * CORS preflight regression test (issue: stuck "Menunggu N" badge).
 *
 * @fastify/cors defaults to `GET,HEAD,POST`. The web client also sends
 * PATCH (expense edit) and DELETE (expense/budget remove) with
 * Authorization + JSON bodies, which trigger OPTIONS preflights. If PATCH /
 * DELETE ever drop out of Access-Control-Allow-Methods again, every
 * edit/delete replay from the offline outbox dies at preflight in the
 * browser (fetch throws → OfflineError status 0 → op kept forever, badge
 * stuck, zero user feedback) while GET/POST keep working — exactly the
 * silent-stuck symptom. This test pins the full method list.
 */
describe("CORS preflight", () => {
  let app: AppInstance;
  beforeAll(async () => {
    app = await buildApp({ logger: false });
  });

  const preflightCases = [
    { method: "GET", url: "/api/expenses" },
    { method: "POST", url: "/api/expenses" },
    { method: "PATCH", url: "/api/expenses/some-id" },
    { method: "DELETE", url: "/api/expenses/some-id" },
    { method: "DELETE", url: "/api/budgets/active" },
  ] as const;

  for (const { method, url } of preflightCases) {
    it(`OPTIONS ${method} ${url} → 204 with method allowed + origin echoed`, async () => {
      const response = await app.inject({
        method: "OPTIONS",
        url,
        headers: {
          origin: "http://localhost:5173",
          "access-control-request-method": method,
          "access-control-request-headers": "authorization,content-type",
        },
      });

      expect(response.statusCode).toBe(204);
      expect(response.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
      const allowed = String(response.headers["access-control-allow-methods"] ?? "");
      const methods = allowed.split(",").map((part) => part.trim());
      expect(methods).toContain(method);
    });
  }
});
