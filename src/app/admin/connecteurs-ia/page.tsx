import type { Metadata } from "next";
import Link from "next/link";
import { AppWindow, KeyRound, Search, Power, Activity } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { getAdminContext } from "@/lib/admin/context";
import { db } from "@/lib/db";
import { getMcpKillSwitch } from "@/lib/mcp/runtime";
import { adminRevokeApiToken, adminRevokeGrant, adminSetClientDisabled } from "@/lib/mcp/admin-actions";
import { formatDateTime, relativeTime } from "@/lib/utils";
import { PageHeader, EmptyState, Alert, Kpi } from "@/components/ui/misc";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { ConfirmActionButton } from "@/components/app/action-controls";
import { Pagination, PAGE_SIZE, pageParam, str } from "@/components/app/admin-bits";
import { McpKillSwitchForm } from "@/components/admin/mcp-controls";
import { KillSwitchForm } from "@/components/admin/kill-switch-form";
import { getGiftCardsKillSwitch } from "@/lib/giftcards/kill-switch";
import { setGiftCardsKillSwitch } from "@/lib/giftcards/admin-actions";
import { getBuyerKillSwitch } from "@/lib/buyer/settings";
import { setBuyerAccountsKillSwitch } from "@/lib/admin/lot1-kill-switches";

export const metadata: Metadata = { title: "Connecteurs IA", robots: { index: false } };

const danger = "inline-flex min-h-11 items-center rounded-full px-3 text-sm font-medium text-danger hover:bg-danger-soft disabled:opacity-50";

/** Il y a 24 h (fenêtre des indicateurs), hors rendu pur. */
function dayAgo() {
  return new Date(Date.now() - 86_400_000);
}

