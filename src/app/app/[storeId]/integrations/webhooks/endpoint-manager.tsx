"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Pause, Play, Plus, RotateCw, Send, ShieldAlert, Trash2, Webhook as WebhookIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, ConfirmButton } from "@/components/ui/dialog";
import { Field, Input, Checkbox } from "@/components/ui/field";
import { Alert, EmptyState } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import { formatDateTime, relativeTime, cn } from "@/lib/utils";
import { WEBHOOK_EVENTS, WEBHOOK_EVENT_LABELS, type WebhookEvent } from "@/lib/webhooks/events";
import { createWebhookEndpoint, deleteWebhookEndpoint, rotateWebhookSecret, sendWebhookTest, updateWebhookEndpoint } from "@/lib/webhooks/actions";
import { CodeBlock } from "../ia/code-block";

export type EndpointRow = {
  id: string;
  url: string;
  description: string | null;
  events: string[];
  secretPrefix: string;
  includePersonalData: boolean;
  active: boolean;
  consecutiveFailures: number;
  disabledAt: string | null;
  disabledReason: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  createdAt: string;
};

const GROUPS: { label: string; events: WebhookEvent[] }[] = [
  { label: "Commandes", events: ["order.created", "order.updated", "order.status_changed", "order.paid", "order.refunded", "order.cancelled"] },
  { label: "Catalogue et stock", events: ["product.created", "product.updated", "product.deleted", "inventory.updated"] },
  { label: "Clients", events: ["customer.created", "customer.updated"] },
  { label: "Retours et cartes cadeaux", events: ["return.created", "return.status_changed", "giftcard.issued"] },
  { label: "Produits numériques", events: ["digital.delivered"] },
  { label: "Test", events: ["app.ping"] },
];

const DEFAULT_EVENTS: WebhookEvent[] = ["order.created", "order.status_changed", "order.paid"];

type Revealed = { title: string; secret: string; note?: string };

