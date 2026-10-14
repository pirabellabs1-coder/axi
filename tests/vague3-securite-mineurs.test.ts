import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";

// `vid-signature` et `crypto` sont des modules serveur : neutralisé pour les tests unitaires.
vi.mock("server-only", () => ({}));

import { posPlanAllowed, posPlanGuard } from "@/lib/pos/plan";
import { isAllowedPushEndpoint, PUSH_ENDPOINT_HOSTS } from "@/lib/push/endpoints";
import { signWebhook, verifySignature, webhookNonceKey, WEBHOOK_NONCE_TTL_SECONDS, WEBHOOK_TOLERANCE_SECONDS } from "@/lib/carriers/webhook";
import { isValidMediaKey, buildMediaKey, deliveryMediaPrefix } from "@/lib/storage/keys";
import { formatSignedVid, splitSignedVid, isVisitorId } from "@/lib/experiments/assign";
import { readSignedVisitorId, signedVisitorCookie, signVisitorId } from "@/lib/experiments/vid-signature";
import { requireAppSecret, isPlaceholderSecret } from "@/lib/crypto";

/**
 * Correctifs MINEURS de l'audit de la vague 3 (un test par correction) :
 *  n° 5  photo de preuve : seule une clé interne du stockage est acceptée ;
 *  n° 7  webhooks transporteurs : horodatage obligatoire + anti-rejeu par nonce ;
 *  n° 8  contrôle de plan des routes `/api/pos/*` ;
 *  n° 10 liste blanche des points de terminaison push (SSRF aveugle) ;
 *  n° 11 cookie `axi_vid` signé ;
 *  n° 12 accesseur unique d'`APP_SECRET` qui lève ;
 *  n° 13 service worker de la caisse : aucun HTML authentifié en cache ;
 *  n° 15 limitation de débit de `/api/storefront/locales`.
 */

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("n° 8 — contrôle de plan de la caisse, côté serveur", () => {
  it("refuse les plans sans appareil de caisse, autorise Business et au-delà", () => {
    expect(posPlanAllowed("FREE")).toBe(false);
    expect(posPlanAllowed("STARTER")).toBe(false);
    expect(posPlanAllowed("BUSINESS")).toBe(true);
    expect(posPlanAllowed("SCALE")).toBe(true);
    expect(posPlanAllowed("ENTERPRISE")).toBe(true);
    expect(posPlanGuard("FREE")).toContain("Business");
    expect(posPlanGuard("BUSINESS")).toBeNull();
  });

  it("la garde est branchée sur les TROIS routes de la caisse", () => {
    for (const route of ["catalog", "sales", "sessions"]) {
      const src = read(`src/app/api/pos/[storeId]/${route}/route.ts`);
      expect(src, route).toContain("posPlanGuard(ctx.planId)");
    }
  });
});

