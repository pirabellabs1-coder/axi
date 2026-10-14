import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { batchingAllowed, defineTool, handleMcpMessage, handleMcpPayload, inputJsonSchema, LATEST_PROTOCOL_VERSION, messageCount, RPC_ERROR, ToolError, type McpServerDefinition, type ToolCallInfo } from "@/lib/mcp/protocol";

type Ctx = { scopes: string[]; quotaOk?: boolean };

const echo = defineTool({
  name: "echo",
  title: "Echo",
  description: "Echo a message",
  scopes: ["catalog:read"],
  annotations: { readOnlyHint: true },
  input: z.object({ message: z.string().min(1).max(20), times: z.number().int().min(1).max(3).default(1) }),
  handler: async (_ctx: Ctx, a) => ({ text: a.message.repeat(a.times), data: { message: a.message, times: a.times } }),
});
const write = defineTool({
  name: "write_thing",
  title: "Write",
  description: "Needs write scope",
  scopes: ["catalog:write"],
  annotations: { readOnlyHint: false, destructiveHint: true },
  input: z.object({}),
  handler: async () => ({ text: "written" }),
});
const failing = defineTool({
  name: "fail",
  title: "Fail",
  description: "Fails",
  scopes: [],
  annotations: {},
  input: z.object({ kind: z.enum(["business", "crash"]) }),
  handler: async (_ctx: Ctx, a) => {
    if (a.kind === "business") throw new ToolError("Product not found in this store.");
    throw new Error("secret database detail");
  },
});

function server(onToolCall?: (info: ToolCallInfo) => void): McpServerDefinition<Ctx> {
  return {
    name: "test",
    version: "1.0.0",
    title: () => "Test server",
    instructions: () => "Use the tools.",
    tools: [echo, write, failing],
    canUseTool: (ctx, t) => (t.scopes.length === 0 || t.scopes.some((s) => ctx.scopes.includes(s)) ? { ok: true } : { ok: false, reason: `${t.name} requires the ${t.scopes.join(" or ")} scope.` }),
    beforeToolCall: async (ctx) => (ctx.quotaOk === false ? { ok: false, status: "rate_limited", reason: "Daily quota reached." } : { ok: true }),
    onToolCall: (_ctx, info) => onToolCall?.(info),
    prompts: { list: () => [{ name: "p", description: "d" }], get: (_c, name) => (name === "p" ? { description: "d", messages: [{ role: "user", content: { type: "text", text: "hi" } }] } : null) },
  };
}

const ctx: Ctx = { scopes: ["catalog:read"] };
const rpc = (method: string, params?: unknown, id: number | string = 1) => ({ jsonrpc: "2.0", id, method, params });

describe("initialize et négociation de version", () => {
  it("renvoie la version demandée si elle est prise en charge, avec capacités et serverInfo", async () => {
    const r = (await handleMcpMessage(server(), ctx, rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {} }))) as { result: Record<string, unknown> };
    expect(r.result.protocolVersion).toBe("2025-03-26");
    expect(r.result.serverInfo).toEqual({ name: "test", title: "Test server", version: "1.0.0" });
    expect(r.result.capabilities).toEqual({ tools: { listChanged: false }, prompts: { listChanged: false } });
    expect(r.result.instructions).toBe("Use the tools.");
  });

  it("propose la dernière version prise en charge sinon", async () => {
    const r = (await handleMcpMessage(server(), ctx, rpc("initialize", { protocolVersion: "1999-01-01" }))) as { result: { protocolVersion: string } };
    expect(r.result.protocolVersion).toBe(LATEST_PROTOCOL_VERSION);
    expect(LATEST_PROTOCOL_VERSION).toBe("2025-06-18");
  });

  it("ne répond jamais à une notification", async () => {
    expect(await handleMcpMessage(server(), ctx, { jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
    expect(await handleMcpPayload(server(), ctx, { jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 1 } })).toBeNull();
  });

  it("ping renvoie un objet vide", async () => {
    expect(await handleMcpMessage(server(), ctx, rpc("ping", undefined, "abc"))).toEqual({ jsonrpc: "2.0", id: "abc", result: {} });
  });
});

