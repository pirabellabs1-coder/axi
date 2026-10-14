"use client";

import Link from "next/link";
import { Tabs } from "@/components/ui/tabs";
import { Alert } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { CodeBlock } from "./code-block";

/**
 * Instructions pas à pas par client MCP. `token` : secret tout juste créé (sinon un emplacement à remplacer).
 * Les clients « en un clic » (Claude.ai, ChatGPT) passent par OAuth et n'ont jamais besoin du jeton.
 */
export function ConnectGuide({ mcpUrl, oauth, upgradeHref, token }: { mcpUrl: string; oauth: boolean; upgradeHref: string; token?: string }) {
  const secret = token ?? "VOTRE_JETON";
  const claudeCode = `claude mcp add --transport http axi ${mcpUrl} --header "Authorization: Bearer ${secret}"`;
  const desktop = JSON.stringify(
    { mcpServers: { axi: { command: "npx", args: ["-y", "mcp-remote", mcpUrl, "--header", "Authorization:${AXI_AUTH}"], env: { AXI_AUTH: `Bearer ${secret}` } } } },
    null,
    2,
  );
  const cursor = JSON.stringify({ mcpServers: { axi: { url: mcpUrl, headers: { Authorization: `Bearer ${secret}` } } } }, null, 2);
  const vscode = JSON.stringify({ servers: { axi: { type: "http", url: mcpUrl, headers: { Authorization: `Bearer ${secret}` } } } }, null, 2);
  const curl = `curl -s ${mcpUrl} \\
  -H "Authorization: Bearer ${secret}" \\
  -H "Content-Type: application/json" \\
  -H "Accept: application/json, text/event-stream" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_store_overview","arguments":{}}}'`;

  const needsOauth = !oauth && (
    <Alert tone="info" className="mb-4" title="Connexion en un clic : plan Business">
      Votre plan actuel n&apos;inclut pas la connexion OAuth. Utilisez un jeton API avec Claude Desktop, Claude Code ou Cursor, ou{" "}
      <Link href={upgradeHref} className="font-medium underline underline-offset-4">
        passez au plan Business
      </Link>
      .
    </Alert>
  );

  const steps = (items: React.ReactNode[]) => (
    <ol className="space-y-3 text-sm leading-relaxed text-ink">
      {items.map((s, i) => (
        <li key={i} className="flex gap-3">
          <span className="mt-px inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary-deep tabular" aria-hidden>
            {i + 1}
          </span>
          <span className="min-w-0 flex-1">{s}</span>
        </li>
      ))}
    </ol>
  );

  const urlBlock = <CodeBlock code={mcpUrl} label="URL du serveur MCP" />;

  return (
    <Tabs
      label="Choisir votre assistant"
      items={[
        {
          id: "claude",
          label: "Claude.ai",
          content: (
            <div className="space-y-4">
              {needsOauth}
              {steps([
                <>Sur <span className="font-medium">claude.ai</span> (ou l&apos;application Claude), ouvrez <span className="font-medium">Paramètres › Connecteurs</span>.</>,
                <>Cliquez sur <span className="font-medium">Ajouter un connecteur personnalisé</span>, nommez-le « Axi » et collez l&apos;URL ci-dessous.</>,
                <>Cliquez sur <span className="font-medium">Se connecter</span> : Axi s&apos;ouvre, choisissez votre boutique et autorisez l&apos;accès.</>,
                <>Dans une conversation, activez Axi depuis le menu des outils, puis demandez par exemple « Résume mes ventes de la semaine ».</>,
              ])}
              {urlBlock}
              <p className="text-xs text-ink-muted">Sur les offres Claude Team et Enterprise, un administrateur de votre organisation ajoute d&apos;abord le connecteur.</p>
            </div>
          ),
        },
        {
          id: "claude-code",
          label: "Claude Desktop et Code",
          content: (
            <div className="space-y-5">
              <div>
                <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink">
                  Claude Code <Badge tone="neutral">Terminal</Badge>
                </h4>
                <CodeBlock code={claudeCode} />
                <p className="mt-2 text-xs text-ink-muted">Vérifiez avec <code className="font-mono">claude mcp list</code>, puis tapez <code className="font-mono">/mcp</code> dans Claude Code.</p>
              </div>
              <div>
                <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink">
                  Claude Desktop <Badge tone="neutral">Windows, macOS</Badge>
                </h4>
                <p className="mb-2 text-sm text-ink-muted">
                  {oauth ? "Le plus simple : Paramètres › Connecteurs, comme sur Claude.ai. " : ""}Avec un jeton : Paramètres › Développeur › Modifier la configuration, puis ajoutez dans <code className="font-mono text-[13px]">claude_desktop_config.json</code> (Node.js requis) :
                </p>
                <CodeBlock code={desktop} />
                <p className="mt-2 text-xs text-ink-muted">Redémarrez Claude Desktop : Axi apparaît dans la liste des outils.</p>
              </div>
            </div>
          ),
        },
        {
          id: "chatgpt",
          label: "ChatGPT",
          content: (
            <div className="space-y-4">
              {needsOauth}
              {steps([
                <>Dans ChatGPT, ouvrez <span className="font-medium">Paramètres › Applications et connecteurs › Paramètres avancés</span> et activez le <span className="font-medium">mode développeur</span>.</>,
                <>Revenez à <span className="font-medium">Applications et connecteurs</span> et cliquez sur <span className="font-medium">Créer</span>.</>,
                <>Nommez le connecteur « Axi », collez l&apos;URL ci-dessous, choisissez l&apos;authentification <span className="font-medium">OAuth</span> et validez.</>,
                <>Autorisez l&apos;accès sur la page Axi, puis activez le connecteur dans une conversation.</>,
              ])}
              {urlBlock}
              <p className="text-xs text-ink-muted">Le mode développeur dépend de votre offre ChatGPT (Plus, Pro, Business, Enterprise). Les intitulés peuvent varier selon les versions.</p>
            </div>
          ),
        },
        {
          id: "cursor",
          label: "Cursor",
          content: (
            <div className="space-y-3">
              <p className="text-sm text-ink-muted">
                Ajoutez dans <code className="font-mono text-[13px]">~/.cursor/mcp.json</code> (ou <code className="font-mono text-[13px]">.cursor/mcp.json</code> dans un projet), puis activez « axi » dans Paramètres › MCP :
              </p>
              <CodeBlock code={cursor} />
            </div>
          ),
        },
        {
          id: "autres",
          label: "Autres clients",
          content: (
            <div className="space-y-5">
              <p className="text-sm text-ink-muted">
                Tout client compatible MCP (transport « Streamable HTTP ») fonctionne : VS Code, Windsurf, n8n, Make, vos propres agents. Authentification par en-tête <code className="font-mono text-[13px]">Authorization: Bearer</code> ou OAuth 2.1 (découverte automatique).
              </p>
              <CodeBlock code={vscode} label="VS Code : .vscode/mcp.json" />
              <CodeBlock code={curl} label="Test en ligne de commande (curl)" />
              <p className="text-xs text-ink-muted">
                Référence complète des outils et des autorisations :{" "}
                <Link href="/developpeurs" className="font-medium text-primary underline-offset-4 hover:underline">
                  page Développeurs
                </Link>
                .
              </p>
            </div>
          ),
        },
      ]}
    />
  );
}
