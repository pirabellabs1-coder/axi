# Axi : décisions produit et business

Document d'arbitrage dérivé du *Cahier des charges V3, Commerce intelligent* (9 oct. 2026), mis à jour pour la **V4** : tarifs en euros avec bascule FCFA, 5 plans, 10 options, crédits.
Les « décisions ouvertes » du cahier sont tranchées ici. Le catalogue (plans, zones, options, crédits)
vit dans `src/config/plans.ts` : source unique, lue par le site, l'espace marchand et l'admin.

## 1. Identité

| Élément | Décision |
|---|---|
| Nom | **Axi** |
| Promesse | Votre boutique WhatsApp, prête en 5 minutes. |
| Domaine (suggestion) | `axi.africa` (à acheter par le porteur) ; boutiques sur `{slug}.axi.africa` ou `/s/{slug}` en attendant |
| Marché de lancement | Bénin (XOF / FCFA), puis Togo, Côte d'Ivoire, Sénégal, Cameroun (XAF) |
| Langue | Français (interface et boutiques). Architecture i18n prête (`locale` sur store et user). |

## 2. Espaces de la plateforme

1. **Site vitrine** (`/`, `/tarifs`, `/fonctionnalites`, `/marketplace`, `/aide`, `/a-propos`, `/contact`, `/legal/*`).
2. **Marketplace** (`/marketplace`) : annuaire public des boutiques publiées (recherche, catégorie, ville, pays, boutiques en vedette). Pas de panier global : la marketplace renvoie vers chaque boutique. Opt-in du marchand (`listedInMarketplace`).
3. **Espace client (marchand)** (`/app/...`) : onboarding, tableau de bord, produits, commandes, clients, coupons, livraison, WhatsApp, paiements, apparence, équipe, abonnement, paramètres.
4. **Boutique publique** (`/s/{slug}` ou sous-domaine) : catalogue, fiche produit, panier, checkout invité, confirmation, suivi par lien signé.
5. **Espace acheteur léger** (`/suivi/{token}`) : suivi de commande sans compte (lien à durée limitée).
6. **Administration plateforme** (`/admin`) : voir §8.

## 3. Rôles

`OWNER`, `MANAGER`, `STAFF` (préparateur/livreur), `SUPPORT` (accès temporaire audité), `PLATFORM_ADMIN` (flag utilisateur). Permissions vérifiées côté serveur sur chaque action (`src/lib/auth/permissions.ts`).

## 4. Plans, zones et tarifs V4 (décision)

Encaissement des ventes : **direct par le marchand** (Mobile Money, espèces, virement, ou passerelle connectée avec ses propres clés). La plateforme n'encaisse que les abonnements et les options. **0 % de commission sur les ventes**, sur tous les plans.

### 4.1 Deux zones de prix

| Zone | Boutiques concernées | Devise de facturation | Unité des montants |
|---|---|---|---|
| **Monde** (`WORLD`) | toute devise hors XOF et XAF (EUR, USD, GNF...) | EUR | centimes d'euro |
| **Afrique francophone** (`AFRICA`) | boutiques en XOF ou XAF | XOF (FCFA) | unités entières |

La zone est déduite de la devise de la boutique (`zoneForCurrency`) et figée sur l'abonnement (`Subscription.zone`, `Subscription.currency`). L'admin peut la changer depuis la fiche boutique (motif obligatoire, audité) : seules les factures suivantes sont concernées. Le site affiche les prix en euros avec une bascule FCFA.

### 4.2 Plans

| Plan | Pour qui | Monde, par mois | Afrique, par mois | Points clés |
|---|---|---|---|---|
| **Gratuit** | tester | 0 € | 0 FCFA | 15 produits, 20 commandes par mois, lien WhatsApp, paiement manuel, logo Axi |
| **Starter** | vendeur seul | 9 € | 5 000 FCFA | commandes illimitées, 200 produits, Mobile Money et carte, stock, coupons, créneaux |
| **Business** (recommandé) | boutique qui grandit | 29 € | 15 000 FCFA | produits illimités, 3 membres, domaine, WhatsApp officiel et boîte partagée (300 messages), entonnoir, campagnes, fidélité, avis, 50 crédits IA |
| **Scale** | marque multicanal | 79 € | 45 000 FCFA | 3 boutiques, 10 membres, automatisations illimitées, paniers abandonnés, 1 500 messages, 500 crédits IA, rôles, audit, API, caisse |
| **Enterprise** | agences, franchises | dès 199 € | dès 130 000 FCFA | illimité, revendeurs, SLA, gestionnaire dédié. **Sur devis**, jamais en libre-service |

