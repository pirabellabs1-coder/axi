import { describe, it, expect } from "vitest";
import { buildEmbeddedSignupSetup, metaTimezone, splitPhone } from "@/lib/whatsapp/embedded-signup-prefill";

describe("metaTimezone", () => {
  it("convertit un fuseau IANA au format Meta", () => {
    expect(metaTimezone("Africa/Porto-Novo")).toBe("UTC+01:00");
    expect(metaTimezone("Africa/Abidjan")).toBe("UTC+00:00");
    expect(metaTimezone("Asia/Kolkata")).toBe("UTC+05:30");
  });
  it("renvoie undefined pour un fuseau absent ou inconnu", () => {
    expect(metaTimezone(null)).toBeUndefined();
    expect(metaTimezone("Pas/UnFuseau")).toBeUndefined();
  });
});

describe("splitPhone", () => {
  it("sépare indicatif et numéro national", () => {
    expect(splitPhone("22997000000", "229")).toEqual({ code: 229, number: "97000000" });
  });
  it("refuse un numéro d'un autre pays ou trop court", () => {
    expect(splitPhone("22890000000", "229")).toBeUndefined();
    expect(splitPhone("229123", "229")).toBeUndefined();
    expect(splitPhone(null, "229")).toBeUndefined();
  });
});

describe("buildEmbeddedSignupSetup", () => {
  it("pré-remplit entreprise et numéro à partir de la boutique", () => {
    const setup = buildEmbeddedSignupSetup({
      store: { name: "Maison Kairos", tagline: "Mode et accessoires", city: "Cotonou", address: "Rue 12", country: "BJ", timezone: "Africa/Porto-Novo", whatsappNumber: "22997000000" },
      email: "marchand@exemple.com",
      website: "https://16-192-144-250.nip.io/s/maison-kairos",
      dialCode: "229",
    });
    expect(setup).toEqual({
      business: {
        name: "Maison Kairos",
        email: "marchand@exemple.com",
        website: "https://16-192-144-250.nip.io/s/maison-kairos",
        phone: { code: 229, number: "97000000" },
        address: { streetAddress1: "Rue 12", city: "Cotonou", country: "BJ" },
        timezone: "UTC+01:00",
      },
      phone: { displayName: "Maison Kairos", description: "Mode et accessoires" },
    });
  });

  it("omet les champs inconnus ou invalides (e-mail, site non https)", () => {
    const setup = buildEmbeddedSignupSetup({
      store: { name: "Boutique", country: "BJ" },
      email: "pas-un-email",
      website: "http://insecure.example",
      dialCode: "229",
    });
    expect(setup.business).toEqual({ name: "Boutique", address: { country: "BJ" } });
    expect(setup.business?.email).toBeUndefined();
    expect(setup.business?.website).toBeUndefined();
    expect(setup.phone).toEqual({ displayName: "Boutique" });
  });
});
