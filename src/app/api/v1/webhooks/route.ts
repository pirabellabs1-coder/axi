import { z } from "zod";
import { restRoute } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/problem";
import { webhookActor } from "@/lib/api/resources";
import { serializeEndpoint } from "@/lib/api/serializers";
import { createEndpoint, listEndpoints } from "@/lib/webhooks/service";

export const dynamic = "force-dynamic";

const createSchema = z
  .object({
    url: z.string().min(8).max(2000),
    events: z.array(z.string().max(60)).min(1).max(30),
    description: z.string().max(200).nullish(),
    include_personal_data: z.boolean().optional(),
  })
  .strict();

/** GET /api/v1/webhooks — POST /api/v1/webhooks (webhooks:write ; le secret n'est renvoyé qu'à la création). */
export const GET = restRoute({ method: "GET", route: "/v1/webhooks", scope: "webhooks:write" }, async ({ ctx }) => ({
  status: 200,
  body: { data: (await listEndpoints(ctx.store.id)).map(serializeEndpoint), page: { next_cursor: null, has_more: false } },
}));

export const POST = restRoute({ method: "POST", route: "/v1/webhooks", scope: "webhooks:write" }, async ({ ctx, body }) => {
  const input = createSchema.parse(body);
  // S1 : `include_personal_data` expose nom, téléphone, e-mail et adresse dans les livraisons. Le jeton doit
  // donc AUSSI porter `customers:read`, comme toute lecture de données personnelles de l'API (le service
  // applique le même garde-fou, quel que soit l'appelant programmatique).
  if (input.include_personal_data === true && !ctx.scopes.includes("customers:read")) {
    throw new ApiError(
      403,
      "insufficient_scope",
      "Sending personal data in webhooks requires the customers:read scope in addition to webhooks:write.",
      { required_scope: "customers:read" },
      { "WWW-Authenticate": 'Bearer realm="axi-api", error="insufficient_scope", scope="customers:read"' },
    );
  }
  const { endpoint, secret } = await createEndpoint(webhookActor(ctx), { url: input.url, events: input.events, description: input.description, includePersonalData: input.include_personal_data });
  return { status: 201, body: { ...serializeEndpoint(endpoint), secret }, headers: { Location: `/api/v1/webhooks/${endpoint.id}` } };
});