describe("erreurs JSON-RPC", () => {
  it("méthode inconnue : -32601", async () => {
    const r = (await handleMcpMessage(server(), ctx, rpc("resources/subscribe"))) as { error: { code: number } };
    expect(r.error.code).toBe(RPC_ERROR.METHOD_NOT_FOUND);
    expect(RPC_ERROR.METHOD_NOT_FOUND).toBe(-32601);
  });

  it("requête invalide : -32600 (jsonrpc absent, id objet)", async () => {
    expect(((await handleMcpMessage(server(), ctx, { id: 1, method: "ping" })) as { error: { code: number } }).error.code).toBe(-32600);
    expect(((await handleMcpMessage(server(), ctx, { jsonrpc: "2.0", id: { x: 1 }, method: "ping" })) as { error: { code: number } }).error.code).toBe(-32600);
    expect(((await handleMcpMessage(server(), ctx, "nope")) as { error: { code: number } }).error.code).toBe(-32600);
  });

  it("params non objet : -32602", async () => {
    const r = (await handleMcpMessage(server(), ctx, { jsonrpc: "2.0", id: 1, method: "tools/list", params: [1] })) as { error: { code: number } };
    expect(r.error.code).toBe(RPC_ERROR.INVALID_PARAMS);
  });

  it("lots refusés à partir de 2025-06-18 (M1)", async () => {
    for (const v of ["2025-06-18", "2025-11-25"]) {
      const r = (await handleMcpPayload(server(), ctx, [rpc("ping", undefined, 1)], v)) as { error: { code: number; message: string } };
      expect(r.error.code, v).toBe(-32600);
      expect(r.error.message).toMatch(/batching/);
    }
    // Version par défaut du paramètre : la dernière, donc refus.
    expect(((await handleMcpPayload(server(), ctx, [rpc("ping")])) as { error: { code: number } }).error.code).toBe(-32600);
    expect(batchingAllowed("2025-03-26")).toBe(true);
    expect(batchingAllowed("2025-06-18")).toBe(false);
  });

  it("lots acceptés avant 2025-06-18 : réponses des requêtes seulement, 1 à 20 messages, quota compté par message", async () => {
    const batch = [rpc("ping", undefined, 1), { jsonrpc: "2.0", method: "notifications/initialized" }, rpc("ping", undefined, 2)];
    const r = await handleMcpPayload(server(), ctx, batch, "2025-03-26");
    expect(Array.isArray(r) && r.map((x) => x.id)).toEqual([1, 2]);
    const empty = (await handleMcpPayload(server(), ctx, [], "2025-03-26")) as { error: { code: number } };
    expect(empty.error.code).toBe(-32600);
    const big = (await handleMcpPayload(server(), ctx, Array.from({ length: 21 }, (_, i) => rpc("ping", undefined, i)), "2025-03-26")) as { error: { code: number } };
    expect(big.error.code).toBe(-32600);
    expect(messageCount(batch)).toBe(3);
    expect(messageCount({ jsonrpc: "2.0" })).toBe(1);
    expect(messageCount(Array.from({ length: 50 }))).toBe(20);
  });

  it("une réponse du client est ignorée", async () => {
    expect(await handleMcpMessage(server(), ctx, { jsonrpc: "2.0", id: 9, result: {} })).toBeNull();
  });
});