export default async function AdminMcp({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await getAdminContext();
  const canModerate = ctx.can("stores.moderate");
  const sp = await searchParams;
  const q = str(sp.q);
  const page = pageParam(sp.page);
  const since = dayAgo();
  const storeFilter: Prisma.StoreWhereInput | undefined = q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { slug: { contains: q, mode: "insensitive" } }] } : undefined;
  const tokenWhere: Prisma.ApiTokenWhereInput = { revokedAt: null, ...(storeFilter ? { store: storeFilter } : {}) };

  const [kill, tokenCount, tokens, grants, clients, calls24h, errors24h, giftKill, buyerKill] = await Promise.all([
    getMcpKillSwitch(true),
    db.apiToken.count({ where: tokenWhere }),
    db.apiToken.findMany({
      where: tokenWhere,
      orderBy: [{ lastUsedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { store: { select: { id: true, name: true, slug: true } }, createdBy: { select: { email: true } } },
    }),
    db.oAuthGrant.findMany({
      where: { revokedAt: null, ...(storeFilter ? { store: storeFilter } : {}) },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { store: { select: { id: true, name: true } }, client: { select: { name: true } }, user: { select: { email: true } } },
    }),
    db.oAuthClient.findMany({ orderBy: { createdAt: "desc" }, take: 50, include: { _count: { select: { grants: { where: { revokedAt: null } } } } } }),
    db.apiRequestLog.count({ where: { createdAt: { gte: since } } }),
    db.apiRequestLog.count({ where: { createdAt: { gte: since }, status: { in: ["error", "rate_limited", "denied"] } } }),
    getGiftCardsKillSwitch(),
    getBuyerKillSwitch(true),
  ]);
  const canSettings = ctx.can("settings.manage");

  return (
    <>
      <PageHeader title="Connecteurs IA" description="Jetons API, applications OAuth (Claude, ChatGPT…) et accès des assistants IA aux boutiques. Les secrets ne sont jamais affichés : seulement leur préfixe." />

      {(giftKill.enabled || buyerKill.enabled) && (
        <Alert tone="warning" className="mb-6" title="Arrêt d'urgence lot 1 actif">
          {[giftKill.enabled && "cartes cadeaux suspendues", buyerKill.enabled && "comptes acheteurs suspendus"].filter(Boolean).join(" ; ")}.
        </Alert>
      )}
      {kill.enabled && (
        <Alert tone="warning" className="mb-6" title="Arrêt d'urgence actif">
          Tous les appels MCP, la vitrine publique et l&apos;émission de jetons OAuth sont refusés (503).
        </Alert>
      )}

      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Jetons actifs" value={tokenCount} icon={KeyRound} />
        <Kpi label="Applications autorisées" value={grants.length} hint="50 plus récentes" icon={AppWindow} />
        <Kpi label="Appels sur 24 h" value={calls24h.toLocaleString("fr-FR")} icon={Activity} />
        <Kpi label="Refus et erreurs 24 h" value={errors24h.toLocaleString("fr-FR")} icon={Power} />
      </div>

      <Card as="section" aria-labelledby="kill" className="mb-8">
        <CardHeader title={<span id="kill">Arrêt d&apos;urgence</span>} description="Coupe immédiatement (moins de 10 s) l'accès des assistants IA à toutes les boutiques, sans supprimer aucun jeton ni autorisation." />
        <div className="px-5 pb-5 pt-3 sm:px-6">
          <McpKillSwitchForm enabled={kill.enabled} message={kill.message} canEdit={canSettings} />
        </div>
      </Card>

      <div className="mb-8 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card as="section" aria-labelledby="kill-giftcards">
          <CardHeader
            title={
              <span id="kill-giftcards" className="inline-flex flex-wrap items-center gap-2">
                Cartes cadeaux {giftKill.enabled && <Badge tone="danger">Suspendues</Badge>}
              </span>
            }
            description="Suspend l'utilisation des cartes au paiement et la vérification publique du solde, sur toutes les boutiques. Les cartes payées restent émises et les recrédits continuent."
          />
          <div className="px-5 pb-5 pt-3 sm:px-6">
            <KillSwitchForm enabled={giftKill.enabled} message={giftKill.message} canEdit={canSettings} action={setGiftCardsKillSwitch} onLabel="Cartes cadeaux suspendues" offLabel="Cartes cadeaux actives" messageLabel="Message affiché aux acheteurs" messageHint="Facultatif. Sans message, un texte générique invite à réessayer plus tard." />
          </div>
        </Card>
        <Card as="section" aria-labelledby="kill-buyers">
          <CardHeader
            title={
              <span id="kill-buyers" className="inline-flex flex-wrap items-center gap-2">
                Comptes acheteurs {buyerKill.enabled && <Badge tone="danger">Suspendus</Badge>}
              </span>
            }
            description="Refuse l'envoi et la vérification des codes de connexion et bloque les modifications du compte. Les acheteurs déjà connectés gardent la lecture de leurs commandes."
          />
          <div className="px-5 pb-5 pt-3 sm:px-6">
            <KillSwitchForm enabled={buyerKill.enabled} message={buyerKill.message} canEdit={canSettings} action={setBuyerAccountsKillSwitch} onLabel="Comptes acheteurs suspendus" offLabel="Comptes acheteurs actifs" messageLabel="Message affiché aux acheteurs" messageHint="Ex. : connexion momentanément indisponible, réessayez vers 14 h." />
          </div>
        </Card>
      </div>

      <section aria-labelledby="tokens" className="mb-8">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <h2 id="tokens" className="text-[15px] font-semibold tracking-tight text-ink">Jetons API actifs</h2>
          <form className="flex gap-2" role="search">
            <label htmlFor="mcp-q" className="sr-only">Filtrer par boutique</label>
            <Input id="mcp-q" name="q" defaultValue={q} placeholder="Boutique (nom ou adresse)" fieldSize="sm" className="w-56" />
            <Button type="submit" size="sm" variant="outline"><Search className="size-4" aria-hidden /> Filtrer</Button>
          </form>
        </div>
        {tokens.length === 0 ? (
          <EmptyState icon={KeyRound} title="Aucun jeton actif" compact className="rounded-[var(--radius-lg)] bg-surface ring-1 ring-line" />
        ) : (
          <>
            <Table minWidth={860}>
              <THead>
                <tr>
                  <TH>Boutique</TH>
                  <TH>Jeton</TH>
                  <TH>Créé par</TH>
                  <TH>Autorisations</TH>
                  <TH>Dernière utilisation</TH>
                  <TH align="right"><span className="sr-only">Actions</span></TH>
                </tr>
              </THead>
              <TBody>
                {tokens.map((t) => (
                  <TR key={t.id}>
                    <TD><Link href={`/admin/boutiques/${t.store.id}`} className="font-medium text-ink hover:text-primary">{t.store.name}</Link></TD>
                    <TD>
                      {t.name}
                      <span className="block font-mono text-xs text-ink-muted">{t.prefix}…</span>
                    </TD>
                    <TD className="text-ink-muted">{t.createdBy?.email ?? "Inconnu"}</TD>
                    <TD className="max-w-[240px] text-xs text-ink-muted">{t.scopes.join(", ")}</TD>
                    <TD className="whitespace-nowrap text-ink-muted">{t.lastUsedAt ? `${relativeTime(t.lastUsedAt)}${t.lastUsedIp ? ` · ${t.lastUsedIp}` : ""}` : "Jamais"}</TD>
                    <TD align="right">
                      {canModerate && (
                        <ConfirmActionButton action={adminRevokeApiToken.bind(null, t.id)} title={`Révoquer « ${t.name} » ?`} description={`Le jeton de ${t.store.name} cessera immédiatement de fonctionner. Action journalisée.`} confirmLabel="Révoquer" className={danger}>
                          Révoquer
                        </ConfirmActionButton>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <Pagination page={page} total={tokenCount} basePath="/admin/connecteurs-ia" params={{ q }} />
          </>
        )}
      </section>

      <section aria-labelledby="grants" className="mb-8">
        <h2 id="grants" className="mb-3 text-[15px] font-semibold tracking-tight text-ink">Autorisations OAuth actives</h2>
        {grants.length === 0 ? (
          <EmptyState icon={AppWindow} title="Aucune application autorisée" compact className="rounded-[var(--radius-lg)] bg-surface ring-1 ring-line" />
        ) : (
          <Table minWidth={760}>
            <THead>
              <tr>
                <TH>Boutique</TH>
                <TH>Application</TH>
                <TH>Autorisée par</TH>
                <TH>Depuis</TH>
                <TH>Dernière utilisation</TH>
                <TH align="right"><span className="sr-only">Actions</span></TH>
              </tr>
            </THead>
            <TBody>
              {grants.map((g) => (
                <TR key={g.id}>
                  <TD><Link href={`/admin/boutiques/${g.store.id}`} className="font-medium text-ink hover:text-primary">{g.store.name}</Link></TD>
                  <TD>{g.client.name}</TD>
                  <TD className="text-ink-muted">{g.user.email}</TD>
                  <TD className="whitespace-nowrap text-ink-muted">{formatDateTime(g.createdAt)}</TD>
                  <TD className="whitespace-nowrap text-ink-muted">{g.lastUsedAt ? relativeTime(g.lastUsedAt) : "Jamais"}</TD>
                  <TD align="right">
                    {canModerate && (
                      <ConfirmActionButton action={adminRevokeGrant.bind(null, g.id)} title={`Révoquer ${g.client.name} ?`} description={`L'application perd l'accès à ${g.store.name}.`} confirmLabel="Révoquer" className={danger}>
                        Révoquer
                      </ConfirmActionButton>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </section>

      <section aria-labelledby="clients">
        <h2 id="clients" className="mb-3 text-[15px] font-semibold tracking-tight text-ink">Applications enregistrées (clients OAuth)</h2>
        {clients.length === 0 ? (
          <EmptyState icon={AppWindow} title="Aucune application enregistrée" description="Les clients MCP (Claude, ChatGPT, Cursor…) s'enregistrent automatiquement lors de leur première connexion." compact className="rounded-[var(--radius-lg)] bg-surface ring-1 ring-line" />
        ) : (
          <Table minWidth={760}>
            <THead>
              <tr>
                <TH>Application</TH>
                <TH>Adresses de retour</TH>
                <TH>Accès actifs</TH>
                <TH>Enregistrée</TH>
                <TH align="right"><span className="sr-only">Actions</span></TH>
              </tr>
            </THead>
            <TBody>
              {clients.map((c) => (
                <TR key={c.id}>
                  <TD>
                    <span className="font-medium text-ink">{c.name}</span>
                    {c.disabledAt && <Badge tone="danger" className="ml-2">Désactivée</Badge>}
                    <span className="block font-mono text-[11px] text-ink-faint">{c.clientId}</span>
                  </TD>
                  <TD className="max-w-[280px] text-xs text-ink-muted [overflow-wrap:anywhere]">{c.redirectUris.join(", ")}</TD>
                  <TD className="tabular">{c._count.grants}</TD>
                  <TD className="whitespace-nowrap text-ink-muted">{formatDateTime(c.createdAt)}</TD>
                  <TD align="right">
                    {canModerate && (
                      <ConfirmActionButton
                        action={adminSetClientDisabled.bind(null, c.id, !c.disabledAt)}
                        title={c.disabledAt ? `Réactiver ${c.name} ?` : `Désactiver ${c.name} ?`}
                        description={c.disabledAt ? "L'application pourra de nouveau demander l'accès aux boutiques." : "Tous les accès de cette application cessent immédiatement, sur toutes les boutiques."}
                        confirmLabel={c.disabledAt ? "Réactiver" : "Désactiver"}
                        tone={c.disabledAt ? "primary" : "danger"}
                        className={c.disabledAt ? "inline-flex min-h-11 items-center rounded-full px-3 text-sm font-medium text-ink hover:bg-surface-2" : danger}
                      >
                        {c.disabledAt ? "Réactiver" : "Désactiver"}
                      </ConfirmActionButton>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </section>
    </>
  );
}
