/**
 * Test setup: isolate the test database BEFORE any Prisma client is imported.
 *
 * The Prisma client singleton (src/prisma.ts) reads DATABASE_URL at import time,
 * so this setup file must run first via vitest.config.ts `setupFiles`.
 *
 * It swaps process.env.DATABASE_URL to TEST_DATABASE_URL so that every test
 * interacts with `expense_test` — never the dev `expense` database.
 */

if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
