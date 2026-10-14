import { z } from "zod";

/**
 * Model Context Protocol — couche protocole (JSON-RPC 2.0), indépendante du transport et de la base.
 * Spécification : https://modelcontextprotocol.io/specification/2025-06-18
 *
 * Méthodes prises en charge : initialize, notifications/initialized, ping, tools/list, tools/call,
 * resources/list, resources/read, resources/templates/list, prompts/list, prompts/get.
 * Mode sans état : aucune session côté serveur, chaque requête HTTP porte son jeton.
 * Module pur (aucun import serveur) : testé dans tests/mcp-protocol.test.ts.
 */

export const LATEST_PROTOCOL_VERSION = "2025-06-18";
export const SUPPORTED_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"] as const;
/** Version supposée quand le client n'envoie pas l'en-tête MCP-Protocol-Version (spécification, §transport). */
export const DEFAULT_NEGOTIATED_VERSION = "2025-03-26";

export function isSupportedProtocolVersion(v: string): boolean {
  return (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(v);
}

export const RPC_ERROR = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  /** Erreurs propres au serveur (plage -32000 à -32099) */
  RATE_LIMITED: -32029,
  UNAVAILABLE: -32030,
  RESOURCE_NOT_FOUND: -32002,
} as const;

export type JsonRpcId = string | number;
export type JsonRpcRequest = { jsonrpc: "2.0"; id?: JsonRpcId | null; method: string; params?: Record<string, unknown> };
export type JsonRpcSuccess = { jsonrpc: "2.0"; id: JsonRpcId | null; result: unknown };
export type JsonRpcError = { jsonrpc: "2.0"; id: JsonRpcId | null; error: { code: number; message: string; data?: unknown } };
export type JsonRpcResponse = JsonRpcSuccess | JsonRpcError;

export function rpcError(id: JsonRpcId | null | undefined, code: number, message: string, data?: unknown): JsonRpcError {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message, ...(data === undefined ? {} : { data }) } };
}

export function rpcResult(id: JsonRpcId | null | undefined, result: unknown): JsonRpcSuccess {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

/* ───────────────────────── Outils, ressources, prompts ───────────────────────── */

export type ToolAnnotations = { title?: string; readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };

/** Erreur métier d'un outil : renvoyée au modèle comme résultat `isError: true` (il peut corriger et réessayer). */
export class ToolError extends Error {
  constructor(message: string, public code: string = "tool_error") {
    super(message);
    this.name = "ToolError";
  }
}

export type ToolOutput = { text: string; data?: Record<string, unknown> };

export type ToolContent = { type: "text"; text: string };
export type ToolCallResult = { content: ToolContent[]; structuredContent?: Record<string, unknown>; isError?: boolean };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type McpTool<C, S extends z.ZodObject<any> = z.ZodObject<any>> = {
  name: string;
  title: string;
  description: string;
  input: S;
  /** Scopes acceptés (l'un d'eux suffit). Vide = aucun scope requis. */
  scopes: readonly string[];
  annotations: ToolAnnotations;
  handler: (ctx: C, args: z.output<S>) => Promise<ToolOutput>;
};

/** Aide au typage : infère le type des arguments depuis le schéma Zod. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function defineTool<C, S extends z.ZodObject<any>>(tool: McpTool<C, S>): McpTool<C> {
  return tool as unknown as McpTool<C>;
}

export type McpResource = { uri: string; name: string; title?: string; description?: string; mimeType: string };
export type McpResourceContents = { uri: string; mimeType: string; text: string };
export type McpPrompt = { name: string; title?: string; description: string; arguments?: { name: string; description: string; required?: boolean }[] };
export type McpPromptMessage = { role: "user" | "assistant"; content: { type: "text"; text: string } };

export type ToolCallInfo = { tool: string; ok: boolean; status: "ok" | "error" | "denied" | "rate_limited"; errorCode?: number; durationMs: number };

export type McpServerDefinition<C> = {
  name: string;
  version: string;
  title: (ctx: C) => string;
  instructions: (ctx: C) => string;
  tools: McpTool<C>[];
  /** Le contexte a-t-il accès à cet outil (scopes, plan) ? Les outils refusés n'apparaissent pas dans tools/list. */
  canUseTool: (ctx: C, tool: McpTool<C>) => { ok: true } | { ok: false; reason: string };
  /** Contrôle avant exécution (quota journalier…). Renvoie un message pour refuser. */
  beforeToolCall?: (ctx: C, tool: McpTool<C>) => Promise<{ ok: true } | { ok: false; reason: string; status: "denied" | "rate_limited" }>;
  onToolCall?: (ctx: C, info: ToolCallInfo) => void | Promise<void>;
  resources?: {
    list: (ctx: C) => McpResource[];
    read: (ctx: C, uri: string) => Promise<McpResourceContents | null>;
  };
  prompts?: {
    list: (ctx: C) => McpPrompt[];
    get: (ctx: C, name: string, args: Record<string, string>) => { description: string; messages: McpPromptMessage[] } | null;
  };
};

