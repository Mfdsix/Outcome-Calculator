import "dotenv/config";

import { normalizePin } from "@expense-app/shared";
import { PrismaClient } from "@prisma/client";
import { createHmac, randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
) => Promise<Buffer>;

/**
 * One-off adoption script (plan §4 step 2). Gives the 254 legacy expenses
 * (rows with no owner from before per-user data) to the PIN identity named
 * via the ADOPT_PIN env var. Run between db:push #1 (userId optional) and
 * db:push #2 (userId required).
 *
 * The PIN is read from the environment ONLY — it must not be committed,
 * logged, or passed as a CLI argument (shell history).
 *
 *   ADOPT_PIN=ABC123 tsx prisma/adopt.ts
 */
async function main(): Promise<void> {
  const raw = process.env.ADOPT_PIN ?? "";
  const pin = normalizePin(raw);
  if (!/^[A-Z0-9]{6}$/.test(pin)) {
    console.error("ADOPT_PIN must be set to the 6-character PIN that will own the legacy rows.");
    process.exit(1);
  }

  const secret = (process.env.APP_JWT_SECRET ?? "").trim();
  if (!secret) {
    console.error("APP_JWT_SECRET must be set (same value as the API uses).");
    process.exit(1);
  }

  const prisma = new PrismaClient();

  try {
    const lookup = createHmac("sha256", secret).update(`pin-lookup\u0000${pin}`).digest("hex");

    // Find-or-create the target user.
    let user = await prisma.user.findUnique({ where: { pinLookup: lookup } });
    if (!user) {
      const salt = randomBytes(16);
      const derived = await scrypt(pin, salt, 32);
      const pinHash = `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
      user = await prisma.user.create({ data: { pinLookup: lookup, pinHash } });
      console.log("Created user for ADOPT_PIN.");
    } else {
      console.log("Found existing user for ADOPT_PIN.");
    }

    // Adopt every orphaned legacy row. updateMany (not update) so no re-read
    // race can crash the run; NULL user_id only exists between the two pushes
    // (push-1 made the column optional), hence the cast — the generated
    // client types userId as required for the final schema.
    const adoptOptions = {
      data: { userId: user.id },
      where: { userId: null },
    } as unknown as Parameters<PrismaClient["expense"]["updateMany"]>[0];
    const result = await prisma.expense.updateMany(adoptOptions);

    console.log(`Adopted ${result.count} legacy expense(s) into PIN space ${user.id}.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
