import "server-only";
import { Prisma } from "@prisma/client";
import { db, type Tx } from "@/lib/db";
import { randomReference, randomToken, addDays, normalizePhone } from "@/lib/utils";
import { audit } from "@/lib/audit";
import { enqueue } from "@/lib/jobs";
import { notifyStore } from "@/lib/notifications/service";
import { priceCart, taxesFor, type PipelineLine } from "@/lib/commerce/checkout-pipeline";
import { unitPricing } from "@/lib/commerce/checkout-lines";
import { loadTaxSettings } from "@/lib/commerce/checkout-context";
import { loadActiveAutomaticDiscounts } from "@/lib/discounts/service";
import { effectivePlanId } from "@/lib/auth/permissions";
import { recordStockChangeTx } from "@/lib/inventory/levels";
import { allocateProRata } from "@/lib/commerce/allocation";
import { getCountry } from "@/config/site";
import { checkPayments, discountAmount, discountAllowed, effectiveDiscountRole, settlePayments, type PaymentSplit, type PosRole } from "./cash";
import { acceptRevokedSale, clampOfflineCreatedAt, decideOffline, decidePrice, MAX_OVERSELL_UNITS, MAX_POS_LINE_QUANTITY, oversellBlocked, OFFLINE_MAX_HOURS } from "./sync";
import { verifyManagerCode } from "./manager-code";

/**
 * Vente en caisse (lot 3 §2) : `createPosSale` est la SEULE porte d'entrée (API et interface).
 *
 * Invariants :
 *  - le serveur recalcule TOUT (prix, remises automatiques, TVA) : aucun montant client n'est accepté,
 *    sauf l'exception contrôlée du hors-ligne (`decidePrice`, `priceSource = "offline_snapshot"`),
 *    auditée et signalée dans le rapport Z ;
 *  - « hors ligne » est PROUVÉ côté serveur (`decideOffline`) et jamais déduit du corps de la requête :
 *    sans preuve, le prix serveur s'impose (correctif majeur n° 2 de l'audit de la vague 3) ;
 *  - un dépassement du plafond de remise du rôle exige le CODE DU GÉRANT vérifié ici
 *    (`verifyManagerCode`) : aucun drapeau du client ne peut l'accorder (correctif bloquant n° 1) ;
 *  - idempotence par `Order.idempotencyKey` (UUID v4 de l'appareil) : un renvoi de la file ne crée
 *    jamais de doublon et renvoie la vente existante ;
 *  - stock : décrément de l'agrégat ET du niveau du dépôt dans la même transaction ; hors ligne, une
 *    survente est acceptée (la marchandise est déjà remise) avec mouvement, alerte et audit ;
 *  - commande `channel POS`, `PICKUP`, `DELIVERED`, `PAID` (vente au comptoir).
 */

/**
 * Refus d'une vente de caisse. `permanent` distingue deux natures de refus, ce qui décide du sort de la
 * vente dans la file de l'appareil (bloquant n° 3) :
 *  - `permanent: true`  → la vente ne passera JAMAIS en l'état (forme invalide : sans article, quantité
 *    aberrante…) : l'appareil peut la retirer de sa file ;
 *  - `permanent: false` (défaut) → refus RÉCUPÉRABLE (session fermée, article devenu indisponible,
 *    plafond de remise, code du gérant…) : la vente est DÉJÀ ENCAISSÉE, elle reste en file et est
 *    signalée au gérant. Jamais d'argent en caisse sans commande.
 */
export class PosError extends Error {
  readonly permanent: boolean;
  constructor(message: string, opts: { permanent?: boolean } = {}) {
    super(message);
    this.permanent = opts.permanent === true;
  }
}

export type PosSaleItem = { productId: string; variantId?: string | null; quantity: number; optionIds?: string[] };

