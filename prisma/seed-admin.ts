/**
 * Création d'un super-admin plateforme SEUL — pour une mise en production propre (aucune donnée de démo).
 *
 *   DATABASE_URL="<base de prod>" SEED_ADMIN_EMAIL="toi@domaine" SEED_ADMIN_PASSWORD="<fort>" pnpm tsx prisma/seed-admin.ts
 *
 * Idempotent : upsert par e-mail. Contrairement à prisma/seed.ts, ce script tourne en production, mais
 * il EXIGE un e-mail et un mot de passe explicites (jamais de mot de passe par défaut connu).
 * Hachage argon2 identique à src/lib/auth/password.ts.
 */
import { PrismaClient } from "@prisma/client";
import { hash } from "@node-rs/argon2";

type LoadEnvFile = (path?: string) => void;
const loadEnv = (process as unknown as { loadEnvFile?: LoadEnvFile }).loadEnvFile;
if (typeof loadEnv === "function") {
  try {
    loadEnv(".env");
  } catch {
    /* pas de .env */
  }
}

const ARGON_OPTS = { memoryCost: 19456, timeCost: 2, outputLen: 32, parallelism: 1 };

const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.SEED_ADMIN_PASSWORD;

if (!email || !password) {
  console.error("Abandon : définissez SEED_ADMIN_EMAIL et SEED_ADMIN_PASSWORD.");
  process.exit(1);
}
if (password.length < 12) {
  console.error("Abandon : SEED_ADMIN_PASSWORD doit faire au moins 12 caractères.");
  process.exit(1);
}

const db = new PrismaClient();

async function main() {
  const now = new Date();
  const passwordHash = await hash(password!, ARGON_OPTS);
  const user = await db.user.upsert({
    where: { email: email! },
    create: { email: email!, name: "Admin Axi", passwordHash, isPlatformAdmin: true, emailVerifiedAt: now },
    update: { isPlatformAdmin: true, emailVerifiedAt: now, passwordHash },
    select: { id: true, email: true },
  });
  console.log(`Super-admin prêt : ${user.email} (id ${user.id}).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
