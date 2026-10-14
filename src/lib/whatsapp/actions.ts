"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireStore } from "@/lib/auth/permissions";
import { guard, parseForm, fail, success, zBool, zOptionalString, type ActionResult } from "@/lib/action";
import { apiNumberDigits, normalizeWaNumber } from "./phone-sync";
import { getCountry } from "@/config/site";
import { PLANS } from "@/config/plans";
import { encryptSecret } from "@/lib/crypto";
import { audit } from "@/lib/audit";
import { runEmbeddedSignup, requestCoexistenceSyncs, partnerModeConfig, EmbeddedSignupError, type CoexistenceSyncs } from "./embedded-signup";
import { loadWabaCreds, createTemplate, deleteTemplate, TemplateError } from "./templates";

const waSchema = z.object({
  storeId: z.string(),
  whatsappNumber: z.string().trim().min(6, "Numéro WhatsApp requis"),
  whatsappOrdering: zBool,
});

/** Numéro WhatsApp + activation de la commande sur WhatsApp. */
export async function updateWhatsapp(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const parsed = parseForm(waSchema, formData);
    if ("error" in parsed) return parsed.error;
    const ctx = await requireStore(parsed.data.storeId, "store.settings");
    const country = getCountry(ctx.store.country);
    const wa = normalizeWaNumber(parsed.data.whatsappNumber, country.dialCode);
    if (!wa) return fail("Numéro WhatsApp invalide pour ce pays.", { whatsappNumber: ["Numéro invalide"] });
    await db.store.update({ where: { id: ctx.store.id }, data: { whatsappNumber: wa, whatsappOrdering: parsed.data.whatsappOrdering } });
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "store.whatsapp_updated" });
    revalidatePath(`/app/${ctx.store.id}/whatsapp`);
    revalidatePath(`/s/${ctx.store.slug}`, "layout");
    return success(undefined, "WhatsApp enregistré");
  });
}

/**
 * Aligne le numéro « Commander sur WhatsApp » sur le numéro relié à l'API (mode partenaire ou saisie manuelle),
 * pour que les messages des clients arrivent dans la boîte Axi.
 */
export async function alignWhatsappNumberWithApi(storeId: string): Promise<ActionResult<{ number: string }>> {
  return guard(async () => {
    const ctx = await requireStore(storeId, "store.settings");
    const integ = await db.integration.findUnique({ where: { storeId_kind: { storeId: ctx.store.id, kind: "whatsapp_cloud" } }, select: { status: true, config: true } });
    const apiNumber = apiNumberDigits((integ?.config as { displayPhoneNumber?: string } | null)?.displayPhoneNumber);
    if (!integ || integ.status !== "active" || !apiNumber) return fail("Aucun numéro n'est relié à l'API WhatsApp pour le moment.");
    await db.store.update({ where: { id: ctx.store.id }, data: { whatsappNumber: apiNumber } });
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "store.whatsapp_updated", metadata: { source: "api_number" } });
    revalidatePath(`/app/${ctx.store.id}/whatsapp`);
    revalidatePath(`/s/${ctx.store.slug}`, "layout");
    return success({ number: apiNumber }, "Numéro aligné sur celui relié à l'API.");
  });
}

const cloudSchema = z.object({
  storeId: z.string(),
  // Identifiants Meta : numériques uniquement.
  phoneNumberId: z.string().trim().regex(/^\d{5,32}$/, "Identifiant du numéro invalide (chiffres uniquement)"),
  wabaId: z.string().trim().regex(/^\d{5,32}$/, "Identifiant WABA invalide (chiffres uniquement)"),
  token: zOptionalString,
});

/**
 * Enregistre les identifiants WhatsApp Business API (Meta Cloud API).
 * Le token est chiffré au repos et jamais renvoyé. L'intégration passe en « pending » :
 * la validation réelle (webhook signé, numéro vérifié chez Meta) est un point d'intégration du porteur.
 */
