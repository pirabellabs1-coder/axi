"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createWhatsappTemplate } from "@/lib/whatsapp/actions";
import { Field, Input, Textarea, Select } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/misc";

type Result = { ok: true; message: string } | { ok: false; error: string } | null;

/** Formulaire de création d'un modèle de message (texte simple : en-tête/corps/pied). Soumis à Meta pour validation. */
export function TemplateForm({ storeId }: { storeId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<Result>(null);
  const [name, setName] = useState("");
  const [category, setCategory] = useState<"MARKETING" | "UTILITY">("UTILITY");
  const [headerText, setHeaderText] = useState("");
  const [body, setBody] = useState("");
  const [footer, setFooter] = useState("");

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setResult(null);
    startTransition(async () => {
      const r = await createWhatsappTemplate({
        storeId,
        name: name.trim(),
        category,
        language: "fr",
        body,
        headerText: headerText.trim() || undefined,
        footer: footer.trim() || undefined,
      });
      if (r.ok) {
        setResult({ ok: true, message: r.message ?? "Modèle soumis." });
        setName("");
        setHeaderText("");
        setBody("");
        setFooter("");
        router.refresh();
      } else {
        setResult({ ok: false, error: r.error });
      }
    });
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      {result && (result.ok ? <Alert tone="success" title="Modèle envoyé">{result.message}</Alert> : <Alert tone="danger" title="Création impossible">{result.error}</Alert>)}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Field id="tpl-name" label="Nom du modèle" required hint="Minuscules, chiffres et « _ » (ex. confirmation_commande).">
          {(p) => (
            <Input
              {...p}
              value={name}
              onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))}
              placeholder="confirmation_commande"
              autoComplete="off"
              spellCheck={false}
              className="font-mono text-sm"
              maxLength={60}
            />
          )}
        </Field>
        <Field id="tpl-category" label="Catégorie" required hint="Utilitaire : suivi de commande. Marketing : promotions (opt-in requis).">
          {(p) => (
            <Select {...p} value={category} onChange={(e) => setCategory(e.target.value as "MARKETING" | "UTILITY")}>
              <option value="UTILITY">Utilitaire</option>
              <option value="MARKETING">Marketing</option>
            </Select>
          )}
        </Field>
      </div>
      <Field id="tpl-header" label="En-tête (facultatif)" hint="Titre court affiché en gras.">
        {(p) => <Input {...p} value={headerText} onChange={(e) => setHeaderText(e.target.value)} placeholder="Votre commande Axi" maxLength={60} />}
      </Field>
      <Field id="tpl-body" label="Corps du message" required hint="Utilisez {{1}}, {{2}}… pour les variables (nom, référence, montant).">
        {(p) => (
          <Textarea
            {...p}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
            maxLength={1024}
            placeholder={"Bonjour {{1}}, votre commande {{2}} est confirmée. Merci de votre confiance !"}
          />
        )}
      </Field>
      <Field id="tpl-footer" label="Pied de page (facultatif)" hint="Texte discret en bas, ex. nom de la boutique.">
        {(p) => <Input {...p} value={footer} onChange={(e) => setFooter(e.target.value)} placeholder="Maison Kairos" maxLength={60} />}
      </Field>
      <div className="flex justify-end border-t border-line pt-4">
        <Button type="submit" loading={pending} disabled={!name.trim() || !body.trim()}>
          Soumettre à Meta
        </Button>
      </div>
    </form>
  );
}
