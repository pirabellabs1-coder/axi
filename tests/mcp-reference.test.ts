import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/commerce/orders", () => ({ transitionOrder: vi.fn() }));

import { MERCHANT_TOOLS } from "@/lib/mcp/merchant/server";
import { PUBLIC_TOOLS } from "@/lib/mcp/public/server";
import { MERCHANT_TOOL_REFERENCE, PUBLIC_TOOL_REFERENCE } from "@/lib/mcp/reference";
import { inputJsonSchema } from "@/lib/mcp/protocol";

describe("référence publique des outils = serveur réel", () => {
  it("mêmes outils marchands, mêmes scopes, annotations cohérentes", () => {
    expect(MERCHANT_TOOL_REFERENCE.map((t) => t.name)).toEqual(MERCHANT_TOOLS.map((t) => t.name));
    for (const ref of MERCHANT_TOOL_REFERENCE) {
      const tool = MERCHANT_TOOLS.find((t) => t.name === ref.name)!;
      expect([...tool.scopes], ref.name).toEqual(ref.scopes);
      expect(tool.annotations.readOnlyHint, ref.name).toBe(!ref.write);
    }
  });

  it("mêmes outils publics ; aucun n'exige d'autorisation", () => {
    expect(PUBLIC_TOOL_REFERENCE.map((t) => t.name)).toEqual(PUBLIC_TOOLS.map((t) => t.name));
    for (const t of PUBLIC_TOOLS) expect(t.scopes).toEqual([]);
  });

  it("chaque outil expose un schéma d'entrée objet et une description en anglais pour les modèles", () => {
    for (const t of [...MERCHANT_TOOLS, ...PUBLIC_TOOLS]) {
      const s = inputJsonSchema(t.input);
      expect(s.type, t.name).toBe("object");
      expect(t.description.length, t.name).toBeGreaterThan(30);
      expect(t.name).toMatch(/^[a-z_]{3,40}$/);
    }
  });
});