export async function saveWhatsappCloud(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const parsed = parseForm(cloudSchema, formData);
    if ("error" in parsed) return parsed.error;
    const ctx = await requireStore(parsed.data.storeId, "integrations.manage");
    if (!PLANS[ctx.planId].features.whatsappApi) {
      return fail(`L'API WhatsApp officielle est incluse à partir du plan Business (plan actuel : ${PLANS[ctx.planId].name}). Changez de plan depuis la page Abonnement.`);
    }

    const existing = await db.integration.findUnique({ where: { storeId_kind: { storeId: ctx.store.id, kind: "whatsapp_cloud" } } });
    if (!parsed.data.token && !existing?.secretsEncrypted) return fail("Le jeton d'accès (token) est requis lors de la première configuration.", { token: ["Requis"] });

    const phoneNumberId = parsed.data.phoneNumberId;
    // M2 : un numéro Meta n'appartient qu'à une boutique (colonne unique Integration.phoneNumberId).
    const taken = phoneNumberId ? await db.integration.findUnique({ where: { phoneNumberId }, select: { storeId: true } }) : null;
    if (taken && taken.storeId !== ctx.store.id) {
      return fail("Ce numéro WhatsApp est déjà connecté à une autre boutique Axi. Contactez le support si vous en êtes le titulaire.", { phoneNumberId: ["Déjà utilisé"] });
    }
    const config: Prisma.InputJsonValue = { phoneNumberId, wabaId: parsed.data.wabaId };
    const secrets = parsed.data.token ? encryptSecret(JSON.stringify({ token: parsed.data.token })) : existing!.secretsEncrypted;
    // Changement de numéro ou de jeton : nouvelle validation par la plateforme (statut « pending »).
    const sameNumber = existing?.phoneNumberId === phoneNumberId;
    const keepActive = existing?.status === "active" && sameNumber && !parsed.data.token;
    try {
      await db.integration.upsert({
        where: { storeId_kind: { storeId: ctx.store.id, kind: "whatsapp_cloud" } },
        create: { storeId: ctx.store.id, kind: "whatsapp_cloud", status: "pending", phoneNumberId, config, secretsEncrypted: secrets },
        update: { config, phoneNumberId, secretsEncrypted: secrets, status: keepActive ? "active" : "pending", lastError: null },
      });
    } catch (e) {
      // Course : le même numéro enregistré au même instant par une autre boutique.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        return fail("Ce numéro WhatsApp est déjà connecté à une autre boutique Axi.", { phoneNumberId: ["Déjà utilisé"] });
      }
      throw e;
    }
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "integration.whatsapp_cloud.saved", metadata: { phoneNumberId: parsed.data.phoneNumberId } });
    revalidatePath(`/app/${ctx.store.id}/whatsapp`);
    return success(undefined, "Identifiants enregistrés. La connexion sera validée par la plateforme.");
  });
}

const esignupSchema = z.object({
  storeId: z.string(),
  code: z.string().trim().min(1, "Code d'autorisation manquant").max(4096),
  // Facultatif : si la fenêtre Meta ne l'a pas renvoyé, le serveur retrouve le numéro du compte (WABA).
  phoneNumberId: z.union([z.literal(""), z.string().trim().regex(/^\d{5,32}$/, "Identifiant du numéro invalide")]).optional(),
  wabaId: z.string().trim().regex(/^\d{5,32}$/, "Identifiant WABA invalide"),
  // « coexistence » : le marchand garde l'app WhatsApp Business sur le même numéro (pas de /register, synchros).
  mode: z.enum(["standard", "coexistence"]).default("standard"),
});

/**
 * Mode partenaire (Embedded Signup) : finalise la connexion à partir du code + des identifiants renvoyés par la
 * fenêtre Meta. Axi (Tech Provider) échange le code, s'abonne à la WABA et enregistre le numéro, puis stocke le
 * jeton chiffré dans la même Integration `whatsapp_cloud` que la saisie manuelle. Le numéro étant vérifié et
 * abonné dans le flux, l'intégration passe directement « active ».
 * Coexistence : après enregistrement de l'intégration (pour que les webhooks de synchro trouvent la boutique),
 * demande une fois la synchro des contacts puis de l'historique ; un échec n'annule pas la connexion, il est
 * tracé dans `config.coexistence` et affiché au marchand.
 */
