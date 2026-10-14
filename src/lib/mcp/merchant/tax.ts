import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { PLANS } from "@/config/plans";
import { TAX_DISCLAIMER, TAX_REGIME_LABELS } from "@/config/taxes";
import { collectsTax, parseTaxRegistration } from "@/lib/tax/registration";
import { formatRateBps } from "@/lib/tax/compute";
import { defineTool, type McpTool } from "../protocol";
import type { MerchantContext } from "../auth";

type Ctx = MerchantContext;

/** Lot 2 (T) : réglages fiscaux de la boutique, en lecture (store:read). Aucun conseil fiscal. */
export const getTaxSettings = defineTool({
  name: "get_tax_settings",
  title: "Get tax settings",
  description:
    "Read the store's VAT / tax configuration: whether taxes are collected, prices including (TTC) or excluding (HT) tax, tax regime (TVA, TPS…), tax identity printed on invoices, configured rates per country and category, and invoicing options. Read-only; Axi does not give tax advice.",
  scopes: ["store:read"],
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  input: z.object({}),
  handler: async (ctx: Ctx) => {
    const [store, rates, invoices] = await Promise.all([
      db.store.findUnique({ where: { id: ctx.store.id }, select: { country: true, currency: true, taxesEnabled: true, pricesIncludeTax: true, taxRegistration: true } }),
      db.taxRate.findMany({ where: { storeId: ctx.store.id }, orderBy: [{ country: "asc" }, { taxCategory: "asc" }], take: 100, select: { id: true, name: true, country: true, regionKey: true, taxCategory: true, rateBps: true, appliesToShipping: true, active: true } }),
      db.orderInvoice.groupBy({ by: ["kind"], where: { storeId: ctx.store.id }, _count: { _all: true } }),
    ]);
    const reg = parseTaxRegistration(store?.taxRegistration);
    const features = PLANS[ctx.planId].features;
    const enabled = !!store?.taxesEnabled && features.taxes;
    const collecting = collectsTax(enabled, reg);
    const count = (kind: string) => invoices.find((i) => i.kind === kind)?._count._all ?? 0;
    const lines = [
      `Taxes: ${enabled ? (collecting ? "collected" : `enabled, regime ${reg.regime} (no VAT collected)`) : features.taxes ? "disabled" : "not included in the current plan (Starter and above)"}.`,
      `Prices ${store?.pricesIncludeTax ?? true ? "include tax (TTC)" : "exclude tax (HT): tax is added at checkout"}. Tax country: ${store?.country ?? "?"}.`,
      `Regime: ${TAX_REGIME_LABELS[reg.regime]}${reg.taxId ? `, tax id ${reg.taxId}` : ", no tax id (required to invoice VAT)"}.`,
      rates.length ? `Rates:\n${rates.map((r) => `- ${r.name} ${formatRateBps(r.rateBps)} % (${r.country}, ${r.taxCategory}${r.appliesToShipping ? ", shipping taxed" : ""}${r.active ? "" : ", inactive"})`).join("\n")}` : "No tax rate configured.",
      `Invoices issued: ${count("INVOICE")}, credit notes: ${count("CREDIT_NOTE")}; automatic issuing on payment: ${reg.autoIssueInvoices ? "on" : "off"}.`,
      TAX_DISCLAIMER,
    ];
    return {
      text: lines.join("\n"),
      data: {
        taxes_enabled: enabled,
        collects_vat: collecting,
        plan_includes_taxes: features.taxes,
        plan_includes_invoices: features.invoices,
        prices_include_tax: store?.pricesIncludeTax ?? true,
        country: store?.country ?? null,
        currency: store?.currency ?? ctx.store.currency,
        regime: reg.regime,
        legal_name: reg.legalName || null,
        tax_id: reg.taxId || null,
        rccm: reg.rccm || null,
        exemption_mention: reg.exemptionMention || null,
        auto_issue_invoices: reg.autoIssueInvoices,
        rates: rates.map((r) => ({ id: r.id, name: r.name, country: r.country, region: r.regionKey, category: r.taxCategory, rate_bps: r.rateBps, applies_to_shipping: r.appliesToShipping, active: r.active })),
        invoices_issued: count("INVOICE"),
        credit_notes_issued: count("CREDIT_NOTE"),
      },
    };
  },
});

export const TAX_TOOLS: McpTool<Ctx>[] = [getTaxSettings];
