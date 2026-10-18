"use server";

import { z } from "zod";
import { isStoredMediaUrl } from "@/lib/storage/public-url";
import { checkImageWrite } from "@/lib/storage/write-guard";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { db, type Tx } from "@/lib/db";
import { requireUserOrThrow, requireStore } from "@/lib/auth/permissions";
import { fail, success, parseForm, guard, zBool, zOptionalString, zMoneyText, readMoneyFields, type ActionResult } from "@/lib/action";
import { slugify, normalizePhone, addDays } from "@/lib/utils";
import { currencyDecimals } from "@/lib/money";
import { COUNTRIES, RESERVED_SLUGS, getCountry } from "@/config/site";
import { TRIAL_DAYS, TRIAL_PLAN, ZONE_CURRENCY, zoneForCurrency } from "@/config/plans";
import { coverageMirror, shouldPauseStore } from "@/lib/billing/rules";
import { BILLING_PAUSE_MESSAGE, BILLING_PAUSE_REASON } from "@/lib/billing/pause-copy";
import { getAccountStoresQuota, lockAccountForStoreCreation, storeWithinAccountLimit } from "@/lib/store/account-quota-service";
import { OVER_STORE_LIMIT_REASON, type AccountStoresQuota } from "@/lib/store/account-quota";
import { audit } from "@/lib/audit";
import { enqueue } from "@/lib/jobs";
import { getPreset } from "@/lib/storefront/theme";
import { getGateway } from "@/lib/payments/gateways";
import { CURRENCY_LOCKED_MESSAGE, canChangeStoreCurrency, isStoreCurrency } from "@/lib/currency/store-currencies";

/** Secteurs proposés à la création : l'id sert à la fois de `Store.sector` et de `Store.themeId` (presets de thème). */
const SECTOR_IDS = ["general", "restaurant", "patisserie", "mode", "beaute", "salon", "clinique"] as const;
export type StoreSector = (typeof SECTOR_IDS)[number];

/** Catégorie historique (marketplace, filtres) déduite du secteur. */
const SECTOR_CATEGORY: Record<StoreSector, string> = {
  general: "general",
  restaurant: "food",
  patisserie: "food",
  mode: "fashion",
  beaute: "beauty",
  salon: "beauty",
  clinique: "services",
};

const createSchema = z.object({
  name: z.string().trim().min(2, "Nom trop court").max(60, "60 caractères maximum"),
  slug: z.string().trim().min(3, "Adresse trop courte").max(48, "48 caractères maximum"),
  country: z.string().length(2, "Choisissez un pays"),
  currency: z.string().trim().toUpperCase().refine(isStoreCurrency, "Choisissez une devise proposée"),
  sector: z.enum(SECTOR_IDS, { error: "Choisissez un secteur" }),
  city: zOptionalString,
  doneForYou: zBool,
});

/** Message de refus côté serveur (l'assistant affiche l'écran de paiement avant d'en arriver là). */
function storesQuotaMessage(q: AccountStoresQuota): string {
  const head = `Limite de boutiques atteinte : ${q.used}/${q.limit ?? "illimité"}.`;
  return q.canBuyExtra
    ? `${head} Ajoutez d'abord une place « Boutique en plus » (paiement), puis créez votre boutique.`
    : `${head} Passez au plan Business pour ouvrir d'autres boutiques.`;
}

export async function isSlugAvailable(slug: string): Promise<{ available: boolean; reason?: string }> {
  const s = slugify(slug);
  if (s.length < 3) return { available: false, reason: "3 caractères minimum" };
  if (RESERVED_SLUGS.has(s)) return { available: false, reason: "Ce nom est réservé" };
  const exists = await db.store.findUnique({ where: { slug: s }, select: { id: true } });
  return exists ? { available: false, reason: "Déjà pris" } : { available: true };
}

/**
 * Création d'une boutique (brouillon) : secteur + thème, abonnement (essai Business de 14 jours pour la première
 * boutique du compte, boutiques suivantes couvertes par l'abonnement de la boutique principale ; zone tarifaire
 * déduite de la devise), membership OWNER, moyens de paiement et zone de livraison par défaut.
 */
