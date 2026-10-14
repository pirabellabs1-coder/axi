"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireStore } from "@/lib/auth/permissions";
import { guard, parseForm, fail, success, badIds, zOptionalString, type ActionResult } from "@/lib/action";
import { audit } from "@/lib/audit";
import { randomReference } from "@/lib/utils";
import { PLANS } from "@/config/plans";
import { applyLevelDeltaIfAvailableTx, applyLevelDeltaTx, itemKeyOf, recordStockChangeTx } from "./levels";
import { canTransitionTransfer, receivePlan, validateTransferDraft, type TransferStatusValue } from "./transfer";
import { countPlan, countSummary, type CountedLine } from "./count";

/**
 * Transferts entre dépôts, répartition du stock et inventaire tournant (lot 3 §1.1 et §4).
 * Capacité `products.manage`, isolation `storeId`, audit systématique.
 * Toutes les écritures de stock passent par `src/lib/inventory/levels.ts` (agrégat + niveau dans la
 * même transaction) : l'invariant « agrégat = Σ niveaux + en transit » est préservé par construction.
 */

const zQty = z.coerce.number().int().min(0).max(1_000_000);

/**
 * Refus métier levé DEPUIS une transaction (correctif majeur n° 3 de l'audit de la vague 3).
 *
 * `return { ok: false }` à l'intérieur de `db.$transaction` VALIDE la transaction : dans `shipTransfer`,
 * le transfert passait IN_TRANSIT avec une ligne non décrémentée, et la réception créait du stock ex
 * nihilo (invariant « agrégat = Σ niveaux + en transit » rompu, stock inventé). Toute sortie en échec
 * passe donc par un `throw`, intercepté HORS transaction par `txFail` : PostgreSQL annule réellement.
 */
class InventoryTxError extends Error {}

/** Exécute une transaction dont les refus métier sont levés ; convertit le refus en `ActionResult`. */
async function inTransaction<T>(run: (tx: Parameters<Parameters<typeof db.$transaction>[0]>[0]) => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    return { ok: true, value: await db.$transaction(run) };
  } catch (e) {
    if (e instanceof InventoryTxError) return { ok: false, error: e.message };
    throw e;
  }
}

function revalidate(storeId: string) {
  revalidatePath(`/app/${storeId}/depots`);
  revalidatePath(`/app/${storeId}/stock/transferts`);
}

/** Lignes `item-<productId>[:<variantId>]` → quantité, issues d'un formulaire. */
function parseLines(formData: FormData): { productId: string; variantId: string | null; quantity: number }[] {
  const out: { productId: string; variantId: string | null; quantity: number }[] = [];
  for (const [key, raw] of formData.entries()) {
    if (!key.startsWith("item-")) continue;
    const [productId, variantId] = key.slice(5).split(":");
    const parsed = zQty.safeParse(raw);
    if (!productId || !parsed.success || parsed.data <= 0) continue;
    out.push({ productId, variantId: variantId || null, quantity: parsed.data });
  }
  return out;
}

/* ───────────────────────── Répartition directe du stock ───────────────────────── */

const assignSchema = z.object({
  storeId: z.string(),
  locationId: z.string(),
  productId: z.string(),
  variantId: zOptionalString,
  quantity: zQty,
  note: zOptionalString,
});

/**
 * Fixe la quantité d'un article dans un dépôt SANS changer le stock agrégé : le complément est pris
 * (ou rendu) sur le dépôt par défaut. C'est l'outil de première répartition après la migration.
 */