export type CreatePosSaleInput = {
  storeId: string;
  deviceId: string;
  sessionId: string;
  locationId: string;
  actorId: string;
  role: PosRole;
  /**
   * Rôle du VENDEUR déclaré par la file (vente hors ligne rejouée par un autre membre). Il ne peut
   * jamais élargir le plafond de remise : seul le plafond le plus bas des deux s'applique
   * (`effectiveDiscountRole`).
   */
  claimedRole?: PosRole | null;
  idempotencyKey: string;
  items: PosSaleItem[];
  payments: PaymentSplit[];
  /** Remise manuelle en pourcentage (plafonnée par rôle ; au-delà, code du gérant exigé). */
  discountPercent?: number;
  /**
   * Code du gérant SAISI à la caisse (4 à 6 chiffres), vérifié ici contre l'empreinte de la boutique.
   * C'est la SEULE façon de dépasser le plafond de remise du rôle : il n'existe aucun drapeau de
   * dérogation accepté depuis le client.
   */
  managerCode?: string | null;
  customerPhone?: string | null;
  customerName?: string | null;
  /** Total encaissé selon l'instantané de l'appareil (ventes hors ligne uniquement). */
  collectedTotal?: number | null;
  /** Date déclarée par l'appareil (hors ligne) ; bornée entre la dernière synchronisation et la réception. */
  offlineCreatedAt?: Date | string | null;
  /** Dernière synchronisation connue de l'appareil (borne basse de l'horloge). Écrite par le SERVEUR. */
  deviceLastSyncAt?: Date | null;
  /** Date de révocation de l'appareil, si révoqué (tolérance de 24 h limitée au hors-ligne prouvé). */
  deviceRevokedAt?: Date | null;
  receivedAt?: Date;
};

export type PosSaleResult = {
  orderId: string;
  reference: string;
  total: number;
  change: number;
  priceSource: "server" | "offline_snapshot";
  priceGap: number;
  oversold: { name: string; stock: number }[];
  duplicate: boolean;
};

const MAX_POS_LINES = 200;

