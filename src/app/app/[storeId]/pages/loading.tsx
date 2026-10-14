import { PageSkeleton } from "@/components/app/page-skeleton";

export default function Loading() {
  return <PageSkeleton stats={3} cards={2} />;
}
