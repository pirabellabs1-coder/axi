"use client";

import { useActionState, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus, Minus, Trash2, WifiOff, Wifi, Printer, LockKeyhole, ArrowLeft, Settings } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button, ButtonLink } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Select } from "@/components/ui/field";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormMessage, fieldError } from "@/components/forms/form-message";
import { Alert, EmptyState } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import { formatMoney } from "@/lib/money";
import { closePosSession, addPosCashMovement } from "@/lib/pos/actions";
import { cashPayable, changeDue, checkPayments, discountAmount, type PaymentKind, type PaymentSplit } from "@/lib/pos/cash";
import { MANAGER_CODE_MAX_LENGTH, MANAGER_CODE_MIN_LENGTH, normalizeManagerCode } from "@/lib/pos/manager-code-shape";
import { isSnapshotExpired, needsCatalogRefresh, OFFLINE_MAX_HOURS, SALES_BATCH_SIZE, chunk } from "@/lib/pos/sync";
import { blockedSales, enqueueSale, listQueue, loadSnapshot, markAttempt, newIdempotencyKey, removeFromQueue, saveSnapshot, syncableSales, type QueuedSale } from "@/lib/pos/offline-store";
import type { PosCatalogItem, PosCatalogSnapshot } from "@/lib/pos/catalog";
import type { PosRole } from "@/lib/pos/cash";

/**
 * Écran de VENTE de la caisse (lot 3 §2). Plein écran pour la tablette du comptoir, mais jamais un
 * cul-de-sac : l'en-tête porte le nom de la boutique, l'état du réseau, la session en cours et un
 * bouton de retour à l'espace marchand. Tout ce qui relève du réglage (enregistrement d'appareil,
 * révocation, code du gérant, rapports Z) vit sur `/app/[storeId]/caisse`.
 *
 *  - jeton d'appareil conservé localement (`localStorage`), envoyé en en-tête `Axi-Pos-Device` ;
 *  - instantané du catalogue en IndexedDB, rafraîchi toutes les 15 min en ligne ; au-delà de 72 h sans
 *    synchronisation, la vente est bloquée ;
 *  - vente hors ligne : mise en file avec une clé d'idempotence UUID v4, puis envoi par lots de 20 ;
 *  - aucun prix n'est accordé au client sans recalcul serveur, sauf l'exception hors ligne (le serveur
 *    conserve alors le prix encaissé et signale l'écart).
 */

/** Appareils de la boutique : ici uniquement pour aider à ASSOCIER cette tablette (nom + début du jeton). */
type DeviceDTO = { id: string; name: string; tokenPrefix: string; openSessionId: string | null };

type CartLine = { key: string; item: PosCatalogItem; quantity: number };

type SessionState = { id: string; openingFloat: number; openedAt: string } | null;

const DEVICE_HEADER = "Axi-Pos-Device";

function tokenKey(storeId: string) {
  return `axi-pos-token:${storeId}`;
}

