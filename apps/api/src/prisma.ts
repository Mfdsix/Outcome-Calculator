import { PrismaClient } from "@prisma/client";

/**
 * Stateless Prisma client singleton (spec §12). One instance per process; the
 * Fastify app receives it via dependency injection so tests can share it too.
 */
export const prisma = new PrismaClient();

export async function closeDb(): Promise<void> {
  await prisma.$disconnect();
}

/**
 * Idempotently apply database-level guarantees that the Prisma schema cannot
 * express (spec §13): amount must be strictly positive.
 */
export async function ensureDatabaseConstraints(client: PrismaClient): Promise<void> {
  await client.$executeRaw`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'expenses_amount_positive'
      ) THEN
        ALTER TABLE expenses
          ADD CONSTRAINT expenses_amount_positive CHECK (amount > 0);
      END IF;
    END
    $$;
  `;
}
