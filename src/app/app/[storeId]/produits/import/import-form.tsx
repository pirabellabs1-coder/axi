"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileUp, CheckCircle2, FileSpreadsheet, RotateCcw, AlertTriangle, Layers } from "lucide-react";
import { importCatalog, type ImportReport } from "@/lib/products/actions";
import { CSV_COLUMNS, guessColumn, metafieldHeaderColumns, parseCatalogRows, type CsvColumn } from "@/lib/products/csv-catalog";
import { variantName } from "@/lib/products/variants";
import { parseCsv } from "@/lib/csv";
import { Button, ButtonLink } from "@/components/ui/button";
import { Select, Checkbox } from "@/components/ui/field";
import { Card, CardHeader, CardBody, CardFooter } from "@/components/ui/card";
import { Alert, Money } from "@/components/ui/misc";
import { StepProgress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/toast";

/**
 * Import CSV « une ligne par variante » (format proche de Shopify) : association des colonnes, aperçu des produits
 * regroupés avec leurs variantes, rapport d'erreurs par ligne. Le serveur reparse et revalide tout.
 */
export function ImportForm({ storeId, currency, stockTracking, remaining = null }: { storeId: string; currency: string; stockTracking: boolean; remaining?: number | null }) {
  const [rows, setRows] = useState<string[][] | null>(null);
  const [hasHeader, setHasHeader] = useState(true);
  const [mapping, setMapping] = useState<(CsvColumn | "")[]>([]);
  const [fileName, setFileName] = useState("");
  const [overwrite, setOverwrite] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const onFile = async (f: File | null) => {
    if (!f) return;
    if (f.size > 4 * 1024 * 1024) return toast.error("Fichier trop lourd", "4 Mo maximum.");
    const parsed = parseCsv(await f.text());
    if (parsed.length === 0) return toast.error("Fichier vide ou illisible");
    if (parsed.length > 2001) return toast.error("Fichier trop long", "2 000 lignes maximum par import.");
    setFileName(f.name);
    setRows(parsed);
    setReport(null);
    const guessed = parsed[0].map(guessColumn);
    const looksHeader = guessed.some(Boolean);
    setHasHeader(looksHeader);
    setMapping(looksHeader ? dedupe(guessed) : parsed[0].map((_, i) => (i === 0 ? "title" : i === 1 ? "price" : "")));
  };

  const dataRows = useMemo(() => (rows ? (hasHeader ? rows.slice(1) : rows) : []), [rows, hasHeader]);
  const colCount = rows ? Math.max(...rows.map((r) => r.length)) : 0;
  // Lot 4 : colonnes de champs personnalisés reconnues à leur en-tête (`metafield:namespace.cle`).
  const metafieldColumns = useMemo(() => (rows && hasHeader ? metafieldHeaderColumns(rows[0]) : []), [rows, hasHeader]);
  const ready = mapping.includes("title") && mapping.includes("price") && dataRows.length > 0;
  const preview = useMemo(() => (ready ? parseCatalogRows(dataRows, mapping, hasHeader ? 2 : 1) : null), [ready, dataRows, mapping, hasHeader]);
  const variantCount = preview?.products.reduce((s, p) => s + Math.max(1, p.variants.length), 0) ?? 0;

  const submit = () =>
    start(async () => {
      const res = await importCatalog(storeId, { rows: dataRows, mapping, firstLine: hasHeader ? 2 : 1, overwrite, metafieldColumns });
      if (res.ok && res.data) {
        setReport(res.data);
        toast.success(res.message ?? "Import terminé");
        router.refresh();
      } else if (!res.ok) toast.error("Import impossible", res.error);
    });

  if (report) {
    return (
      <Card>
        <CardBody className="flex flex-col items-center py-12 text-center">
          <span className="inline-flex size-14 items-center justify-center rounded-2xl bg-primary-soft text-primary ring-1 ring-inset ring-primary/10">
            <CheckCircle2 className="size-6" aria-hidden />
          </span>
          <h2 className="mt-4 text-lg font-semibold tracking-tight text-ink">
            {report.created} produit{report.created > 1 ? "s" : ""} créé{report.created > 1 ? "s" : ""}, {report.updated} mis à jour
          </h2>
          {report.skipped > 0 && <p className="mt-1 text-sm text-ink-muted">{report.skipped} produit{report.skipped > 1 ? "s" : ""} ignoré{report.skipped > 1 ? "s" : ""}.</p>}
          {report.errors.length > 0 && <ErrorList errors={report.errors} className="mt-5 max-w-xl" />}
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <ButtonLink href={`/app/${storeId}/produits`} variant="outline">
              Voir les produits
            </ButtonLink>
            <Button
              variant="ghost"
              onClick={() => {
                setRows(null);
                setReport(null);
                setFileName("");
              }}
            >
              <RotateCcw className="size-4" aria-hidden /> Nouvel import
            </Button>
          </div>
        </CardBody>
      </Card>
    );
  }

  const newCount = preview?.products.length ?? 0;
  const willExceed = remaining != null && newCount > remaining;

  return (
    <div className="space-y-5">
      <StepProgress current={rows ? (ready ? 3 : 2) : 1} total={3} label={!rows ? "Étape 1 sur 3 : choisir le fichier" : !ready ? "Étape 2 sur 3 : associer les colonnes" : "Étape 3 sur 3 : vérifier et importer"} />
      <Card>
        <CardHeader title="Fichier" description="CSV UTF-8, séparateur virgule ou point-virgule, 2 000 lignes maximum. Une ligne par variante : les lignes d'un même produit partagent le même Handle." />
        <CardBody>
          <label
            htmlFor="csv-file"
            className="group flex cursor-pointer flex-col items-center justify-center rounded-[var(--radius-lg)] border border-dashed border-line-strong bg-surface-2/40 px-6 py-10 text-center transition-colors hover:border-primary hover:bg-primary-soft/30 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary"
          >
            <span className="inline-flex size-12 items-center justify-center rounded-2xl bg-primary-soft text-primary ring-1 ring-inset ring-primary/10">
              {fileName ? <FileSpreadsheet className="size-5" aria-hidden /> : <FileUp className="size-5" aria-hidden />}
            </span>
            <span className="mt-3 text-sm font-medium text-ink">{fileName || "Choisir un fichier CSV"}</span>
            <span className="mt-1 text-xs text-ink-muted">{fileName ? "Cliquez pour choisir un autre fichier" : "Export Shopify accepté tel quel"}</span>
            <input id="csv-file" type="file" accept=".csv,text/csv,text/plain" className="sr-only" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
          </label>
          {rows && (
            <div className="mt-4 space-y-2">
              <Checkbox checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} label="La première ligne contient les titres des colonnes" />
              <Checkbox checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} label="Mettre à jour les produits existants" description="Un produit dont le Handle existe déjà est remplacé (variantes conservées par combinaison). Sinon il est ignoré." />
            </div>
          )}
        </CardBody>
      </Card>

      {rows && (
        <Card className="overflow-hidden">
          <CardHeader
            title="Associer les colonnes"
            description="Titre et Prix sont obligatoires. Les colonnes Option1 à Option3 créent les variantes."
            action={ready ? <Badge tone="success" dot>Colonnes prêtes</Badge> : <Badge tone="warning" dot>Titre et prix requis</Badge>}
          />
          <CardBody>
            <div className="overflow-x-auto rounded-[var(--radius-md)] ring-1 ring-line">
              <table className="w-full text-sm" style={{ minWidth: Math.max(640, colCount * 170) }}>
                <thead className="border-b border-line bg-surface-2/50">
                  <tr>
                    {Array.from({ length: colCount }).map((_, i) => (
                      <th key={i} scope="col" className="min-w-40 px-2 py-2 text-left align-top font-normal">
                        <label htmlFor={`map-${i}`} className="sr-only">
                          Colonne {i + 1} {hasHeader ? `(${rows[0][i] ?? ""})` : ""}
                        </label>
                        {metafieldColumns.some((c) => c.index === i) ? (
                          <span id={`map-${i}`} className="inline-flex min-h-9 items-center rounded-[var(--radius-sm)] bg-primary-soft px-2.5 text-xs font-medium text-primary">
                            Champ personnalisé
                          </span>
                        ) : (
                        <Select
                          id={`map-${i}`}
                          fieldSize="sm"
                          value={mapping[i] ?? ""}
                          onChange={(e) =>
                            setMapping((m) => {
                              const n = [...m];
                              while (n.length < colCount) n.push("");
                              const t = e.target.value as CsvColumn | "";
                              if (t) n.forEach((x, j) => x === t && j !== i && (n[j] = ""));
                              n[i] = t;
                              return n;
                            })
                          }
                        >
                          <option value="">Ignorer</option>
                          {CSV_COLUMNS.filter((c) => c.id !== "stock" || stockTracking).map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.header}
                              {c.id === "title" || c.id === "price" ? " (requis)" : ""}
                            </option>
                          ))}
                        </Select>
                        )}
                        {hasHeader && <span className="mt-1.5 block truncate px-1 text-[11px] font-medium text-ink-faint">{rows[0][i]}</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {dataRows.slice(0, 8).map((r, ri) => (
                    <tr key={ri}>
                      {Array.from({ length: colCount }).map((_, ci) => (
                        <td key={ci} className="h-9 max-w-[200px] truncate px-3 text-ink">
                          {r[ci] ?? ""}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!stockTracking && <p className="mt-2 text-xs text-ink-muted">Le stock n&apos;est pas importé : le suivi de stock n&apos;est pas inclus dans votre plan.</p>}
          </CardBody>
        </Card>
      )}

      {preview && (
        <Card className="overflow-hidden">
          <CardHeader
            title="Aperçu"
            description={`${newCount} produit${newCount > 1 ? "s" : ""}, ${variantCount} ligne${variantCount > 1 ? "s" : ""} de vente détectée${variantCount > 1 ? "s" : ""}.`}
            action={preview.issues.length ? <Badge tone="warning">{preview.issues.length} erreur{preview.issues.length > 1 ? "s" : ""}</Badge> : <Badge tone="success">Aucune erreur</Badge>}
          />
          <CardBody className="space-y-4">
            {preview.issues.length > 0 && <ErrorList errors={preview.issues} />}
            {willExceed && (
              <Alert tone="warning">
                Votre plan permet encore {remaining} nouveau{remaining! > 1 ? "x" : ""} produit{remaining! > 1 ? "s" : ""} : les suivants seront ignorés.
              </Alert>
            )}
            <ul className="divide-y divide-line rounded-[var(--radius-md)] ring-1 ring-line" aria-label="Produits détectés">
              {preview.products.slice(0, 30).map((p) => (
                <li key={p.handle} className="px-4 py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-medium text-ink">
                      {p.name} <span className="font-mono text-xs text-ink-faint">{p.handle}</span>
                    </p>
                    <Money amount={p.price} currency={currency} className="tabular text-sm font-medium" />
                  </div>
                  {p.variants.length > 0 ? (
                    <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
                      <Layers className="size-3.5" aria-hidden />
                      {p.options.map((o) => `${o.name} (${o.values.length})`).join(" × ")} : {p.variants.slice(0, 6).map((v) => variantName(v.attributes, p.options)).join(", ")}
                      {p.variants.length > 6 && ` et ${p.variants.length - 6} autres`}
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-ink-muted">Produit simple</p>
                  )}
                </li>
              ))}
              {preview.products.length > 30 && <li className="px-4 py-2 text-xs text-ink-muted">Et {preview.products.length - 30} autres produits.</li>}
            </ul>
          </CardBody>
          <CardFooter>
            <p className="mr-auto text-sm text-ink-muted">Prix en {currency}, montants entiers.</p>
            <Button onClick={submit} loading={pending} disabled={newCount === 0}>
              Importer {newCount} produit{newCount > 1 ? "s" : ""}
            </Button>
          </CardFooter>
        </Card>
      )}
    </div>
  );
}

function dedupe(cols: (CsvColumn | "")[]): (CsvColumn | "")[] {
  const seen = new Set<string>();
  return cols.map((c) => {
    if (!c || seen.has(c)) return "";
    seen.add(c);
    return c;
  });
}

function ErrorList({ errors, className = "" }: { errors: { line: number; message: string }[]; className?: string }) {
  return (
    <div className={`w-full rounded-[var(--radius-md)] bg-danger-soft/40 px-4 py-3 text-left ring-1 ring-inset ring-danger/20 ${className}`} role="status">
      <p className="mb-1.5 inline-flex items-center gap-1.5 text-sm font-medium text-danger">
        <AlertTriangle className="size-4" aria-hidden /> Rapport d&apos;erreurs
      </p>
      <ul className="max-h-56 space-y-1 overflow-y-auto text-sm text-ink">
        {errors.slice(0, 50).map((e, i) => (
          <li key={i}>
            <span className="tabular font-mono text-xs text-ink-muted">Ligne {e.line}</span> {e.message}
          </li>
        ))}
        {errors.length > 50 && <li className="text-ink-muted">Et {errors.length - 50} autres.</li>}
      </ul>
    </div>
  );
}
