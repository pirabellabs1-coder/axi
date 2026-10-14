/**
 * Base Prisma factice en mémoire pour les tests (sous-ensemble suffisant : filtres d'égalité, in/notIn,
 * comparaisons, OR/AND/NOT, clés composées, include/select de relations simples, transactions).
 * Ce n'est PAS un émulateur complet : uniquement ce qu'utilisent les modules testés.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

type Row = Record<string, any>;

/** relation → [table, clé étrangère sur la ligne courante] */
const RELATIONS: Record<string, [string, string]> = {
  store: ["store", "storeId"],
  grant: ["oAuthGrant", "grantId"],
  client: ["oAuthClient", "clientId"],
  user: ["user", "userId"],
  createdBy: ["user", "createdById"],
  product: ["product", "productId"],
};

/** relation 1-n → [table enfant, clé étrangère sur l'enfant] (include/select de listes, ex. product.variants). */
const HAS_MANY: Record<string, [string, string]> = {
  variants: ["variant", "productId"],
  optionGroups: ["optionGroup", "productId"],
  options: ["option", "groupId"],
  items: ["orderItem", "orderId"],
};

/**
 * Relations propres à un modèle (lot 1), prioritaires sur RELATIONS / HAS_MANY pour ce modèle seulement :
 * même nom de relation, tables différentes (ex. returnRequest.items → returnItem, alors que order.items → orderItem).
 * Les modèles existants ne figurent pas ici : leur comportement est inchangé.
 */
const MODEL_RELATIONS: Record<string, Record<string, [string, string]>> = {
  customerOtp: { customer: ["customer", "customerId"] },
  customerSession: { customer: ["customer", "customerId"] },
  customerAddress: { customer: ["customer", "customerId"], deliveryZone: ["deliveryZone", "deliveryZoneId"] },
  customerFavorite: { customer: ["customer", "customerId"] },
  orderDiscount: { order: ["order", "orderId"], automaticDiscount: ["automaticDiscount", "automaticDiscountId"], coupon: ["coupon", "couponId"] },
  cartOffer: { automaticDiscount: ["automaticDiscount", "automaticDiscountId"] },
  giftCard: { customer: ["customer", "customerId"] },
  giftCardTransaction: { giftCard: ["giftCard", "giftCardId"], order: ["order", "orderId"] },
  storeCreditTransaction: { customer: ["customer", "customerId"] },
  returnRequest: { order: ["order", "orderId"], customer: ["customer", "customerId"] },
  returnItem: { returnRequest: ["returnRequest", "returnId"], orderItem: ["orderItem", "orderItemId"] },
  returnEvent: { returnRequest: ["returnRequest", "returnId"] },
  // Lot 1 bis : paiements Wave / Orange (tentative → moyen de paiement, commande)
  paymentAttempt: { paymentMethod: ["paymentMethod", "paymentMethodId"], order: ["order", "orderId"] },
  // Lot 1 bis : catalogue WhatsApp / Meta
  socialCatalogItem: { sync: ["socialCatalogSync", "syncId"] },
  // Lot 2 (store et product : relations génériques)
  orderInvoice: { order: ["order", "orderId"] },
  blogPost: { category: ["blogCategory", "categoryId"] },
  webhookDelivery: { endpoint: ["webhookEndpoint", "endpointId"] },
  // Lot 4
  metafieldValue: { definition: ["metafieldDefinition", "definitionId"] },
  consent: { customer: ["customer", "customerId"] }, // Lot 4D (CAN) : consentement PUSH filtré par boutique du client
  // Vague 2 : produits numériques (accès de téléchargement → commande, ligne, boutique, client)
  downloadGrant: { order: ["order", "orderId"], orderItem: ["orderItem", "orderItemId"], store: ["store", "storeId"], customer: ["customer", "customerId"] },
  digitalAsset: { product: ["product", "productId"], variant: ["variant", "variantId"] },
  experimentStat: { experiment: ["experiment", "experimentId"] },
  // Lot 3 : opérations.
  inventoryLevel: { location: ["location", "locationId"], variant: ["variant", "variantId"] },
  inventoryMovement: { location: ["location", "locationId"], variant: ["variant", "variantId"] },
  stockTransfer: { fromLocation: ["location", "fromLocationId"], toLocation: ["location", "toLocationId"] },
  shipment: { order: ["order", "orderId"], location: ["location", "locationId"], carrierAccount: ["carrierAccount", "carrierAccountId"] },
  shipmentItem: { shipment: ["shipment", "shipmentId"], orderItem: ["orderItem", "orderItemId"] },
  shipmentEvent: { shipment: ["shipment", "shipmentId"] },
  posDevice: { location: ["location", "locationId"] },
  posSession: { device: ["posDevice", "deviceId"] },
  shippingRate: { zone: ["deliveryZone", "zoneId"], carrierAccount: ["carrierAccount", "carrierAccountId"] },
  // Rapport Z : remboursements rattachés aux ventes d'une session (`order.posSessionId`).
  refund: { order: ["order", "orderId"] },
};