export async function finishEmbeddedSignup(input: {
  storeId: string;
  code: string;
  phoneNumberId?: string;
  wabaId: string;
  mode?: "standard" | "coexistence";
}): Promise<ActionResult> {
  return guard(async () => {
    const parsed = esignupSchema.safeParse(input);
    if (!parsed.success) return fail(z.flattenError(parsed.error).formErrors[0] ?? "Données de connexion invalides.");
    const { storeId, code, phoneNumberId, wabaId, mode } = parsed.data;
    if (!partnerModeConfig()) return fail("Le mode partenaire WhatsApp n'est pas disponible pour le moment. Utilisez la connexion manuelle.");

    const ctx = await requireStore(storeId, "integrations.manage");
    if (!PLANS[ctx.planId].features.whatsappApi) {
      return fail(`L'API WhatsApp officielle est incluse à partir du plan Business (plan actuel : ${PLANS[ctx.planId].name}). Changez de plan depuis la page Abonnement.`);
    }

    // M2 : un numéro Meta n'appartient qu'à une boutique (colonne unique Integration.phoneNumberId).
    const taken = phoneNumberId ? await db.integration.findUnique({ where: { phoneNumberId }, select: { storeId: true } }) : null;
    if (taken && taken.storeId !== ctx.store.id) {
      return fail("Ce numéro WhatsApp est déjà connecté à une autre boutique Axi. Contactez le support si vous en êtes le titulaire.");
    }

    let result;
    try {
      result = await runEmbeddedSignup({
        code,
        phoneNumberId,
        wabaId,
        mode,
        // Numéro EFFECTIF (après résolution côté Meta), contrôlé avant abonnement / enregistrement.
        assertPhoneAvailable: async (effective) => {
          const owner = await db.integration.findUnique({ where: { phoneNumberId: effective }, select: { storeId: true } });
          if (owner && owner.storeId !== ctx.store.id) {
            throw new EmbeddedSignupError("Ce numéro WhatsApp est déjà connecté à une autre boutique Axi. Contactez le support si vous en êtes le titulaire.");
          }
        },
      });
    } catch (e) {
      if (e instanceof EmbeddedSignupError) {
        // Trace l'échec sur l'intégration (si elle existe) pour affichage ; ne crée rien si elle n'existe pas.
        await db.integration.updateMany({ where: { storeId: ctx.store.id, kind: "whatsapp_cloud" }, data: { lastError: e.message.slice(0, 300) } });
        return fail(`La connexion WhatsApp a échoué. ${e.message}`);
      }
      throw e;
    }

    // Reconnexion du même numéro en coexistence : les synchros déjà demandées ne sont pas redemandées (une seule fois).
    const previous = await db.integration.findUnique({ where: { storeId_kind: { storeId: ctx.store.id, kind: "whatsapp_cloud" } }, select: { phoneNumberId: true, config: true } });
    const previousSyncs =
      previous?.phoneNumberId === result.phoneNumberId ? ((previous.config as { coexistence?: Partial<CoexistenceSyncs> } | null)?.coexistence ?? null) : null;

    const baseConfig = {
      phoneNumberId: result.phoneNumberId,
      wabaId: result.wabaId,
      source: "embedded_signup",
      mode: result.mode,
      ...(result.verifiedName ? { verifiedName: result.verifiedName } : {}),
      ...(result.displayPhoneNumber ? { displayPhoneNumber: result.displayPhoneNumber } : {}),
      ...(result.bizApp ? { bizApp: result.bizApp } : {}),
      connectedAt: new Date().toISOString(),
    };
    const config: Prisma.InputJsonValue = baseConfig;
    // Le jeton n'expire pas (utilisateur système business) ; le PIN sert à une éventuelle réinscription du numéro
    // (absent en coexistence : le numéro reste enregistré dans l'app WhatsApp Business).
    const secrets = encryptSecret(JSON.stringify(result.pin ? { token: result.token, pin: result.pin } : { token: result.token }));
    try {
      await db.integration.upsert({
        where: { storeId_kind: { storeId: ctx.store.id, kind: "whatsapp_cloud" } },
        create: { storeId: ctx.store.id, kind: "whatsapp_cloud", status: "active", phoneNumberId: result.phoneNumberId, config, secretsEncrypted: secrets },
        update: { config, phoneNumberId: result.phoneNumberId, secretsEncrypted: secrets, status: "active", lastError: null },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        return fail("Ce numéro WhatsApp est déjà connecté à une autre boutique Axi.");
      }
      throw e;
    }

    let syncs: CoexistenceSyncs | null = null;
    if (result.mode === "coexistence") {
      syncs = await requestCoexistenceSyncs(result.phoneNumberId, result.token, previousSyncs);
      await db.integration.update({
        where: { storeId_kind: { storeId: ctx.store.id, kind: "whatsapp_cloud" } },
        data: { config: { ...baseConfig, coexistence: syncs } },
      });
    }

    // Renseigne le numéro wa.me s'il est absent avec CE numéro (format international, quel que soit le pays) :
    // les clients qui cliquent « Commander sur WhatsApp » écrivent ainsi au numéro relié à l'API.
    const apiNumber = apiNumberDigits(result.displayPhoneNumber);
    if (!ctx.store.whatsappNumber && apiNumber) {
      await db.store.update({ where: { id: ctx.store.id }, data: { whatsappNumber: apiNumber } });
    }

    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "integration.whatsapp_cloud.connected", metadata: { phoneNumberId: result.phoneNumberId, source: "embedded_signup", mode: result.mode, ...(syncs ? { contactsSync: syncs.contactsSync.slice(0, 80), historySync: syncs.historySync.slice(0, 80) } : {}) } });
    revalidatePath(`/app/${ctx.store.id}/whatsapp`);
    revalidatePath(`/s/${ctx.store.slug}`, "layout");
    if (syncs) {
      const failed = syncs.contactsSync !== "requested" || syncs.historySync !== "requested";
      return success(
        undefined,
        failed
          ? "WhatsApp connecté en coexistence. Une synchronisation (contacts ou historique) n'a pas pu être lancée : détail sur la page WhatsApp."
          : "WhatsApp connecté en coexistence. Vos contacts et votre historique sont en cours d'import ; les messages envoyés depuis votre téléphone apparaîtront aussi dans Axi.",
      );
    }
    return success(undefined, "WhatsApp connecté. Vous pouvez envoyer des messages depuis votre numéro.");
  });
}

