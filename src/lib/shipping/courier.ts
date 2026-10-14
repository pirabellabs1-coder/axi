import "server-only";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { notifyStore } from "@/lib/notifications/service";
import { isValidMediaKey } from "@/lib/storage/keys";
import { checkDeliveryCode, firstNameOnly, isCourierTokenValid, maskPhone, MAX_DELIVERY_CODE_ATTEMPTS, normalizeDeliveryCode } from "./courier-code";
import { deliveryCodeFingerprint, recordShipmentEvent, ShippingError } from "./service";
import { SHIPMENT_STATUS_LABELS, type ShipmentStatusValue } from "./state";

/**
 * Page livreur `/livraison/[token]` (lot 3 §1.2) : jeton aléatoire, expirant 7 jours après la création
 * de l'expédition. Le livreur n'est PAS un membre de la boutique : il ne voit que le strict nécessaire
 * (prénom du destinataire, téléphone partiellement masqué, adresse, repère), et chaque révélation du
 * numéro complet est journalisée. Le code de remise est limité à 5 essais, puis blocage et alerte.
 */

/** Préfixe des événements d'essai de code (compteur d'essais sans colonne dédiée). */
const CODE_FAILURE_PREFIX = "Code de remise incorrect";

/**
 * Vue livreur. Type SOMME (mineur n° 6) : un jeton expiré ou révoqué ne rend plus qu'un bandeau.
 * Avant, la page servait encore l'adresse complète, le téléphone masqué, le montant à encaisser et le
 * détail des articles après expiration : un lien fuité (WhatsApp, historique du navigateur d'un ancien
 * livreur) restait une fiche client exploitable indéfiniment. Les données ne sont donc même plus lues
 * en base quand le jeton n'est plus valable.
 */
export type CourierView =
  | { expired: true; storeName: string }
  | {
      expired: false;
      shipmentId: string;
      storeId: string;
      storeName: string;
      reference: string;
      status: ShipmentStatusValue;
      statusLabel: string;
      recipientFirstName: string;
      phoneMasked: string;
      address: string | null;
      city: string | null;
      note: string | null;
      cashToCollect: number;
      currency: string;
      items: { name: string; variantName: string | null; quantity: number }[];
      requiresCode: boolean;
      hasProofPhoto: boolean;
      codeAttemptsLeft: number;
    };

export async function codeAttempts(shipmentId: string): Promise<number> {
  return db.shipmentEvent.count({ where: { shipmentId, source: "courier", message: { startsWith: CODE_FAILURE_PREFIX } } });
}

/**
 * Charge la vue livreur d'un jeton ; `null` si le jeton est inconnu.
 * Jeton expiré : seul le nom de la boutique est rendu (aucune donnée personnelle, aucun article).
 */
export async function loadCourierView(token: string): Promise<CourierView | null> {
  if (!token || token.length < 16) return null;
  const shipment = await db.shipment.findUnique({
    where: { courierToken: token },
    select: {
      id: true,
      storeId: true,
      status: true,
      courierTokenExpiresAt: true,
      deliveryCodeHash: true,
      proofPhotoUrl: true,
      store: { select: { name: true, currency: true } },
      order: {
        select: {
          reference: true,
          customerName: true,
          customerPhone: true,
          deliveryAddress: true,
          deliveryZoneName: true,
          customerNote: true,
          amountDue: true,
          total: true,
          paymentStatus: true,
        },
      },
      items: { select: { quantity: true, orderItem: { select: { name: true, variantName: true } } } },
    },
  });
  if (!shipment) return null;
  // Jeton expiré ou révoqué : rien d'autre que le bandeau. Les champs lus ci-dessus ne sortent pas d'ici.
  if (!isCourierTokenValid(shipment.courierTokenExpiresAt)) return { expired: true, storeName: shipment.store.name };
  const due = shipment.order.paymentStatus === "PAID" ? 0 : (shipment.order.amountDue ?? shipment.order.total);
  return {
    expired: false,
    shipmentId: shipment.id,
    storeId: shipment.storeId,
    storeName: shipment.store.name,
    reference: shipment.order.reference,
    status: shipment.status as ShipmentStatusValue,
    statusLabel: SHIPMENT_STATUS_LABELS[shipment.status as ShipmentStatusValue],
    recipientFirstName: firstNameOnly(shipment.order.customerName),
    phoneMasked: maskPhone(shipment.order.customerPhone),
    address: shipment.order.deliveryAddress,
    city: shipment.order.deliveryZoneName,
    note: shipment.order.customerNote,
    cashToCollect: due,
    currency: shipment.store.currency,
    items: shipment.items.map((i) => ({ name: i.orderItem.name, variantName: i.orderItem.variantName, quantity: i.quantity })),
    requiresCode: !!shipment.deliveryCodeHash,
    hasProofPhoto: isValidMediaKey(shipment.proofPhotoUrl ?? ""),
    codeAttemptsLeft: Math.max(0, MAX_DELIVERY_CODE_ATTEMPTS - (await codeAttempts(shipment.id))),
  };
}