const MODEL_HAS_MANY: Record<string, Record<string, [string, string]>> = {
  automaticDiscount: { applications: ["orderDiscount", "automaticDiscountId"], cartOffers: ["cartOffer", "automaticDiscountId"] },
  giftCard: { transactions: ["giftCardTransaction", "giftCardId"] },
  returnRequest: { items: ["returnItem", "returnId"], events: ["returnEvent", "returnId"] },
  socialCatalogSync: { items: ["socialCatalogItem", "syncId"] },
  blogCategory: { posts: ["blogPost", "categoryId"] },
  webhookEndpoint: { deliveries: ["webhookDelivery", "endpointId"] },
  metafieldDefinition: { values: ["metafieldValue", "definitionId"] },
  experiment: { stats: ["experimentStat", "experimentId"] },
  // Modèles existants : ajouts seulement (les relations génériques restent inchangées) ; subscription.invoices n'est pas concerné.
  product: { prices: ["productPrice", "productId"] },
  order: { invoices: ["orderInvoice", "orderId"], paymentAttempts: ["paymentAttempt", "orderId"] },
  // Lot 3 : opérations (dépôts, transferts, expéditions, caisse).
  stockTransfer: { items: ["stockTransferItem", "transferId"] },
  shipment: { items: ["shipmentItem", "shipmentId"], events: ["shipmentEvent", "shipmentId"] },
  posSession: { cashMoves: ["posCashMovement", "sessionId"] },
};

const relationsOf = (model?: string) => (model && MODEL_RELATIONS[model] ? { ...RELATIONS, ...MODEL_RELATIONS[model] } : RELATIONS);
const hasManyOf = (model?: string) => (model && MODEL_HAS_MANY[model] ? { ...HAS_MANY, ...MODEL_HAS_MANY[model] } : HAS_MANY);

function isPlainObject(v: unknown): v is Record<string, any> {
  return !!v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date);
}

function eq(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return (a ?? null) === (b ?? null);
}

function cmp(a: any, b: any): number {
  const x = a instanceof Date ? a.getTime() : a;
  const y = b instanceof Date ? b.getTime() : b;
  return x < y ? -1 : x > y ? 1 : 0;
}

