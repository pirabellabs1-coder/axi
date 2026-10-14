import { describe, expect, it } from "vitest";
import { NEVER_CACHE_SEGMENTS, scopedPath, serviceWorkerSource, swStrategy, SW_IMAGE_CACHE_MAX_ENTRIES } from "@/lib/pwa/sw-source";

/**
 * Lot 4 §14 : le service worker ne doit JAMAIS mettre en cache la commande, le compte, les actions serveur
 * ni l'API. Ces règles sont testées sur la fonction pure utilisée à la fois par le script généré et par le test.
 */

const APP = { scope: "/s/chez-aicha/", origin: "https://axi.africa" };
const SUB = { scope: "/", origin: "https://chez-aicha.axi.africa" };

const at = (path: string, opts: Partial<Parameters<typeof swStrategy>[0]> = {}, env = APP) => swStrategy({ url: `${env.origin}${path}`, method: "GET", ...opts }, env);

describe("chemins jamais mis en cache", () => {
  it("commande, compte, panier, remerciement et connexion (domaine de l'application)", () => {
    for (const seg of ["commander", "compte", "panier", "merci", "connexion"]) {
      expect(at(`/s/chez-aicha/${seg}`)).toBe("never");
      expect(at(`/s/chez-aicha/${seg}/etape-2`)).toBe("never");
    }
  });

  it("commande et compte sur un sous-domaine de boutique", () => {
    for (const seg of ["commander", "compte"]) {
      expect(swStrategy({ url: `${SUB.origin}/${seg}`, method: "GET" }, SUB)).toBe("never");
    }
  });

  it("API et données de navigation", () => {
    expect(at("/api/live/chez-aicha")).toBe("never");
    expect(at("/api/jobs/run")).toBe("never");
    expect(at("/s/chez-aicha/?_rsc=abc")).toBe("never");
    expect(at("/_next/data/build/x.json")).toBe("never");
  });

  it("actions serveur et tout envoi de formulaire : aucune requête non GET n'est traitée", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(at("/s/chez-aicha/", { method })).toBe("never");
      expect(at("/s/chez-aicha/p/pagne", { method })).toBe("never");
    }
  });

  it("liens porteurs d'un jeton (reprise de panier, suivi)", () => {
    expect(at("/s/chez-aicha/?panier=abc123")).toBe("never");
    expect(at("/s/chez-aicha/suivi?token=abc123")).toBe("never");
  });

  it("la liste des segments interdits est bien celle de la spec", () => {
    expect([...NEVER_CACHE_SEGMENTS]).toEqual(["commander", "compte", "panier", "merci", "connexion", "api"]);
  });
});

describe("stratégies de cache", () => {
  it("HTML : réseau d'abord", () => {
    expect(at("/s/chez-aicha/")).toBe("html");
    expect(at("/s/chez-aicha/catalogue")).toBe("html");
    expect(at("/s/chez-aicha/p/pagne-wax", { mode: "navigate" })).toBe("html");
  });

  it("images : cache puis revalidation, y compris depuis le CDN", () => {
    expect(at("/media/abc.webp")).toBe("image");
    expect(at("/s/chez-aicha/p/x.jpg", { destination: "image" })).toBe("image");
    expect(swStrategy({ url: "https://images.unsplash.com/photo-1?w=800", destination: "image" }, APP)).toBe("image");
    expect(at("/_next/image?url=x&w=640")).toBe("image");
  });

  it("actifs immuables de Next : cache d'abord", () => {
    expect(at("/_next/static/chunks/main.js")).toBe("asset");
  });

  it("hors de la portée de la boutique : rien n'est mis en cache", () => {
    expect(at("/app/store1/commandes")).toBe("pass");
    expect(at("/s/autre-boutique/")).toBe("pass");
    expect(swStrategy({ url: "https://connect.facebook.net/x.js" }, APP)).toBe("pass");
  });

  it("URL illisible : jamais de cache", () => {
    expect(swStrategy({ url: "pas une url" }, APP)).toBe("never");
  });
});

describe("chemin relatif à la portée", () => {
  it("gère la racine, les sous-chemins et le hors-portée", () => {
    expect(scopedPath("/s/chez-aicha", "/s/chez-aicha/")).toBe("");
    expect(scopedPath("/s/chez-aicha/", "/s/chez-aicha/")).toBe("");
    expect(scopedPath("/s/chez-aicha/compte/commandes", "/s/chez-aicha/")).toBe("compte/commandes");
    expect(scopedPath("/s/autre/", "/s/chez-aicha/")).toBeNull();
    expect(scopedPath("/compte", "/")).toBe("compte");
  });
});

describe("script généré", () => {
  const source = serviceWorkerSource({ scope: "/s/chez-aicha/", version: "abc123", offlineUrl: "/s/chez-aicha/hors-ligne", notificationIcon: "/media/logo.png", storeName: "Chez Aïcha" });

  it("contient la configuration de la boutique et la page hors ligne", () => {
    expect(source).toContain('"scope":"/s/chez-aicha/"');
    expect(source).toContain('"offlineUrl":"/s/chez-aicha/hors-ligne"');
    expect(source).toContain('"version":"abc123"');
    expect(source).toContain(`"maxImages":${SW_IMAGE_CACHE_MAX_ENTRIES}`);
  });

  it("déclare les segments interdits et ne répond jamais pour eux", () => {
    for (const seg of NEVER_CACHE_SEGMENTS) expect(source).toContain(`"${seg}"`);
    expect(source).toContain("if (mode === 'never' || mode === 'pass') return;");
  });

  it("gère les notifications push et leur clic", () => {
    expect(source).toContain("addEventListener('push'");
    expect(source).toContain("showNotification");
    expect(source).toContain("addEventListener('notificationclick'");
  });

  it("n'exécute aucune donnée interpolée hors JSON (pas d'injection depuis le nom de la boutique)", () => {
    const hostile = serviceWorkerSource({ scope: "/s/x/", version: "v", offlineUrl: "/s/x/hors-ligne", notificationIcon: null, storeName: '</script><script>alert(1)' });
    expect(hostile).not.toContain("<script>");
    expect(hostile).toContain('\\u003c/script');
  });
});