async function requireLiveShipment(token: string) {
  const shipment = await db.shipment.findUnique({
    where: { courierToken: token },
    select: { id: true, storeId: true, status: true, courierTokenExpiresAt: true, deliveryCodeHash: true, deliveryAttempts: true, proofPhotoUrl: true, order: { select: { id: true, reference: true } } },
  });
  if (!shipment) throw new ShippingError("Lien de livraison inconnu.");
  if (!isCourierTokenValid(shipment.courierTokenExpiresAt)) throw new ShippingError("Ce lien de livraison a expiré. Demandez-en un nouveau au commerçant.");
  return shipment;
}

/** « Récupéré » : le livreur a la marchandise. */
export async function courierPickUp(token: string, geo?: { latitude: number; longitude: number } | null): Promise<void> {
  const shipment = await requireLiveShipment(token);
  const result = await recordShipmentEvent({
    shipmentId: shipment.id,
    status: "PICKED_UP",
    source: "courier",
    strict: true,
    message: "Colis récupéré par le livreur",
    locationLabel: geo ? `${geo.latitude.toFixed(5)}, ${geo.longitude.toFixed(5)}` : null,
  });
  if (!result.applied) throw new ShippingError(`Action impossible : l'expédition est « ${SHIPMENT_STATUS_LABELS[result.status]} ».`);
}

export type DeliverResult = { ok: true } | { ok: false; error: string; attemptsLeft: number; blocked?: boolean };

/**
 * « Livré » : code de l'acheteur (5 essais) OU photo de preuve. Au cinquième échec, l'expédition est
 * bloquée pour ce livreur et le commerçant est alerté (tentative de fraude possible).
 *
 * Mineur n° 5 : la photo de preuve n'est JAMAIS une chaîne du formulaire. Elle doit avoir été téléversée
 * par `POST /api/livraison/{token}/preuve`, qui vérifie les octets et écrit une clé interne du stockage ;
 * on relit donc ici `Shipment.proofPhotoUrl` en base et on exige une clé de média valide. Une URL
 * arbitraire ne peut plus tenir lieu de preuve de remise.
 */