export function PosApp(props: {
  storeId: string;
  storeName: string;
  currency: string;
  role: PosRole;
  maxDiscountPercent: number;
  cashRoundingStep: number;
  /** Capacité `store.settings` : sert à orienter le message quand aucun appareil n'est enregistré. */
  canManageDevices: boolean;
  /** Un code gérant est défini sur la boutique : sans lui, aucun dépassement de plafond n'est possible. */
  managerCodeSet: boolean;
  devices: DeviceDTO[];
}) {
  const { storeId, currency } = props;
  const settingsHref = `/app/${storeId}/caisse`;
  const [token, setToken] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const [snapshot, setSnapshot] = useState<PosCatalogSnapshot | null>(null);
  const [snapshotSavedAt, setSnapshotSavedAt] = useState<Date | null>(null);
  // Référence (hors rendu) de la date du dernier instantané : elle sert aux minuteries, sans
  // réexécuter l'effet de synchronisation — sinon chaque rafraîchissement en déclencherait un autre.
  const snapshotSavedAtRef = useRef<Date | null>(null);
  const [session, setSession] = useState<SessionState>(null);
  // Identifiant de l'appareil tel que reconnu par le serveur (réponse du catalogue) : transmis à la
  // clôture, qui vérifie que la session appartient bien à CET appareil.
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [queue, setQueue] = useState<QueuedSale[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [search, setSearch] = useState("");
  const [discountPercent, setDiscountPercent] = useState(0);
  // Code du gérant saisi au comptoir quand la remise dépasse le plafond du rôle. Jamais conservé après
  // l'encaissement ; c'est le SERVEUR qui le vérifie (`verifyManagerCode`).
  const [managerCode, setManagerCode] = useState("");
  const [cashReceived, setCashReceived] = useState("");
  const [momo, setMomo] = useState({ amount: "", reference: "" });
  const [customerPhone, setCustomerPhone] = useState("");
  const [lastSale, setLastSale] = useState<{ reference: string | null; total: number; change: number; lines: CartLine[]; offline: boolean } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  /* ─────────── Jeton d'appareil et réseau ─────────── */
  useEffect(() => {
    setToken(localStorage.getItem(tokenKey(storeId)));
    setOnline(navigator.onLine);
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/caisse/sw.js", { scope: "/caisse/" }).catch(() => undefined);
    }
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, [storeId]);

  // `syncQueue` est défini plus bas (il dépend de `fetchCatalog`) : une référence permet à l'effet de
  // montage de vider la file AVANT le premier rafraîchissement du catalogue.
  const syncQueueRef = useRef<((silent?: boolean) => Promise<void>) | null>(null);

  const refreshQueue = useCallback(async () => {
    try {
      setQueue(await listQueue());
    } catch {
      // IndexedDB indisponible : la caisse reste utilisable en ligne.
    }
  }, []);

  /* ─────────── Catalogue (réseau puis repli hors ligne) ─────────── */
  /**
   * Catalogue : c'est le SEUL appel qui avance `PosDevice.lastSyncAt`, la date de référence de
   * fraîcheur de l'instantané — et donc la preuve technique du hors-ligne côté serveur
   * (`decideOffline`, majeur n° 2). L'appareil doit donc VIDER SA FILE AVANT de rafraîchir, sinon il
   * perd lui-même l'exception de prix de ses ventes en attente (elles passent au prix serveur).
   * Le marqueur n'est jamais piloté par un paramètre de requête : un appareil compromis pourrait
   * alors geler sa fraîcheur à volonté et s'ouvrir l'exception de prix en permanence.
   */
  const fetchCatalog = useCallback(
    async (deviceToken: string) => {
      const res = await fetch(`/api/pos/${storeId}/catalog`, { headers: { [DEVICE_HEADER]: deviceToken }, cache: "no-store" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Catalogue indisponible");
      }
      const data = (await res.json()) as { snapshot: PosCatalogSnapshot; device?: { id: string } };
      if (data.device?.id) setDeviceId(data.device.id);
      await saveSnapshot(data.snapshot).catch(() => undefined);
      setSnapshot(data.snapshot);
      snapshotSavedAtRef.current = new Date();
      setSnapshotSavedAt(snapshotSavedAtRef.current);
      return data.snapshot;
    },
    [storeId],
  );

  const fetchSession = useCallback(
    async (deviceToken: string) => {
      const res = await fetch(`/api/pos/${storeId}/sessions`, { headers: { [DEVICE_HEADER]: deviceToken }, cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { session: { id: string; openingFloat: number; openedAt: string } | null };
      setSession(data.session ? { id: data.session.id, openingFloat: data.session.openingFloat, openedAt: data.session.openedAt } : null);
    },
    [storeId],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!token) {
        setLoading(false);
        return;
      }
      // Appareil associé en cours de session : on repasse en chargement le temps du premier
      // catalogue, sinon l'instantané encore vide se lit comme « périmé » et affiche à tort
      // « Reconnectez la caisse » pendant quelques secondes.
      setLoading(true);
      const stored = await loadSnapshot().catch(() => null);
      if (!cancelled && stored) {
        setSnapshot(stored.snapshot);
        snapshotSavedAtRef.current = new Date(stored.savedAt);
        setSnapshotSavedAt(snapshotSavedAtRef.current);
      }
      if (navigator.onLine) {
        try {
          // La file part AVANT le catalogue : rafraîchir d'abord effacerait la preuve du hors-ligne
          // des ventes en attente (elles seraient réenregistrées au prix serveur).
          if (syncableSales(await listQueue().catch(() => [])).length) await syncQueueRef.current?.(true);
          await fetchCatalog(token);
          await fetchSession(token);
        } catch (e) {
          if (!cancelled) toast.error((e as Error).message);
        }
      }
      await refreshQueue();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [token, fetchCatalog, fetchSession, refreshQueue]);

  /* ─────────── Synchronisation de la file ─────────── */
  /**
   * Vidage de la file. Une vente ne quitte la file que si le serveur l'ACCEPTE ou la déclare
   * DÉFINITIVEMENT invalide (`permanent`). Tout autre refus la laisse en file, avec son motif :
   * jamais d'argent en caisse sans commande ni décrément de stock.
   */
  const syncQueue = useCallback(
    async (silent = false) => {
      if (!token) return;
      const pending = await listQueue().catch(() => []);
      if (!pending.length) {
        if (!silent) toast.success("Rien à synchroniser");
        return;
      }
      setSyncing(true);
      let sent = 0;
      let failed = 0;
      let blocked = 0;
      try {
        for (const batch of chunk(pending, SALES_BATCH_SIZE)) {
          const res = await fetch(`/api/pos/${storeId}/sales`, {
            method: "POST",
            headers: { "content-type": "application/json", [DEVICE_HEADER]: token },
            body: JSON.stringify({
              sales: batch.map((sale) => ({
                idempotencyKey: sale.idempotencyKey,
                sessionId: sale.sessionId,
                items: sale.items.map((i) => ({ productId: i.productId, variantId: i.variantId, quantity: i.quantity })),
                payments: sale.payments,
                discountPercent: sale.discountPercent ?? 0,
                // Rejeu fidèle : rôle du vendeur et code du gérant saisi au comptoir (vérifié serveur).
                sellerRole: sale.sellerRole ?? props.role,
                managerCode: sale.managerCode ?? null,
                customerPhone: sale.customerPhone ?? null,
                customerName: sale.customerName ?? null,
                collectedTotal: sale.collectedTotal,
                offlineCreatedAt: sale.offlineCreatedAt,
              })),
            }),
          });
          if (!res.ok && res.status !== 200) {
            const body = (await res.json().catch(() => ({}))) as { error?: string };
            throw new Error(body.error ?? "Synchronisation impossible");
          }
          const data = (await res.json()) as { results: { idempotencyKey: string; ok: boolean; error?: string; permanent?: boolean }[] };
          for (const result of data.results) {
            const sale = batch.find((s) => s.idempotencyKey === result.idempotencyKey);
            if (result.ok) {
              await removeFromQueue(result.idempotencyKey);
              sent += 1;
            } else if (sale && result.permanent) {
              // Refus DÉFINITIF (vente invalide en la forme) : retirée de la file, signalée au caissier.
              await removeFromQueue(result.idempotencyKey);
              failed += 1;
              toast.error(`Vente refusée : ${result.error ?? "erreur inconnue"}`);
            } else if (sale) {
              // Refus RÉCUPÉRABLE : l'argent est déjà en caisse, la vente RESTE en file et est
              // signalée au gérant, qui la régularise (bloquant n° 3).
              await markAttempt(sale, result.error ?? "Refus temporaire du serveur").catch(() => undefined);
              blocked += 1;
            }
          }
        }
        if (sent && !silent) toast.success(`${sent} vente${sent > 1 ? "s" : ""} synchronisée${sent > 1 ? "s" : ""}`);
        if (failed && !silent) toast.error(`${failed} vente${failed > 1 ? "s" : ""} refusée${failed > 1 ? "s" : ""}`);
        if (blocked && !silent) toast.error(`${blocked} vente${blocked > 1 ? "s" : ""} en attente de régularisation : prévenez le gérant.`);
        // Catalogue rafraîchi UNIQUEMENT si la file est vide : sinon la preuve du hors-ligne des
        // ventes restantes (refus récupérables) serait perdue au prochain essai.
        if (!syncableSales(await listQueue().catch(() => [])).length) await fetchCatalog(token).catch(() => undefined);
      } catch (e) {
        // La file est CONSERVÉE : on réessaiera (chaque vente garde sa clé d'idempotence).
        // On ne marque que les ventes ENCORE en file : celles déjà acceptées par le serveur dans un lot
        // précédent ont été retirées et ne doivent pas être réinsérées (markAttempt fait un `put`).
        const stillQueued = new Set((await listQueue().catch(() => [])).map((s) => s.idempotencyKey));
        for (const sale of pending) if (stillQueued.has(sale.idempotencyKey)) await markAttempt(sale).catch(() => undefined);

        if (!silent) toast.error((e as Error).message);
      } finally {
        setSyncing(false);
        await refreshQueue();
      }
    },
    [token, storeId, fetchCatalog, refreshQueue, props.role],
  );

  // Retour du réseau : synchronisation automatique, puis rafraîchissement périodique du catalogue
  // (toutes les 15 min). La fraîcheur est lue dans une référence : l'effet ne dépend QUE du réseau et
  // du jeton, sinon un rafraîchissement relancerait l'effet, qui relancerait un rafraîchissement…
  useEffect(() => {
    syncQueueRef.current = syncQueue;
  }, [syncQueue]);

  useEffect(() => {
    if (!online || !token) return;
    void syncQueue(true);
    const interval = setInterval(() => {
      void (async () => {
        if (!navigator.onLine || !needsCatalogRefresh(snapshotSavedAtRef.current)) return;
        // Jamais de rafraîchissement tant que des ventes attendent : il effacerait la preuve de leur
        // hors-ligne côté serveur. La file est renvoyée d'abord.
        if (syncableSales(await listQueue().catch(() => [])).length) {
          await syncQueue(true);
          return;
        }
        await fetchCatalog(token).catch(() => undefined);
      })();
    }, 60_000);
    return () => clearInterval(interval);
  }, [online, token, syncQueue, fetchCatalog]);

  /* ─────────── Panier ─────────── */
  const items = snapshot?.items ?? [];
  const results = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items.slice(0, 24);
    return items
      .filter((i) => i.name.toLowerCase().includes(q) || (i.variantName ?? "").toLowerCase().includes(q) || (i.sku ?? "").toLowerCase() === q || (i.barcode ?? "") === q)
      .slice(0, 24);
  }, [items, search]);

  const addItem = useCallback((item: PosCatalogItem) => {
    const key = item.variantId ?? item.productId;
    setCart((current) => {
      const existing = current.find((l) => l.key === key);
      if (existing) return current.map((l) => (l.key === key ? { ...l, quantity: l.quantity + 1 } : l));
      return [...current, { key, item, quantity: 1 }];
    });
    setSearch("");
    searchRef.current?.focus();
  }, []);

  // Lecteur code-barres USB/Bluetooth : il « tape » le code puis Entrée.
  function onSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const code = search.trim();
    if (!code) return;
    const found = items.find((i) => i.barcode === code || (i.sku ?? "").toLowerCase() === code.toLowerCase()) ?? results[0];
    if (found) addItem(found);
    else toast.error("Article introuvable dans l'instantané de la caisse.");
  }

  const subtotal = cart.reduce((s, l) => s + l.item.price * l.quantity, 0);
  const discount = discountAmount(subtotal, discountPercent);
  const total = Math.max(0, subtotal - discount);
  const payable = cashPayable(total, true, props.cashRoundingStep);
  const momoAmount = Number(momo.amount || 0);
  const cashAmount = Number(cashReceived || 0);
  const splits: PaymentSplit[] = [];
  if (momoAmount > 0) splits.push({ kind: "pos_momo", amount: Math.round(momoAmount), reference: momo.reference });
  if (cashAmount > 0) splits.push({ kind: "pos_cash", amount: Math.round(cashAmount) });
  const paymentCheck = checkPayments(payable, splits);
  const change = paymentCheck.ok ? paymentCheck.change : changeDue(payable, cashAmount + momoAmount);

  const blocked = blockedSales(queue);
  const pendingCount = syncableSales(queue).length;
  const snapshotStale = isSnapshotExpired(snapshotSavedAt, new Date());
  // Dépassement du plafond de remise du rôle : le code du gérant est exigé (bloquant n° 1). L'écran le
  // demande ; le serveur, lui, le vérifie — rien ici ne décide de l'autorisation.
  const overCap = discountPercent > props.maxDiscountPercent;
  const managerCodeReady = !overCap || (props.managerCodeSet && !!normalizeManagerCode(managerCode));
  const canSell = !!session && cart.length > 0 && paymentCheck.ok && !snapshotStale && managerCodeReady;

  async function checkout() {
    if (!token || !session) return;
    const sale: QueuedSale = {
      idempotencyKey: newIdempotencyKey(),
      sessionId: session.id,
      items: cart.map((l) => ({ productId: l.item.productId, variantId: l.item.variantId, quantity: l.quantity, unitPrice: l.item.price, name: l.item.name, variantName: l.item.variantName })),
      payments: splits.map((s) => ({ kind: s.kind as PaymentKind, amount: s.amount, reference: s.reference ?? null })),
      discountPercent,
      // Rejeu fidèle de la vente hors ligne : rôle du vendeur au moment de l'encaissement.
      sellerRole: props.role,
      managerCode: overCap ? normalizeManagerCode(managerCode) : null,
      customerPhone: customerPhone || null,
      customerName: null,
      collectedTotal: payable,
      offlineCreatedAt: new Date().toISOString(),
    };

    const finish = (reference: string | null, offline: boolean) => {
      setLastSale({ reference, total: payable, change, lines: cart, offline });
      setCart([]);
      setDiscountPercent(0);
      setManagerCode("");
      setCashReceived("");
      setMomo({ amount: "", reference: "" });
      setCustomerPhone("");
    };

    if (!navigator.onLine) {
      await enqueueSale(sale);
      await refreshQueue();
      finish(null, true);
      toast.success("Vente enregistrée hors ligne : elle sera synchronisée au retour du réseau.");
      return;
    }
    try {
      const res = await fetch(`/api/pos/${storeId}/sales`, {
        method: "POST",
        headers: { "content-type": "application/json", [DEVICE_HEADER]: token },
        body: JSON.stringify({
          sales: [
            {
              idempotencyKey: sale.idempotencyKey,
              sessionId: sale.sessionId,
              items: sale.items.map((i) => ({ productId: i.productId, variantId: i.variantId, quantity: i.quantity })),
              payments: sale.payments,
              discountPercent: sale.discountPercent,
              sellerRole: sale.sellerRole,
              managerCode: sale.managerCode ?? null,
              customerPhone: sale.customerPhone,
              collectedTotal: sale.collectedTotal,
              // Pas d'`offlineCreatedAt` : cette vente est en ligne, le serveur recalcule tout.
            },
          ],
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { results?: { ok: boolean; reference?: string; error?: string; total?: number }[]; error?: string };
      const result = data.results?.[0];
      if (!res.ok || !result?.ok) {
        toast.error(result?.error ?? data.error ?? "Encaissement refusé");
        return;
      }
      finish(result.reference ?? null, false);
      toast.success(`Vente ${result.reference} encaissée`);
      await fetchCatalog(token).catch(() => undefined);
    } catch {
      // Réseau perdu pendant l'envoi : la vente passe en file (jamais d'encaissement perdu).
      await enqueueSale(sale);
      await refreshQueue();
      finish(null, true);
      toast.success("Réseau perdu : vente mise en file.");
    }
  }

  /* ─────────── Rendus ─────────── */
  const noDevice = !props.devices.length;

  return (
    <PosShell
      storeName={props.storeName}
      settingsHref={settingsHref}
      online={online}
      session={session}
      currency={currency}
      queueCount={token ? queue.length : 0}
      onSync={token ? () => void syncQueue() : undefined}
      syncing={syncing}
    >
      {noDevice ? (
        <Card>
          <CardBody>
            <EmptyState
              icon={LockKeyhole}
              title="Aucun appareil de caisse"
              description={
                props.canManageDevices
                  ? "Enregistrez d'abord cette tablette depuis l'espace marchand : vous y obtiendrez un jeton à coller ici."
                  : "Demandez au gérant d'enregistrer cette tablette depuis l'espace marchand."
              }
              action={
                props.canManageDevices ? (
                  <ButtonLink href={settingsHref} variant="accent" size="md" className="h-12">
                    <Settings className="size-4" aria-hidden /> Réglages de la caisse
                  </ButtonLink>
                ) : undefined
              }
            />
          </CardBody>
        </Card>
      ) : !token ? (
        <Card>
          <CardHeader title="Associer cet appareil" description="Collez le jeton obtenu lors de l'enregistrement de l'appareil. Il reste sur cet appareil." />
          <CardBody className="space-y-4">
            <TokenForm storeId={storeId} onToken={(t) => setToken(t)} />
            <ul className="text-sm text-ink-muted">
              {props.devices.map((d) => (
                <li key={d.id}>
                  {d.name} (jeton <span className="font-mono text-xs">{d.tokenPrefix}…</span>)
                </li>
              ))}
            </ul>
            <p className="text-sm text-ink-muted">
              Jeton perdu ? Enregistrez un nouvel appareil depuis les réglages de la caisse, dans l&apos;espace marchand.
            </p>
          </CardBody>
        </Card>
      ) : loading ? (
        <p className="text-sm text-ink-muted">Chargement de la caisse…</p>
      ) : snapshotStale ? (
        <Alert tone="danger" title="Reconnectez la caisse">
          L&apos;instantané du catalogue date de plus de {OFFLINE_MAX_HOURS} h : la vente est bloquée jusqu&apos;à une synchronisation.
        </Alert>
      ) : !session ? (
        <OpenSessionCard storeId={storeId} deviceToken={token} onOpened={(s) => setSession(s)} />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.2fr_1fr]">
          <Card>
            <CardHeader title="Articles" description={`${items.length} article(s) dans l'instantané${snapshotSavedAt ? ` · mis à jour ${snapshotSavedAt.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}` : ""}`} />
            <CardBody className="space-y-3">
              <Field id="possearch" label="Scanner ou chercher un article">
                {(p) => <Input {...p} ref={searchRef} value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={onSearchKeyDown} placeholder="Code-barres, nom ou SKU" autoFocus />}
              </Field>
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {results.map((item) => (
                  <li key={item.variantId ?? item.productId}>
                    <button
                      type="button"
                      onClick={() => addItem(item)}
                      className="flex min-h-[64px] w-full flex-col justify-between rounded-[var(--radius-md)] bg-surface-2 px-3 py-2 text-left ring-1 ring-inset ring-line transition-colors hover:bg-surface-3"
                    >
                      <span className="line-clamp-2 text-sm font-medium text-ink">
                        {item.name}
                        {item.variantName ? ` — ${item.variantName}` : ""}
                      </span>
                      <span className="mt-1 flex items-center justify-between text-xs text-ink-muted">
                        <span className="tabular">{formatMoney(item.price, currency)}</span>
                        {item.trackStock && <span className={item.available <= 0 ? "text-danger" : ""}>{item.available}</span>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {results.length === 0 && <p className="text-sm text-ink-muted">Aucun article ne correspond.</p>}
            </CardBody>
          </Card>

          <div className="space-y-4">
            <Card>
              <CardHeader title="Panier" description={cart.length ? `${cart.reduce((s, l) => s + l.quantity, 0)} article(s)` : "Vide"} />
              <CardBody className="space-y-3">
                {cart.map((line) => (
                  <div key={line.key} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">
                      {line.item.name}
                      {line.item.variantName ? ` — ${line.item.variantName}` : ""}
                    </span>
                    <Button variant="ghost" size="icon" aria-label="Retirer une unité" onClick={() => setCart((c) => c.map((l) => (l.key === line.key ? { ...l, quantity: Math.max(1, l.quantity - 1) } : l)))}>
                      <Minus className="size-4" aria-hidden />
                    </Button>
                    <span className="tabular w-8 text-center text-sm">{line.quantity}</span>
                    <Button variant="ghost" size="icon" aria-label="Ajouter une unité" onClick={() => setCart((c) => c.map((l) => (l.key === line.key ? { ...l, quantity: l.quantity + 1 } : l)))}>
                      <Plus className="size-4" aria-hidden />
                    </Button>
                    <span className="tabular w-20 text-right text-sm">{formatMoney(line.item.price * line.quantity, currency)}</span>
                    <Button variant="ghost" size="icon" aria-label="Supprimer la ligne" onClick={() => setCart((c) => c.filter((l) => l.key !== line.key))}>
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  </div>
                ))}
                {!cart.length && <p className="text-sm text-ink-muted">Scannez un article pour commencer.</p>}

                <dl className="space-y-1 border-t border-line pt-3 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-ink-muted">Sous-total</dt>
                    <dd className="tabular">{formatMoney(subtotal, currency)}</dd>
                  </div>
                  {discount > 0 && (
                    <div className="flex justify-between">
                      <dt className="text-ink-muted">Remise {discountPercent} %</dt>
                      <dd className="tabular">−{formatMoney(discount, currency)}</dd>
                    </div>
                  )}
                  <div className="flex justify-between text-[17px] font-semibold">
                    <dt>À payer</dt>
                    <dd className="tabular">{formatMoney(payable, currency)}</dd>
                  </div>
                </dl>

                <div className="grid grid-cols-2 gap-3">
                  <Field id="posdisc" label={`Remise % (votre plafond : ${props.maxDiscountPercent})`} hint={props.managerCodeSet ? "Au-delà du plafond, le code du gérant est demandé." : undefined}>
                    {(p) => (
                      <Input
                        {...p}
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={props.managerCodeSet ? 100 : props.maxDiscountPercent}
                        value={discountPercent}
                        onChange={(e) => setDiscountPercent(Math.max(0, Math.min(props.managerCodeSet ? 100 : props.maxDiscountPercent, Number(e.target.value || 0))))}
                        className="tabular"
                      />
                    )}
                  </Field>
                  <Field id="posphone" label="Téléphone client">
                    {(p) => <Input {...p} type="tel" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder="97 00 00 00" />}
                  </Field>
                  <Field id="poscash" label="Espèces reçues">
                    {(p) => <Input {...p} type="number" inputMode="numeric" min={0} value={cashReceived} onChange={(e) => setCashReceived(e.target.value)} className="tabular" />}
                  </Field>
                  <Field id="posmomo" label="Mobile Money">
                    {(p) => <Input {...p} type="number" inputMode="numeric" min={0} value={momo.amount} onChange={(e) => setMomo((m) => ({ ...m, amount: e.target.value }))} className="tabular" />}
                  </Field>
                  {momoAmount > 0 && (
                    <Field id="posmomoref" label="Référence Mobile Money" required className="col-span-2">
                      {(p) => <Input {...p} value={momo.reference} onChange={(e) => setMomo((m) => ({ ...m, reference: e.target.value }))} placeholder="TX-…" />}
                    </Field>
                  )}
                  {overCap && props.managerCodeSet && (
                    <Field
                      id="posmgr"
                      label="Code du gérant"
                      required
                      className="col-span-2"
                      hint={`Remise de ${discountPercent} % au-delà de votre plafond de ${props.maxDiscountPercent} % : ${MANAGER_CODE_MIN_LENGTH} à ${MANAGER_CODE_MAX_LENGTH} chiffres, vérifiés par le serveur.`}
                    >
                      {(p) => (
                        <Input
                          {...p}
                          type="password"
                          inputMode="numeric"
                          autoComplete="off"
                          maxLength={MANAGER_CODE_MAX_LENGTH}
                          value={managerCode}
                          onChange={(e) => setManagerCode(e.target.value.replace(/\D/g, "").slice(0, MANAGER_CODE_MAX_LENGTH))}
                          className="tabular"
                        />
                      )}
                    </Field>
                  )}
                </div>

                {overCap && !props.managerCodeSet && (
                  <p className="text-sm text-danger">
                    Aucun code gérant n&apos;est défini sur cette boutique : la remise reste plafonnée à {props.maxDiscountPercent} %. Le gérant le
                    définit dans l&apos;espace marchand, page « Caisse ».
                  </p>
                )}
                {!paymentCheck.ok && cart.length > 0 && <p className="text-sm text-danger">{paymentCheck.error}</p>}
                {paymentCheck.ok && change > 0 && <p className="text-sm font-medium text-ink">Rendu : {formatMoney(change, currency)}</p>}

                <Button className="w-full" size="lg" disabled={!canSell} onClick={() => void checkout()}>
                  Encaisser {formatMoney(payable, currency)}
                </Button>
              </CardBody>
            </Card>

            {lastSale && <Receipt sale={lastSale} currency={currency} storeName={props.storeName} />}

            {blocked.length > 0 && (
              <Card>
                <CardHeader title="Ventes à régulariser" description="Déjà encaissées, refusées par le serveur : elles restent en file et ne sont jamais supprimées automatiquement." />
                <CardBody className="space-y-3">
                  <Alert tone="danger" title={`${blocked.length} vente(s) encaissée(s) sans commande`}>
                    L&apos;argent est en caisse mais la commande n&apos;a pas pu être créée. Prévenez le gérant : corrigez la
                    cause (session rouverte, article remis en vente, code du gérant) puis relancez « Synchroniser ».
                  </Alert>
                  <ul className="space-y-2 text-sm">
                    {blocked.map((sale) => (
                      <li key={sale.idempotencyKey} className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-md)] bg-surface-2 px-3 py-2">
                        <span className="min-w-0">
                          <span className="font-medium text-ink">{formatMoney(sale.collectedTotal, currency)}</span>{" "}
                          <span className="text-ink-muted">
                            — {new Date(sale.offlineCreatedAt).toLocaleString("fr-FR")} · {sale.lastError}
                          </span>
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={async () => {
                            if (!window.confirm("Retirer cette vente de la file ? À ne faire qu'après l'avoir régularisée dans l'espace marchand.")) return;
                            await removeFromQueue(sale.idempotencyKey).catch(() => undefined);
                            await refreshQueue();
                          }}
                        >
                          Régularisée : retirer
                        </Button>
                      </li>
                    ))}
                  </ul>
                </CardBody>
              </Card>
            )}

            <SessionCard
              storeId={storeId}
              session={session}
              currency={currency}
              queueCount={pendingCount}
              blockedCount={blocked.length}
              blockedAmount={blocked.reduce((s, b) => s + b.collectedTotal, 0)}
              deviceId={deviceId}
              onClosed={() => setSession(null)}
            />
          </div>
        </div>
      )}
    </PosShell>
  );
}

/**
 * Coque de l'écran de vente : plein écran, mais avec un en-tête qui situe toujours le caissier
 * (boutique, réseau, session en cours) et un bouton de RETOUR visible vers l'espace marchand. Le
 * porteur se perdait faute de ce repère.
 */
function PosShell({
  storeName,
  settingsHref,
  online,
  session,
  currency,
  queueCount,
  onSync,
  syncing,
  children,
}: {
  storeName: string;
  settingsHref: string;
  online: boolean;
  session: SessionState;
  currency: string;
  queueCount: number;
  onSync?: () => void;
  syncing?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-3 gap-y-2 px-3 py-3 sm:px-4">
          <ButtonLink href={settingsHref} variant="secondary" size="sm" className="order-1 h-11 shrink-0">
            <ArrowLeft className="size-4" aria-hidden /> <span className="hidden sm:inline">Espace marchand</span>
            <span className="sm:hidden">Retour</span>
          </ButtonLink>
          {/* Sur mobile, le titre passe sur sa propre ligne : il n'est plus rogné par les indicateurs. */}
          <div className="order-3 w-full min-w-0 sm:order-2 sm:w-auto sm:flex-1">
            <h1 className="truncate text-[17px] font-semibold tracking-[-0.02em] text-ink sm:text-[20px]">Caisse · {storeName}</h1>
            <p className="truncate text-xs text-ink-muted sm:text-sm">
              {session
                ? `Session ouverte depuis ${new Date(session.openedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })} · fond de caisse ${formatMoney(session.openingFloat, currency)}`
                : "Aucune session ouverte"}
            </p>
          </div>
          <div className="order-2 ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2 sm:order-3 sm:ml-0">
            <Badge tone={online ? "success" : "warning"} dot>
              {online ? "En ligne" : "Hors ligne"}
            </Badge>
            {queueCount > 0 && <Badge tone="info">{queueCount} en attente</Badge>}
            {onSync && (
              <Button variant="secondary" size="sm" className="h-11" onClick={onSync} loading={syncing} aria-label="Synchroniser les ventes en attente">
                {online ? <Wifi className="size-4" aria-hidden /> : <WifiOff className="size-4" aria-hidden />}{" "}
                <span className="hidden sm:inline">Synchroniser</span>
              </Button>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl space-y-4 px-3 py-4 sm:px-4">{children}</main>
    </div>
  );
}

function TokenForm({ storeId, onToken }: { storeId: string; onToken: (token: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const token = value.trim();
        if (token.length < 16) {
          toast.error("Jeton invalide");
          return;
        }
        localStorage.setItem(tokenKey(storeId), token);
        onToken(token);
        toast.success("Appareil associé");
      }}
    >
      <Field id="postoken" label="Jeton de l'appareil" className="min-w-64">
        {(p) => <Input {...p} value={value} onChange={(e) => setValue(e.target.value)} autoComplete="off" placeholder="Collez le jeton" />}
      </Field>
      <Button type="submit" className="h-11 sm:h-10">
        Associer
      </Button>
    </form>
  );
}
function OpenSessionCard({ storeId, deviceToken, onOpened }: { storeId: string; deviceToken: string; onOpened: (s: { id: string; openingFloat: number; openedAt: string }) => void }) {
  const [openingFloat, setOpeningFloat] = useState("0");
  const [pending, setPending] = useState(false);
  return (
    <Card>
      <CardHeader title="Ouvrir la caisse" description="Indiquez le fond de caisse présent dans le tiroir." />
      <CardBody>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setPending(true);
            const res = await fetch(`/api/pos/${storeId}/sessions`, {
              method: "POST",
              headers: { "content-type": "application/json", [DEVICE_HEADER]: deviceToken },
              body: JSON.stringify({ openingFloat: Math.max(0, Math.round(Number(openingFloat || 0))) }),
            });
            const data = (await res.json().catch(() => ({}))) as { ok?: boolean; session?: { id: string }; error?: string };
            setPending(false);
            if (!res.ok || !data.session) {
              toast.error(data.error ?? "Ouverture impossible");
              return;
            }
            onOpened({ id: data.session.id, openingFloat: Math.round(Number(openingFloat || 0)), openedAt: new Date().toISOString() });
            toast.success("Caisse ouverte");
          }}
        >
          <Field id="float" label="Fond de caisse" className="min-w-40">
            {(p) => <Input {...p} type="number" inputMode="numeric" min={0} value={openingFloat} onChange={(e) => setOpeningFloat(e.target.value)} className="tabular" />}
          </Field>
          <Button type="submit" className="h-11 sm:h-10" loading={pending}>
            Ouvrir la caisse
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}

function SessionCard({
  storeId,
  session,
  currency,
  queueCount,
  blockedCount,
  blockedAmount,
  deviceId,
  onClosed,
}: {
  storeId: string;
  session: { id: string; openingFloat: number; openedAt: string };
  currency: string;
  queueCount: number;
  blockedCount: number;
  blockedAmount: number;
  deviceId: string | null;
  onClosed: () => void;
}) {
  const [closeState, closeAction] = useActionState(closePosSession, undefined);
  const [moveState, moveAction] = useActionState(addPosCashMovement, undefined);
  const [seen, setSeen] = useState(closeState);
  if (closeState !== seen) {
    setSeen(closeState);
    if (closeState?.ok) onClosed();
  }
  return (
    <Card>
      <CardHeader title="Session de caisse" description={`Ouverte avec ${formatMoney(session.openingFloat, currency)}.`} />
      <CardBody className="space-y-4">
        <form action={moveAction} noValidate className="space-y-2">
          <FormMessage state={moveState} />
          <input type="hidden" name="storeId" value={storeId} />
          <input type="hidden" name="sessionId" value={session.id} />
          <div className="grid grid-cols-2 gap-2">
            <Field id="movekind" label="Mouvement">
              {(p) => (
                <Select {...p} name="kind" defaultValue="out">
                  <option value="in">Entrée d&apos;espèces</option>
                  <option value="out">Sortie d&apos;espèces</option>
                </Select>
              )}
            </Field>
            <Field id="moveamount" label="Montant">{(p) => <Input {...p} name="amount" type="number" inputMode="numeric" min={1} className="tabular" />}</Field>
          </div>
          <Field id="movereason" label="Motif" error={fieldError(moveState, "reason")}>{(p) => <Input {...p} name="reason" maxLength={120} placeholder="Achat de sachets" />}</Field>
          <SubmitButton variant="secondary" className="w-full">
            Enregistrer le mouvement
          </SubmitButton>
        </form>

        <form action={closeAction} noValidate className="space-y-2 border-t border-line pt-4">
          <FormMessage state={closeState} />
          <input type="hidden" name="storeId" value={storeId} />
          <input type="hidden" name="sessionId" value={session.id} />
          {/* Contrôlés par le serveur : la session doit appartenir à CET appareil et sa file doit être vide. */}
          {deviceId && <input type="hidden" name="deviceId" value={deviceId} />}
          <input type="hidden" name="pendingSales" value={queueCount} />
          <input type="hidden" name="blockedSales" value={blockedCount} />
          <input type="hidden" name="blockedAmount" value={blockedAmount} />
          <Field
            id="counted"
            label="Espèces comptées"
            required
            error={fieldError(closeState, "countedCash")}
            hint="Le rapport Z compare ce montant aux espèces attendues (fond + encaissements espèces − remboursements espèces − sorties + entrées)."
          >
            {(p) => <Input {...p} name="countedCash" type="number" inputMode="numeric" min={0} className="tabular" />}
          </Field>
          <p className="text-xs text-ink-muted">
            Les remboursements en espèces rattachés aux ventes de cette session sont déduits automatiquement. Tout autre
            décaissement (remboursement d&apos;une vente d&apos;une autre session, dépense) doit être saisi en « Sortie
            d&apos;espèces » pour que l&apos;écart de caisse reste juste.
          </p>
          {queueCount > 0 && <p className="text-sm text-warning">Synchronisez d&apos;abord les {queueCount} vente(s) en attente avant de fermer la caisse.</p>}
          {blockedCount > 0 && (
            <div className="space-y-2 rounded-[var(--radius-md)] bg-danger/5 p-3 ring-1 ring-inset ring-danger/30">
              <p className="text-sm text-danger">
                {blockedCount} vente(s) encaissée(s) pour {formatMoney(blockedAmount, currency)} attendent une régularisation (argent en caisse, sans commande).
              </p>
              <label className="flex min-h-11 items-start gap-2 text-sm text-ink">
                <input type="checkbox" name="acknowledgeBlocked" className="mt-1 size-4 accent-[var(--c-primary,currentColor)]" />
                <span>Je ferme quand même : ces ventes seront inscrites au rapport Z et devront être régularisées.</span>
              </label>
            </div>
          )}
          <SubmitButton variant="primary" className="w-full" disabled={queueCount > 0}>
            Fermer la caisse
          </SubmitButton>
        </form>
      </CardBody>
    </Card>
  );
}

function Receipt({ sale, currency, storeName }: { sale: { reference: string | null; total: number; change: number; lines: CartLine[]; offline: boolean }; currency: string; storeName: string }) {
  return (
    <Card>
      {/* Impression : n'imprime que le ticket (`.receipt`), pas toute la page de caisse. */}
      <style
        dangerouslySetInnerHTML={{
          __html: `@media print {
  body * { visibility: hidden !important; }
  .receipt, .receipt * { visibility: visible !important; }
  .receipt { position: fixed; left: 50%; top: 0; transform: translateX(-50%); margin: 0 !important; padding: 0 !important; box-shadow: none !important; }
  @page { margin: 10mm; }
}`,
        }}
      />
      <CardHeader
        title="Dernier reçu"
        description={sale.offline ? "Vente hors ligne : le reçu est provisoire jusqu'à la synchronisation." : `Vente ${sale.reference}`}
        action={
          <Button variant="secondary" size="sm" onClick={() => window.print()}>
            <Printer className="size-4" aria-hidden /> Imprimer
          </Button>
        }
      />
      <CardBody>
        <div className="receipt mx-auto max-w-[280px] bg-white p-3 text-black">
          <p className="text-center text-[13px] font-semibold">{storeName}</p>
          <p className="text-center text-[11px]">{sale.reference ? `Reçu ${sale.reference}` : "Reçu provisoire"}</p>
          <ul className="my-2 border-y border-black/20 py-2 text-[11px]">
            {sale.lines.map((line) => (
              <li key={line.key} className="flex justify-between gap-2">
                <span className="truncate">
                  {line.quantity} × {line.item.name}
                </span>
                <span className="tabular">{formatMoney(line.item.price * line.quantity, currency)}</span>
              </li>
            ))}
          </ul>
          <p className="flex justify-between text-[12px] font-semibold">
            <span>Total</span>
            <span className="tabular">{formatMoney(sale.total, currency)}</span>
          </p>
          {sale.change > 0 && (
            <p className="flex justify-between text-[11px]">
              <span>Rendu</span>
              <span className="tabular">{formatMoney(sale.change, currency)}</span>
            </p>
          )}
          <p className="mt-2 text-center text-[10px]">Merci de votre visite</p>
        </div>
      </CardBody>
    </Card>
  );
}
