/**
 * Abstraction des passerelles de paiement (ventes des boutiques).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │  POINT D'INTÉGRATION LAISSÉ AU PORTEUR                                   │
 * │  Les adaptateurs fedapay / kkiapay / paydunya / stripe (gateways.ts)     │
 * │  définissent le contrat et la vérification de signature ; les appels     │
 * │  HTTP réels doivent être complétés avec les clés et la doc du fournisseur│
 * │  Lot 1 bis : paystack / pawapay / cinetpay (adapters/*.ts) sont complets│
 * │  (doc officielle) ; il reste à les valider en sandbox avec de vraies clés│
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Invariants (cahier des charges §9) :
 *  - un paiement n'est « confirmé » qu'après vérification côté serveur (webhook signé ou API de statut) ;
 *  - jamais déduit d'une redirection navigateur ;
 *  - webhooks idempotents (ProviderEvent unique par (provider, eventId)) et tolérants au désordre ;
 *  - `eventId` globalement unique (il embarque une référence propre à la tentative) : deux boutiques
 *    ne peuvent jamais se « voler » un événement par collision d'identifiant.
 */

export type GatewayId = "fedapay" | "kkiapay" | "paydunya" | "stripe" | "paystack" | "pawapay" | "cinetpay";

export type GatewayStatus = "CONFIRMED" | "FAILED" | "PENDING" | "EXPIRED";

export type InitiateInput = {
  attemptId: string;
  orderReference: string;
  amount: number;
  currency: string;
  customer: { name: string; phone: string; email?: string | null };
  returnUrl: string;
  cancelUrl: string;
  callbackUrl: string;
  description: string;
  /** Lot 1 bis : pays de la boutique (ISO 3166-1 alpha-2). */
  country?: string | null;
  /** Lot 1 bis : portefeuilles autorisés par le marchand (PaymentMethod.channels) ; vide = tous. */
  channels?: string[];
  /** Lot 1 bis : portefeuille choisi par le client (PaymentAttempt.channel), s'il est connu. */
  channel?: string | null;
  /** Lot 1 bis : numéro à débiter (E.164 sans « + ») pour une demande poussée sur le téléphone. */
  payerPhone?: string | null;
};

export type InitiateResult =
  | {
      ok: true;
      /** URL où envoyer le client : page du fournisseur, ou `returnUrl` après une demande poussée (USSD). */
      redirectUrl: string;
      providerRef: string;
      /** Données non sensibles à conserver sur la tentative (ex. empreinte du jeton de notification). */
      metadata?: Record<string, string>;
      /** true : demande de paiement poussée sur le téléphone du client, aucune page fournisseur. */
      pushed?: boolean;
    }
  | { ok: false; error: string };

export type WebhookVerification =
  | { ok: true; eventId: string; type: string; providerRef: string; status: GatewayStatus; amount?: number; currency?: string; raw: unknown }
  | { ok: false; error: string };

/** Contexte de la tentative retrouvée côté serveur (jamais issu du corps non vérifié). */
export type WebhookContext = {
  attemptId: string;
  providerRef: string | null;
  amount: number;
  currency: string;
  metadata: Record<string, unknown> | null;
};

export type StatusContext = {
  /** Date d'initiation (ou de dernière mise à jour) de la tentative : sert à expirer les sessions abandonnées. */
  initiatedAt?: Date | null;
};

export type GatewayCredentials = Record<string, string>;

export type CredentialField = {
  key: string;
  label: string;
  secret: boolean;
  /** Champ facultatif (non exigé à l'enregistrement). */
  optional?: boolean;
  /** Liste de valeurs autorisées (rendue en liste déroulante). */
  options?: { value: string; label: string }[];
  placeholder?: string;
  hint?: string;
};

export type RefundInput = { providerRef: string; amount: number; currency: string; refundId: string; reason?: string | null };
export type RefundResult = { ok: true; providerRefundRef: string; status: "PENDING" | "DONE" } | { ok: false; error: string };

export type ConnectionTest = { ok: true; message: string; warnings?: string[] } | { ok: false; error: string };

export interface PaymentGateway {
  id: GatewayId;
  label: string;
  /** Champs de configuration demandés au marchand (clés). */
  credentialFields: CredentialField[];
  supportedCurrencies: string[];
  supportedCountries: string[];
  /** Lot 1 bis : portefeuilles proposés par pays (wave, orange_money, mtn_momo, moov_money, card). */
  channelsByCountry?: Record<string, string[]>;
  /** Lien vers la documentation officielle du fournisseur (affiché au marchand). */
  docsUrl?: string;
  initiate(input: InitiateInput, creds: GatewayCredentials): Promise<InitiateResult>;
  verifyWebhook(rawBody: string, headers: Headers, creds: GatewayCredentials, ctx?: WebhookContext): Promise<WebhookVerification>;
  /** Vérification active du statut (rapprochement quotidien, webhooks manqués). */
  fetchStatus(providerRef: string, creds: GatewayCredentials, ctx?: StatusContext): Promise<GatewayStatus | "UNKNOWN">;
  /**
   * Références lues dans le corps du webhook AVANT vérification, pour retrouver la tentative
   * (et donc les clés de la boutique). Jamais une preuve : la vérification suit.
   */
  extractWebhookRefs?(payload: unknown): { attemptId?: string | null; providerRef?: string | null };
  /** Remboursement chez le fournisseur, si son API le permet. */
  refund?(input: RefundInput, creds: GatewayCredentials): Promise<RefundResult>;
  /** Test de connexion avec les clés saisies (aucun débit). */
  testConnection?(creds: GatewayCredentials): Promise<ConnectionTest>;
  /** Mode lisible (« Test » / « Production ») déduit des identifiants, sans rien révéler. */
  modeOf?(creds: GatewayCredentials): "test" | "live" | null;
}
