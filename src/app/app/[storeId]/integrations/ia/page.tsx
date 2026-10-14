import type { Metadata } from "next";
import Link from "next/link";
import { Activity, AppWindow, Bot, Gauge, Globe2, KeyRound, MessageSquareText, PlugZap, ShieldCheck, Sparkles, Unplug } from "lucide-react";
import { getStoreContext } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { MCP_LIMITS, PLANS } from "@/config/plans";
import { planScopes, SCOPE_LABELS, parseScopes } from "@/lib/mcp/scopes";
import { appBaseUrl, dayPeriod, getMcpKillSwitch, mcpResourceUrl, PUBLIC_METRIC_PREFIX } from "@/lib/mcp/runtime";
import { revokeOAuthGrant, setAiAgentsEnabled } from "@/lib/mcp/actions";
import { formatDateTime, relativeTime } from "@/lib/utils";
import { PageHeader, Kpi, EmptyState, Alert } from "@/components/ui/misc";
import { Card, CardBody, CardHeader, Bezel } from "@/components/ui/card";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { AsyncSwitch, ConfirmActionButton, CopyButton } from "@/components/app/action-controls";
import { PlanGate } from "@/components/app/plan-gate";
import { ConnectGuide } from "./connect-guide";
import { TokenManager, type TokenRow } from "./token-manager";
import { CodeBlock } from "./code-block";

export const metadata: Metadata = { title: "Connecteurs IA" };

const LOG_TONE: Record<string, BadgeTone> = { ok: "success", error: "danger", denied: "warning", rate_limited: "sun" };
const LOG_LABEL: Record<string, string> = { ok: "Réussi", error: "Erreur", denied: "Refusé", rate_limited: "Quota atteint" };

const PROMPTS = [
  { title: "Ruptures de stock", text: "Quels produits sont en rupture ou presque ? Classe-les selon leurs ventes du mois." },
  { title: "Code promo du week-end", text: "Crée un code promo -10 % valable ce week-end, une utilisation par client, et rédige le message WhatsApp pour l'annoncer." },
  { title: "Bilan de la semaine", text: "Résume les ventes de la semaine : chiffre d'affaires, panier moyen, meilleurs produits, comparaison avec la semaine dernière." },
  { title: "Commandes à traiter", text: "Liste les commandes nouvelles et confirmées, et dis-moi lesquelles traiter en priorité." },
  { title: "Fiche produit", text: "Améliore la description du produit le plus vendu pour qu'elle donne envie, sans changer le prix, puis montre-moi le résultat avant de l'enregistrer." },
  { title: "Meilleurs clients", text: "Qui sont mes 10 meilleurs clients ce trimestre et quand ont-ils commandé pour la dernière fois ?" },
];

/** Instant de la requête (hors rendu pur, comme les autres pages de l'espace marchand). */
function currentTime() {
  return new Date();
}