export async function courierDeliver(
  token: string,
  p: { code?: string | null; geo?: { latitude: number; longitude: number } | null },
): Promise<DeliverResult> {
  const shipment = await requireLiveShipment(token);
  const attempts = await codeAttempts(shipment.id);
  // Preuve photo RÉELLE : clé produite par le serveur lors du téléversement, relue en base.
  const hasProof = isValidMediaKey(shipment.proofPhotoUrl ?? "");

  if (shipment.deliveryCodeHash && !hasProof) {
    const input = p.code ?? "";
    const normalized = normalizeDeliveryCode(input);
    const check = checkDeliveryCode({
      input,
      fingerprint: normalized ? deliveryCodeFingerprint(shipment.id, normalized) : null,
      expected: shipment.deliveryCodeHash,
      attempts,
    });
    if (!check.ok) {
      if (check.reason === "blocked") {
        return { ok: false, error: "Trop d'essais : contactez le commerçant.", attemptsLeft: 0, blocked: true };
      }
      if (check.reason === "format") {
        return { ok: false, error: `Le code comporte 4 chiffres.`, attemptsLeft: check.remaining };
      }
      // Essai erroné : journalisé (compteur), audité, et alerte au cinquième.
      await db.shipmentEvent.create({
        data: { shipmentId: shipment.id, status: shipment.status, source: "courier", message: `${CODE_FAILURE_PREFIX} (essai ${check.attempts}/${MAX_DELIVERY_CODE_ATTEMPTS})`, occurredAt: new Date() },
      });
      await audit({ storeId: shipment.storeId, action: "shipment.delivery_code_failed", target: shipment.id, metadata: { attempts: check.attempts } });
      if (check.remaining === 0) {
        await notifyStore(shipment.storeId, {
          kind: "other",
          key: `shipment:code_blocked:${shipment.id}`,
          title: "Code de remise bloqué",
          text: `5 codes erronés ont été saisis pour la livraison de la commande ${shipment.order.reference}. Vérifiez avec votre livreur avant de débloquer.`,
          href: `/app/${shipment.storeId}/commandes/${shipment.order.id}`,
        });
      }
      return { ok: false, error: `Code incorrect. ${check.remaining} essai${check.remaining > 1 ? "s" : ""} restant${check.remaining > 1 ? "s" : ""}.`, attemptsLeft: check.remaining };
    }
  } else if (!shipment.deliveryCodeHash && !hasProof) {
    return { ok: false, error: "Prenez la photo de preuve de remise avant de confirmer.", attemptsLeft: MAX_DELIVERY_CODE_ATTEMPTS - attempts };
  }

  const result = await recordShipmentEvent({
    shipmentId: shipment.id,
    status: "DELIVERED",
    source: "courier",
    strict: true,
    message: hasProof ? "Livré (photo de preuve téléversée)" : "Livré (code de l'acheteur vérifié)",
    locationLabel: p.geo ? `${p.geo.latitude.toFixed(5)}, ${p.geo.longitude.toFixed(5)}` : null,
  });
  if (!result.applied) return { ok: false, error: `Action impossible : l'expédition est « ${SHIPMENT_STATUS_LABELS[result.status]} ».`, attemptsLeft: 0 };
  return { ok: true };
}

/** « Échec » : motif obligatoire ; l'expédition repart en livraison ou en retour selon le commerçant. */
export async function courierFail(token: string, reason: string, geo?: { latitude: number; longitude: number } | null): Promise<void> {
  const shipment = await requireLiveShipment(token);
  const motive = (reason ?? "").trim().slice(0, 200);
  if (motive.length < 3) throw new ShippingError("Indiquez le motif de l'échec.");
  const result = await recordShipmentEvent({
    shipmentId: shipment.id,
    status: "FAILED_ATTEMPT",
    source: "courier",
    strict: true,
    message: motive,
    locationLabel: geo ? `${geo.latitude.toFixed(5)}, ${geo.longitude.toFixed(5)}` : null,
  });
  if (!result.applied) throw new ShippingError(`Action impossible : l'expédition est « ${SHIPMENT_STATUS_LABELS[result.status]} ».`);
  await notifyStore(shipment.storeId, {
    kind: "other",
    key: `shipment:failed:${shipment.id}:${Date.now()}`,
    title: "Tentative de livraison échouée",
    text: `Commande ${shipment.order.reference} : ${motive}`,
    href: `/app/${shipment.storeId}/commandes/${shipment.order.id}`,
  });
}

/** Révélation du numéro complet au livreur (bouton « Appeler ») : journalisée (donnée personnelle). */
export async function revealCustomerPhone(token: string): Promise<string | null> {
  const shipment = await db.shipment.findUnique({
    where: { courierToken: token },
    select: { id: true, storeId: true, courierTokenExpiresAt: true, order: { select: { customerPhone: true } } },
  });
  if (!shipment || !isCourierTokenValid(shipment.courierTokenExpiresAt)) return null;
  await audit({ storeId: shipment.storeId, action: "shipment.phone_revealed", target: shipment.id });
  return shipment.order.customerPhone;
}