export async function createStore(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const user = await requireUserOrThrow();
    const parsed = parseForm(createSchema, formData);
    if ("error" in parsed) return parsed.error;
    const { name, country, currency, sector, city, doneForYou } = parsed.data;
    const slug = slugify(parsed.data.slug);
    if (!COUNTRIES.some((c) => c.code === country)) return fail("Pays non pris en charge", { country: ["Pays non pris en charge"] });
    const avail = await isSlugAvailable(slug);
    if (!avail.available) return fail(`Adresse de boutique indisponible : ${avail.reason}`, { slug: [avail.reason ?? ""] });

    // Quota boutiques au niveau du COMPTE : meilleur plan des boutiques possédées + options « Boutique en plus »
    // en vigueur sur toutes ces boutiques. Pré-contrôle ici (message rapide), contrôle faisant foi dans la transaction.
    const pre = await getAccountStoresQuota(user.id);
    if (!pre.allowed) return fail(storesQuotaMessage(pre));
    const isFirstStore = pre.firstStore;
    const c = getCountry(country);
    // Zone tarifaire Axi : suit la DEVISE choisie pour la boutique (plateforme internationale) — une boutique en EUR
    // voit et paie les offres Axi en EUR, une boutique en XOF/XAF en FCFA.
    const zone = zoneForCurrency(currency);
    const billingCurrency = ZONE_CURRENCY[zone];
    const now = new Date();

    const store = await db.$transaction(async (tx) => {
      // Anti-course : deux créations simultanées du même compte sont sérialisées, puis le quota est relu.
      await lockAccountForStoreCreation(tx, user.id);
      const quota = await getAccountStoresQuota(user.id, tx);
      if (!quota.allowed || quota.firstStore !== isFirstStore) return null;
      // Abonnement (plus de plan Gratuit) :
      //  - première boutique du compte : essai TRIAL_PLAN de TRIAL_DAYS jours, sans carte ;
      //  - boutique suivante (place du plan du compte ou option « Boutique en plus ») : COUVERTE par l'abonnement de la
      //    boutique principale du compte (même plan, même essai ou période, même pause) ; aucune facture propre.
      //    Pas de nouvel essai : un compte n'a qu'un essai, la boutique principale porte la facturation.
      const primary = isFirstStore || !quota.primaryStoreId ? null : await tx.subscription.findUnique({ where: { storeId: quota.primaryStoreId } });
      const root = primary?.coveredBySubscriptionId ? await tx.subscription.findUnique({ where: { id: primary.coveredBySubscriptionId } }) : primary;
      // Un seul essai par compte : il n'est accordé qu'à la toute première boutique (aucune boutique possédée, même
      // archivée). Un compte qui a tout archivé puis recrée une boutique démarre SANS plan (en pause), avec le
      // chemin de paiement : pas d'essai illimité par archivage.
      const trial = isFirstStore && !root;
      const noPlan = !root && !trial;
      const s = await tx.store.create({
        data: {
          name,
          slug,
          country,
          city: city || null,
          currency,
          timezone: c.timezone,
          category: SECTOR_CATEGORY[sector],
          sector,
          themeId: sector,
          themeConfig: getPreset(sector).config as unknown as Prisma.InputJsonValue,
          contactEmail: user.email,
          onboardingStep: 1,
          subscription: {
            create: root
              ? { ...coverageMirror(root, now), coveredBySubscriptionId: root.id }
              : trial
                ? { planId: TRIAL_PLAN, status: "TRIALING", zone, currency: billingCurrency, trialEndsAt: addDays(now, TRIAL_DAYS), currentPeriodEnd: addDays(now, TRIAL_DAYS) }
                : { planId: "FREE", status: "PAUSED", pausedAt: now, zone, currency: billingCurrency },
          },
          ...(noPlan ? { status: "PAUSED" as const, statusBeforePause: "DRAFT" as const, statusReason: BILLING_PAUSE_REASON } : {}),
          memberships: { create: { userId: user.id, role: "OWNER" } },
          paymentMethods: {
            create: [{ kind: "CASH_ON_DELIVERY", label: "Paiement à la livraison ou au retrait", instructions: "Réglez en espèces à la réception de votre commande.", position: 0 }],
          },
          deliveryZones: { create: [{ name: city ? `${city} centre` : "Zone 1", fee: currencyDecimals(currency) === 0 ? 1000 : 500, etaLabel: "Sous 24 h", position: 0 }] },
        },
      });
      // Lot 3 : « Dépôt principal » dès la création (majeur n° 8). Sans lui, la boutique n'a aucun dépôt :
      // caisse inutilisable, aucun niveau de stock écrit, puis autant d'écarts d'inventaire que
      // d'articles le jour où le commerçant crée son premier dépôt.
      const { ensureDefaultLocationTx } = await import("@/lib/locations/service");
      await ensureDefaultLocationTx(tx, s.id, { country, city: city || null });
      await audit({ storeId: s.id, actorId: user.id, action: "store.created", metadata: { slug, sector, zone, currency, doneForYou } }, tx);
      return s;
    });
    if (!store) return fail(storesQuotaMessage(await getAccountStoresQuota(user.id)));
    // Sans plan (essai déjà consommé par ce compte) : droit au choix du plan et au paiement.
    if (store.status === "PAUSED") redirect(`/app/${store.id}/abonnement#plans`);
    redirect(doneForYou ? `/app/${store.id}/options?addon=DONE_FOR_YOU` : `/app/${store.id}/demarrage`);
  });
}