/* ───────────────────────── Schémas JSON des entrées ───────────────────────── */

const schemaCache = new WeakMap<object, Record<string, unknown>>();

/** JSON Schema (draft 2020-12) d'un schéma Zod d'entrée — source unique de vérité pour la validation et la doc. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function inputJsonSchema(schema: z.ZodObject<any>): Record<string, unknown> {
  const cached = schemaCache.get(schema);
  if (cached) return cached;
  const json = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
  delete json.$schema;
  if (json.type !== "object") json.type = "object";
  schemaCache.set(schema, json);
  return json;
}

export function toolDescriptor<C>(tool: McpTool<C>) {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: inputJsonSchema(tool.input),
    annotations: { title: tool.title, openWorldHint: false, ...tool.annotations },
  };
}

function formatZodIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 8)
    .map((i) => `${i.path.length ? i.path.join(".") : "(arguments)"}: ${i.message}`)
    .join("; ");
}

function textResult(text: string, data?: Record<string, unknown>, isError = false): ToolCallResult {
  const content: ToolContent[] = [{ type: "text", text }];
  if (data && !isError) content.push({ type: "text", text: JSON.stringify(data) });
  return { content, ...(data && !isError ? { structuredContent: data } : {}), ...(isError ? { isError: true } : {}) };
}

/* ───────────────────────── Répartition ───────────────────────── */

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

export function isValidId(v: unknown): v is JsonRpcId {
  return (typeof v === "string" && v.length <= 200) || (typeof v === "number" && Number.isFinite(v));
}

/**
 * Traite UN message JSON-RPC. Renvoie la réponse, ou null pour une notification (aucune réponse attendue)
 * ou une réponse du client (ignorée : ce serveur n'émet pas de requêtes vers le client).
 */
export async function handleMcpMessage<C>(server: McpServerDefinition<C>, ctx: C, message: unknown): Promise<JsonRpcResponse | null> {
  if (!isObject(message) || message.jsonrpc !== "2.0") {
    return rpcError(isObject(message) && isValidId(message.id) ? message.id : null, RPC_ERROR.INVALID_REQUEST, "Invalid Request: expected a JSON-RPC 2.0 object");
  }
  // Réponse du client (résultat/erreur sans méthode) : ignorée.
  if (typeof message.method !== "string") {
    if ("result" in message || "error" in message) return null;
    return rpcError(isValidId(message.id) ? message.id : null, RPC_ERROR.INVALID_REQUEST, "Invalid Request: missing method");
  }
  const hasId = "id" in message && message.id !== undefined;
  if (hasId && !isValidId(message.id)) return rpcError(null, RPC_ERROR.INVALID_REQUEST, "Invalid Request: id must be a string or a number");
  const id = hasId ? (message.id as JsonRpcId) : null;
  const method = message.method;
  if (message.params !== undefined && !isObject(message.params)) {
    return hasId ? rpcError(id, RPC_ERROR.INVALID_PARAMS, "params must be an object") : null;
  }
  const params = (message.params ?? {}) as Record<string, unknown>;

  // Notifications : jamais de réponse.
  if (!hasId) return null;

  try {
    switch (method) {
      case "initialize": {
        const requested = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
        const protocolVersion = isSupportedProtocolVersion(requested) ? requested : LATEST_PROTOCOL_VERSION;
        return rpcResult(id, {
          protocolVersion,
          capabilities: {
            tools: { listChanged: false },
            ...(server.resources ? { resources: { subscribe: false, listChanged: false } } : {}),
            ...(server.prompts ? { prompts: { listChanged: false } } : {}),
          },
          serverInfo: { name: server.name, title: server.title(ctx), version: server.version },
          instructions: server.instructions(ctx),
        });
      }
      case "ping":
        return rpcResult(id, {});
      case "tools/list": {
        const tools = server.tools.filter((t) => server.canUseTool(ctx, t).ok).map(toolDescriptor);
        return rpcResult(id, { tools });
      }
      case "tools/call":
        return await callTool(server, ctx, id, params);
      case "resources/list":
        if (!server.resources) break;
        return rpcResult(id, { resources: server.resources.list(ctx) });
      case "resources/templates/list":
        if (!server.resources) break;
        return rpcResult(id, { resourceTemplates: [] });
      case "resources/read": {
        if (!server.resources) break;
        if (typeof params.uri !== "string" || !params.uri) return rpcError(id, RPC_ERROR.INVALID_PARAMS, "uri is required");
        const contents = await server.resources.read(ctx, params.uri);
        if (!contents) return rpcError(id, RPC_ERROR.RESOURCE_NOT_FOUND, "Resource not found", { uri: params.uri });
        return rpcResult(id, { contents: [contents] });
      }
      case "prompts/list":
        if (!server.prompts) break;
        return rpcResult(id, { prompts: server.prompts.list(ctx) });
      case "prompts/get": {
        if (!server.prompts) break;
        if (typeof params.name !== "string") return rpcError(id, RPC_ERROR.INVALID_PARAMS, "name is required");
        const args = isObject(params.arguments) ? Object.fromEntries(Object.entries(params.arguments).map(([k, v]) => [k, String(v ?? "")])) : {};
        const prompt = server.prompts.get(ctx, params.name, args);
        if (!prompt) return rpcError(id, RPC_ERROR.INVALID_PARAMS, `Unknown prompt: ${params.name}`);
        return rpcResult(id, prompt);
      }
      case "logging/setLevel":
        return rpcResult(id, {});
      case "completion/complete":
        return rpcResult(id, { completion: { values: [], hasMore: false } });
    }
    return rpcError(id, RPC_ERROR.METHOD_NOT_FOUND, `Method not found: ${method}`);
  } catch (e) {
    console.error("[mcp]", method, e);
    return rpcError(id, RPC_ERROR.INTERNAL_ERROR, "Internal error");
  }
}

