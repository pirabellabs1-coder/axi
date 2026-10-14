"use client";

import * as React from "react";
import { Input, Label, Select, Hint, FieldError } from "@/components/ui/field";
import type { EditorResources } from "./types";

type Kind = "none" | "home" | "catalog" | "collection" | "product" | "page" | "url";

const KIND_LABELS: Record<Kind, string> = {
  none: "Aucun lien",
  home: "Accueil",
  catalog: "Catalogue",
  collection: "Collection",
  product: "Produit",
  page: "Page",
  url: "Autre adresse",
};

/** Lit une valeur de lien (`/collections/x`, `/p/y`, `/pages/z`, `https://…`) en type + cible. */
export function parseLink(value: string, r: EditorResources): { kind: Kind; target: string } {
  if (!value) return { kind: "none", target: "" };
  if (value === "/") return { kind: "home", target: "" };
  if (value === "/catalogue") return { kind: "catalog", target: "" };
  const m = value.match(/^\/(collections|p|pages)\/([^/?#]+)$/);
  if (m) {
    const slug = decodeURIComponent(m[2]);
    if (m[1] === "collections" && r.collections.some((c) => c.slug === slug)) return { kind: "collection", target: slug };
    if (m[1] === "p" && r.products.some((p) => p.slug === slug)) return { kind: "product", target: slug };
    if (m[1] === "pages" && r.pages.some((p) => p.slug === slug)) return { kind: "page", target: slug };
  }
  return { kind: "url", target: value };
}

function buildLink(kind: Kind, target: string): string {
  switch (kind) {
    case "none":
      return "";
    case "home":
      return "/";
    case "catalog":
      return "/catalogue";
    case "collection":
      return target ? `/collections/${encodeURIComponent(target)}` : "";
    case "product":
      return target ? `/p/${encodeURIComponent(target)}` : "";
    case "page":
      return target ? `/pages/${encodeURIComponent(target)}` : "";
    case "url":
      return target;
  }
}

export function LinkPicker({ id, label, value, onChange, error, resources }: { id: string; label: string; value: string; onChange: (v: string) => void; error?: string; resources: EditorResources }) {
  const parsed = parseLink(value, resources);
  const [kind, setKind] = React.useState<Kind>(parsed.kind);
  // Resynchronise le type quand la valeur change de l'extérieur (annuler, préréglage).
  const [lastValue, setLastValue] = React.useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    if (parsed.kind !== kind && (value !== "" || kind === "none" || kind === "home" || kind === "catalog")) setKind(parsed.kind);
  }
  const errId = error ? `${id}-error` : undefined;

  const options =
    kind === "collection"
      ? resources.collections.map((c) => ({ value: c.slug, label: c.name }))
      : kind === "product"
        ? resources.products.map((p) => ({ value: p.slug, label: p.name }))
        : kind === "page"
          ? resources.pages.map((p) => ({ value: p.slug, label: p.title }))
          : [];

  return (
    <div>
      <Label htmlFor={`${id}-kind`}>{label}</Label>
      <div className="grid gap-2">
        <Select
          id={`${id}-kind`}
          fieldSize="sm"
          value={kind}
          onChange={(e) => {
            const k = e.target.value as Kind;
            setKind(k);
            if (k === "none" || k === "home" || k === "catalog") onChange(buildLink(k, ""));
            else if (k === "url") onChange(parsed.kind === "url" ? parsed.target : "");
            else onChange("");
          }}
        >
          {(Object.keys(KIND_LABELS) as Kind[]).map((k) => (
            <option key={k} value={k}>
              {KIND_LABELS[k]}
            </option>
          ))}
        </Select>
        {(kind === "collection" || kind === "product" || kind === "page") &&
          (options.length ? (
            <Select id={id} fieldSize="sm" aria-label={`${label} : ${KIND_LABELS[kind].toLowerCase()}`} value={parsed.kind === kind ? parsed.target : ""} onChange={(e) => onChange(buildLink(kind, e.target.value))} aria-describedby={errId}>
              <option value="">Choisir…</option>
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          ) : (
            <Hint>Aucune {KIND_LABELS[kind].toLowerCase()} pour le moment.</Hint>
          ))}
        {kind === "url" && (
          <Input
            id={id}
            fieldSize="sm"
            inputMode="url"
            placeholder="https://… ou /catalogue"
            aria-label={`${label} : adresse`}
            value={parsed.kind === "url" ? parsed.target : ""}
            onChange={(e) => onChange(e.target.value.trim())}
            invalid={!!error}
            aria-describedby={errId}
          />
        )}
      </div>
      <FieldError id={errId}>{error}</FieldError>
    </div>
  );
}
