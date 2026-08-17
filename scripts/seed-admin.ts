/**
 * Seeds the single builder admin User row from ADMIN_EMAIL / ADMIN_PASSWORD.
 *
 * ADMIN_PASSWORD is read as plaintext only here, only long enough to hash
 * it — it is never persisted, logged, or exposed anywhere else. Only the
 * bcrypt hash is written to the database.
 *
 * Usage: npm run seed:admin
 */
// DATABASE_URL / ADMIN_EMAIL / ADMIN_PASSWORD are loaded from .env.local via
// node's --env-file flag (see the "seed:admin" script in package.json) —
// this runs before any module code, so it's safe even though lib/prisma.ts
// reads process.env.DATABASE_URL at import time.
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma";

const BCRYPT_ROUNDS = 12;

async function main() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;

  if (!email) {
    throw new Error("ADMIN_EMAIL is not set.");
  }
  if (!password) {
    throw new Error("ADMIN_PASSWORD is not set.");
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  const user = await prisma.user.upsert({
    where: { email },
    update: { passwordHash },
    create: { email, passwordHash },
  });

  console.log(`Admin user ready: ${user.email} (id: ${user.id})`);
}

main()
  .catch((err) => {
    console.error("Failed to seed admin user:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
