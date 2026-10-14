"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { guard, parseForm, fail, success, type ActionResult } from "@/lib/action";
import { clientIp, rateLimit, rateLimitMessage } from "@/lib/rate-limit";

/** Champ honeypot : rempli uniquement par les robots. */
const zHoneypot = z.preprocess((v) => (v === "" ? undefined : v), z.string().optional());

const zEmail = z.email("Adresse e-mail invalide").trim().toLowerCase().max(120, "Adresse trop longue");

const contactSchema = z.object({
  name: z.string().trim().min(2, "Indiquez votre nom").max(80, "Nom trop long"),
  email: zEmail,
  subject: z.string().trim().min(3, "Choisissez un sujet").max(120, "Sujet trop long"),
  message: z.string().trim().min(20, "Décrivez votre demande en quelques phrases (20 caractères minimum)").max(4000, "Message trop long (4 000 caractères maximum)"),
  storeName: z.preprocess((v) => (v === "" ? undefined : v), z.string().trim().max(80, "Nom de boutique trop long").optional()),
  website: zHoneypot,
});

/** Formulaire de contact public → crée un SupportTicket (sans compte requis). */
export async function submitContact(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const parsed = parseForm(contactSchema, formData);
    if ("error" in parsed) return parsed.error;
    const { name, email, subject, message, storeName, website } = parsed.data;

    // Robot détecté : on répond comme si tout allait bien, sans rien enregistrer.
    if (website) return success(undefined, "Message envoyé");

    const rl = await rateLimit(`contact:ip:${await clientIp()}`, 5, 3600);
    if (!rl.ok) return fail(rateLimitMessage(rl.retryAfter));

    const body = [storeName ? `Boutique : ${storeName}` : null, `Nom : ${name}`, "", message].filter((l) => l !== null).join("\n");

    await db.supportTicket.create({
      data: { email, subject: subject.slice(0, 120), message: body },
    });

    return success(undefined, "Message envoyé. Nous vous répondons sous 24 h ouvrées.");
  });
}

const leadSchema = z.object({
  email: zEmail,
  source: z.preprocess((v) => (v === "" ? undefined : v), z.string().trim().max(40).optional()),
  website: zHoneypot,
});

/** Inscription à la liste d'information (newsletter / nouveautés). */
export async function subscribeLead(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const parsed = parseForm(leadSchema, formData);
    if ("error" in parsed) return parsed.error;
    const { email, source, website } = parsed.data;
    if (website) return success(undefined, "Inscription enregistrée");

    const rl = await rateLimit(`lead:ip:${await clientIp()}`, 10, 3600);
    if (!rl.ok) return fail(rateLimitMessage(rl.retryAfter));

    try {
      await db.lead.upsert({
        where: { email },
        update: {},
        create: { email, source: source ?? "site" },
      });
    } catch (e) {
      console.error("[subscribeLead]", e);
      return fail("Impossible d'enregistrer votre adresse pour le moment. Réessayez plus tard.");
    }

    return success(undefined, "C'est noté. Vous recevrez les nouveautés Axi par e-mail.");
  });
}
