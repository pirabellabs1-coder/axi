import "server-only";

export type Mail = { to: string; subject: string; text: string; html?: string };

/**
 * Envoi d'e-mails transactionnels.
 * EMAIL_PROVIDER=console (défaut, dev uniquement) | resend.
 * En production, le mode console est refusé (M4) : les codes de vérification ne doivent jamais
 * finir dans les journaux du serveur. Un fournisseur inconnu est aussi une erreur explicite.
 */
export async function sendMail(mail: Mail): Promise<{ ok: boolean; error?: string }> {
  const provider = process.env.EMAIL_PROVIDER ?? "console";
  const from = process.env.EMAIL_FROM ?? "Axi <no-reply@axi.africa>";

  if (provider === "resend") {
    const key = process.env.RESEND_API_KEY;
    if (!key) return { ok: false, error: "RESEND_API_KEY manquante" };
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: mail.to, subject: mail.subject, text: mail.text, html: mail.html ?? toHtml(mail.text) }),
    });
    if (!res.ok) return { ok: false, error: `Resend ${res.status}` };
    return { ok: true };
  }

  if (provider !== "console") {
    throw new Error(`EMAIL_PROVIDER inconnu : « ${provider} ». Valeurs acceptées : resend (production) ou console (développement).`);
  }
  // Recette locale d'un build de production : autorisé uniquement si l'app tourne sur localhost.
  const localProdTest = process.env.ALLOW_CONSOLE_EMAIL === "1" && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(process.env.NEXT_PUBLIC_APP_URL ?? "");
  if (process.env.NODE_ENV === "production" && !localProdTest) {
    throw new Error("EMAIL_PROVIDER=console est interdit en production : configurez EMAIL_PROVIDER=resend et RESEND_API_KEY.");
  }

  // console (dev) — affiche le contenu du mail dans le terminal
  console.log(`\n📧 [email → ${mail.to}] ${mail.subject}\n${mail.text}\n`);
  return { ok: true };
}

function toHtml(text: string) {
  return `<pre style="font-family:Inter,system-ui,sans-serif;white-space:pre-wrap;line-height:1.5">${text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")}</pre>`;
}