- **Annuel : 10 mois payés pour 12** (`YEARLY_MONTHS_PAID`).
- **Essai** : 14 jours de Business à l'inscription, sans carte. À la fin : retour sur Gratuit, sans perte de données (les produits au-delà de la limite passent en brouillon, jamais supprimés).
- **Changement de plan** : montée effective dès le paiement de la facture (l'essai et le plan actuel restent actifs en attendant), avec crédit au prorata du temps restant (arrondi à l'unité inférieure, `prorationCredit`) ; descente en fin de période.
- **Renouvellement** : pas de prélèvement automatique en Mobile Money. Une facture de renouvellement est émise 3 jours avant l'échéance (`RENEWAL_LINK_DAYS_BEFORE`). Impayé : `PAST_DUE` à l'échéance, `SUSPENDED` après 7 jours de grâce (fonctions payantes coupées, données conservées).

### 4.3 Options payantes

| Option | Facturation | Monde | Afrique | Plans |
|---|---|---|---|---|
| Membre d'équipe en plus | mensuelle | 5 € | 2 000 FCFA | Business, Scale |
| Numéro WhatsApp en plus | mensuelle | 12 € | 6 000 FCFA | Business, Scale |
| Boutique en plus | mensuelle | 9 € | 4 000 FCFA | Business, Scale |
| 500 messages WhatsApp utilitaires | pack | 9 € | 5 000 FCFA | Business, Scale, Enterprise |
| 200 messages WhatsApp marketing | pack | 15 € | 8 000 FCFA | Business, Scale, Enterprise |
| 1 000 crédits IA | pack | 9 € | 5 000 FCFA | Business, Scale |
| Stockage +10 Go | mensuelle | 4 € | 2 000 FCFA | plans payants |
| Nom de domaine | annuelle | 15 € | 9 000 FCFA | Business, Scale, Enterprise |
| Modèle de boutique par secteur | une fois | 29 € | 15 000 FCFA | tous |
| Création clé en main | une fois | 99 € | 50 000 FCFA | tous |