export async function assignStockToLocation(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const parsed = parseForm(assignSchema, formData);
    if ("error" in parsed) return parsed.error;
    const d = parsed.data;
    const ctx = await requireStore(d.storeId, "products.manage");
    const bad = badIds(d.locationId, d.productId);
    if (bad) return bad;

    const product = await db.product.findFirst({ where: { id: d.productId, storeId: ctx.store.id }, select: { id: true, trackStock: true, name: true } });
    if (!product) return fail("Produit introuvable.");
    if (!product.trackStock) return fail("Le stock de ce produit n'est pas suivi.");
    const target = await db.location.findFirst({ where: { id: d.locationId, storeId: ctx.store.id }, select: { id: true, name: true } });
    if (!target) return fail("Dépôt introuvable.");
    // Mineur n° 10 : la variante doit appartenir à CE produit (et donc à cette boutique), sinon la
    // répartition écrirait un niveau sur une variante d'une autre fiche — voire d'une autre boutique.
    if (d.variantId) {
      if (badIds(d.variantId)) return fail("Identifiant invalide");
      const variant = await db.variant.findFirst({ where: { id: d.variantId, productId: product.id, product: { storeId: ctx.store.id } }, select: { id: true } });
      if (!variant) return fail("Cette variante n'appartient pas à ce produit.");
    }

    const itemKey = itemKeyOf(d.productId, d.variantId ?? null);
    const result = await inTransaction(async (tx) => {
      const level = await tx.inventoryLevel.findUnique({ where: { locationId_itemKey: { locationId: d.locationId, itemKey } }, select: { available: true } });
      const current = level?.available ?? 0;
      const delta = d.quantity - current;
      if (delta === 0) return { delta };
      // Autre dépôt qui absorbe la contrepartie : le dépôt par défaut, sinon un autre dépôt du magasin.
      const counterpart = await tx.location.findFirst({
        where: { storeId: ctx.store.id, id: { not: d.locationId }, active: true },
        orderBy: [{ isDefault: "desc" }, { position: "asc" }],
        select: { id: true, name: true },
      });
      if (!counterpart) throw new InventoryTxError("Créez un second dépôt pour répartir le stock.");
      await applyLevelDeltaTx(tx, { storeId: ctx.store.id, locationId: d.locationId, productId: d.productId, variantId: d.variantId ?? null, delta });
      await applyLevelDeltaTx(tx, { storeId: ctx.store.id, locationId: counterpart.id, productId: d.productId, variantId: d.variantId ?? null, delta: -delta });
      // Mouvements traçables (neutres pour l'agrégat).
      await tx.inventoryMovement.createMany({
        data: [
          { storeId: ctx.store.id, productId: d.productId, variantId: d.variantId ?? null, locationId: d.locationId, delta, reason: "TRANSFER", note: `Répartition depuis ${counterpart.name}`.slice(0, 250), actorId: ctx.user.id },
          { storeId: ctx.store.id, productId: d.productId, variantId: d.variantId ?? null, locationId: counterpart.id, delta: -delta, reason: "TRANSFER", note: `Répartition vers ${target.name}`.slice(0, 250), actorId: ctx.user.id },
        ],
      });
      await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "inventory.assign_location", target: itemKey, metadata: { locationId: d.locationId, from: current, to: d.quantity, counterpartId: counterpart.id } }, tx);
      return { delta };
    });
    if (!result.ok) return fail(result.error);
    revalidate(ctx.store.id);
    return success(undefined, result.value.delta === 0 ? "Quantité inchangée" : `Stock réparti (${result.value.delta > 0 ? "+" : ""}${result.value.delta})`);
  });
}

/* ───────────────────────── Transferts ───────────────────────── */

const transferSchema = z.object({
  storeId: z.string(),
  fromLocationId: z.string(),
  toLocationId: z.string(),
  note: zOptionalString,
});

export async function createTransfer(_prev: ActionResult<{ id: string }> | undefined, formData: FormData): Promise<ActionResult<{ id: string }>> {
  return guard(async () => {
    const parsed = parseForm(transferSchema, formData);
    if ("error" in parsed) return parsed.error;
    const d = parsed.data;
    const ctx = await requireStore(d.storeId, "products.manage");
    const bad = badIds(d.fromLocationId, d.toLocationId);
    if (bad) return bad;
    if (!PLANS[ctx.planId].features.stockTransfers) {
      return fail(`Les transferts entre dépôts sont inclus à partir du plan Business (plan actuel : ${PLANS[ctx.planId].name}). Changez de plan depuis la page Abonnement.`);
    }
    const items = parseLines(formData);
    const invalid = validateTransferDraft({ fromLocationId: d.fromLocationId, toLocationId: d.toLocationId, items });
    if (invalid) return fail(invalid);

    const locations = await db.location.findMany({ where: { storeId: ctx.store.id, id: { in: [d.fromLocationId, d.toLocationId] } }, select: { id: true } });
    if (locations.length !== 2) return fail("Dépôt introuvable.");
    const productIds = [...new Set(items.map((i) => i.productId))];
    const known = await db.product.findMany({ where: { storeId: ctx.store.id, id: { in: productIds } }, select: { id: true } });
    if (known.length !== productIds.length) return fail("Un produit du transfert n'appartient pas à cette boutique.");

    const transfer = await db.$transaction(async (tx) => {
      const created = await tx.stockTransfer.create({
        data: {
          storeId: ctx.store.id,
          reference: randomReference("TR"),
          fromLocationId: d.fromLocationId,
          toLocationId: d.toLocationId,
          status: "DRAFT",
          note: d.note ?? null,
          createdById: ctx.user.id,
          items: { create: items.map((i) => ({ productId: i.productId, variantId: i.variantId, quantity: i.quantity })) },
        },
        select: { id: true, reference: true },
      });
      await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "stock_transfer.created", target: created.id, metadata: { reference: created.reference, lines: items.length } }, tx);
      return created;
    });
    revalidate(ctx.store.id);
    return success({ id: transfer.id }, `Transfert ${transfer.reference} créé`);
  });
}

