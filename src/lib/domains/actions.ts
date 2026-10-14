"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { resolveTxt } from "node:dns/promises";
import { db } from "@/lib/db";
import { requireStore } from "@/lib/auth/permissions";
import { guard, parseForm, fail, success, type ActionResult } from "@/lib/action";
import { PLANS } from "@/config/plans";
import { RESERVED_SLUGS, SITE } from "@/config/site";
import { slugify, randomToken } from "@/lib/utils";
import { audit } from "@/lib/audit";
import { UNVERIFIED_DOMAIN_TTL_DAYS, domainExpired, expiredDomainsWhere } from "./expiry";

const slugSchema = z.object({ storeId: z.string(), slug: z.string().trim().min(3, "3 caractères minimum").max(48) });

/** Change l'adresse {slug}.{domaine}. L'ancien lien ne fonctionnera plus. */
export async function changeSlug(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const parsed = parseForm(slugSchema, formData);
    if ("error" in parsed) return parsed.error;
    const ctx = await requireStore(parsed.data.storeId, "store.settings");
    const slug = slugify(parsed.data.slug);
    if (slug.length < 3) return fail("Adresse trop courte (3 caractères minimum).", { slug: ["Trop courte"] });
    if (RESERVED_SLUGS.has(slug)) return fail("Ce nom est réservé.", { slug: ["Réservé"] });
    if (slug === ctx.store.slug) return success(undefined, "Adresse inchangée");
    const exists = await db.store.findUnique({ where: { slug }, select: { id: true } });
    if (exists) return fail("Cette adresse est déjà prise.", { slug: ["Déjà prise"] });
    await db.$transaction(async (tx) => {
      await tx.store.update({ where: { id: ctx.store.id }, data: { slug } });
      await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "store.slug_changed", metadata: { from: ctx.store.slug, to: slug } }, tx);
    });
    revalidatePath(`/app/${ctx.store.id}`, "layout");
    revalidatePath(`/s/${ctx.store.slug}`, "layout");
    revalidatePath(`/s/${slug}`, "layout");
    return success(undefined, `Nouvelle adresse : ${slug}.${SITE.domain}`);
  });
}

const CUSTOM_DOMAIN_UPSELL = "Le domaine personnalisé est inclus à partir du plan Business.";

const HOSTNAME_RE = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;
const hostSchema = z.object({ storeId: z.string(), hostname: z.string().trim().toLowerCase().max(253) });

export async function addDomain(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const parsed = parseForm(hostSchema, formData);
    if ("error" in parsed) return parsed.error;
    const ctx = await requireStore(parsed.data.storeId, "store.settings");
    if (!PLANS[ctx.planId].features.customDomain) return fail(CUSTOM_DOMAIN_UPSELL);
    const hostname = parsed.data.hostname.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (!HOSTNAME_RE.test(hostname)) return fail("Nom de domaine invalide (ex. boutique.mondomaine.com).", { hostname: ["Format invalide"] });
    const appDomain = SITE.domain.split(":")[0];
    if (hostname === appDomain || hostname.endsWith(`.${appDomain}`)) return fail(`Utilisez votre propre domaine, pas ${appDomain}.`, { hostname: ["Domaine Axi réservé"] });
    // Domaines non vérifiés après UNVERIFIED_DOMAIN_TTL_DAYS jours : libérés (pas de squat d'un nom d'hôte).
    await db.domain.deleteMany({ where: { storeId: ctx.store.id, ...expiredDomainsWhere() } });
    const count = await db.domain.count({ where: { storeId: ctx.store.id } });
    if (count >= 3) return fail("Maximum 3 domaines par boutique.");
    const exists = await db.domain.findUnique({ where: { hostname } });
    if (exists && domainExpired(exists)) {
      await db.domain.deleteMany({ where: { id: exists.id, verified: false } });
      await audit({ storeId: exists.storeId, action: "domain.expired", metadata: { hostname, reason: `non vérifié sous ${UNVERIFIED_DOMAIN_TTL_DAYS} jours` } });
    } else if (exists) {
      return fail("Ce domaine est déjà rattaché à une boutique.", { hostname: ["Déjà utilisé"] });
    }
    await db.domain.create({ data: { storeId: ctx.store.id, hostname, verifyToken: `axi-verify-${randomToken(16)}`, isPrimary: count === 0 } });
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "domain.added", metadata: { hostname } });
    revalidatePath(`/app/${ctx.store.id}/domaine`);
    return success(undefined, "Domaine ajouté. Configurez vos DNS puis vérifiez.");
  });
}

/** Vérification DNS : le TXT `_axi-verify.{hostname}` doit contenir le jeton. */
export async function verifyDomain(storeId: string, id: string): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await requireStore(storeId, "store.settings");
    if (!PLANS[ctx.planId].features.customDomain) return fail(CUSTOM_DOMAIN_UPSELL);
    const domain = await db.domain.findFirst({ where: { id, storeId: ctx.store.id } });
    if (!domain) return fail("Domaine introuvable.");
    if (domainExpired(domain)) {
      await db.domain.deleteMany({ where: { id: domain.id, verified: false } });
      await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "domain.expired", metadata: { hostname: domain.hostname } });
      revalidatePath(`/app/${ctx.store.id}/domaine`);
      return fail(`Ce domaine n'a pas été vérifié dans les ${UNVERIFIED_DOMAIN_TTL_DAYS} jours : il a été libéré. Ajoutez-le à nouveau pour obtenir un nouveau jeton.`);
    }
    let records: string[] = [];
    try {
      const txt = await resolveTxt(`_axi-verify.${domain.hostname}`);
      records = txt.map((chunks) => chunks.join(""));
    } catch (e) {
      const code = (e as { code?: string }).code;
      return fail(code === "ENOTFOUND" || code === "ENODATA" ? "Enregistrement TXT introuvable. La propagation DNS peut prendre jusqu'à 24 h." : `Résolution DNS impossible (${code ?? "erreur"}). Réessayez plus tard.`);
    }
    const ok = records.some((r) => r.trim() === domain.verifyToken);
    if (!ok) return fail(`Le TXT trouvé ne correspond pas au jeton attendu (${records.length} enregistrement(s) lu(s)).`);
    await db.domain.update({ where: { id: domain.id }, data: { verified: true } });
    await db.integration.upsert({
      where: { storeId_kind: { storeId: ctx.store.id, kind: "custom_domain" } },
      create: { storeId: ctx.store.id, kind: "custom_domain", status: "active", config: { hostname: domain.hostname } },
      update: { status: "active", config: { hostname: domain.hostname }, lastError: null },
    });
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "domain.verified", metadata: { hostname: domain.hostname } });
    revalidatePath(`/app/${ctx.store.id}/domaine`);
    return success(undefined, "Domaine vérifié. Il affiche votre boutique dès que le CNAME pointe vers Axi.");
  });
}

export async function deleteDomain(storeId: string, id: string): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await requireStore(storeId, "store.settings");
    const d = await db.domain.findFirst({ where: { id, storeId: ctx.store.id } });
    if (!d) return fail("Domaine introuvable.");
    await db.domain.delete({ where: { id: d.id } });
    const remaining = await db.domain.count({ where: { storeId: ctx.store.id, verified: true } });
    if (remaining === 0) await db.integration.deleteMany({ where: { storeId: ctx.store.id, kind: "custom_domain" } });
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "domain.removed", metadata: { hostname: d.hostname } });
    revalidatePath(`/app/${ctx.store.id}/domaine`);
    return success(undefined, "Domaine retiré");
  });
}
