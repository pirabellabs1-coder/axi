import "server-only";
import type { OtpChannel } from "@prisma/client";
import { db } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import { debitCredits, refundCredits } from "@/lib/credits";
import { sendMail } from "@/lib/email";
import { audit } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";
import { BUYER_KILL_SWITCH_KEY, freeDailyPerStore, neutralStoreName, platformDailyBudget, type BuyerIdentifier } from "./otp";
import { resetBuyerKillSwitchCache, type OtpChannelPref } from "./settings";

/**
 * Envoi du code de connexion acheteur, par ordre (§1) :
 *  1. WhatsApp Cloud de la boutique (intégration `whatsapp_cloud` active) : modèle d'authentification,
 *     1 crédit `WA_UTILITY` débité (référence `otp:{id}`), remboursé si l'envoi échoue ;
 *  2. expéditeur plateforme si AXI_OTP_WHATSAPP_PHONE_ID et AXI_OTP_WHATSAPP_TOKEN sont définis (coût plateforme),
 *     UNIQUEMENT pour une boutique sans WhatsApp Cloud actif (audit M1). Plan Gratuit : AXI_OTP_FREE_DAILY_PER_STORE
 *     codes par jour et par boutique (défaut 30). Tous plans : budget global AXI_OTP_DAILY_BUDGET ; au-delà, arrêt
 *     d'urgence activé automatiquement et alerte admin ;
 *  3. e-mail (`sendMail`) si l'identifiant est un e-mail.
 *  SMS : point d'intégration (valeur d'enum prévue, aucun fournisseur branché).
 *
 * Le code ne transite JAMAIS par `Notification` ni par les journaux (sauf console de développement).
 */
export type OtpVia = "store_whatsapp" | "platform_whatsapp" | "email" | "sms" | "dev_console" | "none";
export type OtpSendResult = { delivered: boolean; channel: OtpChannel; via: OtpVia; error?: string };

const GRAPH_VERSION = "v21.0";
const SEND_TIMEOUT_MS = 8000;

type WaTarget = { phoneNumberId: string; token: string; template: string; language: string };