async function loadTransfer(storeId: string, id: string) {
  return db.stockTransfer.findFirst({
    where: { id, storeId },
    select: { id: true, reference: true, status: true, fromLocationId: true, toLocationId: true, items: { select: { id: true, productId: true, variantId: true, quantity: true, receivedQuantity: true } } },
  });
}

/** Expédition : sortie conditionnelle du dépôt source (TRANSFER négatif), stock agrégé inchangé. */
export async function shipTransfer(storeId: string, id: string): Promise<ActionResult> {
  return guard(async () => {
    const bad = badIds(storeId, id);
    if (bad) return bad;
    const ctx = await requireStore(storeId, "products.manage");
    const transfer = await loadTransfer(ctx.store.id, id);
    if (!transfer) return fail("Transfert introuvable.");
    if (!canTransitionTransfer(transfer.status as TransferStatusValue, "IN_TRANSIT")) return fail("Ce transfert ne peut plus être expédié.");

    // Expédition TOUT OU RIEN : un refus (verrou perdu, stock source insuffisant) est levé, jamais
    // renvoyé — sinon la transaction serait validée avec un transfert IN_TRANSIT dont une ligne n'a
    // pas été sortie du dépôt, et la réception créerait ce stock de rien (majeur n° 3).
    const outcome = await inTransaction(async (tx) => {
      // Verrou de ligne : deux expéditions simultanées du même transfert ne sortent pas le stock deux fois.
      const locked = await tx.stockTransfer.updateMany({ where: { id, storeId: ctx.store.id, status: "DRAFT" }, data: { status: "IN_TRANSIT", shippedAt: new Date() } });
      if (locked.count === 0) throw new InventoryTxError("Ce transfert ne peut plus être expédié.");
      for (const it of transfer.items) {
        const done = await applyLevelDeltaIfAvailableTx(tx, { storeId: ctx.store.id, locationId: transfer.fromLocationId, productId: it.productId, variantId: it.variantId, delta: -it.quantity });
        if (!done) throw new InventoryTxError("Stock insuffisant dans le dépôt source pour une des lignes : le transfert reste en brouillon.");
        await tx.inventoryMovement.create({
          data: { storeId: ctx.store.id, productId: it.productId, variantId: it.variantId, locationId: transfer.fromLocationId, delta: -it.quantity, reason: "TRANSFER", note: `Transfert ${transfer.reference} (sortie)`, actorId: ctx.user.id },
        });
      }
      await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "stock_transfer.shipped", target: id, metadata: { reference: transfer.reference } }, tx);
    });
    if (!outcome.ok) return fail(outcome.error);
    revalidate(ctx.store.id);
    return success(undefined, "Transfert expédié");
  });
}

const receiveSchema = z.object({ storeId: z.string(), id: z.string(), lossReason: zOptionalString });

