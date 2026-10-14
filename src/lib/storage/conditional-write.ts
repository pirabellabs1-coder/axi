/**
 * Lecture → calcul → écriture CONDITIONNELLE, rejouée si la ligne a changé entre-temps (module pur, utilisé par
 * scripts/migrate-images.ts). `step` renvoie `write: null` s'il n'y a rien à écrire ; sinon `write()` doit
 * renvoyer le nombre de lignes modifiées par un `updateMany` filtré sur la version lue (updatedAt ou ancienne
 * valeur) : 0 signifie « modifiée par quelqu'un d'autre », on relit et on recommence sans rien écraser.
 */
export type ConditionalOutcome = "missing" | "unchanged" | "written" | "abandoned";

export async function writeConditionally<R, X>(opts: {
  read: () => Promise<R | null>;
  step: (row: R) => Promise<X & { write: (() => Promise<number>) | null }>;
  maxTries?: number;
  onConflict?: (attempt: number) => void;
}): Promise<{ outcome: ConditionalOutcome; attempts: number; result?: X }> {
  const max = opts.maxTries ?? 5;
  for (let attempt = 1; attempt <= max; attempt++) {
    const row = await opts.read();
    if (!row) return { outcome: "missing", attempts: attempt };
    const r = await opts.step(row);
    if (!r.write) return { outcome: "unchanged", attempts: attempt, result: r };
    if ((await r.write()) === 1) return { outcome: "written", attempts: attempt, result: r };
    opts.onConflict?.(attempt);
  }
  return { outcome: "abandoned", attempts: max };
}