describe("n° 10 — liste blanche des services de push (SSRF aveugle)", () => {
  it("accepte les services des navigateurs", () => {
    expect(isAllowedPushEndpoint("https://fcm.googleapis.com/fcm/send/abc")).toBe(true);
    expect(isAllowedPushEndpoint("https://web.push.apple.com/QWxw")).toBe(true);
    expect(isAllowedPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/gAAA")).toBe(true);
    expect(isAllowedPushEndpoint("https://sin.notify.windows.com/w/?token=x")).toBe(true);
  });

  it("refuse tout autre hôte, le réseau interne et les ruses d'URL", () => {
    expect(isAllowedPushEndpoint("https://attaquant.test/collecte")).toBe(false);
    // Réseau interne : le worker d'envoi POSTe depuis le serveur.
    expect(isAllowedPushEndpoint("https://169.254.169.254/latest/meta-data")).toBe(false);
    expect(isAllowedPushEndpoint("http://localhost:3000/api/jobs/run")).toBe(false);
    // L'hôte autorisé en sous-chaîne, pas en hôte réel.
    expect(isAllowedPushEndpoint("https://evil.test/?x=fcm.googleapis.com")).toBe(false);
    expect(isAllowedPushEndpoint("https://fcm.googleapis.com.evil.test/x")).toBe(false);
    // Port arbitraire (balayage de ports) et identifiants dans l'URL.
    expect(isAllowedPushEndpoint("https://fcm.googleapis.com:8080/x")).toBe(false);
    expect(isAllowedPushEndpoint("https://user:pass@fcm.googleapis.com/x")).toBe(false);
    expect(isAllowedPushEndpoint("pas-une-url")).toBe(false);
  });

  it("l'abonnement applique la liste blanche et révoque au lieu de supprimer", () => {
    const src = read("src/lib/push/actions.ts");
    expect(src).toContain("isAllowedPushEndpoint");
    expect(src).not.toContain("pushSubscription.delete(");
    expect(PUSH_ENDPOINT_HOSTS.length).toBeGreaterThan(3);
  });
});

describe("n° 7 — webhooks transporteurs : horodatage obligatoire et anti-rejeu", () => {
  const secret = "secret-transporteur";
  const raw = JSON.stringify({ provider_ref: "X1", events: [{ status: "delivered" }] });
  const ts = String(Math.floor(Date.now() / 1000));

  it("refuse une signature SANS horodatage (rejeu indéfini possible)", () => {
    const r = verifySignature({ secret, raw, signature: signWebhook(secret, raw) });
    expect(r).toEqual({ ok: false, error: "missing_timestamp" });
  });

  it("accepte un horodatage frais et refuse un horodatage périmé", () => {
    expect(verifySignature({ secret, raw, signature: signWebhook(secret, raw, ts), timestamp: ts })).toEqual({ ok: true });
    const old = String(Math.floor(Date.now() / 1000) - WEBHOOK_TOLERANCE_SECONDS - 10);
    expect(verifySignature({ secret, raw, signature: signWebhook(secret, raw, old), timestamp: old })).toEqual({ ok: false, error: "stale" });
  });

  it("n'accepte l'absence d'horodatage qu'avec le drapeau de configuration explicite", () => {
    const r = verifySignature({ secret, raw, signature: signWebhook(secret, raw), allowMissingTimestamp: true });
    expect(r).toEqual({ ok: true });
  });

  it("produit une clé de nonce stable par transporteur et par signature (TTL 10 min)", () => {
    const sig = signWebhook(secret, raw, ts);
    expect(webhookNonceKey("gozem", sig)).toBe(webhookNonceKey("gozem", `sha256=${sig.toUpperCase()}`));
    expect(webhookNonceKey("gozem", sig)).not.toBe(webhookNonceKey("yango", sig));
    expect(WEBHOOK_NONCE_TTL_SECONDS).toBe(600);
  });

  it("la route refuse une signature déjà vue avant toute écriture", () => {
    const src = read("src/app/api/webhooks/carriers/[carrier]/route.ts");
    expect(src).toContain("webhookNonceKey(carrier, signature)");
    // Le nonce est contrôlé AVANT la boucle qui enregistre les événements.
    expect(src.indexOf("webhookNonceKey")).toBeLessThan(src.indexOf("recordShipmentEvent("));
  });
});

describe("n° 5 — preuve de remise : clé interne du stockage uniquement", () => {
  it("l'espace de noms `delivery` est une clé valide, les URL arbitraires non", () => {
    const key = buildMediaKey("store123456", "a".repeat(64), "jpg", new Date("2026-10-12T00:00:00.000Z"), "delivery");
    expect(key.startsWith(deliveryMediaPrefix("store123456"))).toBe(true);
    expect(isValidMediaKey(key)).toBe(true);
    expect(isValidMediaKey("https://exemple.test/photo.jpg")).toBe(false);
    expect(isValidMediaKey("../../etc/passwd")).toBe(false);
    expect(isValidMediaKey("")).toBe(false);
  });

  it("le formulaire du livreur ne transporte plus d'URL de photo", () => {
    expect(read("src/lib/shipping/courier-actions.ts")).not.toContain("proofPhotoUrl");
    expect(read("src/app/livraison/[token]/courier-client.tsx")).not.toContain('name="proofPhotoUrl"');
    // La preuve est relue en base et validée comme clé de média.
    expect(read("src/lib/shipping/courier.ts")).toContain("isValidMediaKey(shipment.proofPhotoUrl");
  });
});

describe("n° 11 — cookie `axi_vid` signé", () => {
  const id = "0123456789abcdef0123456789abcdef";

  it("accepte uniquement une valeur signée par ce serveur", () => {
    const cookie = signedVisitorCookie(id);
    expect(splitSignedVid(cookie)).toEqual({ id, signature: signVisitorId(id) });
    expect(readSignedVisitorId(cookie)).toBe(id);
    // Identifiant nu (forgeable à volonté : le cas d'attaque) : refusé.
    expect(readSignedVisitorId(id)).toBeNull();
    // Signature d'un AUTRE identifiant.
    expect(readSignedVisitorId(formatSignedVid(id, signVisitorId("f".repeat(32))))).toBeNull();
    expect(readSignedVisitorId(formatSignedVid(id, "0".repeat(32)))).toBeNull();
    expect(readSignedVisitorId(undefined)).toBeNull();
    expect(isVisitorId(id)).toBe(true);
  });

  it("la balise exige `Sec-Fetch-Site: same-origin` et abaisse le plafond par IP", () => {
    const src = read("src/app/api/s/[slug]/events/route.ts");
    expect(src).toContain('req.headers.get("sec-fetch-site") !== "same-origin"');
    expect(src).toContain("readSignedVisitorId");
    const perIp = /sfevents:ip:\$\{ip\}`, limit: (\d+)/.exec(src);
    expect(perIp).not.toBeNull();
    expect(Number(perIp![1])).toBeLessThanOrEqual(30);
  });
});

describe("n° 12 — accesseur unique du secret d'application", () => {
  it("renvoie le secret de test et refuse une valeur d'exemple", () => {
    expect(requireAppSecret()).toBe(process.env.APP_SECRET);
    expect(isPlaceholderSecret("change-me-please-change-me-please")).toBe(true);
    const saved = process.env.APP_SECRET;
    try {
      process.env.APP_SECRET = "change-me-0123456789-0123456789-abc";
      expect(() => requireAppSecret()).toThrow(/change-me/);
      process.env.APP_SECRET = "trop-court";
      expect(() => requireAppSecret()).toThrow(/APP_SECRET/);
      delete process.env.APP_SECRET;
      expect(() => requireAppSecret()).toThrow(/APP_SECRET/);
    } finally {
      process.env.APP_SECRET = saved;
    }
  });

  it("aucun HMAC calculé sur `process.env` dans les modules de la vague 3", () => {
    for (const f of ["src/lib/pos/device.ts", "src/lib/shipping/service.ts", "src/lib/pos/manager-code.ts", "src/lib/experiments/vid-signature.ts"]) {
      const src = read(f);
      // Hors commentaires : plus aucune lecture directe de l'environnement pour dériver une empreinte.
      const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(code, f).not.toMatch(/process\.env\.APP_SECRET/);
      expect(code, f).toContain("requireAppSecret()");
    }
  });
});

describe("n° 13 — service worker de la caisse", () => {
  const sw = read("src/app/caisse/sw.js/route.ts");

  it("ne met en cache que la coque statique, jamais le document authentifié", () => {
    expect(sw).toContain('url.pathname.startsWith("/_next/static/")');
    expect(sw).toContain('url.pathname === "/caisse/manifest.webmanifest"');
    // Le document part en réseau d'abord SANS écriture de cache, avec un repli local.
    expect(sw).toContain('request.mode === "navigate"');
    expect(sw).toContain("OFFLINE_HTML");
    // Le cache est renommé : les anciens, qui contenaient du HTML authentifié, sont effacés.
    expect(sw).toContain('const CACHE = "axi-pos-v2"');
  });

  it("n'écrit dans le cache que dans la branche de la coque", () => {
    const put = sw.indexOf("cache.put(request, copy)");
    expect(put).toBeGreaterThan(-1);
    // Une seule écriture dans tout le script : celle de la coque.
    expect(sw.indexOf("cache.put(", put + 1)).toBe(-1);
    expect(sw).not.toContain('url.pathname.startsWith("/api/")) return;\n  if (!url.pathname.startsWith("/caisse")) return;\n\n  // Réseau');
  });
});

describe("n° 15 — /api/storefront/locales limitée par adresse", () => {
  it("la route est bornée avant la requête base", () => {
    const src = read("src/app/api/storefront/locales/route.ts");
    expect(src).toContain("rateLimit(");
    expect(src.indexOf("rateLimit(")).toBeLessThan(src.indexOf("db.store.findUnique"));
    expect(src).toContain("429");
  });
});

describe("n° 6 — jeton de la page livreur", () => {
  it("la vue expirée ne contient aucune donnée personnelle (type somme)", () => {
    const src = read("src/lib/shipping/courier.ts");
    expect(src).toContain("{ expired: true; storeName: string }");
    expect(src).toContain("return { expired: true, storeName: shipment.store.name }");
  });

  it("révocation et purge existent", () => {
    expect(read("src/lib/shipping/actions.ts")).toContain("export async function revokeCourierToken");
    expect(read("src/lib/shipping/token-purge.ts")).toContain("purgeFinishedCourierTokens");
    expect(read("src/app/api/jobs/run/route.ts")).toContain("purgeFinishedCourierTokens");
  });
});

describe("n° 9 — sorties d'espèces et clôture de caisse", () => {
  const src = read("src/lib/pos/session.ts");

  it("un membre sans capacité de gestion n'agit que sur SA session", () => {
    expect(src).toContain("assertOwnSession");
    expect(src).toContain("session.openedById !== p.actorId");
    // Appliqué aux deux opérations sensibles.
    expect(src.match(/assertOwnSession\(session, p\)/g)?.length).toBe(2);
  });

  it("chaque sortie d'espèces prévient le gérant", () => {
    expect(src).toContain('p.kind === "out"');
    expect(src).toContain("Sortie d'espèces en caisse");
  });

  it("la capacité est bien transmise par les actions", () => {
    const actions = read("src/lib/pos/actions.ts");
    expect(actions.match(/canManage: ctx\.can\("store\.settings"\)/g)?.length).toBe(2);
  });
});
