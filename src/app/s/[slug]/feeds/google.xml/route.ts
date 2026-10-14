import { serveFeed } from "@/lib/social/feeds";

export const dynamic = "force-dynamic";

/** Flux catalogue public (google), voir src/lib/social/feeds.ts. */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return serveFeed(slug, "google");
}
