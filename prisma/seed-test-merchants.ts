/**
 * Création de comptes MARCHANDS de test (user vérifié + boutique) sur la prod, SANS données de démo
 * (ni produits, ni commandes). Reproduit la transaction de `createStore` (src/lib/store/actions.ts) :
 * boutique + abonnement d'essai (première boutique = essai Business) + membership OWNER + moyen de
 * paiement + zone de livraison + dépôt principal.
 *
 *   DATABASE_URL="<session 5432>" pnpm tsx prisma/seed-test-merchants.ts
 *
 * Idempotent : user upsert par e-mail, boutique créée seulement si le slug est libre. Les mots de passe
 * générés sont affichés UNE fois sur la sortie standard.
 */
import { PrismaClient, type Prisma } from "@prisma/client";
import { hash } from "@node-rs/argon2";
import { randomBytes } from "node:crypto";
import { getCountry, RESERVED_SLUGS } from "../src/config/site";
import { TRIAL_DAYS, TRIAL_PLAN, ZONE_CURRENCY, zoneForCurrency } from "../src/config/plans";
import { slugify, addDays } from "../src/lib/utils";
import { getPreset } from "../src/lib/storefront/theme";
import { ensureDefaultLocationTx } from "../src/lib/locations/service";

const ARGON_OPTS = { memoryCost: 19456, timeCost: 2, outputLen: 32, parallelism: 1 };

type Spec = { email: string; name: string; storeName: string; slug: string; country: string; sector: string; city: string };

const MERCHANTS: Spec[] = [
  { email: "marchand1@test.axi.africa", name: "Marchand Test 1", storeName: "Boutique Test 1", slug: "boutique-test-1", country: "BJ", sector: "general", city: "Cotonou" },
  { email: "marchand2@test.axi.africa", name: "Marchand Test 2", storeName: "Boutique Test 2", slug: "boutique-test-2", country: "BJ", sector: "mode", city: "Cotonou" },
  { email: "marchand3@test.axi.africa", name: "Marchand Test 3", storeName: "Boutique Test 3", slug: "boutique-test-3", country: "CI", sector: "restaurant", city: "Abidjan" },
];

const SECTOR_CATEGORY: Record<string, string> = {
  general: "general", restaurant: "food", patisserie: "food", mode: "fashion", beaute: "beauty", salon: "beauty", clinique: "services",
};

function genPassword(): string {
  return "Test-" + randomBytes(9).toString("base64url") + "-2026";
}

const db = new PrismaClient();

async function main() {
  const now = new Date();
  const results: { email: string; password: string; slug: string; storeId: string | null; note?: string }[] = [];

  for (const m of MERCHANTS) {
    const slug = slugify(m.slug);
    const password = genPassword();
    const passwordHash = await hash(password, ARGON_OPTS);

    const user = await db.user.upsert({
      where: { email: m.email },
      create: { email: m.email, name: m.name, passwordHash, emailVerifiedAt: now },
      update: { name: m.name, passwordHash, emailVerifiedAt: now },
      select: { id: true, email: true },
    });

    if (RESERVED_SLUGS.has(slug)) { results.push({ email: m.email, password, slug, storeId: null, note: "slug réservé — boutique non créée" }); continue; }
    const existing = await db.store.findUnique({ where: { slug }, select: { id: true } });
    if (existing) { results.push({ email: m.email, password, slug, storeId: existing.id, note: "boutique déjà existante — inchangée" }); continue; }

    const c = getCountry(m.country);
    const zone = zoneForCurrency(c.currency);
    const billingCurrency = ZONE_CURRENCY[zone];

    const store = await db.$transaction(async (tx) => {
      const s = await tx.store.create({
        data: {
          name: m.storeName,
          slug,
          country: m.country,
          city: m.city || null,
          currency: c.currency,
          timezone: c.timezone,
          category: SECTOR_CATEGORY[m.sector] ?? "general",
          sector: m.sector,
          themeId: m.sector,
          themeConfig: getPreset(m.sector).config as unknown as Prisma.InputJsonValue,
          contactEmail: user.email,
          onboardingStep: 1,
          subscription: {
            // Plus de plan Gratuit : chaque boutique de test démarre par un essai (données de test indépendantes).
            create: { planId: TRIAL_PLAN, status: "TRIALING", zone, currency: billingCurrency, trialEndsAt: addDays(now, TRIAL_DAYS), currentPeriodEnd: addDays(now, TRIAL_DAYS) },
          },
          memberships: { create: { userId: user.id, role: "OWNER" } },
          paymentMethods: {
            create: [{ kind: "CASH_ON_DELIVERY", label: "Paiement à la livraison ou au retrait", instructions: "Réglez en espèces à la réception de votre commande.", position: 0 }],
          },
          deliveryZones: { create: [{ name: m.city ? `${m.city} centre` : "Zone 1", fee: c.currency === "XOF" || c.currency === "XAF" ? 1000 : 500, etaLabel: "Sous 24 h", position: 0 }] },
        },
      });
      await ensureDefaultLocationTx(tx, s.id, { country: m.country, city: m.city || null });
      return s;
    });

    results.push({ email: m.email, password, slug, storeId: store.id });
  }

  console.log("\n=== Comptes marchands de test ===");
  for (const r of results) {
    console.log(`${r.email}  |  ${r.password}  |  /${r.slug}${r.storeId ? `  (store ${r.storeId})` : ""}${r.note ? `  [${r.note}]` : ""}`);
  }
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => db.$disconnect());