/** Message de modèle « authentification » Meta : code dans le corps et dans le bouton « Copier le code ». */
async function sendWhatsappTemplate(target: WaTarget, to: string, code: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(target.phoneNumberId)}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${target.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: target.template,
          language: { code: target.language },
          components: [
            { type: "body", parameters: [{ type: "text", text: code }] },
            { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: code }] },
          ],
        },
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, error: `WhatsApp ${res.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).name === "TimeoutError" ? "WhatsApp : délai dépassé" : "WhatsApp : erreur réseau" };
  }
}

async function storeWhatsappTarget(storeId: string): Promise<WaTarget | null> {
  const i = await db.integration.findUnique({ where: { storeId_kind: { storeId, kind: "whatsapp_cloud" } }, select: { status: true, phoneNumberId: true, secretsEncrypted: true, config: true } });
  if (!i || i.status !== "active" || !i.phoneNumberId || !i.secretsEncrypted) return null;
  try {
    const { token } = JSON.parse(decryptSecret(i.secretsEncrypted)) as { token?: string };
    if (!token) return null;
    const cfg = (i.config ?? {}) as { otpTemplate?: unknown; otpLanguage?: unknown };
    return {
      phoneNumberId: i.phoneNumberId,
      token,
      template: typeof cfg.otpTemplate === "string" && /^[a-z0-9_]{1,512}$/.test(cfg.otpTemplate) ? cfg.otpTemplate : (process.env.AXI_OTP_WHATSAPP_TEMPLATE ?? "code_authentification"),
      language: typeof cfg.otpLanguage === "string" && /^[a-z]{2}(_[A-Z]{2})?$/.test(cfg.otpLanguage) ? cfg.otpLanguage : "fr",
    };
  } catch {
    return null;
  }
}

function platformWhatsappTarget(): WaTarget | null {
  const phoneNumberId = process.env.AXI_OTP_WHATSAPP_PHONE_ID;
  const token = process.env.AXI_OTP_WHATSAPP_TOKEN;
  if (!phoneNumberId || !token || !/^\d{5,32}$/.test(phoneNumberId)) return null;
  return { phoneNumberId, token, template: process.env.AXI_OTP_WHATSAPP_TEMPLATE ?? "code_authentification", language: process.env.AXI_OTP_WHATSAPP_LANGUAGE ?? "fr" };
}

/** Point d'intégration SMS (fournisseur à brancher par le porteur : destinataire E.164 et texte court). */
async function sendSms(message: { to: string; text: string }): Promise<{ ok: boolean; error?: string }> {
  if (!message.to || !message.text) return { ok: false, error: "Message SMS invalide" };
  return { ok: false, error: "SMS non configuré" };
}

/**
 * Budget quotidien de l'expéditeur plateforme (jour UTC). Dépassé : arrêt d'urgence des comptes acheteurs activé
 * (PlatformSetting buyer_accounts.kill_switch, levé depuis la console) et alerte au journal d'audit plateforme.
 */
async function consumePlatformBudget(now = new Date()): Promise<boolean> {
  const budget = platformDailyBudget();
  const rl = await rateLimit(`buyer-otp:platform-budget:${now.toISOString().slice(0, 10)}`, budget, 24 * 3600);
  if (rl.ok) return true;
  const value = { enabled: true, message: "La connexion aux comptes clients est momentanément indisponible. Réessayez plus tard.", reason: "platform_budget", at: now.toISOString() };
  const already = await db.platformSetting.findUnique({ where: { key: BUYER_KILL_SWITCH_KEY }, select: { value: true } });
  if ((already?.value as { enabled?: unknown } | null)?.enabled !== true) {
    await db.platformSetting.upsert({ where: { key: BUYER_KILL_SWITCH_KEY }, create: { key: BUYER_KILL_SWITCH_KEY, value, updatedBy: "system" }, update: { value, updatedBy: "system" } });
    resetBuyerKillSwitchCache();
    await audit({ action: "admin.alert.buyer_otp_budget", metadata: { budget, killSwitch: true } }).catch(() => {});
    console.error(`[buyer-otp] ALERTE : budget quotidien de l'expéditeur plateforme atteint (${budget}). Arrêt d'urgence des comptes acheteurs activé.`);
  }
  return false;
}

/** Plan Gratuit : codes envoyés par l'expéditeur Axi, par boutique et par jour UTC. */
async function consumeFreeQuota(storeId: string, now = new Date()): Promise<boolean> {
  const rl = await rateLimit(`buyer-otp:platform-free:${storeId}:${now.toISOString().slice(0, 10)}`, freeDailyPerStore(), 24 * 3600);
  return rl.ok;
}

export async function sendBuyerOtp(p: {
  storeId: string;
  storeName: string;
  otpId: string;
  identifier: BuyerIdentifier;
  code: string;
  pref: OtpChannelPref;
  /** Boutique au plan Gratuit : quota quotidien serré sur l'expéditeur plateforme. */
  freePlan: boolean;
}): Promise<OtpSendResult> {
  const { identifier, code } = p;

  if (identifier.kind === "email") {
    // Sujet neutre (audit m2) : aucun texte du commerçant dans l'objet ; nom neutralisé dans le corps.
    const name = neutralStoreName(p.storeName);
    const res = await sendMail({
      to: identifier.destination,
      subject: `Votre code de connexion : ${code}`,
      text: `Bonjour,\n\nVotre code de connexion à votre compte client (${name}) : ${code}\n\nIl est valable 10 minutes. Ne le communiquez à personne, pas même à la boutique.\nSi vous n'êtes pas à l'origine de cette demande, ignorez ce message.\n\nEnvoyé par Axi.`,
    }).catch((e: Error) => ({ ok: false, error: e.message }));
    return { delivered: res.ok, channel: "EMAIL", via: "email", error: res.ok ? undefined : res.error };
  }

  // 1. WhatsApp de la boutique. Si elle en a un, AUCUN repli sur l'expéditeur plateforme (audit M1) :
  //    crédit insuffisant ou envoi en échec = code non envoyé (crédit remboursé), message générique côté acheteur.
  const target = p.pref === "store_whatsapp" ? await storeWhatsappTarget(p.storeId) : null;
  if (target) {
    const reference = `otp:${p.otpId}`;
    const debit = await db.$transaction((tx) => debitCredits(p.storeId, "WA_UTILITY", 1, reference, tx));
    if (!debit.ok) return { delivered: false, channel: "WHATSAPP", via: "none", error: "Crédits WhatsApp insuffisants" };
    const sent = await sendWhatsappTemplate(target, identifier.destination, code);
    if (sent.ok) return { delivered: true, channel: "WHATSAPP", via: "store_whatsapp" };
    await refundCredits(p.storeId, reference, 1).catch((e) => console.error("[buyer-otp] remboursement", e));
    return { delivered: false, channel: "WHATSAPP", via: "store_whatsapp", error: sent.error };
  }

  // 2. Expéditeur plateforme : quota Gratuit par boutique, puis budget global (compté pour tous les plans).
  const platform = platformWhatsappTarget();
  if (platform) {
    if (p.freePlan && !(await consumeFreeQuota(p.storeId))) return { delivered: false, channel: "WHATSAPP", via: "none", error: "Quota quotidien du plan Gratuit atteint" };
    if (!(await consumePlatformBudget())) return { delivered: false, channel: "WHATSAPP", via: "none", error: "Budget plateforme atteint" };
    const sent = await sendWhatsappTemplate(platform, identifier.destination, code);
    if (sent.ok) return { delivered: true, channel: "WHATSAPP", via: "platform_whatsapp" };
    return { delivered: false, channel: "WHATSAPP", via: "platform_whatsapp", error: sent.error };
  }

  // SMS : point d'intégration (non branché).
  const sms = await sendSms({ to: identifier.destination, text: `${code} est votre code de connexion. Valable 10 min.` });
  if (sms.ok) return { delivered: true, channel: "SMS", via: "sms" };

  // Développement uniquement : le code s'affiche dans la console du serveur (jamais en production).
  if (process.env.NODE_ENV !== "production") {
    console.info(`\n[buyer-otp] (dev) code de connexion pour ${neutralStoreName(p.storeName)} : ${code}\n`);
    return { delivered: true, channel: "WHATSAPP", via: "dev_console" };
  }
  return { delivered: false, channel: "WHATSAPP", via: "none", error: "Aucun canal disponible" };
}