export default async function AiConnectorsPage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const ctx = await getStoreContext(storeId, "store.settings");
  const store = ctx.store;
  const limits = MCP_LIMITS[ctx.planId];
  const plan = PLANS[ctx.planId];
  const canManage = ctx.can("integrations.manage");
  const now = currentTime();
  const since24h = new Date(now.getTime() - 86_400_000);

  const [tokens, grants, logs, calls24h, kill, aiStore, publicCounters] = await Promise.all([
    db.apiToken.findMany({ where: { storeId: store.id, revokedAt: null }, orderBy: { createdAt: "desc" }, include: { createdBy: { select: { name: true } } } }),
    db.oAuthGrant.findMany({ where: { storeId: store.id, revokedAt: null }, orderBy: { createdAt: "desc" }, include: { client: { select: { name: true, clientUri: true } }, user: { select: { id: true, name: true } } } }),
    // Journal du marchand : ses jetons et applications uniquement (la vitrine publique est agrégée à part).
    db.apiRequestLog.findMany({ where: { storeId: store.id, NOT: { actorLabel: "public:assistant" } }, orderBy: { createdAt: "desc" }, take: 50 }),
    db.apiRequestLog.count({ where: { storeId: store.id, createdAt: { gte: since24h }, method: "tools/call", NOT: { actorLabel: "public:assistant" } } }),
    getMcpKillSwitch(),
    db.store.findUnique({ where: { id: store.id }, select: { aiAgentsEnabled: true } }),
    db.usageCounter.findMany({ where: { storeId: store.id, metric: { startsWith: PUBLIC_METRIC_PREFIX }, period: { gte: dayPeriod(new Date(now.getTime() - 29 * 86_400_000)) } }, select: { metric: true, value: true } }),
  ]);
  const publicByTool = new Map<string, number>();
  for (const c of publicCounters) publicByTool.set(c.metric.slice(PUBLIC_METRIC_PREFIX.length), (publicByTool.get(c.metric.slice(PUBLIC_METRIC_PREFIX.length)) ?? 0) + c.value);
  const publicTotal = [...publicByTool.values()].reduce((a, b) => a + b, 0);

  const tokenNames = new Map(tokens.map((t) => [t.id, t.name]));
  const rows: TokenRow[] = tokens.map((t) => ({
    id: t.id,
    name: t.name,
    prefix: t.prefix,
    scopes: t.scopes,
    createdAt: t.createdAt.toISOString(),
    lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
    lastUsedIp: t.lastUsedIp,
    expiresAt: t.expiresAt?.toISOString() ?? null,
    createdBy: t.createdBy?.name ?? null,
    expired: !!t.expiresAt && t.expiresAt <= now,
  }));
  const activeTokens = rows.filter((r) => !r.expired).length;
  const mcpUrl = mcpResourceUrl();
  const base = appBaseUrl();
  const publicMcp = `${base}/api/mcp/store/${store.slug}`;
  const llms = `${base}/s/${store.slug}/llms.txt`;
  const upgradeHref = `/app/${store.id}/abonnement#plans`;
  const published = store.status === "PUBLISHED" || store.status === "CLOSED_TEMPORARILY";

  return (
    <>
      <PageHeader
        title="Connecteurs IA"
        description="Pilotez votre boutique depuis Claude, ChatGPT, Cursor ou tout assistant compatible MCP : demandez vos ventes, mettez à jour vos prix, traitez vos commandes, en langage naturel."
      />

      {kill.enabled && (
        <Alert tone="warning" className="mb-6" title="Connecteurs IA temporairement suspendus">
          {kill.message || "L'équipe Axi a suspendu l'accès des assistants IA à la plateforme. Vos jetons et connexions sont conservés et refonctionneront dès la levée de la suspension."}
        </Alert>
      )}

      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Jetons actifs" value={limits.maxTokens == null ? activeTokens : `${activeTokens} / ${limits.maxTokens}`} hint={`Plan ${plan.name}`} icon={KeyRound} />
        <Kpi label="Applications connectées" value={grants.length} hint={limits.oauth ? "Connexion en un clic incluse" : "À partir du plan Business"} icon={AppWindow} />
        <Kpi label="Appels sur 24 h" value={calls24h.toLocaleString("fr-FR")} hint={limits.callsPerDay == null ? "Sans plafond journalier" : `Quota : ${limits.callsPerDay.toLocaleString("fr-FR")} / jour`} icon={Activity} />
        <Kpi label="Débit maximal" value={`${limits.callsPerMinute} / min`} hint={limits.scopes === "read" ? "Lecture seule" : limits.scopes === "standard" ? "Lecture et écriture" : "Toutes les autorisations"} icon={Gauge} />
      </div>

      <section aria-labelledby="connect-title" className="mb-10">
        <Card>
          <CardHeader
            title={
              <span id="connect-title" className="inline-flex items-center gap-2">
                <PlugZap className="size-4 text-primary" aria-hidden /> Connecter votre assistant IA
              </span>
            }
            description="Choisissez votre outil et suivez les étapes. La connexion prend moins de deux minutes."
          />
          <CardBody>
            <ConnectGuide mcpUrl={mcpUrl} oauth={limits.oauth} upgradeHref={upgradeHref} />
          </CardBody>
        </Card>
      </section>

      <section aria-labelledby="tokens-title" className="mb-10">
        <div className="mb-3">
          <h2 id="tokens-title" className="text-lg font-semibold tracking-[-0.02em] text-ink">Jetons API</h2>
          <p className="mt-0.5 text-sm text-ink-muted">
            Pour Claude Desktop, Claude Code, Cursor et vos automatisations. {canManage ? "Chaque jeton a ses propres autorisations et peut être révoqué à tout moment." : "Seul le propriétaire de la boutique peut créer ou révoquer des jetons."}
          </p>
        </div>
        <TokenManager storeId={store.id} tokens={rows} canManage={canManage} allowedScopes={planScopes(ctx.planId)} maxTokens={limits.maxTokens} planName={plan.name} mcpUrl={mcpUrl} />
      </section>

      <section aria-labelledby="apps-title" className="mb-10">
        <div className="mb-3">
          <h2 id="apps-title" className="text-lg font-semibold tracking-[-0.02em] text-ink">Applications connectées</h2>
          <p className="mt-0.5 text-sm text-ink-muted">Assistants autorisés en un clic (OAuth) depuis Claude.ai, ChatGPT ou d&apos;autres clients.</p>
        </div>
        {!limits.oauth && grants.length === 0 ? (
          <PlanGate
            storeId={store.id}
            plan="BUSINESS"
            compact
            title="Connexion en un clic (OAuth)"
            description="Connectez Claude.ai ou ChatGPT sans copier de jeton : vous autorisez l'accès depuis une page Axi, et vous le retirez quand vous voulez."
          />
        ) : grants.length === 0 ? (
          <EmptyState icon={AppWindow} title="Aucune application connectée" description="Ajoutez Axi comme connecteur dans Claude.ai ou ChatGPT : l'application apparaîtra ici après votre autorisation." />
        ) : (
          <Table minWidth={720}>
            <THead>
              <tr>
                <TH>Application</TH>
                <TH>Autorisée par</TH>
                <TH>Autorisations</TH>
                <TH>Dernière utilisation</TH>
                <TH align="right"><span className="sr-only">Actions</span></TH>
              </tr>
            </THead>
            <TBody>
              {grants.map((g) => {
                const scopes = parseScopes(g.scopes);
                return (
                  <TR key={g.id}>
                    <TD>
                      <span className="font-medium text-ink">{g.client.name}</span>
                      <span className="block text-xs text-ink-muted">Depuis le {formatDateTime(g.createdAt)}</span>
                    </TD>
                    <TD>{g.user.name}</TD>
                    <TD>
                      <span className="text-sm text-ink-muted" title={scopes.map((s) => SCOPE_LABELS[s].label).join(", ")}>
                        {scopes.length} autorisation{scopes.length > 1 ? "s" : ""}
                        {scopes.some((s) => SCOPE_LABELS[s].write) ? ", dont écriture" : ", lecture seule"}
                      </span>
                    </TD>
                    <TD className="whitespace-nowrap text-ink-muted">{g.lastUsedAt ? relativeTime(g.lastUsedAt) : "Jamais"}</TD>
                    <TD align="right">
                      {(canManage || g.user.id === ctx.user.id) && (
                        <ConfirmActionButton
                          action={revokeOAuthGrant.bind(null, store.id, g.id)}
                          title={`Déconnecter ${g.client.name} ?`}
                          description="L'application perd immédiatement l'accès à votre boutique. Vous pourrez la reconnecter plus tard."
                          confirmLabel="Déconnecter"
                          className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-danger hover:bg-danger-soft"
                        >
                          <Unplug className="size-4" aria-hidden /> Déconnecter
                        </ConfirmActionButton>
                      )}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </section>

      <div className="mb-10 grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section aria-labelledby="public-title">
          <Card>
            <CardHeader
              title={
                <span id="public-title" className="inline-flex items-center gap-2">
                  <Globe2 className="size-4 text-primary" aria-hidden /> Votre boutique dans les assistants IA
                </span>
              }
              description="Les acheteurs demandent de plus en plus à ChatGPT ou Claude où acheter. Exposez votre catalogue public pour qu'un assistant trouve vos produits, vérifie le stock et prépare un panier : l'acheteur valide lui-même sa commande."
            />
            <CardBody className="space-y-4">
              <AsyncSwitch checked={aiStore?.aiAgentsEnabled ?? true} label="Ouvrir ma boutique aux assistants IA" action={setAiAgentsEnabled.bind(null, store.id)} />
              {!published && <Alert tone="info">Votre boutique n&apos;est pas encore publiée : elle sera visible des assistants après publication.</Alert>}
              <CodeBlock code={publicMcp} label="Serveur MCP public (sans authentification)" />
              <div>
                <p className="mb-1.5 text-xs font-medium text-ink-muted">Description pour les IA (llms.txt)</p>
                <div className="flex flex-wrap items-center gap-2">
                  <a href={llms} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 min-w-0 items-center break-all font-mono text-[13px] text-primary underline-offset-4 hover:underline">
                    {llms}
                  </a>
                  <CopyButton value={llms} />
                </div>
              </div>
              <p className="text-sm text-ink-muted">
                <span className="font-medium text-ink tabular">{publicTotal.toLocaleString("fr-FR")}</span> consultation{publicTotal > 1 ? "s" : ""} par des assistants sur 30 jours
                {publicTotal > 0 && (
                  <>
                    {" "}(
                    {[...publicByTool.entries()]
                      .sort((a, b) => b[1] - a[1])
                      .slice(0, 4)
                      .map(([tool, n]) => `${tool} : ${n.toLocaleString("fr-FR")}`)
                      .join(", ")}
                    ).
                  </>
                )}
              </p>
              <p className="text-xs leading-relaxed text-ink-muted">
                Seules les informations déjà publiques sont partagées : produits en vente, prix, disponibilité, livraison, horaires et pages. Jamais vos clients, vos commandes ni votre stock exact. Aucune commande n&apos;est créée sans l&apos;acheteur.
              </p>
            </CardBody>
          </Card>
        </section>

        <Bezel as="section" coreClassName="p-5">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-ink">
            <ShieldCheck className="size-4 text-primary" aria-hidden /> Sécurité
          </h2>
          <ul className="mt-3 space-y-2.5 text-sm text-ink-muted">
            <li>Les secrets sont chiffrés par hachage : Axi ne peut pas les relire.</li>
            <li>Chaque action d&apos;un assistant est enregistrée dans le journal à son nom.</li>
            <li>Un assistant ne voit que votre boutique, avec les autorisations choisies.</li>
            <li>Annulation de commande ou archivage : demandez à l&apos;assistant de vous confirmer avant d&apos;agir.</li>
          </ul>
          <Link href="/developpeurs" className="mt-4 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline">
            <Bot className="size-4" aria-hidden /> Référence des outils et autorisations
          </Link>
        </Bezel>
      </div>

      <section aria-labelledby="prompts-title" className="mb-10">
        <h2 id="prompts-title" className="mb-1 flex items-center gap-2 text-lg font-semibold tracking-[-0.02em] text-ink">
          <Sparkles className="size-4 text-primary" aria-hidden /> Exemples de demandes
        </h2>
        <p className="mb-4 text-sm text-ink-muted">Copiez une phrase et collez-la dans votre assistant une fois connecté.</p>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {PROMPTS.map((p) => (
            <li key={p.title} className="flex flex-col justify-between gap-3 rounded-[var(--radius-lg)] bg-surface p-4 ring-1 ring-line">
              <div>
                <p className="flex items-center gap-2 text-sm font-semibold text-ink">
                  <MessageSquareText className="size-4 text-ink-faint" aria-hidden /> {p.title}
                </p>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">« {p.text} »</p>
              </div>
              <CopyButton value={p.text} className="self-start" />
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="log-title">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
          <h2 id="log-title" className="text-lg font-semibold tracking-[-0.02em] text-ink">Journal des appels</h2>
          {logs.length > 0 && <p className="text-sm text-ink-muted">50 derniers appels, conservés 30 jours</p>}
        </div>
        {logs.length === 0 ? (
          <EmptyState icon={Activity} title="Aucun appel pour l'instant" description="Les actions des assistants IA connectés à votre boutique apparaîtront ici : outil utilisé, application, résultat et durée." />
        ) : (
          <Table minWidth={720}>
            <THead>
              <tr>
                <TH>Date</TH>
                <TH>Outil</TH>
                <TH>Origine</TH>
                <TH>Statut</TH>
                <TH align="right">Durée</TH>
              </tr>
            </THead>
            <TBody>
              {logs.map((l) => (
                <TR key={l.id}>
                  <TD className="whitespace-nowrap tabular text-ink-muted">{formatDateTime(l.createdAt)}</TD>
                  <TD className="font-mono text-xs">{l.tool ?? l.method}</TD>
                  <TD className="max-w-[240px] truncate">
                    {l.tokenId ? `Jeton « ${tokenNames.get(l.tokenId) ?? l.actorLabel.replace(/^api:/, "")} »` : l.actorLabel.replace(/^oauth:/, "")}
                  </TD>
                  <TD>
                    <Badge tone={LOG_TONE[l.status] ?? "neutral"} dot>{LOG_LABEL[l.status] ?? l.status}</Badge>
                  </TD>
                  <TD align="right" className="tabular text-ink-muted">{l.durationMs} ms</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </section>
    </>
  );
}
