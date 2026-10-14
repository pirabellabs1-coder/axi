"use client";

import { Dialog } from "@/components/ui/dialog";
import { useCart } from "./cart-store";
import { CartExtras, CartFooter, CartLines, CartNote, EmptyCart, type CartConfig } from "./cart-contents";

/** Tiroir panier (bas d'écran sur mobile, latéral sur ordinateur). Montants indicatifs : le serveur recalcule. */
export function CartSheet({ cfg }: { cfg: CartConfig }) {
  const cart = useCart(cfg.slug);
  const empty = cart.lines.length === 0;
  return (
    <Dialog
      open={cart.open}
      onClose={cart.closeSheet}
      title="Votre panier"
      description={cart.count > 0 ? `${cart.count} article${cart.count > 1 ? "s" : ""}` : undefined}
      sheet
      footer={empty ? undefined : <div className="sf-safe-bottom w-full"><CartFooter cfg={cfg} onNavigate={cart.closeSheet} /></div>}
    >
      {empty ? (
        <EmptyCart onContinue={cart.closeSheet} />
      ) : (
        <div className="space-y-4">
          <CartLines cfg={cfg} onNavigate={cart.closeSheet} />
          {cfg.showNote && <CartNote slug={cfg.slug} />}
          <CartExtras cfg={cfg} onNavigate={cart.closeSheet} />
        </div>
      )}
    </Dialog>
  );
}
