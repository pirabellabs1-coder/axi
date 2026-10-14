"use client";

import { useActionState, useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { Send, StickyNote, Zap, ExternalLink, Lock, ImagePlus, X, Sparkles } from "lucide-react";
import { sendInboxMessage, type SendResult } from "@/lib/inbox/actions";
import { suggestInboxReply } from "@/lib/inbox/ai-reply";
import { MAX_MESSAGE_LENGTH } from "@/lib/inbox/constants";
import type { ActionResult } from "@/lib/action";
import { uploadImage } from "@/lib/storage/client";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

export type QuickReplyDTO = { id: string; shortcut: string; body: string };

function fill(body: string, vars: { prenom: string; boutique: string }) {
  return body.replace(/\{prenom\}/gi, () => vars.prenom).replace(/\{boutique\}/gi, () => vars.boutique);
}

export function Composer({
  storeId,
  conversationId,
  phone,
  apiActive,
  canReply,
  quickReplies,
  firstName,
  storeName,
}: {
  storeId: string;
  conversationId: string;
  phone: string;
  apiActive: boolean;
  canReply: boolean;
  quickReplies: QuickReplyDTO[];
  firstName: string;
  storeName: string;
}) {
  const [state, action, pending] = useActionState<ActionResult<SendResult> | undefined, FormData>(sendInboxMessage, undefined);
  const [mode, setMode] = useState<"reply" | "note">("reply");
  const [value, setValue] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [suggesting, startSuggest] = useTransition();

  function suggest() {
    startSuggest(async () => {
      const r = await suggestInboxReply({ storeId, conversationId });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      if (r.data?.reply) {
        setMode("reply");
        setValue(r.data.reply);
        toast.success("Proposition de l'IA prête : relisez-la avant d'envoyer.");
        requestAnimationFrame(() => areaRef.current?.focus());
      }
    });
  }
  const [lastLink, setLastLink] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [active, setActive] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const sentText = useRef("");
  const listId = useId();
  const hintId = useId();

  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      setValue("");
      setImageUrl(null);
      if (fileRef.current) fileRef.current.value = "";
      if (state.data?.status === "LINK_ONLY") {
        setLastLink(`https://wa.me/${phone}?text=${encodeURIComponent(sentText.current)}`);
      } else {
        setLastLink(null);
      }
      if (state.message) toast.success(state.message);
      areaRef.current?.focus();
    } else {
      toast.error(state.error);
    }
  }, [state, phone]);

  const slashQuery = /^\/(\S*)$/.exec(value)?.[1] ?? null;
  const showPicker = mode === "reply" && quickReplies.length > 0 && (pickerOpen || slashQuery !== null);
  const filtered = useMemo(() => {
    const q = (slashQuery ?? "").toLowerCase();
    return quickReplies.filter((r) => !q || r.shortcut.includes(q) || r.body.toLowerCase().includes(q)).slice(0, 8);
  }, [quickReplies, slashQuery]);

  useEffect(() => setActive(0), [slashQuery, pickerOpen]);

  function insert(r: QuickReplyDTO) {
    const text = fill(r.body, { prenom: firstName, boutique: storeName });
    setValue((v) => (slashQuery !== null || !v.trim() ? text : `${v.trimEnd()} ${text}`));
    setPickerOpen(false);
    requestAnimationFrame(() => {
      const el = areaRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    });
  }

  async function onPickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Choisissez une image.");
      return;
    }
    setUploading(true);
    try {
      const { url } = await uploadImage(storeId, "product", file);
      setImageUrl(url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "L'envoi de l'image a échoué.");
      if (fileRef.current) fileRef.current.value = "";
    } finally {
      setUploading(false);
    }
  }

  if (!canReply) {
    return (
      <div className="border-t border-line px-4 py-3 text-sm text-ink-muted">
        <Lock className="mr-1.5 inline size-4" aria-hidden /> Votre rôle permet de lire les conversations, pas d&apos;y répondre.
      </div>
    );
  }

  return (
    <div className="border-t border-line bg-surface">
      {lastLink && mode === "reply" && (
        <div className="flex flex-wrap items-center gap-3 border-b border-line bg-whatsapp-deep/10 px-4 py-2.5 text-sm" role="status">
          <span className="min-w-0 flex-1 text-ink">Message enregistré, pas encore envoyé : l&apos;API WhatsApp n&apos;est pas connectée.</span>
          <a href={lastLink} target="_blank" rel="noopener noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-full bg-whatsapp-deep px-4 text-sm font-medium text-white hover:brightness-110">
            Ouvrir dans WhatsApp <ExternalLink className="size-3.5" aria-hidden />
          </a>
        </div>
      )}

      <form
        ref={formRef}
        action={(fd) => {
          sentText.current = String(fd.get("body") ?? "");
          return action(fd);
        }}
        className="px-3 pb-3 pt-2 sm:px-4"
      >
        <input type="hidden" name="storeId" value={storeId} />
        <input type="hidden" name="conversationId" value={conversationId} />
        <input type="hidden" name="mode" value={mode} />
        {imageUrl && <input type="hidden" name="imageUrl" value={imageUrl} />}
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/avif,image/gif" className="sr-only" onChange={onPickImage} aria-hidden tabIndex={-1} />

        <div className="mb-2 flex items-center gap-1" role="radiogroup" aria-label="Type de message">
          {(
            [
              { k: "reply", label: "Réponse", icon: Send },
              { k: "note", label: "Note interne", icon: StickyNote },
            ] as const
          ).map((t) => (
            <button
              key={t.k}
              type="button"
              role="radio"
              aria-checked={mode === t.k}
              onClick={() => setMode(t.k)}
              className={cn(
                "inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-colors duration-150",
                mode === t.k ? (t.k === "note" ? "bg-sun-soft text-[#8a5a00] dark:text-sun" : "bg-primary-soft text-primary-deep") : "text-ink-muted hover:bg-surface-2 hover:text-ink",
              )}
            >
              <t.icon className="size-3.5" aria-hidden />
              {t.label}
            </button>
          ))}
          <span className="ml-auto hidden text-xs text-ink-faint sm:inline">
            {mode === "reply" ? (apiActive ? "Envoi par l'API WhatsApp, 1 crédit" : "Envoi manuel via WhatsApp") : "Visible uniquement par l'équipe"}
          </span>
        </div>

        {mode === "reply" && imageUrl && (
          <div className="mb-2 inline-flex items-center gap-2 rounded-[var(--radius-md)] bg-surface-2 p-1.5 pr-2 ring-1 ring-inset ring-line">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageUrl} alt="" className="size-10 rounded-[8px] object-cover" />
            <span className="text-xs text-ink-muted">Image jointe</span>
            <button
              type="button"
              onClick={() => {
                setImageUrl(null);
                if (fileRef.current) fileRef.current.value = "";
              }}
              className="inline-flex size-6 items-center justify-center rounded-full text-ink-faint hover:bg-surface hover:text-ink"
              aria-label="Retirer l'image"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </div>
        )}

        <div className="relative">
          {showPicker && (
            <ul
              id={listId}
              role="listbox"
              aria-label="Réponses rapides"
              className="absolute inset-x-0 bottom-full z-20 mb-2 max-h-64 overflow-y-auto rounded-[var(--radius-md)] bg-surface p-1 shadow-[var(--shadow-lg)] ring-1 ring-line"
            >
              {filtered.length === 0 ? (
                <li className="px-3 py-2.5 text-sm text-ink-muted">Aucune réponse rapide ne correspond.</li>
              ) : (
                filtered.map((r, i) => (
                  <li
                    key={r.id}
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={i === active}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      insert(r);
                    }}
                    onMouseEnter={() => setActive(i)}
                    className={cn("cursor-pointer rounded-[var(--radius-sm)] px-3 py-2", i === active ? "bg-surface-2" : "")}
                  >
                    <span className="font-mono text-xs font-semibold text-primary">/{r.shortcut}</span>
                    <span className="mt-0.5 line-clamp-2 block text-sm text-ink-muted">{r.body}</span>
                  </li>
                ))
              )}
            </ul>
          )}

          <label htmlFor={`${listId}-area`} className="sr-only">
            {mode === "reply" ? "Votre réponse" : "Note interne"}
          </label>
          <textarea
            id={`${listId}-area`}
            ref={areaRef}
            name="body"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            maxLength={MAX_MESSAGE_LENGTH}
            rows={2}
            role={quickReplies.length > 0 ? "combobox" : undefined}
            aria-autocomplete={quickReplies.length > 0 ? "list" : undefined}
            aria-expanded={quickReplies.length > 0 ? showPicker : undefined}
            aria-controls={showPicker ? listId : undefined}
            aria-activedescendant={showPicker && filtered[active] ? `${listId}-${active}` : undefined}
            aria-describedby={hintId}
            placeholder={mode === "reply" ? "Écrivez votre réponse, ou tapez / pour une réponse rapide" : "Note visible uniquement par l'équipe"}
            onKeyDown={(e) => {
              if (showPicker && filtered.length > 0) {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActive((a) => (a + 1) % filtered.length);
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive((a) => (a - 1 + filtered.length) % filtered.length);
                  return;
                }
                if (e.key === "Enter" || e.key === "Tab") {
                  e.preventDefault();
                  insert(filtered[active]!);
                  return;
                }
              }
              if (e.key === "Escape" && showPicker) {
                e.preventDefault();
                setPickerOpen(false);
                if (slashQuery !== null) setValue("");
                return;
              }
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                if (value.trim() && !pending) formRef.current?.requestSubmit();
              }
            }}
            className={cn(
              "block max-h-48 min-h-[52px] w-full resize-y rounded-[var(--radius-md)] border-0 px-4 py-3 text-[15px] leading-relaxed text-ink ring-1 ring-inset placeholder:text-ink-faint focus:outline-none focus:ring-2",
              mode === "note" ? "bg-sun-soft/60 ring-sun/40 focus:ring-sun" : "bg-surface ring-line-strong focus:ring-primary",
            )}
          />
        </div>

        <div className="mt-2 flex items-center gap-2">
          {mode === "reply" && (
            <Button type="button" variant="ghost" size="sm" onClick={() => fileRef.current?.click()} loading={uploading} disabled={uploading} aria-label="Joindre une image">
              <ImagePlus className="size-4" aria-hidden /> <span className="hidden sm:inline">Image</span>
            </Button>
          )}
          {mode === "reply" && (
            <Button type="button" variant="ghost" size="sm" onClick={suggest} loading={suggesting} disabled={suggesting} aria-label="Suggérer une réponse avec l'IA (1 crédit IA)">
              <Sparkles className="size-4" aria-hidden /> <span className="hidden sm:inline">Suggérer (IA)</span>
            </Button>
          )}
          {mode === "reply" && quickReplies.length > 0 && (
            <Button type="button" variant="ghost" size="sm" onClick={() => setPickerOpen((o) => !o)} aria-expanded={showPicker} aria-controls={listId}>
              <Zap className="size-4" aria-hidden /> <span className="hidden sm:inline">Réponses rapides</span>
            </Button>
          )}
          <p id={hintId} className="hidden text-xs text-ink-faint md:block">
            <Kbd>Ctrl</Kbd> + <Kbd>Entrée</Kbd> pour envoyer
          </p>
          <Button type="submit" size="sm" className="ml-auto" loading={pending} disabled={mode === "note" ? !value.trim() : (!value.trim() && !imageUrl) || slashQuery !== null} variant={mode === "note" ? "secondary" : "primary"}>
            {mode === "note" ? <StickyNote className="size-4" aria-hidden /> : <Send className="size-4" aria-hidden />}
            {mode === "note" ? "Ajouter la note" : apiActive ? "Envoyer" : "Préparer l'envoi"}
          </Button>
        </div>
      </form>
    </div>
  );
}