export function createFakeDb(seed: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = {};
  for (const [k, rows] of Object.entries(seed)) tables[k] = rows.map((r) => ({ ...r }));
  let seq = 0;
  const calls: { model: string; op: string; args: any }[] = [];
  const table = (name: string) => (tables[name] ??= []);

  const match = (row: Row, where: any, modelName?: string): boolean => {
    if (!where) return true;
    const relations = relationsOf(modelName);
    return Object.entries(where).every(([k, v]) => {
      if (v === undefined) return true;
      if (k === "OR") return (v as any[]).some((w) => match(row, w, modelName));
      if (k === "AND") return (Array.isArray(v) ? v : [v]).every((w) => match(row, w, modelName));
      if (k === "NOT") return !(Array.isArray(v) ? v : [v]).some((w) => match(row, w, modelName));
      if (isPlainObject(v)) {
        if (!(k in row) && !(k in relations)) return match(row, v, modelName); // clé composée (userId_storeId…)
        if (k in relations && !(k in row)) {
          const [t, fk] = relations[k]!;
          const rel = table(t).find((r) => r.id === row[fk]);
          return !!rel && match(rel, v, t);
        }
        const val = row[k];
        // Filtre JSON Prisma { path: [...], equals } (ex. clé d'idempotence dans payload).
        if (Array.isArray(v.path)) {
          const nested = (v.path as string[]).reduce((o: any, key) => (o == null ? undefined : o[key]), val);
          return "equals" in v ? eq(nested, v.equals) : true;
        }
        return Object.entries(v).every(([op, x]) => {
          switch (op) {
            case "in": return (x as any[]).some((y) => eq(val, y));
            case "notIn": return !(x as any[]).some((y) => eq(val, y));
            case "not": return isPlainObject(x) ? !match({ [k]: val }, { [k]: x }, modelName) : !eq(val, x);
            case "gt": return val != null && cmp(val, x) > 0;
            case "gte": return val != null && cmp(val, x) >= 0;
            case "lt": return val != null && cmp(val, x) < 0;
            case "lte": return val != null && cmp(val, x) <= 0;
            case "has": return Array.isArray(val) && val.includes(x);
            case "contains": return typeof val === "string" && val.toLowerCase().includes(String(x).toLowerCase());
            case "mode": return true;
            case "equals": return eq(val, x);
            default: return true;
          }
        });
      }
      return eq(row[k], v);
    });
  };

  const attach = (row: Row | undefined | null, spec: any, modelName?: string): any => {
    if (!row) return row ?? null;
    const out: Row = { ...row };
    const rels = spec?.include ?? spec?.select;
    if (!rels) return out;
    const relations = relationsOf(modelName);
    const hasMany = hasManyOf(modelName);
    for (const [rel, sub] of Object.entries(rels)) {
      if (!sub) continue;
      if (rel === "subscription") {
        out.subscription = table("subscription").find((s) => s.storeId === row.id) ?? null;
        continue;
      }
      if (rel === "_count") continue;
      // Liste déjà portée par la ligne (données de test en ligne) : conservée telle quelle.
      if (hasMany[rel] && !(rel in relations) && !Array.isArray(row[rel])) {
        const [t, fk] = hasMany[rel]!;
        const subSpec = sub === true ? undefined : sub;
        const children = table(t).filter((r) => r[fk] === row.id && match(r, (subSpec as any)?.where, t));
        out[rel] = children.map((c) => attach(c, subSpec, t));
        continue;
      }
      const def = relations[rel];
      if (!def) continue;
      const [t, fk] = def;
      const target = table(t).find((r) => r.id === row[fk]);
      out[rel] = attach(target, sub === true ? undefined : sub, t);
    }
    return out;
  };

  const apply = (row: Row, data: Row) => {
    for (const [k, v] of Object.entries(data)) {
      if (isPlainObject(v) && "increment" in v) row[k] = (row[k] ?? 0) + v.increment;
      else if (isPlainObject(v) && "decrement" in v) row[k] = (row[k] ?? 0) - v.decrement;
      else row[k] = v;
    }
    row.updatedAt = new Date();
  };

  const model = (name: string) => ({
    findUnique: async (args: any) => (calls.push({ model: name, op: "findUnique", args }), attach(table(name).find((r) => match(r, args.where, name)), args, name)),
    findUniqueOrThrow: async (args: any) => {
      const r = table(name).find((x) => match(x, args.where, name));
      if (!r) throw new Error(`${name} not found`);
      return attach(r, args, name);
    },
    findFirst: async (args: any = {}) => (calls.push({ model: name, op: "findFirst", args }), attach(table(name).find((r) => match(r, args.where, name)), args, name)),
    findFirstOrThrow: async (args: any = {}) => {
      calls.push({ model: name, op: "findFirstOrThrow", args });
      const r = table(name).find((x) => match(x, args.where, name));
      if (!r) throw new Error(`${name} not found`);
      return attach(r, args, name);
    },
    findMany: async (args: any = {}) => {
      calls.push({ model: name, op: "findMany", args });
      const rows = table(name).filter((r) => match(r, args.where, name));
      return rows.slice(0, args.take ?? rows.length).map((r) => attach(r, args, name));
    },
    count: async (args: any = {}) => (calls.push({ model: name, op: "count", args }), table(name).filter((r) => match(r, args.where, name)).length),
    create: async (args: any) => {
      calls.push({ model: name, op: "create", args });
      const row: Row = { id: `${name}_${++seq}`, createdAt: new Date(), ...args.data };
      // Création imbriquée d'une relation 1-n (ex. order.items: { create: [...] }) : lignes enfants matérialisées.
      for (const [rel, [childTable, fk]] of Object.entries(hasManyOf(name))) {
        const v = row[rel];
        if (isPlainObject(v) && "create" in v) {
          for (const c of Array.isArray(v.create) ? v.create : [v.create]) table(childTable).push({ id: `${childTable}_${++seq}`, createdAt: new Date(), ...c, [fk]: row.id });
          delete row[rel];
        }
      }
      table(name).push(row);
      return attach(row, args, name);
    },
    createMany: async (args: any) => {
      for (const d of args.data) table(name).push({ id: `${name}_${++seq}`, createdAt: new Date(), ...d });
      return { count: args.data.length };
    },
    update: async (args: any) => {
      calls.push({ model: name, op: "update", args });
      const row = table(name).find((r) => match(r, args.where, name));
      if (!row) throw new Error(`${name} not found`);
      apply(row, args.data);
      return attach(row, args, name);
    },
    updateMany: async (args: any) => {
      calls.push({ model: name, op: "updateMany", args });
      const rows = table(name).filter((r) => match(r, args.where, name));
      for (const r of rows) apply(r, args.data);
      return { count: rows.length };
    },
    delete: async (args: any) => {
      const i = table(name).findIndex((r) => match(r, args.where, name));
      return i >= 0 ? table(name).splice(i, 1)[0] : null;
    },
    deleteMany: async (args: any = {}) => {
      const keep = table(name).filter((r) => !match(r, args.where, name));
      const n = table(name).length - keep.length;
      tables[name] = keep;
      return { count: n };
    },
    upsert: async (args: any) => {
      calls.push({ model: name, op: "upsert", args });
      const row = table(name).find((r) => match(r, args.where, name));
      if (row) {
        apply(row, args.update);
        return row;
      }
      const created: Row = { id: `${name}_${++seq}`, createdAt: new Date(), ...args.create };
      table(name).push(created);
      return created;
    },
    aggregate: async () => ({ _count: { _all: 0 }, _sum: {} }),
    groupBy: async () => [],
  });

  const models: Record<string, ReturnType<typeof model>> = {};
  const db: any = new Proxy(
    {
      $transaction: async (arg: any) => (typeof arg === "function" ? arg(db) : Promise.all(arg)),
      $queryRaw: async (sql: TemplateStringsArray | string, ...values: unknown[]) => {
        calls.push({ model: "$raw", op: "queryRaw", args: { sql: typeof sql === "string" ? sql : sql.join("?"), values } });
        return [];
      },
      // Verrous consultatifs (pg_advisory_xact_lock) : sans effet en mémoire.
      $executeRaw: async (sql: TemplateStringsArray | string, ...values: unknown[]) => {
        calls.push({ model: "$raw", op: "executeRaw", args: { sql: typeof sql === "string" ? sql : sql.join("?"), values } });
        return 0;
      },
    },
    {
      get(target: any, prop: string) {
        if (prop in target) return target[prop];
        if (prop === "then") return undefined;
        return (models[prop] ??= model(prop));
      },
    },
  );
  return { db, tables, calls };
}