async function callTool<C>(server: McpServerDefinition<C>, ctx: C, id: JsonRpcId | null, params: Record<string, unknown>): Promise<JsonRpcResponse> {
  const name = params.name;
  if (typeof name !== "string" || !name) return rpcError(id, RPC_ERROR.INVALID_PARAMS, "Tool name is required");
  const tool = server.tools.find((t) => t.name === name);
  if (!tool) return rpcError(id, RPC_ERROR.INVALID_PARAMS, `Unknown tool: ${name}`);
  const started = Date.now();
  const report = (info: Omit<ToolCallInfo, "tool" | "durationMs">) => {
    try {
      void server.onToolCall?.(ctx, { tool: name, durationMs: Date.now() - started, ...info });
    } catch {
      // journalisation best effort
    }
  };

  const access = server.canUseTool(ctx, tool);
  if (!access.ok) {
    report({ ok: false, status: "denied" });
    return rpcResult(id, textResult(access.reason, undefined, true));
  }
  if (params.arguments !== undefined && !isObject(params.arguments)) {
    return rpcError(id, RPC_ERROR.INVALID_PARAMS, "arguments must be an object");
  }
  const parsed = tool.input.safeParse(params.arguments ?? {});
  if (!parsed.success) {
    report({ ok: false, status: "error" });
    return rpcResult(id, textResult(`Invalid arguments for ${name}: ${formatZodIssues(parsed.error)}`, undefined, true));
  }
  if (server.beforeToolCall) {
    const gate = await server.beforeToolCall(ctx, tool);
    if (!gate.ok) {
      report({ ok: false, status: gate.status });
      return rpcResult(id, textResult(gate.reason, undefined, true));
    }
  }
  try {
    const out = await tool.handler(ctx, parsed.data);
    report({ ok: true, status: "ok" });
    return rpcResult(id, textResult(out.text, out.data));
  } catch (e) {
    if (e instanceof ToolError) {
      report({ ok: false, status: "error" });
      return rpcResult(id, textResult(e.message, undefined, true));
    }
    console.error("[mcp] tool", name, e);
    report({ ok: false, status: "error", errorCode: RPC_ERROR.INTERNAL_ERROR });
    return rpcResult(id, textResult("The tool failed unexpectedly. Try again later.", undefined, true));
  }
}

/** Les lots JSON-RPC ont été retirés de MCP à partir de la version 2025-06-18. */
export const BATCH_REMOVED_IN = "2025-06-18";
export const MAX_BATCH = 20;

export function batchingAllowed(protocolVersion: string): boolean {
  return protocolVersion < BATCH_REMOVED_IN;
}

/** Nombre de messages d'un corps (pour compter les quotas par message). */
export function messageCount(payload: unknown): number {
  return Array.isArray(payload) ? Math.max(1, Math.min(payload.length, MAX_BATCH)) : 1;
}

/**
 * Corps HTTP → réponses. Un lot n'est accepté que pour les versions antérieures à 2025-06-18
 * (20 messages max) ; sinon -32600. Renvoie `null` quand aucune réponse n'est due (notifications seules → 202).
 */
export async function handleMcpPayload<C>(server: McpServerDefinition<C>, ctx: C, payload: unknown, protocolVersion: string = LATEST_PROTOCOL_VERSION): Promise<JsonRpcResponse | JsonRpcResponse[] | null> {
  if (Array.isArray(payload)) {
    if (!batchingAllowed(protocolVersion)) return rpcError(null, RPC_ERROR.INVALID_REQUEST, `Invalid Request: JSON-RPC batching is not supported in protocol version ${protocolVersion}`);
    if (payload.length === 0 || payload.length > MAX_BATCH) return rpcError(null, RPC_ERROR.INVALID_REQUEST, `Invalid Request: batch must contain 1 to ${MAX_BATCH} messages`);
    const out: JsonRpcResponse[] = [];
    for (const m of payload) {
      const r = await handleMcpMessage(server, ctx, m);
      if (r) out.push(r);
    }
    return out.length ? out : null;
  }
  return handleMcpMessage(server, ctx, payload);
}
