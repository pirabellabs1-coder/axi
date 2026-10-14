import { cleanupE2E, clearRateLimits, db } from "./db";

export default async function globalTeardown() {
  if (process.env.E2E_KEEP_DATA !== "1") await cleanupE2E();
  await clearRateLimits();
  await db.$disconnect();
}
