/** Module PUR (sans import serveur) : lecture bornée du corps des webhooks. */

/**
 * Lit le corps en flux et s'arrête dès que `limit` est dépassé, y compris sans `content-length` (chunked).
 * Renvoie null si trop gros.
 */
export async function readBodyLimited(req: Request, limit: number): Promise<Buffer | null> {
  if (Number(req.headers.get("content-length") ?? 0) > limit) return null;
  if (!req.body) return Buffer.alloc(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, size);
}