export async function createPosSale(input: CreatePosSaleInput): Promise<PosSaleResult> {
  if (!input.items.length) throw new PosError("Vente sans article.", { permanent: true });
  if (input.items.length > MAX_POS_LINES) throw new PosError("Trop de lignes dans cette vente.", { permanent: true });
  for (const item of input.items) {
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > MAX_POS_LINE_QUANTITY) {
      throw new PosError(`Quantité invalide : 1 à ${MAX_POS_LINE_QUANTITY} unités par ligne.`, { permanent: true });
    }
  }
  const receivedAt = input.receivedAt ?? new Date();

  /* 0. Hors-ligne PROUVÉ côté serveur (jamais déduit du corps de la requête) : sans preuve, la vente
        est traitée comme une vente en ligne et le prix serveur s'impose. Un instantané de plus de
        72 h est refusé, comme l'interface le fait déjà sur l'appareil. */
  const proof = decideOffline({ claimed: input.offlineCreatedAt ?? null, lastSyncAt: input.deviceLastSyncAt ?? null, receivedAt });
  if (proof.reason === "snapshot_expired") {
    throw new PosError(`Reconnectez la caisse : l'instantané du catalogue a plus de ${OFFLINE_MAX_HOURS} h, cette vente ne peut pas être enregistrée au prix de l'appareil.`);
  }
  const offline = proof.offline;
  const createdAt = clampOfflineCreatedAt({ claimed: input.offlineCreatedAt ?? null, lastSyncAt: input.deviceLastSyncAt ?? null, receivedAt });

  /* 0 bis. Appareil révoqué : la tolérance de 24 h ne couvre QUE le hors-ligne prouvé antérieur à la
           révocation (correctif majeur n° 4). */
  const revoked = acceptRevokedSale({ revokedAt: input.deviceRevokedAt ?? null, offline, createdAt: createdAt.at, receivedAt });
  if (!revoked.ok) throw new PosError(revoked.error);

  // Idempotence hors transaction (chemin le plus fréquent du rejeu de file). AVANT le code gérant :
  // un rejeu d'une vente déjà enregistrée ne doit pas consommer d'essai du code (sinon quelques rejeux
  // bloqueraient tout dépassement de plafond pour la boutique pendant 15 min).
  const duplicateOf = async (): Promise<PosSaleResult | null> => {
    const existing = await db.order.findUnique({
      where: { storeId_idempotencyKey: { storeId: input.storeId, idempotencyKey: input.idempotencyKey } },
      select: { id: true, reference: true, total: true, priceSource: true },
    });
    if (!existing) return null;
    return {
      orderId: existing.id,
      reference: existing.reference,
      total: existing.total,
      change: 0,
      priceSource: existing.priceSource === "offline_snapshot" ? "offline_snapshot" : "server",
      priceGap: 0,
      oversold: [],
      duplicate: true,
    };
  };
  const already = await duplicateOf();
  if (already) return already;

  /* 0 ter. Dépassement du plafond de remise du rôle : code du gérant vérifié ICI, hors transaction
           (compteur d'essais et limitation de débit). */
  let managerOverride = false;
  const discountRole = effectiveDiscountRole(input.role, input.claimedRole ?? null);
  if (input.discountPercent && input.discountPercent > 0 && !discountAllowed(discountRole, input.discountPercent)) {
    const check = await verifyManagerCode(input.storeId, input.managerCode ?? null);
    if (!check.ok) throw new PosError(check.error);
    managerOverride = true;
    await audit({
      storeId: input.storeId,
      actorId: input.actorId,
      action: "pos.manager_override",
      target: input.idempotencyKey,
      metadata: { role: discountRole, authenticatedRole: input.role, discountPercent: input.discountPercent, deviceId: input.deviceId },
    });
  }

  const sale = db.$transaction(async (tx) => {
    const store = await tx.store.findUnique({
      where: { id: input.storeId },
      include: { subscription: true },
    });
    if (!store) throw new PosError("Boutique introuvable.");
    const session = await tx.posSession.findFirst({
      where: { id: input.sessionId, storeId: input.storeId, deviceId: input.deviceId },
      select: { id: true, status: true, locationId: true, openedAt: true },
    });
    if (!session) throw new PosError("Session de caisse introuvable.");
    if (session.status !== "OPEN") throw new PosError("Cette session de caisse est fermée : ouvrez une nouvelle session.");

    /* Horodatage DÉFINITIF de la vente (bloquant n° 4) : borné par l'ouverture de la session, jamais par
       `lastSyncAt` (marqueur de synchronisation réécrit par chaque appel de l'API, catalogue compris).
       Une vente hors ligne conserve ainsi sa date réelle, donc sa tarification du moment. */
    const saleAt = clampOfflineCreatedAt({ claimed: input.offlineCreatedAt ?? null, sessionOpenedAt: session.openedAt, receivedAt });
    const pricingDate = offline ? saleAt.at : receivedAt;

    /* 1. Lignes : produits verrouillés, prix et options recalculés côté serveur. */
    const productIds = [...new Set(input.items.map((i) => i.productId))];
    await tx.$queryRaw`SELECT id FROM "Product" WHERE id IN (${Prisma.join(productIds)}) ORDER BY id FOR UPDATE`;
    const products = await tx.product.findMany({
      where: { id: { in: productIds }, storeId: store.id, status: "ACTIVE" },
      include: { variants: true, optionGroups: { include: { options: true } } },
    });

    const lines: (PipelineLine & { trackStock: boolean; variantName: string | null })[] = [];
    for (const item of input.items) {
      const product = products.find((p) => p.id === item.productId);
      if (!product) throw new PosError("Un article n'est plus disponible à la vente.");
      if (product.isGiftCard) throw new PosError("Vendez les cartes cadeaux depuis l'espace marchand.");
      const variant = item.variantId ? product.variants.find((v) => v.id === item.variantId) : null;
      if (item.variantId && !variant) throw new PosError("Variante inconnue.");
      const selected: { name: string; priceDelta: number }[] = [];
      for (const group of product.optionGroups) {
        for (const option of group.options) {
          if (item.optionIds?.includes(option.id)) selected.push({ name: option.name, priceDelta: option.priceDelta });
        }
      }
      const { unitPrice } = unitPricing(product, variant ?? null, selected, pricingDate);
      lines.push({
        productId: product.id,
        variantId: variant?.id ?? null,
        name: product.name,
        variantName: variant?.name ?? null,
        unitPrice,
        quantity: item.quantity,
        options: selected,
        collectionIds: [],
        isGiftCard: false,
        kind: product.kind,
        onSale: false,
        taxable: product.taxable !== false,
        taxCategory: product.taxCategory ?? "standard",
        trackStock: product.trackStock && product.kind !== "DIGITAL",
      });
    }

    /* 1 bis. Survente BORNÉE (correctif mineur n° 14) : une vente au comptoir n'est jamais refusée pour
              un stock légèrement négatif (la marchandise est déjà remise au client), mais une survente
              massive trahit une saisie erronée ou un appareil compromis, pas un écart d'inventaire. */
    const wanted = new Map<string, number>();
    for (const [index, line] of lines.entries()) {
      if (!lines[index].trackStock) continue;
      const itemKey = line.variantId ?? line.productId;
      wanted.set(itemKey, (wanted.get(itemKey) ?? 0) + line.quantity);
    }
    if (wanted.size) {
      const levels = await tx.inventoryLevel.findMany({
        where: { storeId: store.id, locationId: input.locationId, itemKey: { in: [...wanted.keys()] } },
        select: { itemKey: true, available: true },
      });
      for (const [itemKey, quantity] of wanted) {
        const available = levels.find((l) => l.itemKey === itemKey)?.available ?? 0;
        if (oversellBlocked(available, quantity)) {
          throw new PosError(`Quantité refusée : elle dépasse de plus de ${MAX_OVERSELL_UNITS} unités le stock du dépôt. Vérifiez la saisie ou régularisez l'inventaire.`);
        }
      }
    }

    /* 2. Pipeline : remises automatiques et TVA, comme en ligne (même code). */
    const planId = effectivePlanId(store.subscription);
    const automaticDiscounts = await loadActiveAutomaticDiscounts(store.id, planId, pricingDate, tx);
    const tax = await loadTaxSettings(tx, store);
    const priced = priceCart({
      lines,
      // Vente au comptoir : retrait, aucun frais de livraison.
      delivery: { type: "PICKUP" },
      automaticDiscounts,
      now: pricingDate,
      currency: store.currency,
      tax,
    });

    /* 3. Remise manuelle plafonnée par rôle, répartie au prorata des lignes.
          Le dépassement de plafond a déjà exigé le code du gérant (étape 0 ter) : `managerOverride`
          ne peut être vrai qu'après cette vérification. */
    let manualDiscount = 0;
    if (input.discountPercent && input.discountPercent > 0) {
      if (!discountAllowed(discountRole, input.discountPercent) && !managerOverride) {
        throw new PosError("Remise au-delà du plafond de votre rôle : demandez le code du gérant.");
      }
      manualDiscount = discountAmount(priced.subtotal - priced.discount, input.discountPercent);
    }
    /**
     * Répartition de la remise manuelle sur les lignes, puis RECALCUL DES TAXES sur les nets obtenus
     * (majeur n° 6) : sans cela la TVA resterait celle d'avant remise (surdéclaration) et
     * `OrderItem.taxAmount` ne correspondrait plus au net de la ligne. En prix TTC les taxes sont
     * contenues dans le total, en prix HT elles s'y ajoutent : le total encaissable suit la même règle
     * que le pipeline (`addToTotal`).
     */
    const manualAllocation = manualDiscount > 0 ? allocateProRata(manualDiscount, priced.lines.map((l) => l.netTotal)) : priced.lines.map(() => 0);
    const netsAfterManual = priced.lines.map((l, i) => Math.max(0, l.netTotal - manualAllocation[i]));
    const manualTaxes = manualDiscount > 0 ? taxesFor(lines, netsAfterManual, 0, tax) : null;
    const taxTotal = manualTaxes ? manualTaxes.taxTotal : priced.taxTotal;
    const taxLines = manualTaxes ? manualTaxes.taxLines : priced.taxLines;
    const lineTax = (index: number) => (manualTaxes ? manualTaxes.perLine[index] : { taxAmount: priced.lines[index].taxAmount, taxRateBps: priced.lines[index].taxRateBps });
    const serverTotal = manualTaxes
      ? Math.max(0, netsAfterManual.reduce((sum, net) => sum + net, 0) + manualTaxes.addToTotal)
      : Math.max(0, priced.total - manualDiscount);

    /* 4. Prix retenu (exception hors ligne contrôlée) et paiements. */
    const decision = decidePrice({ serverTotal, collectedTotal: input.collectedTotal, offline });
    const payment = checkPayments(decision.total, input.payments);
    if (!payment.ok) throw new PosError(payment.error);

    /* 5. Client facultatif (téléphone) : fiche par boutique, jamais écrasée. */
    let customerId: string | null = null;
    const dialCode = getCountry(store.country)?.dialCode ?? "229";
    const phone = input.customerPhone ? normalizePhone(input.customerPhone, dialCode) : null;
    if (phone) {
      const customer = await tx.customer.upsert({
        where: { storeId_phone: { storeId: store.id, phone } },
        create: { storeId: store.id, name: input.customerName?.trim() || "Client comptoir", phone },
        update: {},
        select: { id: true },
      });
      customerId = customer.id;
    }

    /* 6. Commande POS : livrée et payée immédiatement. */
    let reference = randomReference("AX");
    for (let i = 0; i < 5; i++) {
      const clash = await tx.order.findUnique({ where: { storeId_reference: { storeId: store.id, reference } }, select: { id: true } });
      if (!clash) break;
      reference = randomReference("AX");
    }

    const order = await tx.order.create({
      data: {
        storeId: store.id,
        customerId,
        reference,
        idempotencyKey: input.idempotencyKey,
        trackingToken: randomToken(24),
        trackingExpiresAt: addDays(receivedAt, 90),
        status: "DELIVERED",
        paymentStatus: "PAID",
        fulfillmentType: "PICKUP",
        fulfillmentStatus: "FULFILLED",
        channel: "POS",
        customerName: input.customerName?.trim() || "Client comptoir",
        customerPhone: phone ?? "",
        currency: store.currency,
        subtotal: priced.subtotal,
        discount: priced.discount + manualDiscount,
        automaticDiscount: priced.automaticDiscount,
        deliveryFee: 0,
        total: decision.total,
        amountDue: 0,
        taxTotal,
        taxesIncluded: priced.taxesIncluded,
        taxLines: taxLines.length ? (taxLines as unknown as Prisma.InputJsonValue) : undefined,
        paymentMethodLabel: input.payments.map((p) => p.kind).join(" + "),
        paymentReference: input.payments.find((p) => p.reference)?.reference ?? null,
        locationId: input.locationId,
        posSessionId: session.id,
        posDeviceId: input.deviceId,
        offlineCreatedAt: offline ? saleAt.at : null,
        priceSource: decision.priceSource,
        deliveredAt: receivedAt,
        confirmedAt: receivedAt,
        events: {
          create: [
            { actorId: input.actorId, actorLabel: "Caisse", type: "status_changed", toValue: "DELIVERED", message: `Vente au comptoir encaissée (${input.payments.map((p) => `${p.kind} ${p.amount}`).join(", ")})` },
            ...(manualDiscount > 0 ? [{ actorId: input.actorId, actorLabel: "Caisse", type: "note", message: `Remise manuelle de ${input.discountPercent} % (−${manualDiscount} ${store.currency})${managerOverride ? " validée par le code du gérant" : ""}` }] : []),
            ...(decision.gap !== 0
              ? [{
                  actorLabel: "Système",
                  type: "note",
                  message:
                    decision.priceSource === "offline_snapshot"
                      ? `Écart de prix hors ligne : encaissé ${decision.total}, recalculé ${serverTotal} (${decision.gap > 0 ? "+" : ""}${decision.gap} ${store.currency}). Vente conservée au prix encaissé.`
                      : `Écart de prix hors ligne hors tolérance : prix serveur appliqué (${serverTotal} au lieu de ${input.collectedTotal}).`,
                }]
              : []),
            ...(saleAt.clamped && offline ? [{ actorLabel: "Système", type: "note", message: "Horodatage de l'appareil corrigé (horloge hors bornes)." }] : []),
          ],
        },
      },
      select: { id: true },
    });

    /* 7. Lignes, stock (agrégat + dépôt) et survente tracée. */
    const oversold: { name: string; stock: number }[] = [];
    for (const [index, line] of priced.lines.entries()) {
      const source = lines[index];
      await tx.orderItem.create({
        data: {
          orderId: order.id,
          productId: line.productId,
          variantId: line.variantId ?? null,
          name: line.name,
          variantName: source.variantName,
          options: (line.options ?? []) as unknown as Prisma.InputJsonValue,
          unitPrice: line.unitPrice,
          quantity: line.quantity,
          lineTotal: line.lineTotal,
          kind: line.kind ?? "PHYSICAL",
          discountAllocated: line.discountAllocated + manualAllocation[index],
          taxAmount: lineTax(index).taxAmount,
          taxRateBps: lineTax(index).taxRateBps,
          locationId: input.locationId,
        },
      });
      if (!source.trackStock) continue;
      await recordStockChangeTx(tx, {
        storeId: store.id,
        locationId: input.locationId,
        productId: line.productId,
        variantId: line.variantId ?? null,
        delta: -line.quantity,
        reason: "SALE",
        note: offline ? "Vente en caisse (hors ligne)" : "Vente en caisse",
        orderId: order.id,
        actorId: input.actorId,
      });
      // Survente : acceptée (la marchandise est déjà remise au client), mais signalée.
      const level = await tx.inventoryLevel.findUnique({
        where: { locationId_itemKey: { locationId: input.locationId, itemKey: line.variantId ?? line.productId } },
        select: { available: true },
      });
      if (level && level.available < 0) oversold.push({ name: `${line.name}${source.variantName ? ` (${source.variantName})` : ""}`, stock: level.available });
    }

    /* 8. Tentatives de paiement (une par moyen), NETTES du rendu de monnaie : Σ tentatives = total
          encaissé, sinon le rapport Z surévaluerait les espèces en caisse. */
    for (const split of settlePayments(decision.total, input.payments)) {
      await tx.paymentAttempt.create({
        data: {
          orderId: order.id,
          provider: split.kind,
          status: "CONFIRMED",
          amount: split.amount,
          currency: store.currency,
          customerRef: split.reference?.slice(0, 120) ?? null,
          verifiedBy: input.actorId,
          verifiedAt: receivedAt,
        },
      });
    }

    await enqueue("order.created", { orderId: order.id }, { storeId: store.id }, tx);
    await audit(
      {
        storeId: store.id,
        actorId: input.actorId,
        action: "pos.sale",
        target: order.id,
        metadata: {
          sessionId: session.id,
          deviceId: input.deviceId,
          total: decision.total,
          offline,
          offlineReason: proof.reason,
          managerOverride,
          priceSource: decision.priceSource,
          gap: decision.gap,
          oversold: oversold.length,
        },
      },
      tx,
    );
    if (decision.priceSource === "offline_snapshot") {
      await audit({ storeId: store.id, actorId: input.actorId, action: "pos.price_mismatch", target: order.id, metadata: { collected: decision.total, server: serverTotal, gap: decision.gap } }, tx);
    }
    if (oversold.length) {
      await audit({ storeId: store.id, actorId: input.actorId, action: "pos.oversold", target: order.id, metadata: { items: oversold } }, tx);
      await notifyStore(
        store.id,
        {
          kind: "stock.oversold",
          key: `pos:oversold:${order.id}`,
          title: "Survente en caisse",
          text: `Vente ${reference} : ${oversold.map((o) => `${o.name} (${o.stock})`).join(", ")}. Réapprovisionnez ou corrigez le stock du dépôt.`,
          href: `/app/${store.id}/depots`,
        },
        tx,
      );
    }

    return {
      orderId: order.id,
      reference,
      total: decision.total,
      change: payment.change,
      priceSource: decision.priceSource,
      priceGap: decision.gap,
      oversold,
      duplicate: false,
    };
  });
  // Deux envois concurrents de la même vente : la contrainte unique (storeId, idempotencyKey) fait échouer
  // le second (P2002). On le traite comme un doublon au lieu d'un 500 qui couperait le reste du lot.
  return sale.catch(async (e: unknown) => {
    if ((e as { code?: string } | null)?.code === "P2002") {
      const dup = await duplicateOf();
      if (dup) return dup;
    }
    throw e;
  });
}

/** Ventes d'une session (rapport Z, clôture). */
export async function sessionSales(client: Tx | typeof db, sessionId: string) {
  return client.order.findMany({
    where: { posSessionId: sessionId },
    select: { id: true, reference: true, total: true, discount: true, taxTotal: true, priceSource: true, createdAt: true, paymentAttempts: { select: { provider: true, amount: true, status: true } } },
    orderBy: { createdAt: "asc" },
  });
}
