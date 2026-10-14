import type { Metadata } from "next";
import { appBaseUrl } from "@/lib/mcp/runtime";
import { WEBHOOK_EVENTS, WEBHOOK_EVENT_LABELS } from "@/lib/webhooks/events";
import { C, Code, DocTitle, H2, H3, NextLink, P, Table, UL } from "../_ui";

export const metadata: Metadata = { title: "Webhooks" };

const VERIFY = `import crypto from "node:crypto";

// header : valeur de Axi-Webhook-Signature (cycle de vie) ou Axi-Signature (événements de boutique)
export function verifyAxiSignature(rawBody, header, secret, toleranceSec = 300) {
  const parts = header.split(",").map((p) => p.split("="));
  const t = Number(parts.find(([k]) => k === "t")?.[1]);
  if (!t || Math.abs(Date.now() / 1000 - t) > toleranceSec) return false;
  const expected = crypto.createHmac("sha256", secret).update(\`\${t}.\${rawBody}\`).digest();
  return parts.filter(([k]) => k === "v1").some(([, v]) => {
    const sig = Buffer.from(v ?? "", "hex");
    return sig.length === expected.length && crypto.timingSafeEqual(sig, expected);
  });
}`;

export default function WebhooksDocPage() {
  const BASE = appBaseUrl();
  return (
    <>
      <DocTitle
        title="Webhooks"
        lead="Axi appelle votre serveur en HTTPS : d'abord pour le cycle de vie de votre application (installation, désinstallation), ensuite, si vous les abonnez, pour les événements de la boutique (commandes, produits, stock…). Chaque envoi est signé."
      />

      <H2 id="cycle-de-vie">Cycle de vie de l&apos;application</H2>
      <P>Envoyés à l&apos;<strong>URL de webhook</strong> de l&apos;onglet Configuration, signés avec votre <strong>secret de signature</strong> (<C>whsec_…</C>, onglet Identifiants). Les installations de test en envoient aussi. Régénérer le <C>client_secret</C> renouvelle aussi ce secret de signature.</P>
      <Table
        head={["Événement", "Quand"]}
        rows={[
          [<C key="i">app.installed</C>, "L'application vient d'être installée sur une boutique (scopes accordés dans data.scopes)."],
          [<C key="u">app.uninstalled</C>, "L'application a été désinstallée : les jetons de la boutique sont déjà révoqués, supprimez vos données si nécessaire."],
        ]}
      />
      <Code
        label="Requête reçue"
        code={`POST <votre URL de webhook>
Content-Type: application/json
Axi-Webhook-Id: evt_app_installed_clx..._1760000000   (stable : dédupliquez dessus)
Axi-Webhook-Topic: app.installed
Axi-Webhook-Shop: chez-aicha
Axi-Webhook-Timestamp: 1760000000
Axi-Webhook-Api-Version: 2026-10
Axi-Webhook-Signature: t=1760000000,v1=5f2b...

{ "id": "evt_app_installed_clx..._1760000000", "type": "app.installed",
  "created_at": "2026-10-13T10:00:00.000Z", "api_version": "2026-10",
  "app_id": "...", "store_id": "...", "shop": "chez-aicha", "installation_id": "...",
  "data": { "scopes": ["store:read","catalog:read"], "status": "ACTIVE",
            "installed_at": "2026-10-13T10:00:00.000Z", "uninstalled_at": null } }`}
      />
      <UL>
        <li>Livraison au moins une fois, avec relances par la file de tâches d&apos;Axi : dédupliquez sur <C>Axi-Webhook-Id</C>. Toute réponse 2xx vaut succès ; délai maximal 10 s.</li>
        <li>https sur les ports 443 ou 8443 uniquement ; redirections non suivies ; adresses privées, locales ou de métadonnées cloud refusées (protection SSRF). Pour une désinstallation, <C>data.scopes</C> vaut <C>[]</C>.</li>
      </UL>

      <H2 id="boutique">Événements de la boutique</H2>
      <P>
        Avec le scope <C>webhooks:write</C>, votre app crée elle-même ses abonnements par l&apos;API : <C>{`POST ${BASE}/api/v1/webhooks`}</C>. Le secret du
        point (<C>whsec_…</C>) est renvoyé <strong>une seule fois</strong> dans la réponse : stockez-le avec la boutique.
      </P>
      <Code
        code={`curl -s -X POST ${BASE}/api/v1/webhooks \\
  -H "Authorization: Bearer $ACCESS_TOKEN" -H "Content-Type: application/json" \\
  -H "Idempotency-Key: $(uuidgen)" \\
  -d '{"url":"https://mon-app.com/webhooks/axi","events":["order.created","order.paid"]}'`}
      />
      <Table head={["Événement", "Description"]} rows={WEBHOOK_EVENTS.map((e) => [<C key={e}>{e}</C>, WEBHOOK_EVENT_LABELS[e]])} />
      <H3>En-têtes</H3>
      <P>
        <C>Axi-Webhook-Id</C> (identifiant d&apos;événement, à dédupliquer), <C>Axi-Event</C>, <C>Axi-Delivery-Id</C>, <C>Axi-Api-Version</C> et <C>Axi-Signature: t=…,v1=…</C>.
        Le corps contient <C>data</C> minimal (identifiants, statuts, montants) : relisez la ressource par l&apos;API pour le détail.
      </P>
      <UL>
        <li>URL https uniquement, ports 443 ou 8443. Réponse 2xx attendue en moins de 10 s.</li>
        <li>Relances : 1 min, 5 min, 30 min, 2 h, 6 h, 12 h, 24 h, puis abandon. Désactivation automatique après 50 échecs consécutifs sur plus de 72 h.</li>
        <li>Rotation du secret : pendant 24 h, chaque envoi porte deux <C>v1</C> (nouveau et ancien).</li>
      </UL>

      <H2 id="signature">Vérifier la signature</H2>
      <P>
        <C>v1 = hex(HMAC-SHA256(secret, t + &quot;.&quot; + corps_brut))</C>, la clé étant la chaîne complète <C>whsec_…</C>. Calculez sur le <strong>corps brut</strong> reçu
        (jamais sur un JSON re-sérialisé), refusez si aucun <C>v1</C> ne correspond ou si l&apos;écart avec <C>t</C> dépasse 300 s, comparez en temps constant.
      </P>
      <Code label="Node.js" code={VERIFY} />
      <NextLink slug="embarquees" />
    </>
  );
}