/** Réception : RECEIVE positif à la destination ; l'écart est déclaré en perte (motif obligatoire). */
export async function receiveTransfer(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const parsed = parseForm(receiveSchema, formData);
    if ("error" in parsed) return parsed.error;
    const d = parsed.data;
    const ctx = await requireStore(d.storeId, "products.manage");
    const bad = badIds(d.id);
    if (bad) return bad;
    const transfer = await loadTransfer(ctx.store.id, d.id);
    if (!transfer) return fail("Transfert introuvable.");
    if (!canTransitionTransfer(transfer.status as TransferStatusValue, "RECEIVED")) return fail("Ce transfert n'est pas en transit.");

    const received = new Map<string, number>();
    for (const [key, raw] of formData.entries()) {
      if (!key.startsWith("received-")) continue;
      const parsedQty = zQty.safeParse(raw);
      if (parsedQty.success) received.set(key.slice(9), parsedQty.data);
    }
    const plan = receivePlan(transfer.items, received);
    if (plan.totalMissing > 0 && !d.lossReason) return fail("Indiquez le motif de l'écart (perte, casse, vol…).", { lossReason: ["Motif requis"] });

    const outcome = await inTransaction(async (tx) => {
      const locked = await tx.stockTransfer.updateMany({ where: { id: d.id, storeId: ctx.store.id, status: "IN_TRANSIT" }, data: { status: "RECEIVED", receivedAt: new Date() } });
      if (locked.count === 0) throw new InventoryTxError("Ce transfert n'est plus en transit.");
      for (const line of plan.lines) {
        await tx.stockTransferItem.update({ where: { id: line.itemId }, data: { receivedQuantity: line.received } });
        // `credit` = unités reçues MAINTENANT (bornées au reste réellement sorti de la source) ;
        // `received` = cumul écrit sur la ligne. Les confondre créditerait deux fois une réception partielle.
        if (line.credit > 0) {
          await applyLevelDeltaTx(tx, { storeId: ctx.store.id, locationId: transfer.toLocationId, productId: line.productId, variantId: line.variantId, delta: line.credit });
          await tx.inventoryMovement.create({
            data: { storeId: ctx.store.id, productId: line.productId, variantId: line.variantId, locationId: transfer.toLocationId, delta: line.credit, reason: "RECEIVE", note: `Transfert ${transfer.reference} (réception)`, actorId: ctx.user.id },
          });
        }
        if (line.missing > 0) {
          // Perte en transit : le stock agrégé baisse, aucun dépôt n'est crédité (l'invariant reste tenu).
          await recordStockChangeTx(tx, {
            storeId: ctx.store.id,
            locationId: null,
            productId: line.productId,
            variantId: line.variantId,
            delta: -line.missing,
            reason: "ADJUSTMENT",
            note: `Perte en transit ${transfer.reference} : ${d.lossReason}`,
            actorId: ctx.user.id,
          });
        }
      }
      await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "stock_transfer.received", target: d.id, metadata: { reference: transfer.reference, missing: plan.totalMissing, lossReason: d.lossReason ?? null } }, tx);
    });
    if (!outcome.ok) return fail(outcome.error);
    revalidate(ctx.store.id);
    return success(undefined, plan.totalMissing > 0 ? `Transfert reçu (${plan.totalMissing} manquant${plan.totalMissing > 1 ? "s" : ""} déclaré${plan.totalMissing > 1 ? "s" : ""} en perte)` : "Transfert reçu");
  });
}

/** Annulation : brouillon simple, ou restitution au dépôt source si le transfert était en transit. */
export async function cancelTransfer(storeId: string, id: string): Promise<ActionResult> {
  return guard(async () => {
    const bad = badIds(storeId, id);
    if (bad) return bad;
    const ctx = await requireStore(storeId, "products.manage");
    const transfer = await loadTransfer(ctx.store.id, id);
    if (!transfer) return fail("Transfert introuvable.");
    const from = transfer.status as TransferStatusValue;
    if (!canTransitionTransfer(from, "CANCELLED")) return fail("Ce transfert ne peut plus être annulé.");

    const outcome = await inTransaction(async (tx) => {
      const locked = await tx.stockTransfer.updateMany({ where: { id, storeId: ctx.store.id, status: from }, data: { status: "CANCELLED" } });
      if (locked.count === 0) throw new InventoryTxError("Ce transfert vient de changer d'état.");
      if (from === "IN_TRANSIT") {
        for (const it of transfer.items) {
          await applyLevelDeltaTx(tx, { storeId: ctx.store.id, locationId: transfer.fromLocationId, productId: it.productId, variantId: it.variantId, delta: it.quantity });
          await tx.inventoryMovement.create({
            data: { storeId: ctx.store.id, productId: it.productId, variantId: it.variantId, locationId: transfer.fromLocationId, delta: it.quantity, reason: "RECEIVE", note: `Transfert ${transfer.reference} annulé (restitution)`, actorId: ctx.user.id },
          });
        }
      }
      await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "stock_transfer.cancelled", target: id, metadata: { reference: transfer.reference, from } }, tx);
    });
    if (!outcome.ok) return fail(outcome.error);
    revalidate(ctx.store.id);
    return success(undefined, "Transfert annulé");
  });
}

