import { describe, expect, it, vi } from "vitest";
import { collectDataUrls, decodeDataImageUrl, isDataImageUrl, replaceDataUrls } from "@/lib/storage/data-url";
import { sniffImageType } from "@/lib/storage/image-type";
import { SAMPLES } from "./helpers/images";

/** Migration des data-URL : fonctions pures d'extraction / remplacement sur un document de thème. */
const png = `data:image/png;base64,${Buffer.from(SAMPLES.png).toString("base64")}`;
const jpeg = `data:image/jpeg;base64,${Buffer.from(SAMPLES.jpeg).toString("base64")}`;
const svg = "data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+";

const themeDoc = {
  version: 2,
  preset: "mode",
  settings: {
    header: { logo: { url: png, alt: "Logo" } },
    social: { shareImage: { url: jpeg }, favicon: { url: "https://cdn.example.com/f.png" } },
  },
  templates: {
    home: {
      sections: [
        { id: "hero", type: "hero", settings: { image: { url: jpeg, alt: "" }, title: "data:image/png;base64, n'est pas une image ici ?" } },
        { id: "logos", type: "logo-list", blocks: [{ id: "b1", settings: { image: { url: png } } }, { id: "b2", settings: { image: { url: svg } } }] },
      ],
    },
  },
};

describe("migration des data-URL", () => {
  it("collecte chaque data-URL d'image une seule fois, à toute profondeur", () => {
    const found = collectDataUrls(themeDoc);
    expect([...found]).toEqual([png, jpeg, svg]);
    expect(isDataImageUrl("data:image/png;base64, n'est pas une image ici ?")).toBe(false);
  });

  it("décode le base64 ; le format réel est vérifié par octets magiques (SVG non migré)", () => {
    const d = decodeDataImageUrl(png)!;
    expect(d.mime).toBe("image/png");
    expect(sniffImageType(d.bytes)?.ext).toBe("png");
    expect(sniffImageType(decodeDataImageUrl(svg)!.bytes)).toBeNull();
    expect(decodeDataImageUrl("https://x.example/a.png")).toBeNull();
  });

  it("remplace toutes les occurrences sans modifier l'entrée, et laisse ce qui n'est pas mappé", () => {
    const snapshot = JSON.stringify(themeDoc);
    const map = new Map([
      [png, "/media/stores/s/2026/10/aa.png"],
      [jpeg, "https://media.axi.africa/stores/s/2026/10/bb.jpg"],
    ]);
    const r = replaceDataUrls(themeDoc, map);
    expect(r.changed).toBe(true);
    expect(JSON.stringify(themeDoc)).toBe(snapshot);
    expect(r.value.settings.header.logo.url).toBe("/media/stores/s/2026/10/aa.png");
    expect(r.value.templates.home.sections[0].settings!.image.url).toBe("https://media.axi.africa/stores/s/2026/10/bb.jpg");
    expect(r.value.templates.home.sections[1].blocks![0].settings.image.url).toBe("/media/stores/s/2026/10/aa.png");
    expect(r.value.templates.home.sections[1].blocks![1].settings.image.url).toBe(svg); // non migré
    expect(r.value.settings.social.favicon.url).toBe("https://cdn.example.com/f.png");
    expect(JSON.stringify(r.value).length).toBeLessThan(snapshot.length);
  });

  it("idempotent : une seconde passe ne trouve plus rien à remplacer", () => {
    const map = new Map([
      [png, "/media/a.png"],
      [jpeg, "/media/b.jpg"],
    ]);
    const once = replaceDataUrls(themeDoc, map).value;
    expect([...collectDataUrls(once)]).toEqual([svg]);
    const twice = replaceDataUrls(once, map);
    expect(twice.changed).toBe(false);
    expect(twice.value).toBe(once);
  });

  it("fonctionne aussi sur une valeur simple (Variant.imageUrl) et une liste d'images produit", () => {
    expect(replaceDataUrls(png, new Map([[png, "/media/x.png"]])).value).toBe("/media/x.png");
    const images = [{ url: jpeg, alt: "Robe" }, { url: "https://x.example/2.jpg", alt: "" }];
    expect(replaceDataUrls(images, new Map([[jpeg, "/media/y.jpg"]])).value).toEqual([{ url: "/media/y.jpg", alt: "Robe" }, { url: "https://x.example/2.jpg", alt: "" }]);
    expect(replaceDataUrls(null, new Map()).changed).toBe(false);
  });
});

describe("migration : écritures conditionnelles (m3)", () => {
  /** Ligne simulée avec version (updatedAt) : un « marchand » la modifie pendant le calcul. */
  it("ne réécrit pas une ligne modifiée entre lecture et écriture : relit, recalcule, puis écrit", async () => {
    const { writeConditionally } = await import("@/lib/storage/conditional-write");
    const row = { version: 1, images: [png] };
    let concurrentEdits = 1;
    const writes: unknown[] = [];
    const r = await writeConditionally({
      read: async () => ({ ...row, images: [...row.images] }),
      step: async (read) => {
        const next = replaceDataUrls(read.images, new Map([[png, "/media/p.png"], [jpeg, "/media/j.jpg"]])).value;
        if (concurrentEdits-- > 0) {
          row.images = [...row.images, jpeg]; // le marchand ajoute une photo pendant l'envoi
          row.version++;
        }
        return {
          next,
          write: async () => {
            if (read.version !== row.version) return 0; // updateMany({ where: { id, updatedAt } }) → 0 ligne
            writes.push(next);
            row.images = next;
            return 1;
          },
        };
      },
    });
    expect(r.outcome).toBe("written");
    expect(r.attempts).toBe(2);
    expect(writes).toEqual([["/media/p.png", "/media/j.jpg"]]); // la photo ajoutée n'a pas été perdue
  });

  it("abandonne après N conflits sans rien écrire ; rien à faire → aucune écriture", async () => {
    const { writeConditionally } = await import("@/lib/storage/conditional-write");
    const write = vi.fn(async () => 0);
    expect((await writeConditionally({ read: async () => ({}), step: async () => ({ write }), maxTries: 3 })).outcome).toBe("abandoned");
    expect(write).toHaveBeenCalledTimes(3);
    expect((await writeConditionally({ read: async () => ({}), step: async () => ({ write: null }) })).outcome).toBe("unchanged");
    expect((await writeConditionally({ read: async () => null, step: async () => ({ write }) })).outcome).toBe("missing");
  });
});