const templateSchema = z.object({
  storeId: z.string(),
  name: z
    .string()
    .trim()
    .regex(/^[a-z0-9_]{1,60}$/, "Nom invalide : minuscules, chiffres et « _ » uniquement (60 max)"),
  category: z.enum(["MARKETING", "UTILITY"]),
  language: z.string().trim().regex(/^[a-z]{2}(_[A-Z]{2})?$/, "Code de langue invalide (ex. fr, fr_FR)").default("fr"),
  body: z.string().trim().min(1, "Corps du message requis").max(1024),
  footer: z.string().trim().max(60).optional(),
  headerText: z.string().trim().max(60).optional(),
});

/** Crée un modèle de message WhatsApp et le soumet à Meta pour validation (hors fenêtre de 24 h). */
export async function createWhatsappTemplate(input: {
  storeId: string;
  name: string;
  category: "MARKETING" | "UTILITY";
  language?: string;
  body: string;
  footer?: string;
  headerText?: string;
}): Promise<ActionResult> {
  return guard(async () => {
    const parsed = templateSchema.safeParse(input);
    if (!parsed.success) return fail(z.flattenError(parsed.error).formErrors[0] ?? "Modèle invalide.");
    const { storeId, name, category, language, body, footer, headerText } = parsed.data;
    const ctx = await requireStore(storeId, "integrations.manage");
    if (!PLANS[ctx.planId].features.whatsappApi) {
      return fail(`L'API WhatsApp officielle est incluse à partir du plan Business (plan actuel : ${PLANS[ctx.planId].name}).`);
    }
    const creds = await loadWabaCreds(ctx.store.id);
    if ("error" in creds) return fail(`${creds.error}. Connectez d'abord votre numéro WhatsApp.`);
    try {
      const res = await createTemplate(creds, { name, category, language, body, footer, headerText });
      await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "integration.whatsapp_cloud.template_created", metadata: { name, category, status: res.status } });
      revalidatePath(`/app/${ctx.store.id}/whatsapp/modeles`);
      return success(undefined, "Modèle soumis à Meta. La validation prend généralement quelques minutes à 24 h.");
    } catch (e) {
      if (e instanceof TemplateError) return fail(`Création impossible. ${e.message}`);
      throw e;
    }
  });
}

/** Supprime un modèle de message WhatsApp (par nom) côté Meta. */
export async function deleteWhatsappTemplate(storeId: string, name: string): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await requireStore(storeId, "integrations.manage");
    if (!PLANS[ctx.planId].features.whatsappApi) return fail("Fonction réservée aux plans avec l'API WhatsApp officielle.");
    if (!/^[a-z0-9_]{1,60}$/.test(name)) return fail("Nom de modèle invalide.");
    const creds = await loadWabaCreds(ctx.store.id);
    if ("error" in creds) return fail(creds.error);
    try {
      await deleteTemplate(creds, name);
      await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "integration.whatsapp_cloud.template_deleted", metadata: { name } });
      revalidatePath(`/app/${ctx.store.id}/whatsapp/modeles`);
      return success(undefined, "Modèle supprimé");
    } catch (e) {
      if (e instanceof TemplateError) return fail(`Suppression impossible. ${e.message}`);
      throw e;
    }
  });
}

export async function disconnectWhatsappCloud(storeId: string): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await requireStore(storeId, "integrations.manage");
    await db.integration.deleteMany({ where: { storeId: ctx.store.id, kind: "whatsapp_cloud" } });
    await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "integration.whatsapp_cloud.removed" });
    revalidatePath(`/app/${ctx.store.id}/whatsapp`);
    return success(undefined, "Connexion supprimée");
  });
}
