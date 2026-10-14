# Rapport d'audit et de préparation au lancement — Axi

Date : nuit du 13 au 14 octobre 2026 · Préproduction : https://16-192-144-250.nip.io/ (AWS EC2 + RDS, eu-north-1)

Légende des statuts : **✅ Corrigé et testé** · **🟢 Testé et réussi** · **🟡 Corrigé, non testé en conditions réelles** · **⚪ Non vérifié** · **🔜 À faire ultérieurement**

---

## 1. Architecture réelle découverte

- **Un seul déployable Next.js 16** (App Router, RSC + Server Actions, React 19, TypeScript strict), **PostgreSQL** via Prisma (~114 modèles), Tailwind v4, Zod 4. Pas de Redis : caches mémoire par instance.
- **Routage** : `src/proxy.ts` (sous-domaine → `/s/{slug}`, domaines personnalisés, segment de langue), groupes `(marketing)`, `(auth)`, `app/[storeId]` (marchand), `admin` (plateforme), `s/[slug]` (vitrine), `caisse` (POS), `api/*` (webhooks, jobs, REST v1, MCP, médias, santé).
- **Multi-tenant** : isolation par `storeId`, passage obligé `requireStore(storeId, capability)` (`src/lib/auth/permissions.ts:143`), aucun accès admin implicite.
- **Paiements** : `src/lib/payments/service.ts` + adaptateurs (FedaPay, KkiaPay, PayDunya, Stripe, Paystack, pawaPay, CinetPay) ; webhooks HMAC à temps constant, idempotence `ProviderEvent (provider, eventId)`, relecture serveur du statut.
- **Abonnements/quotas** : `src/config/plans.ts`, `src/lib/billing/*`, `src/lib/credits.ts` (grand livre de crédits sous verrou), `src/lib/commerce/quotas.ts`.
- **Tâches** : outbox `Job` (`src/lib/jobs.ts`) traitée par le worker PM2 `axi-jobs` ; tâches planifiées (billing, campagnes, crédits mensuels, balayages) par `GET /api/jobs/run`.
- **Hors-ligne** : caisse uniquement (`src/app/caisse/*`, service worker dédié, IndexedDB, idempotence serveur).
- **Intégrations** : WhatsApp Cloud (`src/lib/whatsapp/*`), catalogue Meta (`src/lib/social/*`), IA Claude (`src/lib/ai/*`), MCP + OAuth + API REST + webhooks sortants.
- **Hébergement actuel** : EC2 t3.small (Ubuntu, PM2 : `axi` + `axi-jobs`, Caddy HTTPS) + RDS PostgreSQL 18 privé. Vercel reste en ligne en parallèle.

## 2. Fonctionnalités confirmées dans le code

Boutique + éditeur à sections, catalogue/variantes/collections/stock multi-dépôts, import/export CSV, commandes, clients, paiements (manuel, COD, agrégateurs, carte), livraison/zones/livreurs, WhatsApp (liens + API Cloud, boîte partagée), CRM/fidélité/campagnes/paniers abandonnés, marketplace, abonnements/quotas, multi-devises/TVA/factures, IA (descriptions, traduction, génération de boutique), MCP/OAuth/REST/webhooks, **caisse en magasin avec mode hors connexion**, multilingue (`/langues`, i18n vitrine), cartes cadeaux, retours, produits numériques, App Store (phase A).

Absentes (et correctement marquées « Bientôt ») : **messages Instagram/Facebook dans la boîte**, **réponses automatiques autonomes** (robot).

## 3. Incohérences détectées entre pages publiques et application

