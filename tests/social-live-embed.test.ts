import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { liveEmbed, LIVE_PLAYER_ORIGINS } from "@/lib/social/live-embed";
import { sourceKeyFromSegments, withSlot, BusyError, MAX_WAITING } from "@/lib/social/feed-image";
import { parseIds } from "@/lib/social/live-products";
import { buildUpdatedTags, isTaggableMedia, matchCatalogProduct } from "@/lib/social/instagram-tagging";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/rate-limit", () => ({ clientIp: async () => "1.1.1.1", rateLimitAll: async () => ({ ok: true, retryAfter: 0 }) }));
vi.mock("@/lib/storage", () => ({ getStorage: () => ({}) }));

describe("lecteurs du direct : URL réelles des plateformes", () => {
  it.each([
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&playsinline=1&rel=0"],
    ["https://youtube.com/live/dQw4w9WgXcQ?feature=share", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&playsinline=1&rel=0"],
    ["https://youtu.be/dQw4w9WgXcQ", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&playsinline=1&rel=0"],
    ["https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=10", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&playsinline=1&rel=0"],
    ["https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv/live", "https://www.youtube.com/embed/live_stream?channel=UCabcdefghijklmnopqrstuv&autoplay=1&playsinline=1"],
  ])("YouTube %s", (url, src) => {
    expect(liveEmbed(url)).toMatchObject({ platform: "youtube", src });
  });

  it("YouTube : Shorts vertical ; page @chaîne/live non intégrable (identifiant inconnu)", () => {
    expect(liveEmbed("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toMatchObject({ vertical: true });
    expect(liveEmbed("https://www.youtube.com/@MaBoutique/live")).toBeNull();
    expect(liveEmbed("https://www.youtube.com/watch?v=<script>")).toBeNull();
  });

  it("Facebook : vidéo et direct publics de Page → plugin vidéo officiel", () => {
    for (const url of [
      "https://www.facebook.com/MaBoutique/videos/1234567890123456/",
      "https://web.facebook.com/watch/live/?v=1234567890123456",
      "https://www.facebook.com/watch/?v=1234567890123456",
      "https://fb.watch/abcDEF123/",
    ]) {
      const e = liveEmbed(url);
      expect(e?.platform, url).toBe("facebook");
      const src = new URL(e!.src);
      expect(src.origin + src.pathname).toBe("https://www.facebook.com/plugins/video.php");
      expect(src.searchParams.get("href")).toMatch(/^https:\/\/(www\.facebook\.com|fb\.watch)\//);
    }
    expect(liveEmbed("https://www.facebook.com/MaBoutique")).toBeNull();
  });

  it("TikTok : vidéo intégrable (lecteur v1), direct non intégrable", () => {
    expect(liveEmbed("https://www.tiktok.com/@ma.boutique/video/7301234567890123456")).toEqual({ platform: "tiktok", src: "https://www.tiktok.com/player/v1/7301234567890123456?autoplay=1&rel=0", vertical: true });
    expect(liveEmbed("https://www.tiktok.com/@ma.boutique/live")).toBeNull();
  });

  it("Instagram : publication / Reel intégrables, direct non intégrable", () => {
    expect(liveEmbed("https://www.instagram.com/reel/C9xYz12AbCd/")).toEqual({ platform: "instagram", src: "https://www.instagram.com/reel/C9xYz12AbCd/embed/", vertical: true });
    expect(liveEmbed("https://www.instagram.com/p/C9xYz12AbCd/")?.src).toBe("https://www.instagram.com/p/C9xYz12AbCd/embed/");
    expect(liveEmbed("https://www.instagram.com/ma.boutique/live/")).toBeNull();
  });

  it("refus : http, identifiants, autres domaines", () => {
    expect(liveEmbed("http://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(liveEmbed("https://user:pass@www.youtube.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(liveEmbed("https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(liveEmbed("javascript:alert(1)")).toBeNull();
  });

  it("chaque iframe produite vient d'une origine autorisée", () => {
    for (const url of ["https://youtu.be/dQw4w9WgXcQ", "https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv/live", "https://www.facebook.com/x/videos/123/", "https://www.tiktok.com/@a/video/123456789012", "https://www.instagram.com/p/AbCdEf1/"]) {
      expect(LIVE_PLAYER_ORIGINS).toContain(new URL(liveEmbed(url)!.src).origin);
    }
  });
});

describe("CSP : lecteurs autorisés dans frame-src, rien de plus", () => {
  it("la politique générale ouvre exactement les origines des lecteurs", async () => {
    const config = (await import("../next.config")).default;
    const rules = await config.headers!();
    const csp = rules.find((r) => r.source === "/(.*)")!.headers.find((h) => h.key === "Content-Security-Policy")!.value;
    const frameSrc = csp.split("; ").find((d) => d.startsWith("frame-src "))!.split(" ").slice(1);
    for (const o of LIVE_PLAYER_ORIGINS) expect(frameSrc).toContain(o);
    expect(frameSrc).not.toContain("https:");
    expect(frameSrc).not.toContain("*");
    expect(new Set(frameSrc).size).toBe(frameSrc.length);
    // script-src inchangé : les lecteurs sont des iframes, aucun script tiers supplémentaire.
    const scriptSrc = csp.split("; ").find((d) => d.startsWith("script-src "))!;
    expect(scriptSrc).not.toContain("youtube");
    expect(scriptSrc).not.toContain("tiktok");
  });
});

describe("conversion d'images des flux : clés acceptées", () => {
  const key = `stores/storeaaa0001/2026/10/${"a".repeat(64)}.webp`;
  it("photo catalogue de LA boutique seulement, formats non JPEG/PNG", () => {
    expect(sourceKeyFromSegments(`${key}.jpg`.split("/"), "storeaaa0001")).toBe(key);
    expect(sourceKeyFromSegments(`${key}.jpg`.split("/"), "storebbb0002")).toBeNull();
    expect(sourceKeyFromSegments(key.split("/"), "storeaaa0001")).toBeNull();
    expect(sourceKeyFromSegments(`stores/storeaaa0001/returns/2026/10/${"a".repeat(64)}.webp.jpg`.split("/"), "storeaaa0001")).toBeNull();
    expect(sourceKeyFromSegments(`stores/storeaaa0001/2026/10/${"a".repeat(64)}.png.jpg`.split("/"), "storeaaa0001")).toBeNull();
    expect(sourceKeyFromSegments(["..", "..", "etc", "passwd.jpg"], "storeaaa0001")).toBeNull();
  });
});

describe("conversion d'images : file bornée", () => {
  it("2 créneaux, MAX_WAITING en attente, puis refus immédiat ; la file se vide ensuite", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const jobs = Array.from({ length: 2 + MAX_WAITING }, () => withSlot(() => gate));
    await expect(withSlot(async () => 1)).rejects.toBeInstanceOf(BusyError);
    release();
    await Promise.all(jobs);
    await expect(withSlot(async () => 2)).resolves.toBe(2);
  });
});

describe("ajout au panier depuis le direct", () => {
  it("identifiants filtrés, dédoublonnés, 12 au plus", () => {
    expect(parseIds("prod_aaa_0001,prod_aaa_0001, <x>,abc")).toEqual(["prod_aaa_0001"]);
    expect(parseIds(Array.from({ length: 20 }, (_, i) => `prod_aaa_${String(i).padStart(4, "0")}`).join(","))).toHaveLength(12);
    expect(parseIds(null)).toEqual([]);
  });
});

describe("Instagram : identification de produits (fonctions pures)", () => {
  it("positions sur une image, aucune sur une vidéo ; 5 produits au plus, uniques", () => {
    expect(buildUpdatedTags(["111111", "222222", "111111"], "IMAGE")).toEqual([
      { product_id: "111111", x: 0.5, y: 0.2 },
      { product_id: "222222", x: 0.5, y: 0.35 },
    ]);
    expect(buildUpdatedTags(["111111"], "VIDEO")).toEqual([{ product_id: "111111" }]);
    expect(buildUpdatedTags(["1", "abc", "1234567"], "IMAGE")).toHaveLength(1);
    expect(buildUpdatedTags(Array.from({ length: 9 }, (_, i) => String(100000 + i)), "VIDEO")).toHaveLength(5);
  });
  it("Stories et directs exclus", () => {
    expect(isTaggableMedia({ mediaType: "VIDEO", productType: "REELS" })).toBe(true);
    expect(isTaggableMedia({ mediaType: "IMAGE", productType: "STORY" })).toBe(false);
    expect(isTaggableMedia({ mediaType: "VIDEO", productType: "LIVE" })).toBe(false);
  });
  it("correspondance exacte du retailer_id (jamais un produit voisin)", () => {
    const results = [
      { productId: "9001", retailerId: "prod_x_00010", name: "A", reviewStatus: "approved", variantIds: [] },
      { productId: "9002", retailerId: "prod_x_0001", name: "B", reviewStatus: "pending", variantIds: [] },
    ];
    expect(matchCatalogProduct(results, ["prod_x_0001"])?.productId).toBe("9002");
    expect(matchCatalogProduct(results, ["prod_y"])).toBeNull();
  });
});
