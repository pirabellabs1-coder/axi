import type { Metadata } from "next";
import { appBaseUrl } from "@/lib/mcp/runtime";
import { MERCHANT_TOOL_REFERENCE } from "@/lib/mcp/reference";
import { C, Code, DocTitle, H2, H3, NextLink, P, Table, UL } from "../_ui";

export const metadata: Metadata = { title: "API" };

export default function ApiDocPage() {
  const BASE = appBaseUrl();
  return (
    <>
      <DocTitle
        title="API"
        lead="Votre jeton d'accès ouvre deux interfaces : l'API REST /api/v1 (ressources classiques) et le serveur MCP marchand (JSON-RPC, outils de plus haut niveau). Dans les deux cas, la boutique est déduite du jeton : aucun paramètre ne permet d'en viser une autre."
      />

      <H2 id="mcp">Serveur MCP marchand</H2>
      <P>
        Point d&apos;accès : <C>{`POST ${BASE}/api/mcp`}</C>, message JSON-RPC 2.0, réponse <C>application/json</C>. Méthodes utiles :
        <C>initialize</C>, <C>tools/list</C>, <C>tools/call</C>.
      </P>
      <Code
        label="Lire l'identité et les chiffres de la boutique"
        code={`curl -s ${BASE}/api/mcp \\
  -H "Authorization: Bearer $ACCESS_TOKEN" \\
  -H "Content-Type: application/json" \\
  -H "MCP-Protocol-Version: 2025-06-18" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_store_overview","arguments":{}}}'`}
      />
      <P>
        Résultat : <C>result.structuredContent</C> (objet JSON), <C>result.content[0].text</C> (résumé lisible). Une erreur métier (scope manquant,
        produit introuvable) est un résultat <C>{`{ "isError": true }`}</C> ; une erreur d&apos;authentification renvoie HTTP 401/403 (code <C>-32001</C>),
        un dépassement de quota HTTP 429 (<C>-32029</C>) avec <C>Retry-After</C>.
      </P>
      <H3>Outils disponibles</H3>
      <Table
        head={["Outil", "Scope", "Description"]}
        rows={MERCHANT_TOOL_REFERENCE.map((t) => [<C key={t.name}>{t.name}</C>, t.scopes.join(", "), t.description])}
      />

      <H2 id="rest">API REST /api/v1</H2>
      <P>
        L&apos;API REST accepte le jeton d&apos;accès de votre application installée (<C>axi_oat_…</C> obtenu à l&apos;installation) ainsi que les jetons API
        créés par un marchand (<C>axi_live_…</C>). Un jeton OAuth d&apos;un simple connecteur IA (non rattaché à une installation d&apos;app) y est refusé.
      </P>
      <P>Plans de la boutique : Business (lecture seule), Scale et Enterprise (lecture et écriture). En-tête <C>Authorization: Bearer axi_oat_…</C>. Quotas par minute et par jour selon le plan (429 + <C>Retry-After</C>).</P>
      <Table
        head={["Méthode", "Route", "Scope"]}
        rows={[
          ["GET", <C key="1">/products, /products/{"{id}"}</C>, "catalog:read"],
          ["POST", <C key="2">/products</C>, "catalog:write"],
          ["PATCH", <C key="3">/products/{"{id}"}</C>, "catalog:write"],
          ["POST", <C key="4">/inventory/adjustments</C>, "inventory:write"],
          ["GET", <C key="5">/orders, /orders/{"{id}"}</C>, "orders:read"],
          ["POST", <C key="6">/orders/{"{id}"}/transitions</C>, "orders:write"],
          ["GET", <C key="7">/customers, /customers/{"{id}"}</C>, "customers:read"],
          ["GET, POST", <C key="8">/webhooks</C>, "webhooks:write"],
          ["GET, DELETE", <C key="9">/webhooks/{"{id}"}</C>, "webhooks:write"],
        ]}
      />
      <H3>Conventions</H3>
      <UL>
        <li>Pagination par curseur : <C>?limit=1..100</C> (20 par défaut) et <C>?cursor=</C> ; réponse <C>{`{ "data": [...], "page": { "next_cursor": "...", "has_more": true } }`}</C>.</li>
        <li>Montants entiers dans la plus petite unité de la devise : <C>5000</C> = 5 000 FCFA. Dates ISO 8601 UTC.</li>
        <li><C>Idempotency-Key</C> obligatoire sur tout POST (UUID v4 conseillé), conservée 24 h.</li>
        <li>Erreurs au format RFC 9457 (<C>application/problem+json</C>) avec <C>code</C> et <C>request_id</C>.</li>
        <li>En-tête facultatif <C>Axi-Api-Version: 2026-10</C>. CORS fermé : l&apos;API est réservée aux serveurs.</li>
        <li>Spécification OpenAPI 3.1 : <C>{`${BASE}/api/openapi-2026-10.json`}</C>.</li>
      </UL>
      <Code
        code={`curl -s "${BASE}/api/v1/products?status=ACTIVE&limit=10" -H "Authorization: Bearer $TOKEN"

curl -s -X POST ${BASE}/api/v1/orders/ORDER_ID/transitions \\
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \\
  -H "Idempotency-Key: $(uuidgen)" -d '{"status":"CONFIRMED"}'`}
      />
      <NextLink slug="webhooks" />
    </>
  );
}