| Incohérence | Statut |
|---|---|
| Caisse annoncée « Bientôt » + forfait **Scale**, alors que livrée et ouverte dès **Business** (`posDevices: 1`) | ✅ Corrigé (`positioning.ts`) |
| Grille tarifaire « Caisse » calculée sur `features.pos` (Scale) au lieu du droit serveur `limits.posDevices` | ✅ Corrigé (`plans.ts`, affiche « 1 appareil » / « 5 appareils » / « Illimité ») |
| Canal « En personne » : « caisse en magasin (bientôt) » | ✅ Corrigé |
| Boutique multilingue « Bientôt » alors que livrée (2 langues Business, 5 Scale) | ✅ Corrigé |
| Pack IA promettant des « réponses automatiques » non livrées | ✅ Corrigé (→ « suggestions de réponses », désormais réelles) |
| Accueil trop centré « Afrique francophone » pour le positionnement international | ✅ Corrigé (hero, bande de confiance, différenciateurs) |
| Statuts de disponibilité dispersés (marketing / badges « Nouveau » / plans) | 🔜 Centralisation recommandée ; garde-fou ajouté : test de non-régression `tests/marketing-consistency.test.ts` |

## 4. Problèmes corrigés

### Sécurité
- ✅ **Webhook WhatsApp** : refuse un `WHATSAPP_APP_SECRET` absent **ou resté sur une valeur d'exemple** (signature sinon forgeable) — `src/app/api/webhooks/whatsapp/route.ts`.
- ✅ **MFA marchand activable** : section « Double authentification » dans *Mon compte* (TOTP, codes de secours, révocation des autres sessions) — `src/lib/auth/mfa-actions.ts`, `src/app/app/compte/page.tsx`, `src/components/admin/mfa-panel.tsx` (désormais réutilisable). La connexion exigeait déjà le second facteur dès qu'il est actif.

### Paiements
- ✅ **Écart montant/devise d'un webhook** : n'est plus silencieux — la commande reste non payée (sécurité), mais le marchand reçoit une **notification + un événement de commande + une entrée d'audit** pour vérifier et confirmer manuellement — `src/lib/payments/service.ts` (`flagAmountMismatch`, idempotent par événement).

