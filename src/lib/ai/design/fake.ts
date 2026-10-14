/**
 * Client IA SIMULÉ (lot 4 §9 et §10), pour les tests automatisés et la recette locale.
 *
 * Activation : `AI_FAKE=1` ET environnement différent de `production`. En production la variable est
 * ignorée : aucune porte dérobée possible (contrôle dans `isFakeAi`, seul point d'entrée).
 * La sortie simulée passe par EXACTEMENT le même chemin que la sortie réelle (zod, garde-fous,
 * compilateur, validation) : elle vérifie le pipeline, pas le modèle.
 */
import type { StoreDesignData } from "./compile";
import type { StoreDesignBrief } from "./schema";

export function isFakeAi(): boolean {
  return process.env.AI_FAKE === "1" && process.env.NODE_ENV !== "production";
}

const SHAPES = [
  { id: "a", name: "Éditorial épuré", palette: { background: "#FAF9F6", surface: "#FFFFFF", text: "#16181A", primary: "#1F3A5F", accent: "#C96A3B" }, fonts: { heading: "cormorant", body: "manrope" }, buttons: { radius: 0, style: "outline" }, cards: { radius: 0, imageRatio: "portrait" }, density: "airy" },
  { id: "b", name: "Chaleureux coloré", palette: { background: "#FFF8F0", surface: "#FFFFFF", text: "#201510", primary: "#9A3412", accent: "#F5B82E" }, fonts: { heading: "outfit", body: "dm-sans" }, buttons: { radius: 20, style: "solid" }, cards: { radius: 18, imageRatio: "square" }, density: "balanced" },
  { id: "c", name: "Premium contrasté", palette: { background: "#F4F4F5", surface: "#FFFFFF", text: "#0B0B0C", primary: "#111827", accent: "#7CC6B6" }, fonts: { heading: "playfair", body: "inter-tight" }, buttons: { radius: 8, style: "soft" }, cards: { radius: 8, imageRatio: "landscape" }, density: "compact" },
] as const;

/** Brief simulé : 3 directions contrastées qui n'utilisent que des indices réels. */
export function fakeBrief(data: StoreDesignData, brief: string): StoreDesignBrief {
  const hasCollection = data.collections.length > 0;
  const hasPhoto = data.photos.length > 0;
  const hasProduct = data.products.length > 0;
  const intro = brief.trim().slice(0, 140);
  return {
    directions: SHAPES.map((s, i) => ({
      id: s.id,
      name: s.name,
      rationale: `Direction simulée ${i + 1} : ${intro || "ambiance adaptée au secteur"}.`,
      palette: { ...s.palette },
      fonts: { ...s.fonts },
      headingWeight: 600,
      buttons: { ...s.buttons },
      cards: { ...s.cards },
      density: s.density,
      announcement: i === 1 ? "Commandez sur WhatsApp, nous répondons vite." : null,
      home: [
        {
          type: "hero-banner" as const,
          preset: 0,
          scheme: "default" as const,
          copy: { heading: `${data.storeName}`, text: data.tagline ?? "Commandez en ligne, nous vous répondons sur WhatsApp.", button_label: "Découvrir" },
          image: hasPhoto ? { photoIndex: 0 } : null,
          collectionIndex: null,
          productIndexes: [],
        },
        ...(hasCollection
          ? [{ type: "collection-list" as const, preset: 0, scheme: "surface" as const, copy: { heading: "Nos catégories" }, image: null, collectionIndex: 0, productIndexes: [] }]
          : []),
        {
          type: "featured-collection" as const,
          preset: 0,
          scheme: "default" as const,
          copy: { heading: "Nos coups de cœur" },
          image: null,
          collectionIndex: hasCollection ? 0 : null,
          productIndexes: hasProduct ? [0, 1, 2] : [],
        },
        {
          type: "image-with-text" as const,
          preset: 0,
          scheme: "surface" as const,
          copy: { heading: "Notre savoir-faire", text: "Nous préparons chaque commande avec soin, dans notre atelier." },
          image: hasPhoto ? { photoIndex: Math.min(1, data.photos.length - 1) } : null,
          collectionIndex: null,
          productIndexes: [],
        },
        { type: "faq" as const, preset: 0, scheme: "default" as const, copy: { heading: "Questions fréquentes" }, image: null, collectionIndex: null, productIndexes: [] },
        { type: "whatsapp-cta" as const, preset: 0, scheme: "brand" as const, copy: { heading: "Une question ? Écrivez-nous", text: "Nous répondons sur WhatsApp." }, image: null, collectionIndex: null, productIndexes: [] },
        // Section de témoignages volontairement demandée : elle doit être refusée sans avis réels.
        { type: "testimonials" as const, preset: 0, scheme: "surface" as const, copy: { heading: "Ils nous font confiance" }, image: null, collectionIndex: null, productIndexes: [] },
      ],
      product: {
        gallery: (i === 0 ? "thumbnails-left" : i === 1 ? "carousel" : "stacked") as "thumbnails-left",
        variantPicker: (i === 2 ? "swatches" : "buttons") as "buttons",
        stickyAddToCart: true,
        blocks: ["title", "price", "variant_picker", "quantity", "buy_buttons", "description", "delivery_info"],
      },
      faq: [
        ...(data.paymentMethods.length ? [{ q: "Comment payer ?", a: `Paiement accepté : ${data.paymentMethods.slice(0, 4).join(", ")}.` }] : []),
        ...(data.deliveryZones.length ? [{ q: "Où livrez-vous ?", a: `Nous livrons dans ces zones : ${data.deliveryZones.slice(0, 4).join(", ")}.` }] : []),
        ...(data.hours ? [{ q: "Quels sont vos horaires ?", a: data.hours }] : []),
      ],
    })),
  };
}

/** Sortie simulée de l'assistant de design (§10) : quelques règles de mots-clés, et un refus explicite. */
export function fakeAssistant(instruction: string, ctx: { template: string; sectionIds: string[]; selection?: string | null }): { explanation: string; operations: unknown[] } {
  const text = instruction.toLowerCase();
  const refuse = ["script", "javascript", "code html", "pixel", "faux avis", "inventer des avis", "promo", "remise", "gratuit"].some((k) => text.includes(k));
  if (refuse) return { explanation: "Je ne peux pas faire cela : je ne modifie que l'apparence, sans code ni promesse commerciale.", operations: [] };
  const ops: unknown[] = [];
  if (text.includes("luxe") || text.includes("premium") || text.includes("chic")) {
    ops.push({ op: "updateGlobalSetting", path: "colors.primary", value: "#111827" });
    ops.push({ op: "updateGlobalSetting", path: "typography.heading", value: "playfair" });
    ops.push({ op: "updateGlobalSetting", path: "buttons.radius", value: 4 });
  }
  if (text.includes("faq") || text.includes("question")) {
    ops.push({ op: "addSection", template: ctx.template, type: "faq", presetIndex: 0 });
  }
  if (text.includes("whatsapp")) {
    ops.push({ op: "addSection", template: ctx.template, type: "whatsapp-cta", presetIndex: 0 });
  }
  if (!ops.length && ctx.sectionIds.length) {
    ops.push({ op: "moveSection", template: ctx.template, sectionId: ctx.selection ?? ctx.sectionIds[0], index: 0 });
  }
  return { explanation: "Modifications appliquées au brouillon : vous pouvez les annuler en un clic.", operations: ops.slice(0, 20) };
}