const contactSchema = z.object({
  storeId: z.string(),
  whatsappNumber: z.string().trim().min(6, "Numéro WhatsApp requis"),
  contactPhone: zOptionalString,
  contactEmail: z.preprocess((v) => (v === "" ? undefined : v), z.string().email("E-mail invalide").optional()),
  address: zOptionalString,
  tagline: zOptionalString,
});

export async function updateStoreContact(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const parsed = parseForm(contactSchema, formData);
    if ("error" in parsed) return parsed.error;
    const { storeId, ...data } = parsed.data;
    const ctx = await requireStore(storeId, "store.settings");
    const country = getCountry(ctx.store.country);
    const wa = normalizePhone(data.whatsappNumber, country.dialCode);
    if (!wa) return fail("Numéro WhatsApp invalide pour ce pays.", { whatsappNumber: ["Numéro invalide"] });
    await db.store.update({
      where: { id: storeId },
      data: {
        whatsappNumber: wa,
        contactPhone: data.contactPhone ? normalizePhone(data.contactPhone, country.dialCode) ?? data.contactPhone : null,
        contactEmail: data.contactEmail ?? null,
        address: data.address ?? null,
        tagline: data.tagline ?? null,
        onboardingStep: Math.max(ctx.store.onboardingStep, 2),
      },
    });
    revalidatePath(`/app/${storeId}`, "layout");
    return success(undefined, "Coordonnées enregistrées");
  });
}

/* ───────────────────────── Devise de la boutique ───────────────────────── */

const currencySchema = z.object({
  storeId: z.string().min(8).max(64),
  currency: z.string().trim().toUpperCase().refine(isStoreCurrency, "Choisissez une devise proposée"),
});

/**
 * Change la devise de la boutique, uniquement tant qu'elle n'a AUCUNE commande ni carte cadeau (historique
 * comptable). Les montants existants (prix, frais de livraison…) ne sont pas convertis : l'écran le signale.
 * Effets de bord : la devise d'affichage identique est retirée, les passerelles qui n'encaissent pas la nouvelle
 * devise sont désactivées.
 */
