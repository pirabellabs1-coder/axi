import { cleanupE2E, clearRateLimits, db } from "./db";

export default async function globalSetup() {
  await cleanupE2E();
  await clearRateLimits();
  await db.$disconnect();
}
