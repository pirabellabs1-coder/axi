"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { markConversationRead } from "@/lib/inbox/actions";

/**
 * Zone de défilement du fil : se place en bas à l'ouverture et quand un message arrive,
 * sauf si l'utilisateur est remonté lire l'historique. Marque la conversation comme lue.
 */
export function ThreadScroller({
  storeId,
  conversationId,
  messageCount,
  lastMessageId,
  unread,
  children,
}: {
  storeId: string;
  conversationId: string;
  messageCount: number;
  lastMessageId: string | null;
  unread: number;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const opened = useRef<string | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (opened.current !== conversationId) {
      opened.current = conversationId;
      el.scrollTop = el.scrollHeight;
      return;
    }
    if (pinned.current) el.scrollTop = el.scrollHeight;
  }, [conversationId, messageCount, lastMessageId]);

  useEffect(() => {
    if (unread > 0) void markConversationRead(storeId, conversationId);
  }, [storeId, conversationId, unread, lastMessageId]);

  return (
    <div
      ref={ref}
      onScroll={(e) => {
        const el = e.currentTarget;
        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      }}
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-canvas/60 px-3 py-4 sm:px-5"
      role="log"
      aria-live="polite"
      aria-relevant="additions"
      aria-label="Fil de la conversation"
      tabIndex={0}
    >
      {children}
    </div>
  );
}