export async function changeStoreCurrency(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const parsed = parseForm(currencySchema, formData);
    if ("error" in parsed) return parsed.error;
    const ctx = await requireStore(parsed.data.storeId, "store.settings");
    const storeId = ctx.store.id;
    const from = ctx.store.currency;
    const to = parsed.data.currency;
    if (from === to) return success(undefined, "Devise inchangée");

    const disabled = await db.$transaction(async (tx) => {
      const [orders, giftCards] = await Promise.all([tx.order.count({ where: { storeId } }), tx.giftCard.count({ where: { storeId } })]);
      if (!canChangeStoreCurrency(orders + giftCards)) return null;
      const gateways = await tx.paymentMethod.findMany({ where: { storeId, kind: "GATEWAY", active: true }, select: { id: true, provider: true } });
      const off = gateways.filter((m) => !(m.provider && getGateway(m.provider)?.supportedCurrencies.includes(to))).map((m) => m.id);
      if (off.length) await tx.paymentMethod.updateMany({ where: { storeId, id: { in: off } }, data: { active: false } });
      await tx.storeCurrency.deleteMany({ where: { storeId, currency: to } });
      await tx.store.update({ where: { id: storeId }, data: { currency: to } });
      // Les offres Axi suivent la devise : tant qu'aucun abonnement payant n'est en cours (essai ou pause),
      // la zone et la devise de facturation basculent aussi ; sinon elles changent au prochain changement de plan.
      const zone = zoneForCurrency(to);
      await tx.subscription.updateMany({
        where: { storeId, zone: { not: zone }, coveredBySubscriptionId: null, OR: [{ status: "TRIALING" }, { planId: "FREE" }] },
        data: { zone, currency: ZONE_CURRENCY[zone] },
      });
      await audit({ storeId, actorId: ctx.user.id, action: "store.currency_changed", metadata: { from, to, disabledGateways: off.length } }, tx);
      return off.length;
    });
    if (disabled == null) return fail(CURRENCY_LOCKED_MESSAGE, { currency: ["Devise verrouillée"] });

    revalidatePath(`/app/${storeId}`, "layout");
    revalidatePath(`/s/${ctx.store.slug}`, "layout");
    return success(
      undefined,
      disabled > 0
        ? `Devise changée en ${to}. ${disabled} passerelle${disabled > 1 ? "s" : ""} incompatible${disabled > 1 ? "s" : ""} désactivée${disabled > 1 ? "s" : ""}. Vérifiez vos prix.`
        : `Devise changée en ${to}. Vérifiez vos prix.`,
    );
  });
}

const settingsSchema = z.object({
  storeId: z.string(),
  name: z.string().trim().min(2).max(60),
  tagline: z.preprocess((v) => (v === "" ? undefined : v), z.string().max(160, "160 caractères maximum").optional()),
  description: z.preprocess((v) => (v === "" ? undefined : v), z.string().max(2000, "2 000 caractères maximum").optional()),
  category: z.string().max(60),
  city: z.preprocess((v) => (v === "" ? undefined : v), z.string().max(80).optional()),
  address: z.preprocess((v) => (v === "" ? undefined : v), z.string().max(200).optional()),
  contactEmail: z.preprocess((v) => (v === "" ? undefined : v), z.string().email().optional()),
  contactPhone: zOptionalString,
  whatsappNumber: zOptionalString,
  pickupEnabled: zBool,
  deliveryEnabled: zBool,
  whatsappOrdering: zBool,
  listedInMarketplace: zBool,
  minOrderAmount: zMoneyText, // unités majeures de la devise de la boutique
  orderNotes: z.preprocess((v) => (v === "" ? undefined : v), z.string().max(1000, "1 000 caractères maximum").optional()),
});

export async function updateStoreSettings(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const parsed = parseForm(settingsSchema, formData);
    if ("error" in parsed) return parsed.error;
    const { storeId, ...d } = parsed.data;
    const ctx = await requireStore(storeId, "store.settings");
    const mo = readMoneyFields({ minOrderAmount: d.minOrderAmount }, { minOrderAmount: 0 }, ctx.store.currency);
    if ("error" in mo) return mo.error;
    const country = getCountry(ctx.store.country);
    const wa = d.whatsappNumber ? normalizePhone(d.whatsappNumber, country.dialCode) : null;
    if (d.whatsappNumber && !wa) return fail("Numéro WhatsApp invalide.", { whatsappNumber: ["Numéro invalide"] });
    // Retrait de la marketplace décidé par l'admin : le marchand ne peut pas se relister.
    if (d.listedInMarketplace && ctx.store.marketplaceBlocked) {
      return fail("Votre boutique a été retirée de la marketplace par l'équipe Axi. Contactez le support pour la relister.", { listedInMarketplace: ["Retrait administrateur"] });
    }
    await db.store.update({
      where: { id: storeId },
      data: {
        name: d.name,
        tagline: d.tagline ?? null,
        description: d.description ?? null,
        category: d.category,
        city: d.city ?? null,
        address: d.address ?? null,
        contactEmail: d.contactEmail ?? null,
        contactPhone: d.contactPhone ?? null,
        whatsappNumber: wa,
        pickupEnabled: d.pickupEnabled,
        deliveryEnabled: d.deliveryEnabled,
        whatsappOrdering: d.whatsappOrdering,
        listedInMarketplace: d.listedInMarketplace && !ctx.store.marketplaceBlocked,
        minOrderAmount: mo.values.minOrderAmount ?? 0,
        orderNotes: d.orderNotes ?? null,
      },
    });
    await audit({ storeId, actorId: ctx.user.id, action: "store.settings_updated" });
    revalidatePath(`/app/${storeId}`, "layout");
    revalidatePath(`/s/${ctx.store.slug}`, "layout");
    return success(undefined, "Paramètres enregistrés");
  });
}

