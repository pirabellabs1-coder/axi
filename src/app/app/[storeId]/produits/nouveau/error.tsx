"use client";

import { SegmentError } from "@/components/app/segment-error";

export default function SegmentErrorPage(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <SegmentError {...props} title="Impossible d'ouvrir le formulaire produit" />;
}
