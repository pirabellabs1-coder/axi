/**
 * TEST : connecte le numéro de test WhatsApp (Meta) à une boutique et active l'intégration,
 * pour valider la réception des messages entrants dans la boîte de la boutique.
 *
 *   DATABASE_URL="<session 5432>" APP_SECRET="<prod>" \
 *     WA_STORE_SLUG=boutique-test-1 WA_PHONE_ID=... WA_WABA_ID=... WA_TOKEN=placeholder \
 *     node --conditions=react-server --import tsx prisma/connect-wa-test.ts
 *
 * Le jeton est chiffré au repos (encryptSecret / APP_SECRET), comme via l'UI. Pour l'ENTRANT, le jeton
 * n'est pas utilisé (le webhook route par phoneNumberId et vérifie la signature avec WHATSAPP_APP_SECRET).
 */
import { PrismaClient, type Prisma } from "@prisma/client";
import { encryptSecret } from "../src/lib/crypto";

const slug = process.env.WA_STORE_SLUG ?? "boutique-test-1";
const phoneNumberId = process.env.WA_PHONE_ID ?? "";
const wabaId = process.env.WA_WABA_ID ?? "";
const token = process.env.WA_TOKEN ?? "PLACEHOLDER_INBOUND_ONLY";

if (!/^\d{5,32}$/.test(phoneNumberId) || !/^\d{5,32}$/.test(wabaId)) {
  console.error("WA_PHONE_ID et WA_WABA_ID doivent être numériques.");
  process.exit(1);
}

const db = new PrismaClient();

async function main() {
  const store = await db.store.findUnique({ where: { slug }, select: { id: true, name: true } });
  if (!store) {
    console.error(`Boutique introuvable : ${slug}`);
    process.exit(1);
  }
  const taken = await db.integration.findUnique({ where: { phoneNumberId }, select: { storeId: true } });
  if (taken && taken.storeId !== store.id) {
    console.error("Ce numéro est déjà rattaché à une autre boutique.");
    process.exit(1);
  }
  const config: Prisma.InputJsonValue = { phoneNumberId, wabaId };
  const secretsEncrypted = encryptSecret(JSON.stringify({ token }));
  await db.integration.upsert({
    where: { storeId_kind: { storeId: store.id, kind: "whatsapp_cloud" } },
    create: { storeId: store.id, kind: "whatsapp_cloud", status: "active", phoneNumberId, config, secretsEncrypted },
    update: { status: "active", phoneNumberId, config, secretsEncrypted, lastError: null },
  });
  console.log(`Intégration WhatsApp ACTIVE pour « ${store.name} » (${slug}) · phoneNumberId ${phoneNumberId}.`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