describe("tools/list et tools/call", () => {
  it("ne liste que les outils autorisés, avec schéma JSON et annotations", async () => {
    const r = (await handleMcpMessage(server(), ctx, rpc("tools/list"))) as { result: { tools: { name: string; inputSchema: Record<string, unknown>; annotations: Record<string, unknown> }[] } };
    expect(r.result.tools.map((t) => t.name)).toEqual(["echo", "fail"]);
    const t = r.result.tools[0];
    expect(t.inputSchema.type).toBe("object");
    expect(t.inputSchema).not.toHaveProperty("$schema");
    expect((t.inputSchema.required as string[]) ?? []).toEqual(["message"]);
    expect(t.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: false, title: "Echo" });
  });

  it("appel réussi : contenu texte + structuredContent, journalisé ok", async () => {
    const infos: ToolCallInfo[] = [];
    const r = (await handleMcpMessage(server((i) => infos.push(i)), ctx, rpc("tools/call", { name: "echo", arguments: { message: "ab", times: 2 } }))) as { result: { content: { text: string }[]; structuredContent: unknown; isError?: boolean } };
    expect(r.result.isError).toBeUndefined();
    expect(r.result.content[0].text).toBe("abab");
    expect(r.result.structuredContent).toEqual({ message: "ab", times: 2 });
    expect(infos[0]).toMatchObject({ tool: "echo", ok: true, status: "ok" });
  });

  it("scope manquant : résultat isError explicite (pas d'exécution), journalisé denied", async () => {
    const infos: ToolCallInfo[] = [];
    const handler = vi.spyOn(write, "handler");
    const r = (await handleMcpMessage(server((i) => infos.push(i)), ctx, rpc("tools/call", { name: "write_thing", arguments: {} }))) as { result: { isError: boolean; content: { text: string }[] } };
    expect(r.result.isError).toBe(true);
    expect(r.result.content[0].text).toContain("catalog:write");
    expect(handler).not.toHaveBeenCalled();
    expect(infos[0].status).toBe("denied");
  });

  it("arguments invalides : isError lisible par le modèle", async () => {
    const r = (await handleMcpMessage(server(), ctx, rpc("tools/call", { name: "echo", arguments: { message: "", times: 9 } }))) as { result: { isError: boolean; content: { text: string }[] } };
    expect(r.result.isError).toBe(true);
    expect(r.result.content[0].text).toMatch(/Invalid arguments for echo: .*message/);
  });

  it("outil inconnu : -32602 ; nom absent : -32602", async () => {
    expect(((await handleMcpMessage(server(), ctx, rpc("tools/call", { name: "nope" }))) as { error: { code: number } }).error.code).toBe(-32602);
    expect(((await handleMcpMessage(server(), ctx, rpc("tools/call", {}))) as { error: { code: number } }).error.code).toBe(-32602);
  });

  it("erreur métier transmise ; erreur inattendue masquée (aucune fuite de détail interne)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const biz = (await handleMcpMessage(server(), ctx, rpc("tools/call", { name: "fail", arguments: { kind: "business" } }))) as { result: { isError: boolean; content: { text: string }[] } };
    expect(biz.result).toMatchObject({ isError: true, content: [{ text: "Product not found in this store." }] });
    const crash = (await handleMcpMessage(server(), ctx, rpc("tools/call", { name: "fail", arguments: { kind: "crash" } }))) as { result: { isError: boolean; content: { text: string }[] } };
    expect(crash.result.isError).toBe(true);
    expect(crash.result.content[0].text).not.toContain("secret");
    spy.mockRestore();
  });

  it("quota journalier atteint : isError, statut rate_limited", async () => {
    const infos: ToolCallInfo[] = [];
    const r = (await handleMcpMessage(server((i) => infos.push(i)), { scopes: ["catalog:read"], quotaOk: false }, rpc("tools/call", { name: "echo", arguments: { message: "x" } }))) as { result: { isError: boolean; content: { text: string }[] } };
    expect(r.result).toMatchObject({ isError: true, content: [{ text: "Daily quota reached." }] });
    expect(infos[0].status).toBe("rate_limited");
  });

  it("prompts/get : prompt connu, inconnu en -32602 ; ressources absentes : -32601", async () => {
    const p = (await handleMcpMessage(server(), ctx, rpc("prompts/get", { name: "p" }))) as { result: { messages: unknown[] } };
    expect(p.result.messages).toHaveLength(1);
    expect(((await handleMcpMessage(server(), ctx, rpc("prompts/get", { name: "x" }))) as { error: { code: number } }).error.code).toBe(-32602);
    expect(((await handleMcpMessage(server(), ctx, rpc("resources/list"))) as { error: { code: number } }).error.code).toBe(-32601);
  });

  it("schéma JSON stable (mise en cache) et valeurs par défaut exposées", () => {
    const a = inputJsonSchema(echo.input);
    expect(inputJsonSchema(echo.input)).toBe(a);
    expect((a.properties as Record<string, { default?: unknown }>).times.default).toBe(1);
  });
});
