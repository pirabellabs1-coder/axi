import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { savedSectionLimit, savedSectionsEnabled, toSavedSectionDTO } from "@/lib/saved-sections/rules";
import { ownerExists, writeOwnerMetafields } from "@/lib/metafields/server";
import { listMetafieldDefinitions } from "@/lib/metafields/read";
import { metafieldText } from "@/lib/metafields/validate";
import { formatMoney } from "@/lib/money";
import { defineTool, ToolError, type McpTool } from "../protocol";
import type { MerchantContext } from "../auth";
import { assertWritable, auditApi, requireFeature, revalidate, zId } from "./common";

type Ctx = MerchantContext;

/** Propriétaires modifiables avec le scope catalog:write (jamais client ni commande par ce scope). */
const CATALOG_OWNERS = ["PRODUCT", "VARIANT", "COLLECTION"] as const;

export const setMetafield = defineTool({
  name: "set_metafield",
  title: "Set a custom field value",
  description:
    "Set (or clear with value null) a merchant-defined custom field (metafield) on a product, variant or collection. The field must already be defined in Axi (Settings > Custom fields); the value is validated against its type (single_line_text: string, integer/decimal/rating: number, boolean, date: YYYY-MM-DD, color: #rrggbb, url, image: {url, alt?}, product_reference/collection_reference: id from this store, list_single_line_text: string[], dimension: {value, unit: mm|cm|m|in|ft}, weight: {value, unit: g|kg|lb|oz}, money: {amount} integer in store currency). Call without value errors to see available fields.",
  scopes: ["catalog:write"],
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  input: z.object({
    owner_type: z.enum(CATALOG_OWNERS).describe("PRODUCT, VARIANT or COLLECTION."),
    owner_id: zId.describe("Id of the product, variant or collection (from search_products / get_product / list_collections)."),
    namespace: z.string().regex(/^[a-z0-9_]{1,32}$/).default("custom").describe("Field namespace, usually 'custom'."),
    key: z.string().regex(/^[a-z0-9_]{1,64}$/).describe("Field key, e.g. 'matiere'."),
    value: z.unknown().describe("New value (JSON, shape depends on the field type), or null to clear."),
  }),
  handler: async (ctx: Ctx, a) => {
    assertWritable(ctx);
    requireFeature(ctx, "metafields", "Custom fields");
    const defs = await listMetafieldDefinitions(ctx.store.id, a.owner_type);
    const def = defs.find((d) => d.namespace === a.namespace && d.key === a.key);
    if (!def) {
      const list = defs.map((d) => `${d.namespace}.${d.key} (${d.type})`).join(", ") || "none";
      throw new ToolError(`No custom field ${a.namespace}.${a.key} for ${a.owner_type}. Available: ${list}. Fields are created by the merchant in Axi.`, "not_found");
    }
    if (!(await ownerExists(db, ctx.store.id, a.owner_type, a.owner_id))) throw new ToolError(`${a.owner_type} not found in this store.`, "not_found");
    const res = await db.$transaction(async (tx) => {
      const r = await writeOwnerMetafields(tx, { storeId: ctx.store.id, currency: ctx.store.currency, ownerType: a.owner_type, ownerId: a.owner_id, entries: [{ definitionId: def.id, value: a.value ?? null }] });
      if (Object.keys(r.errors).length) return r;
      await auditApi(ctx, "metafield.values.update", `${a.owner_type}:${a.owner_id}`, { key: `${def.namespace}.${def.key}`, written: r.written, deleted: r.deleted }, tx);
      return r;
    });
    const error = Object.values(res.errors)[0];
    if (error) throw new ToolError(`Invalid value for ${def.namespace}.${def.key} (${def.type}): ${error}`, "invalid_value");
    revalidate(ctx, a.owner_type === "COLLECTION" ? `collections/${a.owner_id}` : "produits");
    const cleared = res.deleted > 0 && res.written === 0;
    const text = cleared ? "" : metafieldText(def.type, a.value, { formatMoney, validations: def.validations });
    return {
      text: cleared ? `${def.name} cleared.` : `${def.name} set${text ? ` to "${text}"` : ""}.${def.storefrontVisible ? " Visible in the store where the theme shows it." : " Private field (not shown in the store)."}`,
      data: { owner_type: a.owner_type, owner_id: a.owner_id, key: `${def.namespace}.${def.key}`, type: def.type, cleared, storefront_visible: def.storefrontVisible },
    };
  },
});

export const listSavedSectionsTool = defineTool({
  name: "list_saved_sections",
  title: "List saved theme sections",
  description: "List the theme sections the merchant saved for reuse (name, section type, pages where it can be inserted, usage count), with the plan limit.",
  scopes: ["store:read", "theme:write"],
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  input: z.object({}),
  handler: async (ctx: Ctx) => {
    const rows = await db.savedSection.findMany({ where: { storeId: ctx.store.id }, orderBy: [{ usageCount: "desc" }, { updatedAt: "desc" }], take: 200 });
    const items = rows.map(toSavedSectionDTO);
    const limit = savedSectionLimit(ctx.planId);
    const head = !savedSectionsEnabled(ctx.planId) ? "Saved sections are not included in the current plan (Starter and above)." : `${items.length} saved section(s)${limit === null ? " (unlimited)" : ` of ${limit}`}.`;
    return {
      text: [head, ...items.map((s) => `- ${s.name} [${s.sectionName}] used ${s.usageCount}x, pages: ${s.templates.join(", ")} (id ${s.id})`)].join("\n"),
      data: { saved_sections: items.map((s) => ({ id: s.id, name: s.name, section_type: s.sectionType, templates: s.templates, usage_count: s.usageCount, created_at: s.createdAt })), limit, enabled: savedSectionsEnabled(ctx.planId) },
    };
  },
});

export const METAFIELD_TOOLS: McpTool<Ctx>[] = [setMetafield, listSavedSectionsTool];