const hoursSchema = z.object({ storeId: z.string(), hours: z.string() });

export async function updateOpeningHours(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const parsed = parseForm(hoursSchema, formData);
    if ("error" in parsed) return parsed.error;
    const ctx = await requireStore(parsed.data.storeId, "store.settings");
    let hours: unknown;
    try {
      hours = JSON.parse(parsed.data.hours);
    } catch {
      return fail("Horaires invalides");
    }
    const schema = z.record(z.string(), z.array(z.tuple([z.string().regex(/^\d{2}:\d{2}$/), z.string().regex(/^\d{2}:\d{2}$/)])));
    const v = schema.safeParse(hours);
    if (!v.success) return fail("Horaires invalides");
    await db.store.update({ where: { id: ctx.store.id }, data: { openingHours: v.data as Prisma.InputJsonValue } });
    revalidatePath(`/s/${ctx.store.slug}`, "layout");
    return success(undefined, "Horaires enregistrés");
  });
}

/** La boutique occupe-t-elle une place couverte du compte de son propriétaire (plan + options) ? */
async function withinOwnerLimit(storeId: string): Promise<boolean> {
  const owner = await db.membership.findFirst({ where: { storeId, role: "OWNER" }, select: { userId: true } });
  return !owner || storeWithinAccountLimit(owner.userId, storeId);
}

/**
 * Sortie d'archive : la boutique doit trouver une place libre sur le compte de son propriétaire
 * (verrou du compte + relecture du quota dans la transaction). Renvoie le message de refus, ou null.
 */
async function unarchiveDenied(tx: Tx, storeId: string): Promise<string | null> {
  const owner = await tx.membership.findFirst({ where: { storeId, role: "OWNER" }, select: { userId: true } });
  if (!owner) return null;
  await lockAccountForStoreCreation(tx, owner.userId);
  const q = await getAccountStoresQuota(owner.userId, tx);
  return q.allowed ? null : storesQuotaMessage(q);
}

export async function publishStore(storeId: string): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await requireStore(storeId, "store.publish");
    const s = ctx.store;
    const missing: string[] = [];
    if (!s.whatsappNumber) missing.push("un numéro WhatsApp");
    const products = await db.product.count({ where: { storeId, status: "ACTIVE" } });
    if (products === 0) missing.push("au moins un produit actif");
    const methods = await db.paymentMethod.count({ where: { storeId, active: true } });
    if (methods === 0) missing.push("un moyen de paiement actif");
    if (missing.length) return fail(`Avant de publier, ajoutez ${missing.join(", ")}.`);
    if (s.status === "SUSPENDED") return fail("Boutique suspendue par la plateforme.");
    // En pause, ou sans plan ouvrant droit (essai échu avant le passage du cron) : pas de mise en ligne.
    if (s.status === "PAUSED" || (!!s.subscription && shouldPauseStore(s.subscription))) return fail(BILLING_PAUSE_MESSAGE);
    if (!(await withinOwnerLimit(storeId))) return fail(OVER_STORE_LIMIT_REASON);

    const refused = await db.$transaction(async (tx) => {
      if (s.status === "ARCHIVED") {
        const denied = await unarchiveDenied(tx, storeId);
        if (denied) return denied;
      }
      await tx.store.update({
        where: { id: storeId },
        data: { status: "PUBLISHED", publishedAt: s.publishedAt ?? new Date(), onboardingCompleted: true, onboardingStep: 99, statusReason: null },
      });
      await audit({ storeId, actorId: ctx.user.id, action: "store.published" }, tx);
      await enqueue("store.published", { storeId }, { storeId }, tx);
      return null;
    });
    if (refused) return fail(refused);
    revalidatePath(`/app/${storeId}`, "layout");
    revalidatePath(`/s/${s.slug}`, "layout");
    revalidatePath("/marketplace");
    return success(undefined, "Boutique publiée");
  });
}

