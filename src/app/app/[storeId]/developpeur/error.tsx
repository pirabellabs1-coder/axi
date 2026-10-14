"use client";

import { SegmentError } from "@/components/app/segment-error";

export default function DeveloperError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <SegmentError {...props} title="Impossible de charger le portail développeur" />;
}
