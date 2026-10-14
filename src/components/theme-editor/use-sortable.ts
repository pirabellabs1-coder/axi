"use client";

import * as React from "react";

/**
 * Liste réordonnable accessible :
 *  - souris / tactile : glisser la poignée (Pointer Events + capture), les voisins s'écartent en direct (transform) ;
 *  - clavier : Espace / Entrée sur la poignée pour saisir, flèches haut/bas pour déplacer, Espace / Entrée pour déposer,
 *    Échap pour annuler. Chaque étape est annoncée via `announce`.
 */
export function useSortable({
  ids,
  onMove,
  label,
  announce,
}: {
  ids: string[];
  onMove: (id: string, toIndex: number) => void;
  label: (id: string) => string;
  announce: (message: string) => void;
}) {
  const nodes = React.useRef(new Map<string, HTMLElement>());
  const [drag, setDrag] = React.useState<{ id: string; dy: number; from: number; to: number; height: number; mids: number[] } | null>(null);
  const [grabbed, setGrabbed] = React.useState<{ id: string; origin: number } | null>(null);
  const startY = React.useRef(0);

  const itemRef = (id: string) => (el: HTMLElement | null) => {
    if (el) nodes.current.set(id, el);
    else nodes.current.delete(id);
  };

  const itemStyle = (id: string): React.CSSProperties | undefined => {
    if (!drag) return undefined;
    const i = ids.indexOf(id);
    if (id === drag.id) return { transform: `translateY(${drag.dy}px)`, zIndex: 2, position: "relative" };
    let shift = 0;
    if (drag.from < drag.to && i > drag.from && i <= drag.to) shift = -drag.height;
    if (drag.from > drag.to && i >= drag.to && i < drag.from) shift = drag.height;
    return { transform: `translateY(${shift}px)`, transition: "transform 180ms cubic-bezier(0.23,1,0.32,1)" };
  };

  const onPointerDown = (id: string) => (e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0 || ids.length < 2) return;
    const el = nodes.current.get(id);
    if (!el) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    startY.current = e.clientY;
    const mids = ids.map((x) => {
      const r = nodes.current.get(x)?.getBoundingClientRect();
      return r ? r.top + r.height / 2 : 0;
    });
    const from = ids.indexOf(id);
    setDrag({ id, dy: 0, from, to: from, height: el.getBoundingClientRect().height + 4, mids });
  };

  const onPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    if (!drag) return;
    const dy = e.clientY - startY.current;
    const center = drag.mids[drag.from] + dy;
    let to = drag.from;
    drag.mids.forEach((m, i) => {
      if (i < drag.from && center < m) to = Math.min(to, i);
      if (i > drag.from && center > m) to = Math.max(to, i);
    });
    setDrag({ ...drag, dy, to });
  };

  const onPointerUp = () => {
    if (!drag) return;
    if (drag.to !== drag.from) {
      onMove(drag.id, drag.to);
      announce(`${label(drag.id)} déplacé en position ${drag.to + 1} sur ${ids.length}.`);
    }
    setDrag(null);
  };

  const onKeyDown = (id: string) => (e: React.KeyboardEvent<HTMLElement>) => {
    const i = ids.indexOf(id);
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      if (grabbed?.id === id) {
        setGrabbed(null);
        announce(`${label(id)} déposé en position ${i + 1} sur ${ids.length}.`);
      } else {
        setGrabbed({ id, origin: i });
        announce(`${label(id)} saisi, position ${i + 1} sur ${ids.length}. Flèches haut et bas pour déplacer, Espace pour déposer, Échap pour annuler.`);
      }
      return;
    }
    if (grabbed?.id !== id) return;
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const to = e.key === "ArrowUp" ? i - 1 : i + 1;
      if (to < 0 || to >= ids.length) return;
      onMove(id, to);
      announce(`${label(id)} : position ${to + 1} sur ${ids.length}.`);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (i !== grabbed.origin) onMove(id, grabbed.origin);
      setGrabbed(null);
      announce(`Déplacement annulé. ${label(id)} revient en position ${grabbed.origin + 1}.`);
    } else if (e.key === "Tab") {
      setGrabbed(null);
    }
  };

  const handleProps = (id: string) => ({
    onPointerDown: onPointerDown(id),
    onPointerMove,
    onPointerUp,
    onPointerCancel: () => setDrag(null),
    onKeyDown: onKeyDown(id),
    onBlur: () => setGrabbed((g) => (g?.id === id ? null : g)),
    "aria-pressed": grabbed?.id === id,
    "aria-roledescription": "poignée de déplacement",
    "aria-label": `Déplacer ${label(id)}`,
    style: { touchAction: "none" } as React.CSSProperties,
  });

  return { itemRef, itemStyle, handleProps, draggingId: drag?.id ?? null, grabbedId: grabbed?.id ?? null };
}