### Caisse et hors-ligne
- ✅ **(Élevé)** Le code gérant était vérifié **avant** l'idempotence : quelques rejeux d'une vente pouvaient **bloquer 15 min** tout dépassement de remise de la boutique. Ordre corrigé — `src/lib/pos/service.ts`.
- ✅ Deux envois concurrents de la même vente : collision traitée comme **doublon** au lieu d'un 500 qui coupait le lot — `src/lib/pos/service.ts`.
- ✅ La synchronisation en erreur **ne ressuscite plus** des ventes déjà acceptées par le serveur — `src/app/caisse/[storeId]/caisse-client.tsx`.
- ✅ **Clôture avec ventes « à régulariser »** : exige une **confirmation explicite** et inscrit nombre + montant au **rapport Z** (plus d'écart de caisse trompeur) — `src/lib/pos/session.ts`, `src/lib/pos/actions.ts`, écran de caisse.

### Fiabilité
- ✅ **Places d'équipe** : verrou par boutique, deux invitations simultanées ne dépassent plus la limite — `src/lib/team/actions.ts`.
- ✅ **Fidélité** : un échec d'attribution/retrait de points après livraison/annulation est **relancé par la file de jobs** (handlers idempotents) au lieu d'être perdu — `src/lib/commerce/orders.ts`, job `loyalty.sync` dans `src/lib/jobs.ts`.
- ✅ **Tâches planifiées** : le worker PM2 ne lançait ni facturation, ni campagnes, ni crédits mensuels, ni balayages. **Cron système installé sur l'EC2** (`/etc/cron.d/axi-jobs`, toutes les 5 min, clé lue dans le `.env` serveur).
- ✅ **Observabilité** : `/api/health` expose l'état de la file (en attente, morts, retard du plus ancien job dû) et passe en `degraded` si le worker est bloqué > 15 min.
- ✅ **Tableau de bord** : alerte « commandes livrées mais non encaissées » (paiement à la livraison oublié).

### Expérience et produit
- ✅ **Marketplace** : un produit actif **en rupture** est affiché « **Épuisé** » (au lieu d'être présenté comme achetable).
- ✅ **Conversations** : mise en page resserrée (bulles 480 px max, moins d'espace haut/bords), **envoi d'images** (migration `message_attachment`), **« Suggérer (IA) »** : l'IA rédige une réponse à partir de la conversation et du catalogue réel, le marchand relit et envoie (1 crédit IA, remboursé en cas d'échec, jamais d'envoi ni d'action automatique).
- ✅ **Envoi WhatsApp immédiat** à la réponse (plus d'attente du worker) ; **envoi sortant WhatsApp implémenté** (auparavant marqué « canal non activé »).
- ✅ **Onboarding** : encart « Créez votre boutique en 2 minutes avec l'IA » en tête du démarrage.
- ✅ **Tableau de bord** : filtres « Aujourd'hui » et **plage personnalisée (calendrier)**, borne haute de période corrigée.
- ✅ **Impression du reçu de caisse** : n'imprime plus que le ticket.

## 5. Fichiers et migrations modifiés (cette phase)

Migrations : `prisma/migrations/20261013220000_message_attachment` (2 colonnes nullables sur `Message`, additive, appliquée sur RDS).

Code : `src/lib/pos/service.ts`, `src/lib/pos/session.ts`, `src/lib/pos/actions.ts`, `src/app/caisse/[storeId]/caisse-client.tsx`, `src/lib/payments/service.ts`, `src/app/api/webhooks/whatsapp/route.ts`, `src/lib/team/actions.ts`, `src/lib/commerce/orders.ts`, `src/lib/jobs.ts`, `src/app/api/health/route.ts`, `src/lib/marketplace/{data,types}.ts`, `src/components/marketplace/product-card.tsx`, `src/lib/auth/mfa-actions.ts` (nouveau), `src/components/admin/mfa-panel.tsx`, `src/app/app/compte/page.tsx`, `src/lib/inbox/{ai-reply (nouveau),actions,service}.ts`, `src/components/inbox/{composer,message-list}.tsx`, `src/lib/whatsapp/send.ts`, `src/config/plans.ts`, `src/lib/marketing/positioning.ts`, `src/app/(marketing)/page.tsx`, `src/app/app/[storeId]/{page,demarrage/page,caisse/page,conversations/page,date-range-filter}.tsx`, `next.config.ts`, `tsconfig.build.json`, `prisma/schema.prisma`.
Tests : `tests/marketing-consistency.test.ts` (nouveau, 5 tests).

## 6. Tests exécutés et résultats réels

| Vérification | Résultat |
|---|---|
| `pnpm typecheck` (tsc strict, projet complet) | 🟢 0 erreur |
| `pnpm test` (Vitest) | 🟢 **179 fichiers / 2 372 tests passés**, 14 ignorés (préexistants), 0 échec |
| `pnpm lint` (ESLint) | 🟢 0 erreur, 41 avertissements **préexistants** (aucun dans les fichiers modifiés) |
| Build de production | 🟢 sur l'EC2 (voir §10) |
| Migrations | 🟢 appliquées sur RDS (`prisma migrate deploy`) |
| Tests end-to-end Playwright (17 suites) | ⚪ **Non exécutés** : ils créent des données et ne doivent pas tourner sur la préproduction partagée ; à lancer sur une base isolée (`pnpm db:local` + `pnpm e2e`) |
| Paiements réels, WhatsApp sortant/images, e-mails, stockage d'images, IA | ⚪ **Non testables sans les clés** (voir §7) |

## 7. Problèmes restant ouverts (raccordements externes — nécessitent tes clés)

1. **Paiements** : valider chaque agrégateur en **sandbox puis en réel** (Paystack, CinetPay, pawaPay, FedaPay…) — risque n°1 du lancement.
2. **WhatsApp** : jeton **système permanent** (le jeton de test a expiré), vérification business Pirabel Labs, numéro de production, re-pointer le webhook Meta vers l'URL AWS définitive. Sur AWS l'intégration de test est en « entrant seulement ».
3. **E-mails (Resend)** : inscription/vérification, confirmations de commande.
4. **Stockage des images (Cloudflare R2)** : sans lui, l'envoi de photos produits/messages est refusé en production.
5. **Clé Anthropic** en production : active l'assistant IA (descriptions, suggestions de réponses).
6. **Domaine** (ex. `app.pirabellabs.com`) : remplacer l'adresse temporaire `nip.io`, puis rebuild avec la nouvelle `NEXT_PUBLIC_APP_URL`.

## 8. Améliorations recommandées (classées)

| Priorité | Amélioration | Problème résolu | Coût | Statut |
|---|---|---|---|---|
| P1 | Supervision externe de `/api/health` (UptimeRobot/Better Uptime) | Panne worker/base détectée avant les clients | Très faible | 🔜 (la sonde est prête) |
| P1 | Sauvegardes RDS > 1 jour + test de restauration | L'offre gratuite limite à 1 jour | Faible (passage de plan AWS) | 🔜 décision porteur |
| P1 | Rate-limit L7 devant l'app (Caddy/ALB) | Volumétrie login/OTP | Faible | 🔜 |
| P2 | Diagnostic de boutique « prête à vendre » (checklist étendue) | Activation jusqu'à la 1re vente | Moyen | 🔜 (checklist de démarrage existante + encart IA) |
| P2 | Suivi des événements produit (activation, conversion, rétention) | Pilotage | Moyen | 🔜 |
| P2 | Agent IA palier 2 : réponses automatiques encadrées (option payante) | Service client 24/7 | Élevé | 🔜 (palier 1 « suggestion » livré) |
| P3 | Centraliser les statuts de disponibilité | Divergences public/app | Moyen | 🔜 (test garde-fou en place) |
| P3 | Traçage d'erreurs (Sentry) | Diagnostic sans exposer de données | Faible + compte externe | 🔜 |
| P3 | CSP à nonce, sessions admin plus courtes, `pnpm audit` en CI | Défense en profondeur | Moyen | 🔜 |

## 9. Risques sécurité et fiabilité avant ouverture publique

- **Sécurité** : audit défensif — **0 faille bloquante, 0 majeure**. Restent des durcissements de défense en profondeur (CSP `unsafe-inline`, contrôle d'origine des uploads quand `Sec-Fetch-Site` est absent, sessions de 30 jours).
- **Fiabilité** : instance EC2 unique (point de défaillance), worker unique (désormais supervisable via `/api/health`), sauvegardes RDS 1 jour, intégrations externes non validées en réel.
- **Code gérant de caisse** stocké sur l'appareil jusqu'à la synchronisation (nécessaire au rejeu) : ne pas partager la tablette, changer le code régulièrement.

## 10. Checklist de préparation au lancement

- [x] Typecheck, tests unitaires, lint au vert
- [x] Build de production et déploiement AWS
- [x] Migrations appliquées
- [x] Incohérences marketing ↔ produit corrigées (+ test de non-régression)
- [x] Correctifs sécurité/caisse/paiements/fiabilité de l'audit appliqués
- [x] Tâches planifiées actives (cron) et santé enrichie
- [x] MFA disponible pour les marchands
- [ ] Clés de paiement + recette sandbox puis réelle par agrégateur
- [ ] Jeton WhatsApp permanent + vérification business + webhook définitif
- [ ] Resend, R2, clé Anthropic en production
- [ ] Domaine définitif + HTTPS + rebuild
- [ ] Supervision externe de `/api/health`, sauvegardes RDS étendues
- [ ] Recette `docs/RECETTE.md` sur un vrai téléphone Android
- [ ] Tests e2e sur base isolée
- [ ] Relecture juridique des pages légales
- [ ] Couper Vercel une fois AWS validé