Achat : `AddOnPurchase` en `PENDING` et une facture. **L'option s'active quand la facture est payée** (`activateAddOnPurchase`, appelée par `confirmInvoicePayment` depuis un webhook signé ou depuis l'admin). Les options ponctuelles et le nom de domaine ouvrent un ticket pour l'équipe Axi.

### 4.4 Crédits

Trois portefeuilles par boutique : messages WhatsApp utilitaires, messages WhatsApp marketing, crédits IA. Grand livre en ajout seul (`CreditLedger`) :

- crédits **inclus du plan** : dotation mensuelle non cumulable (expire le 1er du mois suivant) ;
- **packs** : valables 12 mois ;
- **gestes commerciaux** (ajustement admin) : sans échéance, motif obligatoire, audités ;
- consommation FIFO (le lot qui expire le plus tôt d'abord), débitée uniquement quand un message est réellement remis à l'API WhatsApp (jamais pour un lien `wa.me` ou un brouillon), remboursée en cas d'échec ; alertes à 80 % et 100 %.

### 4.5 Ouverture progressive des plans

1. **Pilote (Bénin, Côte d'Ivoire, Sénégal, Togo)** : Gratuit, Starter et Business en libre-service, factures réglées manuellement (Mobile Money sur le numéro de la plateforme, confirmation admin). Packs de crédits ouverts.
2. **API WhatsApp officielle validée par Meta** : Scale en libre-service (automatisations, paniers abandonnés), option numéro WhatsApp en plus.
3. **Paiement en ligne des abonnements** (FedaPay ou KkiaPay en zone Afrique, Stripe en zone Monde) : renouvellement en un clic, la confirmation admin devient l'exception.
4. **Enterprise** : uniquement sur devis, contrat et SLA négociés.

### 4.6 Évolution du catalogue

Aujourd'hui, les prix sont du code versionné (`src/config/plans.ts`), affichés en lecture seule dans `/admin/tarifs`. Évolution prévue : une table de tarifs en base (plan, zone, période, montant, date d'effet) éditable depuis l'admin, avec **prix figés par abonnement** (un client existant garde son tarif jusqu'à son prochain changement de plan) et historique des grilles.

## 5. Paiements boutique (ventes)

Méthodes disponibles dès P0, activables par boutique :
- **Paiement à la livraison / au retrait** (espèces), statut « à encaisser ».
- **Mobile Money manuel** (MTN MoMo, Moov Money, Celtiis…) : le marchand affiche son numéro, le client envoie, puis saisit la référence de transaction ; le marchand confirme manuellement. Jamais assimilé à « payé vérifié » tant qu'il n'y a pas de confirmation.
- **Virement bancaire manuel** (même logique).
- **Passerelle en ligne** (FedaPay, KkiaPay, PayDunya, Stripe) : adaptateurs `src/lib/payments/providers/*` avec vérification de signature de webhook, idempotence et machine d'états `PaymentAttempt`. Les clés sont saisies par le marchand (ou la plateforme) dans *Paiements*. **Les implémentations HTTP réelles sont le point d'intégration laissé au porteur** ; la structure, les statuts, les webhooks et le rapprochement sont en place.

## 6. WhatsApp

- P0 : bouton « Commander sur WhatsApp » → panier enregistré côté serveur → message `wa.me` prérempli avec référence et récapitulatif. Le clic est journalisé comme *tentative*, jamais comme envoi.
- P1 : intégration API officielle (Meta Cloud API) : structure `Integration` + webhooks signés + modèles ; l'activation réelle nécessite un numéro et un compte Meta Business (porteur).
- P1 bis — **mode partenaire (Embedded Signup)** : Axi comme fournisseur de technologies Meta. Le marchand connecte son numéro en quelques clics (*WhatsApp › Connexion partenaire*), sans recopier d'identifiant : Axi échange le code OAuth, s'abonne à la WABA et enregistre le numéro au nom du client (`src/lib/whatsapp/embedded-signup.ts`). La saisie manuelle des identifiants reste disponible (avancé). Branché par variables d'environnement ; prérequis Meta (vérification d'entreprise, revue « fournisseur de technologies », ligne de crédit partagée) côté porteur. Détail : `docs/DEPLOIEMENT.md` §7.3 ter.

## 7. Périmètre livré dans ce dépôt

P0 complet, fondations P1 et socle V4 : plans et zones, options et crédits, boîte WhatsApp partagée et entonnoir, campagnes, avis, fidélité, modèles par secteur, marketplace. P2 (API publique complète, caisse, logistique partenaires) : prévu dans le modèle, partiellement implémenté. Assistant IA de rédaction derrière un garde-fou (désactivé sans clé).

## 8. Administration plateforme (`/admin`)

| Écran | Rôle |
|---|---|
| Vue d'ensemble | MRR consolidé en euros (abonnements valorisés au tarif Monde, options récurrentes incluses), MRR facturé en FCFA et en EUR séparément, clients payants par plan, revenus des options sur 30 jours, crédits consommés du mois, conversion essai vers payant, points à traiter |
| Catalogue des prix | plans, zones, limites, options et règles de facturation, lus depuis `src/config/plans.ts` |
| Abonnements et factures | filtres par statut et par plan, « Marquer payée » (abonnement activé, ou option activée si la facture est liée à un achat d'option), annulation, statut d'abonnement |
| Options vendues | achats par boutique, facture liée, activation |
| Portefeuilles de crédits | soldes par boutique, consommation du mois, ajustement motivé et audité |
| Boutiques | fiche complète : zone tarifaire (changement motivé), crédits, options, suspension motivée, vedette, marketplace, accès support temporaire |
| Utilisateurs, paiements des ventes, tickets, tâches, journal d'audit | exploitation |

Conversion essai vers payant : part des boutiques de plus de 14 jours (essai terminé) qui ont un abonnement payant actif. C'est une approximation tant que l'historique des essais n'est pas modélisé.

Chaque action admin est vérifiée côté serveur (`isPlatformAdmin`) et journalisée avec le préfixe `admin.`.
