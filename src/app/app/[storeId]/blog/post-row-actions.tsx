"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, ExternalLink, FilePen, MoreHorizontal, Send, Trash2, Undo2 } from "lucide-react";
import { deletePost, setPostStatus } from "@/lib/blog/actions";
import { DropdownItem, DropdownMenu, DropdownSeparator } from "@/components/ui/dropdown-menu";
import { ConfirmActionButton } from "@/components/app/action-controls";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import type { BlogStatus } from "@/lib/blog/constants";

export function PostRowActions({ storeId, storeSlug, id, slug, title, status }: { storeId: string; storeSlug: string; id: string; slug: string; title: string; status: BlogStatus }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (intent: "draft" | "publish" | "archive") =>
    start(async () => {
      const r = await setPostStatus(storeId, id, intent);
      if (r.ok) {
        toast.success(r.message ?? "Enregistré");
        router.refresh();
      } else toast.error(r.error);
    });

  return (
    <div className="flex items-center justify-end gap-1">
      <DropdownMenu
        label={`Actions pour ${title}`}
        trigger={(p) => (
          <button {...p} type="button" disabled={pending} className={cn("inline-flex size-11 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink", pending && "opacity-60")} aria-label={`Actions pour ${title}`}>
            <MoreHorizontal className="size-5" aria-hidden />
          </button>
        )}
      >
        <DropdownItem href={`/app/${storeId}/blog/${id}`} icon={FilePen}>
          Modifier
        </DropdownItem>
        <DropdownItem href={`/s/${storeSlug}/blog/${slug}`} icon={ExternalLink} external>
          {status === "PUBLISHED" ? "Voir sur la boutique" : "Aperçu sur la boutique"}
        </DropdownItem>
        <DropdownSeparator />
        {status !== "PUBLISHED" && (
          <DropdownItem icon={Send} onSelect={() => run("publish")}>
            Publier maintenant
          </DropdownItem>
        )}
        {status !== "DRAFT" && (
          <DropdownItem icon={Undo2} onSelect={() => run("draft")}>
            Repasser en brouillon
          </DropdownItem>
        )}
        {status !== "ARCHIVED" && (
          <DropdownItem icon={Archive} onSelect={() => run("archive")}>
            Archiver
          </DropdownItem>
        )}
      </DropdownMenu>
      <ConfirmActionButton
        action={() => deletePost(storeId, id)}
        title={`Supprimer « ${title} » ?`}
        description="L'article disparaîtra de votre boutique et de son adresse. Cette action est définitive. Pour le masquer sans le perdre, archivez-le."
        confirmLabel="Supprimer"
        className="inline-flex size-11 items-center justify-center rounded-full text-danger hover:bg-danger-soft"
      >
        <Trash2 className="size-4" aria-hidden />
        <span className="sr-only">Supprimer {title}</span>
      </ConfirmActionButton>
    </div>
  );
}