export function EndpointManager({
  storeId,
  endpoints,
  max,
  planName,
  canSendPersonalData,
}: {
  storeId: string;
  endpoints: EndpointRow[];
  max: number | null;
  planName: string;
  canSendPersonalData: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [events, setEvents] = useState<Set<WebhookEvent>>(new Set(DEFAULT_EVENTS));
  const [pii, setPii] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Revealed | null>(null);

  const limitReached = max != null && endpoints.length >= max;

  const toggle = (e: WebhookEvent) =>
    setEvents((prev) => {
      const next = new Set(prev);
      if (next.has(e)) next.delete(e);
      else next.add(e);
      return next;
    });

  const submit = () => {
    setError(null);
    start(async () => {
      const r = await createWebhookEndpoint(storeId, { url, description: description || undefined, events: WEBHOOK_EVENTS.filter((e) => events.has(e)), includePersonalData: pii });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setOpen(false);
      setUrl("");
      setDescription("");
      setEvents(new Set(DEFAULT_EVENTS));
      setPii(false);
      setRevealed({ title: "Point de webhook créé", secret: r.data!.secret });
      router.refresh();
    });
  };

  const act = async (fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) => {
    const r = await fn();
    if (r.ok) toast.success(r.message ?? "Fait");
    else toast.error(r.error ?? "Échec");
    router.refresh();
  };

  const rotate = async (id: string) => {
    const r = await rotateWebhookSecret(storeId, id);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    setRevealed({ title: "Nouveau secret de signature", secret: r.data!.secret, note: `L'ancien secret continue de signer chaque envoi (second v1) jusqu'au ${formatDateTime(r.data!.previousValidUntil)}. Mettez à jour votre serveur avant cette date.` });
    router.refresh();
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-muted">
          <span className="font-medium text-ink tabular">{endpoints.length}</span>
          {max != null ? ` / ${max}` : ""} point{endpoints.length > 1 ? "s" : ""} de webhook · plan {planName}
        </p>
        <Button onClick={() => setOpen(true)} disabled={limitReached} title={limitReached ? "Limite de points atteinte pour votre plan" : undefined}>
          <Plus className="size-4" aria-hidden /> Ajouter un point
        </Button>
      </div>
      {limitReached && (
        <Alert tone="info" className="mb-4" title="Limite atteinte">
          Supprimez un point inutilisé ou passez à un plan supérieur pour en ajouter.
        </Alert>
      )}

      {endpoints.length === 0 ? (
        <EmptyState
          icon={WebhookIcon}
          title="Aucun point de webhook"
          description="Un webhook prévient votre logiciel (comptabilité, logistique, ERP, Zapier, Make…) dès qu'une commande arrive ou qu'un produit change, avec une signature à vérifier."
          action={<Button onClick={() => setOpen(true)} disabled={limitReached}><Plus className="size-4" aria-hidden /> Ajouter un point</Button>}
        />
      ) : (
        <ul className="space-y-3">
          {endpoints.map((e) => (
            <li key={e.id} className="rounded-[var(--radius-lg)] bg-surface p-4 ring-1 ring-line">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="break-all font-mono text-sm text-ink">{e.url}</p>
                  {e.description && <p className="mt-0.5 text-sm text-ink-muted">{e.description}</p>}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {e.active ? <Badge tone="success" dot>Actif</Badge> : e.disabledAt ? <Badge tone="danger" dot>Désactivé automatiquement</Badge> : <Badge tone="neutral" dot>En pause</Badge>}
                    <Badge tone="neutral">{e.events.length} événement{e.events.length > 1 ? "s" : ""}</Badge>
                    {e.includePersonalData ? <Badge tone="warning">Données personnelles</Badge> : <Badge tone="info">Sans données personnelles</Badge>}
                    {e.consecutiveFailures > 0 && <Badge tone="sun">{e.consecutiveFailures} échec{e.consecutiveFailures > 1 ? "s" : ""} d&apos;affilée</Badge>}
                  </div>
                  <p className="mt-2 text-xs text-ink-muted">
                    Secret <span className="font-mono">{e.secretPrefix}…</span> · dernier succès {e.lastSuccessAt ? relativeTime(e.lastSuccessAt) : "jamais"}
                    {e.lastFailureAt ? ` · dernier échec ${relativeTime(e.lastFailureAt)}` : ""}
                  </p>
                  {e.disabledReason && <p className="mt-1 text-xs text-danger">{e.disabledReason}</p>}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1 border-t border-line pt-3">
                <Button variant="ghost" size="sm" className="min-h-11" disabled={!e.active} onClick={() => act(() => sendWebhookTest(storeId, e.id))}>
                  <Send className="size-4" aria-hidden /> Envoyer un test
                </Button>
                <Button variant="ghost" size="sm" className="min-h-11" onClick={() => act(() => updateWebhookEndpoint(storeId, e.id, { active: !e.active }))}>
                  {e.active ? <><Pause className="size-4" aria-hidden /> Mettre en pause</> : <><Play className="size-4" aria-hidden /> Réactiver</>}
                </Button>
                <ConfirmButton
                  title="Générer un nouveau secret ?"
                  description="Le nouveau secret s'affiche une seule fois. Pendant 24 h, chaque envoi porte deux signatures (nouveau et ancien secret) pour vous laisser le temps de mettre à jour votre serveur."
                  confirmLabel="Générer"
                  tone="primary"
                  onConfirm={() => rotate(e.id)}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-ink hover:bg-surface-2"
                >
                  <RotateCw className="size-4" aria-hidden /> Nouveau secret
                </ConfirmButton>
                <ConfirmButton
                  title="Supprimer ce point de webhook ?"
                  description="Plus aucun événement ne lui sera envoyé et son historique de livraisons est supprimé. Cette action est définitive."
                  confirmLabel="Supprimer"
                  onConfirm={() => act(() => deleteWebhookEndpoint(storeId, e.id))}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-danger hover:bg-danger-soft"
                >
                  <Trash2 className="size-4" aria-hidden /> Supprimer
                </ConfirmButton>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Nouveau point de webhook"
        description="Axi enverra une requête POST signée à cette adresse à chaque événement choisi."
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>Annuler</Button>
            <Button onClick={submit} loading={pending} disabled={url.trim().length < 8 || events.size === 0}>
              <KeyRound className="size-4" aria-hidden /> Créer le point
            </Button>
          </>
        }
      >
        <form
          className="space-y-5"
          onSubmit={(ev) => {
            ev.preventDefault();
            submit();
          }}
        >
          {error && <Alert tone="danger">{error}</Alert>}
          <Field id="wh-url" label="URL de réception" hint="https uniquement, port 443 ou 8443, adresse publique (les adresses internes sont refusées)." required>
            {(p) => <Input {...p} type="url" inputMode="url" placeholder="https://exemple.com/webhooks/axi" value={url} onChange={(ev) => setUrl(ev.target.value)} maxLength={2000} autoComplete="off" spellCheck={false} />}
          </Field>
          <Field id="wh-desc" label="Description" hint="Facultatif, pour vous y retrouver (par exemple « Comptabilité »).">
            {(p) => <Input {...p} value={description} onChange={(ev) => setDescription(ev.target.value)} maxLength={200} />}
          </Field>
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-ink">Événements</legend>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {GROUPS.map((g) => (
                <div key={g.label}>
                  <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-ink-muted">{g.label}</p>
                  <div className="space-y-1">
                    {g.events.map((ev) => (
                      <Checkbox key={ev} checked={events.has(ev)} onChange={() => toggle(ev)} label={<span>{WEBHOOK_EVENT_LABELS[ev]} <span className="font-mono text-xs text-ink-muted">{ev}</span></span>} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </fieldset>
          <div className={cn("rounded-[var(--radius-md)] p-3 ring-1 ring-line", !canSendPersonalData && "opacity-60")}>
            <Checkbox
              checked={pii}
              disabled={!canSendPersonalData}
              onChange={(ev) => setPii(ev.target.checked)}
              label="Inclure les données personnelles des clients"
              description="Noms, téléphones, e-mails et adresses. Par défaut, seuls les identifiants sont envoyés. N'activez cette option que si le destinataire est de confiance et protège ces données (loi béninoise sur les données personnelles, RGPD)."
            />
          </div>
          <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
        </form>
      </Dialog>

      <Dialog open={!!revealed} onClose={() => setRevealed(null)} title={revealed?.title ?? "Secret"} size="lg" footer={<Button onClick={() => setRevealed(null)}>J&apos;ai copié le secret</Button>}>
        {revealed && (
          <div className="space-y-4">
            <Alert tone="warning" title="Copiez-le maintenant">
              Ce secret ne sera plus jamais affiché. Votre serveur l&apos;utilise pour vérifier l&apos;en-tête Axi-Signature de chaque requête.
            </Alert>
            <CodeBlock code={revealed.secret} label="Secret de signature" />
            {revealed.note && <p className="text-sm text-ink-muted">{revealed.note}</p>}
            <p className="flex items-start gap-2 text-xs text-ink-muted">
              <ShieldAlert className="mt-px size-4 shrink-0" aria-hidden /> En cas de fuite, générez un nouveau secret depuis cette page.
            </p>
          </div>
        )}
      </Dialog>
    </div>
  );
}