/* ───────────────────────── Inventaire tournant ───────────────────────── */

const countSchema = z.object({ storeId: z.string(), locationId: z.string(), note: zOptionalString });

/** Saisie des quantités comptées dans un dépôt : écart écrit en `COUNT` (niveau + agrégat), audité. */
export async function submitCount(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const parsed = parseForm(countSchema, formData);
    if ("error" in parsed) return parsed.error;
    const d = parsed.data;
    const ctx = await requireStore(d.storeId, "products.manage");
    const bad = badIds(d.locationId);
    if (bad) return bad;
    const location = await db.location.findFirst({ where: { id: d.locationId, storeId: ctx.store.id }, select: { id: true, name: true } });
    if (!location) return fail("Dépôt introuvable.");

    const counted = new Map<string, number>();
    for (const [key, raw] of formData.entries()) {
      if (!key.startsWith("count-")) continue;
      const q = zQty.safeParse(raw);
      if (q.success) counted.set(key.slice(6), q.data);
    }
    if (!counted.size) return fail("Saisissez au moins une quantité comptée.");

    const levels = await db.inventoryLevel.findMany({
      where: { storeId: ctx.store.id, locationId: d.locationId, itemKey: { in: [...counted.keys()] } },
      select: { itemKey: true, productId: true, variantId: true, available: true },
    });
    /**
     * Résolution des articles comptés (majeur n° 5). `itemKey` vaut `variantId ?? productId` : il ne
     * suffit PAS de le prendre pour un `productId` quand le dépôt n'a pas encore de niveau pour cet
     * article — compter une variante jamais réapprovisionnée ici faisait échouer TOUT le comptage.
     * Les clés sans niveau sont donc résolues en base : variante d'abord (filtrée par la boutique du
     * produit), produit ensuite.
     */
    const unknownKeys = [...counted.keys()].filter((key) => !levels.some((l) => l.itemKey === key));
    const resolved = new Map<string, { productId: string; variantId: string | null }>();
    if (unknownKeys.length) {
      const variants = await db.variant.findMany({
        where: { id: { in: unknownKeys }, product: { storeId: ctx.store.id } },
        select: { id: true, productId: true },
      });
      for (const v of variants) resolved.set(v.id, { productId: v.productId, variantId: v.id });
      const rest = unknownKeys.filter((key) => !resolved.has(key));
      if (rest.length) {
        const products = await db.product.findMany({ where: { id: { in: rest }, storeId: ctx.store.id }, select: { id: true } });
        for (const prod of products) resolved.set(prod.id, { productId: prod.id, variantId: null });
      }
      if (resolved.size !== unknownKeys.length) return fail("Un article compté est inconnu de cette boutique.");
    }
    // Un article compté sans niveau existant part de 0.
    const lines: CountedLine[] = [...counted.keys()].map((itemKey) => {
      const level = levels.find((l) => l.itemKey === itemKey);
      const item = level ?? resolved.get(itemKey)!;
      return {
        itemKey,
        productId: item.productId,
        variantId: item.variantId ?? null,
        available: level?.available ?? 0,
        counted: counted.get(itemKey) ?? null,
      };
    });
    const deltas = countPlan(lines);
    if (!deltas.length) return success(undefined, "Aucun écart : stock confirmé");

    await db.$transaction(async (tx) => {
      for (const delta of deltas) {
        await recordStockChangeTx(tx, {
          storeId: ctx.store.id,
          locationId: d.locationId,
          productId: delta.productId,
          variantId: delta.variantId,
          delta: delta.delta,
          reason: "COUNT",
          note: `Inventaire ${location.name}${d.note ? ` — ${d.note}` : ""}`,
          actorId: ctx.user.id,
        });
      }
      await audit({ storeId: ctx.store.id, actorId: ctx.user.id, action: "inventory.count", target: d.locationId, metadata: { ...countSummary(deltas), note: d.note ?? null } }, tx);
    });
    revalidate(ctx.store.id);
    const s = countSummary(deltas);
    return success(undefined, `Inventaire enregistré : ${s.lines} écart${s.lines > 1 ? "s" : ""} (+${s.added} / −${s.removed})`);
  });
}