export async function setStoreStatus(storeId: string, status: "PUBLISHED" | "CLOSED_TEMPORARILY" | "ARCHIVED", reason?: string): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await requireStore(storeId, status === "ARCHIVED" ? "store.delete" : "store.publish");
    if (ctx.store.status === "SUSPENDED") return fail("Boutique suspendue par la plateforme.");
    // En pause (abonnement) : seule la réouverture par paiement lève la pause ; l'archivage reste possible.
    if ((ctx.store.status === "PAUSED" || (!!ctx.store.subscription && shouldPauseStore(ctx.store.subscription))) && status !== "ARCHIVED") return fail(BILLING_PAUSE_MESSAGE);
    if (status !== "ARCHIVED" && !(await withinOwnerLimit(storeId))) return fail(OVER_STORE_LIMIT_REASON);
    const refused = await db.$transaction(async (tx) => {
      // Désarchivage : la boutique reprend une place du compte → même verrou et même contrôle qu'une création.
      if (ctx.store.status === "ARCHIVED" && status !== "ARCHIVED") {
        const denied = await unarchiveDenied(tx, storeId);
        if (denied) return denied;
      }
      await tx.store.update({ where: { id: storeId }, data: { status, statusReason: reason ?? null, ...(status === "ARCHIVED" ? { statusBeforePause: null } : {}) } });
      await audit({ storeId, actorId: ctx.user.id, action: `store.status.${status.toLowerCase()}`, metadata: { reason } }, tx);
      return null;
    });
    if (refused) return fail(refused);
    revalidatePath(`/app/${storeId}`, "layout");
    revalidatePath(`/s/${ctx.store.slug}`, "layout");
    revalidatePath("/marketplace");
    if (status === "ARCHIVED") redirect("/app");
    return success(undefined, "Statut mis à jour");
  });
}

export async function setOnboardingStep(storeId: string, step: number): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await requireStore(storeId, "store.settings");
    if (step > ctx.store.onboardingStep) await db.store.update({ where: { id: storeId }, data: { onboardingStep: step } });
    revalidatePath(`/app/${storeId}/demarrage`);
    return success();
  });
}

const brandSchema = z.object({ storeId: z.string(), logoUrl: zOptionalString, bannerUrl: zOptionalString });

export async function updateBrandAssets(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const parsed = parseForm(brandSchema, formData);
    if ("error" in parsed) return parsed.error;
    const ctx = await requireStore(parsed.data.storeId, "theme.manage");
    // https ou média téléversé de la boutique ; une ancienne data-URL n'est conservée que si elle est identique
    // à la valeur actuelle (checkImageWrite). Adresses bornées et ancrées.
    const okUrl = (u?: string) => !u || (u.length <= 2000 && /^https:\/\/[^\s"'<>]+$/i.test(u)) || isStoredMediaUrl(u) || u.startsWith("data:");
    if (!okUrl(parsed.data.logoUrl) || !okUrl(parsed.data.bannerUrl)) return fail("URL d'image invalide");
    const logoIssue = checkImageWrite(parsed.data.logoUrl ?? null, { storeId: ctx.store.id, existing: [ctx.store.logoUrl] });
    const bannerIssue = checkImageWrite(parsed.data.bannerUrl ?? null, { storeId: ctx.store.id, existing: [ctx.store.bannerUrl] });
    if (logoIssue || bannerIssue) return fail((logoIssue ?? bannerIssue)!);
    await db.store.update({ where: { id: ctx.store.id }, data: { logoUrl: parsed.data.logoUrl ?? null, bannerUrl: parsed.data.bannerUrl ?? null } });
    revalidatePath(`/app/${ctx.store.id}`, "layout");
    revalidatePath(`/s/${ctx.store.slug}`, "layout");
    return success(undefined, "Images enregistrées");
  });
}
