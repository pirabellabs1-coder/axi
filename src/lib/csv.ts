/**
 * CSV minimal (RFC 4180) — export UTF-8 avec BOM (Excel) et parseur tolérant (`,` ou `;`).
 */

export function csvEscape(value: unknown): string {
  if (value == null) return "";
  const s = typeof value === "string" ? value : value instanceof Date ? value.toISOString() : String(value);
  // Neutralise les formules Excel (=, +, -, @, tabulation, retour chariot), y compris après des espaces de
  // tête (Excel les ignore) — protection CSV injection, même règle que `csvCell` (src/lib/social/feed-format.ts).
  const safe = /^[\s]*[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",;\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(headers: string[], rows: unknown[][], separator = ";"): string {
  const lines = [headers.map(csvEscape).join(separator), ...rows.map((r) => r.map(csvEscape).join(separator))];
  return "﻿" + lines.join("\r\n");
}

export function csvResponse(filename: string, content: string): Response {
  return new Response(content, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

/** Détecte le séparateur et parse le fichier en tableau de lignes (gère les guillemets et retours à la ligne). */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/)[0] ?? "";
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : (firstLine.includes("\t") && !firstLine.includes(",") ? "\t" : ",");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === sep) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows.map((r) => r.map((c) => c.trim()));
}
