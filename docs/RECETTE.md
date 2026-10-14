# Recette manuelle : Axi

Scénarios de test de bout en bout à dérouler avant chaque mise en production, de préférence sur un
**téléphone Android réel** (Chrome) en plus du navigateur de bureau. Base vierge + `pnpm db:seed`.

Notation : ☐ à cocher · **Attendu** = critère de réussite. Un échec = NO-GO.

## 0. Préparation

- ☐ `.env` complet, base prête (`pnpm db:local` en local, port 5433), `pnpm db:push` puis `pnpm db:seed` (deux fois de suite sans erreur : le seed est idempotent), `pnpm dev` et `pnpm jobs` lancés (ou cron actif).
- ☐ `GET /api/health` → `{"status":"ok","database":"ok"}`.
- ☐ `GET /api/jobs/run` sans clé → 401 ; avec l'en-tête `x-jobs-key` → `{"ok":true}` ; `?key=` → 401.

## 1. Inscription → boutique → produit → publication (marchand)

1. ☐ `/inscription` : créer un compte (nom, e-mail, mot de passe ≥ 8 caractères avec chiffres). **Attendu** : message de vérification, e-mail reçu (console en dev).
2. ☐ Mot de passe faible (`abc`) refusé avec message clair ; e-mail déjà utilisé refusé.
3. ☐ `/verification` : code correct → redirection `/app` ; code faux → erreur sans fuite d'info.
4. ☐ `/app/nouvelle-boutique` : nom, adresse (slug), pays BJ, catégorie Restauration. Slug réservé (`admin`) refusé ; slug existant (`chez-aicha`) refusé. **Attendu** : boutique DRAFT, essai Business 14 j, redirection *Démarrage*.
5. ☐ Démarrage : WhatsApp (`97 00 00 99` → normalisé `22997000099`), horaires, zone de livraison, moyen de paiement MoMo manuel.
6. ☐ Produits : créer un produit avec image (fichier < 300 Ko), prix `4 900`, option « Taille » obligatoire. **Attendu** : prix affiché « 4 900 FCFA », image visible.
7. ☐ Produit avec promo datée (début hier, fin demain) → prix barré sur la boutique ; promo passée → prix normal.
8. ☐ Variantes taille/couleur avec stock suivi (plan essai Business) ; quota Starter : créer 31 produits sur une boutique Starter → message d'upsell au 31e.
9. ☐ Publier la boutique. **Attendu** : statut PUBLISHED, `/s/{slug}` accessible, job `store.published` DONE.
10. ☐ Boutique non publiée : `/s/{slug}` → page « indisponible », pas de catalogue.

## 2. Commande mobile → confirmation → paiement → livraison

Sur téléphone, boutique de démo `/s/dantokpa-mode` (ou la vôtre).

1. ☐ Catalogue : grille 2 colonnes, chips de catégories scrollables, recherche. Pas de défilement horizontal parasite.
2. ☐ Fiche produit : choisir variante M / Bleu ; variante épuisée (M / Orange) grisée ; quantité > stock refusée.
3. ☐ Panier (sheet bas) : modifier quantité, supprimer, coupon `WAX15` → remise 1 500 FCFA ; coupon `FAUX` → message « introuvable » ; `WAX15` sous 10 000 FCFA → « minimum non atteint ».
4. ☐ Checkout : coordonnées (téléphone `0197010203` accepté, `12` refusé), livraison zone « Cotonou, centre » (frais 1 000) ; zone « Fidjrossè » avec panier ≥ 40 000 → livraison offerte ; retrait → créneau.
5. ☐ Paiement : MoMo manuel → instructions affichées, champ référence ; espèces → aucun champ.
6. ☐ Valider → page de confirmation avec référence `AX-…`, total identique au récapitulatif, bouton « Envoyer sur WhatsApp » ouvrant `wa.me/22997000002?text=` avec référence et total.
7. ☐ Double soumission (retour arrière + revalider) → **même commande** (idempotence), pas de doublon.
8. ☐ Lien de suivi `/suivi/{token}` : statut « Nouvelle » ; token modifié → 404.
9. ☐ Côté marchand `/app/{storeId}/commandes` : la commande apparaît (badge Nouvelle), stock de la variante décrémenté, client créé/mis à jour, `UsageCounter` orders +1.
10. ☐ Confirmer → Préparer → Prête → En livraison → Livrée : chaque étape journalisée (`OrderEvent`), suivi acheteur mis à jour, e-mail client (si e-mail saisi) via job `order.status_changed`.
11. ☐ Transition invalide (Nouvelle → Livrée) impossible dans l'UI ; action forcée → erreur.
12. ☐ Paiement MoMo : « Confirmer le paiement » avec note → `PAID`, tentative `CONFIRMED`, événement `payment_changed` ; « Marquer échoué » → `FAILED`.
13. ☐ Annuler une commande NEW avec stock suivi → stock restitué ; annuler après « En livraison » impossible.
14. ☐ Remboursement partiel sur une commande livrée payée → `PARTIALLY_REFUNDED` ; total → `REFUNDED` + statut commande `REFUNDED`.
15. ☐ Export CSV des commandes (Business) ; refusé sur Starter avec upsell.

## 3. Isolation multi-tenant et permissions

1. ☐ Marchand A connecté : ouvrir `/app/{storeId de B}` → redirection `/app` (pas de 500, pas de données B).
2. ☐ Appeler une action de B avec un `storeId` de B depuis l'UI de A (modifier le champ caché) → « Boutique introuvable ou accès refusé ».
3. ☐ Inviter un membre STAFF : il voit Commandes mais pas Produits/Paiements ; URL `/app/{id}/produits` → `?denied=1`.
4. ☐ MANAGER ne peut pas gérer l'équipe ni la facturation ; OWNER seul peut supprimer/archiver.
5. ☐ Invitation expirée/révoquée → page d'erreur claire.
6. ☐ Boutique suspendue par l'admin : marchand voit le bandeau, ne peut plus modifier (actions → « contactez le support »), boutique publique hors ligne ; réactivation → tout revient.
7. ☐ Utilisateur non admin → `/admin` redirige vers `/app` ; non connecté → `/connexion`.
8. ☐ Admin plateforme : **aucun accès implicite** aux boutiques. `/app/{storeId}` d'une boutique dont il n'est pas membre → redirection `/app`. Depuis `/admin/boutiques/{storeId}`, bouton « Accès support » (durée de 1 h à 7 jours, motif obligatoire) : crée une adhésion SUPPORT datée (lecture seule : boutique, commandes, clients), affichée dans l'équipe de la boutique (« Accès support, expire … »), audit `admin.support_access.granted`. À l'expiration, plus aucun accès. Un membre de l'équipe plateforme sans la permission `support.access` (rôle Finance) ne peut ni accorder ni utiliser un accès support ; retirer ses droits d'administration à un utilisateur supprime ses adhésions SUPPORT.
9. ☐ Admin ne peut pas se rétrograder lui-même ; promotion d'un autre utilisateur auditée.
10. ☐ Révocation des sessions d'un utilisateur → il est déconnecté au prochain chargement.
11. ☐ Webhook `/api/webhooks/payments/fedapay` avec signature invalide → 400 + `ProviderEvent` `invalid_signature` dans `/admin/paiements`, aucune commande modifiée.
12. ☐ Token de suivi d'une commande de A utilisé sur le sous-domaine de B → 404.

## 4. Administration (V4)

Connexion `admin@axi.africa` (mot de passe `SEED_ADMIN_PASSWORD`), juste après `pnpm db:seed`.

**Double authentification (MFA) obligatoire** pour l'équipe plateforme (`src/lib/admin/roles.ts`, `adminMfaGate`). Tant
qu'un membre ne l'a pas activée, toute page `/admin` redirige vers `/admin/equipe?mfa=requise#securite` (section
Sécurité) et toute action de la console est refusée avec le message « Activez la double authentification
(Console > Équipe et sécurité) avant toute action d'administration. ». Le compte admin du seed n'a pas de MFA : il faut
donc l'activer au premier passage, ou, **en local uniquement**, définir `ADMIN_MFA_OPTIONAL=1` dans `.env` pour la rendre
facultative. Sur un build de production, cette dérogation n'est honorée que si `NEXT_PUBLIC_APP_URL` pointe sur
`http://localhost` ou `http://127.0.0.1` ; elle ne doit jamais être définie en production.

- ☐ Sans `ADMIN_MFA_OPTIONAL=1` : connexion admin → redirection `/admin/equipe?mfa=requise#securite`, liens de la console ramenés à cette page. « Activer » : saisir la clé (ou le lien de configuration) dans une application TOTP (Google Authenticator, 1Password, Aegis…), entrer le code à 6 chiffres. **Attendu** : badge « Activée », codes de secours affichés une seule fois, console accessible.
- ☐ Déconnexion puis reconnexion : après le mot de passe, `/double-authentification` demande le code à 6 chiffres ; « Utiliser un code de secours » accepte un code `xxxx-xxxx` une seule fois ; code faux refusé.

1. ☐ `/admin` : **Attendu** 9 boutiques publiées, 6 clients payants (Salon Belle Tresse est impayé, Chez Aïcha en essai), MRR consolidé 195,92 € (abonnements 177,67 € et options 18,25 € au tarif Monde), MRR facturé en FCFA 81 667 FCFA et 29,00 € en euros, barres « clients payants par plan » Starter 2, Business 3, Scale 1.
2. ☐ Conversion essai vers payant affichée en % avec « x sur y boutiques de plus de 14 jours » ; crédits consommés du mois non nuls ; revenus des options sur 30 jours en EUR et FCFA séparés (jamais additionnés).
3. ☐ « À traiter » : facture en retard (Salon Belle Tresse), option en attente (pack utilitaire Atelier Beauté Nafi), tickets ouverts.
4. ☐ `/admin/tarifs` : 5 plans, prix Monde et Afrique mensuels et annuels (annuel = 10 mois), Enterprise « Sur devis » hors libre-service, 10 options avec plans éligibles, note sur l'évolution vers une gestion en base.
5. ☐ `/admin/abonnements` : filtre plan Business puis statut Essai ; la colonne Objet distingue « Plan » et « Option ».
6. ☐ Marquer payée la facture **de plan** OPEN de Tech Hub Cotonou (renouvellement) : **Attendu** facture PAID, abonnement ACTIVE, audits `invoice.paid` et `admin.invoice.marked_paid`, job `subscription.changed`. Recliquer : bouton absent (idempotent).
7. ☐ Marquer payée la facture **d'option** du pack 500 messages utilitaires (Atelier Beauté Nafi), depuis `/admin/options?status=PENDING` : **Attendu** option ACTIVE, +500 « WhatsApp utilitaire » dans `/admin/credits` avec échéance à 12 mois, abonnement Scale inchangé.
8. ☐ `/admin/credits` : ajuster +100 crédits IA avec un motif de moins de 5 caractères → erreur sous le champ ; avec un motif valide → solde mis à jour, mouvement « Ajustement admin » sans échéance, audit `admin.credits.adjusted`. Retirer plus que le solde → refus « Solde insuffisant ».
9. ☐ Fiche boutique Saveurs d'Afrique Paris : zone « Monde (EUR) » ; « Passer en FCFA » exige un motif, met à jour la zone et la devise de l'abonnement, audit `admin.subscription.zone_changed`. Remettre en EUR.
10. ☐ Fiche boutique : options et portefeuille affichés ; suspension avec motif obligatoire → boutique hors ligne (`/s/{slug}` en 404 ou page « suspendue »), réactivation motivée → en ligne.
11. ☐ Boutiques : recherche « tech », filtres pays, plan et statut, pagination. Vedette : 3 boutiques (Chez Aïcha, Dantokpa Mode, Atelier Beauté Nafi).
12. ☐ Tâches : forcer un échec (ex. `EMAIL_PROVIDER=resend` sans clé) → notification FAILED, job FAILED ou DEAD ; « Rejouer » puis « Exécuter maintenant » → DONE après correction.
13. ☐ Tickets : changer le statut ; journal d'audit filtrable par action et boutique.
14. ☐ Thème sombre (menu du compte) : sidebar, tableaux, barres et dialogues lisibles ; mobile 375 px : menu en tiroir, Échap ferme, tableaux défilent horizontalement sans déborder la page.

## 4 bis. Parcours V4 côté marchand

1. ☐ `demo@axi.africa`, boutique Chez Aïcha (essai Business) : bandeau d'essai avec date de fin ; boîte WhatsApp avec 6 conversations (Nouveau, Intéressé, Commande en cours, Payé, Perdu), non lus visibles ; réponses rapides `/bonjour`, `/livraison`.
2. ☐ Entonnoir : déplacer une conversation d'étape, valeur estimée mise à jour.
3. ☐ Campagnes : brouillon et campagne programmée présents ; Dantokpa Mode affiche une campagne envoyée avec destinataires, clics, commandes attribuées et crédits consommés.
4. ☐ Avis : approuver un avis en attente, répondre ; il apparaît sur la fiche produit publique.
5. ☐ Fidélité : points des clients cohérents avec les commandes livrées et payées ; configuration visible.
6. ☐ Abonnement : prix affichés en FCFA pour Chez Aïcha, en EUR pour Saveurs d'Afrique Paris (`awa@saveurs-afrique.demo`) ; passage à l'annuel affiche « 10 mois payés pour 12 » ; montée en gamme avec crédit au prorata.
7. ☐ Options : achat d'un pack IA → facture OPEN, option « En attente » jusqu'au paiement (confirmé par l'admin, scénario 4.7).
8. ☐ Plan Gratuit (`dr.adjovi@sante-plus.demo`) : fonctions Business verrouillées avec explication du plan ou de l'option qui débloque, logo Axi visible sur la boutique.
9. ☐ Salon Belle Tresse (`akossiwa@belle-tresse.demo`) : abonnement impayé signalé, facture en retard payable.
10. ☐ Suivi de commande : lien `/suivi/{token}` d'une commande livrée récente → page de suivi (jeton valide 90 jours dans la démo).

## 4 ter. Constructeur de boutique, catalogue et connecteur IA

Compte `demo@axi.africa`, boutique Chez Aïcha (essai Business : toutes les fonctions ci-dessous sont incluses), sauf
mention contraire. Les boutiques de démo n'ont ni collections, ni menus, ni thème v2 : ces scénarios les créent.
Guide utilisateur correspondant : [`docs/GUIDE-BOUTIQUE.md`](GUIDE-BOUTIQUE.md).

### Éditeur de thème (`/app/{storeId}/apparence`)

1. ☐ Ouverture : éditeur plein écran ; à partir de 1024 px, trois colonnes (structure, aperçu, réglages) ; en dessous, onglets « Sections », « Réglages », « Aperçu ». Une boutique sans thème v2 obtient un document créé depuis le modèle de son secteur.
2. ☐ Sections : sélecteur de modèle de page (Accueil, Produit, Collection, Catalogue, Page, Panier, Blog, Article). « Ajouter une section » ouvre la bibliothèque par catégorie ; ajouter « Questions fréquentes ». La monter et la descendre (menu « Plus d'actions » ou glisser la poignée), la masquer (œil), la dupliquer, la supprimer puis « Annuler » dans le message. Une section obligatoire (cadenas, ex. « Fiche produit » sur le modèle Produit) ne peut être ni dupliquée ni supprimée. Au-delà de 25 sections : « Maximum 25 sections par page. ».
3. ☐ Blocs : déplier une section, « Ajouter un bloc », réordonner, masquer, dupliquer, supprimer. Un bloc limité (ex. « Prix » dans « Fiche produit », 1 maximum) ne peut pas être ajouté une seconde fois.
4. ☐ Réglages : modifier un titre, les couleurs de la section, les marges. Un lien qui n'est ni un chemin de la boutique (`/catalogue`) ni une adresse `https` est signalé et le brouillon passe à « À corriger » sans être enregistré. Onglet « Réglages du thème » : Couleurs, Typographie, Boutons, Cartes produit, Mise en page, En-tête, Pied de page, Fiche produit, Panier, Réseaux sociaux, Favicon et partage.
5. ☐ Aperçu : chaque modification s'affiche sans rechargement ; sélectionner une section dans la liste fait défiler l'aperçu jusqu'à elle et l'encadre ; tailles Ordinateur, Tablette, Mobile. Dans l'aperçu, le survol (ou le focus clavier) d'une section l'entoure d'un contour pointillé avec son nom ; un clic la sélectionne dans la liste et ouvre ses réglages (sur téléphone : onglet « Réglages ») ; un clic sur l'en-tête ou le pied de page ouvre « En-tête » / « Pied de page ». Les liens et formulaires de l'aperçu ne naviguent pas (« Ajouter au panier » et les carrousels restent utilisables). Ouvrir `/s/{slug}?preview=1` directement dans un onglet : navigation normale, aucun contour.
6. ☐ Enregistrement : statut « Enregistré » environ une seconde après la dernière modification (sauvegarde automatique du brouillon), `Ctrl+S`, `Ctrl+Z` / `Ctrl+Y`. Quitter avec une modification en attente déclenche l'avertissement du navigateur. Le brouillon n'est pas visible des visiteurs : `/s/{slug}` en navigation privée est inchangé.
7. ☐ Publier : message « Thème publié sur la boutique », pastille de modifications non publiées retirée, boutique publique à jour, audit `theme.published`, la version apparaît en tête du menu « Versions » avec la mention « En ligne ».
8. ☐ Versions (plan Business et plus) : restaurer une version antérieure → elle est chargée dans le brouillon (« Publiez pour la mettre en ligne »), audit `theme.version_restored`. « Abandonner les modifications » ramène le brouillon à la version en ligne. Sur une boutique Starter (`/s/tech-hub-cotonou`) ou Gratuit : « Historique et restauration » verrouillé, lien vers l'abonnement.
9. ☐ Modèle de départ (Réglages du thème) : appliquer un autre modèle avec « Conserver mon logo, mes menus, mes réseaux sociaux et le pied de page » coché → logo et menus conservés. Plan Gratuit (`dr.adjovi@sante-plus.demo`) : 2 modèles disponibles, les autres verrouillés ; mention « Propulsé par Axi » impossible à masquer.
10. ☐ Permissions : l'employée STAFF de Dantokpa Mode (`benedicte@dantokpa-mode.demo`) ouvrant `/app/{id}/apparence` ou `/navigation` → `?denied=1`.

### Menus (`/app/{storeId}/navigation`)

1. ☐ Menus « Menu principal » et « Pied de page » présents (vidables, non supprimables). « Ajouter un élément » : libellé, type de lien (Accueil, Catalogue, Collection, Produit, Page, Adresse web), cible choisie dans la boutique. « Enregistrer » → « Menu enregistré », audit `theme.menu_saved`.
2. ☐ Sous-éléments : « Placer sous l'élément précédent », « Ajouter un sous-élément », « Remonter au premier niveau » ; réordonner à la souris ou au clavier (Espace pour saisir, flèches pour déplacer). Deux niveaux maximum, 20 éléments par menu, 15 sous-éléments.
3. ☐ Adresse web `http://…` ou `javascript:…` refusée ; seule une adresse `https` ou un chemin de la boutique est accepté. Élément sans cible → « Menu incomplet ».
4. ☐ « Créer un menu » (ex. `aide`) : 6 menus supplémentaires maximum ; suppression avec confirmation. Dans l'éditeur, En-tête › « Menu » et Pied de page › « Menus affichés » permettent de les choisir ; après publication, liens visibles et fonctionnels sur `/s/{slug}`.

### Fiches produits, variantes couleur et taille

1. ☐ Nouveau produit : « Médias » avec 3 photos (texte alternatif), prix, prix barré, statut Actif. Section « Variantes » : boutons « Couleur », « Taille », « Option libre » (3 options maximum).
2. ☐ Couleur : ajouter Rouge, Bleu (Entrée ou virgule pour en saisir plusieurs) ; pour chaque couleur, choisir la pastille (sélecteur ou code `#RRGGBB`, code invalide refusé) et une image parmi les médias du produit. Taille : S, M, L. **Attendu** : tableau de 6 variantes généré, chacune avec prix, prix barré, stock et image ; au-delà de 100 combinaisons, refus.
3. ☐ Édition groupée : cocher plusieurs variantes, appliquer un prix, un prix barré, un stock et une image. Enregistrer.
4. ☐ Boutique publique : dans l'éditeur (modèle Produit, bloc « Variantes »), choisir le style « Pastilles couleur » et publier. Sur la fiche, les couleurs s'affichent en pastilles ; choisir une couleur affiche son image ; une variante à stock 0 est signalée épuisée (option « Montrer les variantes épuisées ») et ne peut pas être ajoutée au panier.
5. ☐ Conflit de stock : ouvrir la fiche, passer une commande sur la même variante dans un autre onglet, réduire le stock dans la fiche jusqu'à le rendre négatif après la vente puis enregistrer → message « Le stock de … a changé pendant la modification ».
6. ☐ Plan Gratuit : section « Suppléments » verrouillée ; plan sans suivi de stock : colonne et édition du stock absentes.

### Collections (`/app/{storeId}/collections`)

1. ☐ Collection manuelle « Nouveautés » : ajouter des produits par recherche, les ordonner (glisser ou flèches), tri « Manuel ». Image, description, référencement, « Publiée ». **Attendu** : `/s/{slug}/collections/{adresse}` affiche les produits dans cet ordre ; dans la fiche produit, la collection apparaît sous « Autres collections ».
2. ☐ Collection automatique « Moins de 10 000 F » : condition « Prix est inférieur à 10000 » ; ajouter « Étiquette est égale à wax » avec « au moins une condition », puis « toutes les conditions » : l'aperçu en direct change. Un produit modifié pour remplir les conditions y entre sans action manuelle ; la fiche produit indique « Inclus automatiquement dans : … ».
3. ☐ Condition invalide (prix non entier, valeur vide) refusée sous le champ. Collection dépubliée → page publique introuvable. Suppression : les produits sont conservés.
4. ☐ 101e collection refusée (« 100 collections maximum »).
5. ☐ Ordre des collections (au moins 3 collections) : sur la liste, glisser une collection par sa poignée, puis au clavier (Tab jusqu'à la poignée, Espace, flèches, Espace ; Échap annule) et avec les boutons « Monter » / « Descendre ». **Attendu** : annonce de la position pour les lecteurs d'écran, message « Ordre des collections enregistré », ordre conservé après rechargement ; sur la boutique, la section « Liste de collections » (sans collections choisies), le sous-menu « Catalogue » et les liens du menu principal par défaut (boutique sans menu enregistré) et le filtre « Collection » du catalogue suivent cet ordre.

### Inventaire (`/app/{storeId}/produits/stock`)

1. ☐ Une ligne par variante des produits suivis (non archivés) ; indicateurs Articles suivis, En rupture, Stock bas (seuil du produit, sinon de la boutique), Mouvements sur 7 jours ; filtres « Tout », « Stock bas », « Rupture » (et « Survente » s'il y en a) ; recherche par produit ou SKU.
2. ☐ Ajustement rapide (+, −, saisie puis « Valider ») → message « X en stock », mouvement enregistré. Fiche « Stock et mouvements » d'un produit : ajustement avec sens (Entrée, Sortie), quantité, motif ; historique des ventes, annulations et ajustements.
3. ☐ Une commande puis son annulation apparaissent dans l'historique ; la quantité revient.
4. ☐ Plan Gratuit : page Inventaire remplacée par l'invitation à changer de plan.

### Vente en rupture, seuils et alertes de stock

1. ☐ Fiche d'un produit à variantes avec stock suivi : colonne **Vendre en rupture** ; cocher une variante à stock 0, enregistrer. Case « Continuer à vendre en cas de rupture (toutes les variantes) » : cochée → toutes passent en vente continue ; réglage mixte signalé.
2. ☐ Vitrine : la variante à 0 en vente continue n'est pas barrée, badge « Précommande », ligne « Précommande : expédition différée », bouton « Précommander » ; avec « Afficher le stock » désactivé, aucune quantité n'apparaît. Données structurées : `BackOrder`.
3. ☐ Commander 2 unités de cette variante → commande créée, note « Précommande » dans l'historique, stock −2, mouvement « Vente » −2. Une variante à 0 en « Bloquer à zéro » reste refusée (« … est épuisé »).
4. ☐ Inventaire : badge **Survente (−2)**, filtre **Survente** ; liste produits : badge **Survente** ; tableau de bord : carte « Stock bas et ruptures ». Notifications : une alerte « Survente » (après le balayage `/api/jobs/run`), pas de doublon au balayage suivant.
5. ☐ Annuler la commande → stock revient à 0, mouvement « Annulation » +2. Réassort +5 via l'inventaire depuis −2 : accepté.
6. ☐ Seuil : produit à seuil 2, boutique à 5 (Notifications) ; stock 3 → pas « stock bas » ; vendre 1 → « Stock bas » une fois, la vente suivante n'en recrée pas ; réassort à 10 puis vente à 2 → nouvelle alerte.
7. ☐ Export CSV : colonnes « Variant Inventory Policy » (`deny`/`continue`), « Seuil stock bas », code-barres du produit simple ; réimport sans erreur.
8. ☐ MCP : `update_variant_price_stock` avec `inventory_policy: "continue"` puis `check_availability` (vitrine) : stock à 0 → « available for pre-order » ; stock 3 et quantité 5 → « available » (aucune déduction du stock possible).
9. ☐ Seuil relevé : produit à 6 unités (seuil boutique 5), relever le seuil du produit à 8 → aucune alerte ; vendre 1 → toujours aucune (déjà sous le nouveau seuil) ; réassort à 12 puis vente à 7 → une alerte.
10. ☐ Inventaire : variante à −2 affichée « -2 », bouton « − » désactivé, « + » → −1 puis « Valider » accepté ; saisir −3 → non enregistrable.
11. ☐ Thème avec « Afficher le stock » désactivé : panier avec 5 unités d'un article à 3 en stock (« Bloquer à zéro ») → « Quantité demandée indisponible pour … », jamais « Il ne reste que 3 ».
12. ☐ Variante désactivée à stock 0 : absente du filtre « Stock bas », de la carte du tableau de bord et des alertes.
13. ☐ CSV : cellule Stock « douze » → erreur sur la ligne, stock existant conservé ; stock négatif réexporté alors que la survente a bougé → avertissement, stock actuel conservé.

### Import et export CSV (`/app/{storeId}/produits`, menu « Actions »)

1. ☐ « Exporter le catalogue » télécharge `produits-{slug}-{date}.csv`, une ligne par variante (colonnes Handle, Titre, Option1 Nom / Valeur…, Prix, Stock, Image…), audit `products.exported`. Sélection dans la liste → « Exporter la sélection ».
2. ☐ « Importer des produits » : réimporter ce fichier modifié (un prix changé, une nouvelle variante, un nouveau produit). Étapes : fichier (CSV UTF-8, virgule ou point-virgule, 2 000 lignes maximum), association des colonnes (Titre et Prix obligatoires), aperçu avec erreurs par ligne. Avec « Mettre à jour les produits existants », le produit au même Handle est remplacé (variantes conservées par combinaison) ; sans, il est ignoré.
3. ☐ Fichier avec une ligne sans titre → erreur « Titre ou Handle manquant » sur la ligne concernée. Limite de produits du plan respectée.
4. ☐ Boutique Starter : import et export grisés avec mention du plan requis ; `/app/{id}/produits/export` répond 403.

### Connecteur IA (`/app/{storeId}/integrations/ia`)

Référence technique : [`docs/API-MCP.md`](API-MCP.md).

1. ☐ Indicateurs : jetons actifs (avec plafond du plan), applications connectées, appels sur 24 h, débit maximal. Guide de connexion par assistant (Claude.ai, Claude Desktop et Code, Cursor…).
2. ☐ Jeton (propriétaire uniquement) : « Nouveau jeton API », nom, autorisations, expiration. **Attendu** : secret `axi_live_…` affiché une seule fois (« J'ai copié mon jeton »), seul le préfixe reste visible ensuite.
3. ☐ Appel `curl` (exemples en §8 de `docs/API-MCP.md`) avec ce jeton sur `http://localhost:3000/api/mcp` : `initialize`, `tools/list` puis `tools/call` `get_store_overview`. **Attendu** : réponses JSON, appels visibles dans le journal de la page. Sans jeton → 401 ; jeton en lecture seule appelant `adjust_inventory` → résultat `isError` ; un tableau de messages (lot) avec l'en-tête `MCP-Protocol-Version: 2025-06-18` → HTTP 400.
4. ☐ « Faire tourner » puis « Révoquer » : l'ancien secret cesse aussitôt de fonctionner (401).
5. ☐ OAuth Claude.ai (plan Business et plus), **une fois l'application déployée en https** (Claude.ai doit joindre l'URL publique) : Paramètres › Connecteurs › « Ajouter un connecteur personnalisé », URL `https://{domaine}/api/mcp`, « Se connecter » → page de consentement Axi (choix de la boutique, autorisations listées, badge « Application vérifiée ») → « Autoriser ». L'application apparaît dans « Applications connectées » ; « Déconnecter » coupe l'accès. Sur un plan inférieur : message « Connexion en un clic : plan Business ».
6. ☐ MCP vitrine public : `curl` sans jeton sur `/api/mcp/store/{slug}` (`search_catalog`, puis `create_checkout_link`) → lien `/s/{slug}?panier=…` qui restaure le panier, l'acheteur finalise lui-même. Désactiver « Ouvrir ma boutique aux assistants IA » → la vitrine MCP refuse.
7. ☐ `GET /s/{slug}/llms.txt` : description texte de la boutique (produits actifs, informations publiques), aucune donnée privée.

### Arrêt d'urgence des connecteurs IA (`/admin/connecteurs-ia`)

1. ☐ Console admin (MFA active, rôle Super admin : permission `settings.manage`) : indicateurs, jetons actifs filtrables par boutique, applications autorisées, clients enregistrés.
2. ☐ « Arrêt d'urgence » : activer « Connecteurs IA suspendus » avec un message, « Enregistrer » → audit `admin.mcp.kill_switch`. **Attendu** (sous 10 s) : `/api/mcp` et `/api/mcp/store/{slug}` répondent 503 avec le message, la page Connecteurs IA du marchand affiche « Connecteurs IA temporairement suspendus ». Aucun jeton ni autorisation supprimé : désactiver l'arrêt rétablit l'accès.
3. ☐ Révoquer un jeton ou une autorisation d'une boutique, désactiver un client : effet immédiat, journal `admin.mcp.*`. Un rôle Support ou Finance voit la page sans pouvoir modifier l'arrêt d'urgence.

## 4 quater. Lot 1 : ventes et fidélité

Spécification : [`docs/specs/LOT-1-ventes-fidelite.md`](specs/LOT-1-ventes-fidelite.md). Guide utilisateur : [`docs/GUIDE-BOUTIQUE.md`](GUIDE-BOUTIQUE.md), sections 7 à 12.

Données du seed utilisées : marchand `demo@axi.africa` / `Demo-Axi-2026!` (boutiques Dantokpa Mode, Business actif ; Chez Aïcha, essai Business ; Tech Hub Cotonou, Starter). Sur Dantokpa Mode : remises « 2 accessoires achetés = 1 offert » (collection Accessoires, 2 applications par commande au maximum) et « −15 % sur la collection Femme » (non cumulable avec les codes promo), code `WAX15` (−1 500 FCFA dès 10 000 FCFA), politique de retours activée (7 jours, bonus avoir 10 %), fidélité active (300 points = 2 500 FCFA), cliente **Grâce Hounkpatin** (`0197010203`) avec la carte cadeau `KD7M-4XQ2-9PRT-H3VW` de 25 000 FCFA (créée seulement si `APP_SECRET` fait au moins 32 caractères), offre au panier « Complétez la tenue » (panier, vente croisée, déclencheur collection Femme, produits proposés Collier de perles et Sac à main cuir et wax), produit « Carte cadeau Dantokpa Mode » (`/s/dantokpa-mode/p/carte-cadeau`, valeurs 10 000, 25 000 et 50 000 FCFA), 5 000 FCFA d'avoir pour la cliente **Nadège Dossou** (`0195070809`), retour `RT-DEMO01` en attente (« Demandé », avoir souhaité) sur la dernière commande livrée de moins de 6 jours. Sur Chez Aïcha : paliers « −5 % dès 20 000 FCFA, −10 % dès 50 000 FCFA » et une remise expirée. Plan Gratuit : `dr.adjovi@sante-plus.demo` (Cabinet Santé Plus).

Sans WhatsApp Business connecté ni `AXI_OTP_WHATSAPP_PHONE_ID` / `AXI_OTP_WHATSAPP_TOKEN`, le code de connexion acheteur s'affiche **dans la console du serveur** en développement (`[buyer-otp] (dev) code de connexion …`), jamais en production. `pnpm jobs` doit tourner (émission des cartes, notifications de retour).

### Connexion acheteur par code (`/s/dantokpa-mode/compte`)

1. ☐ En-tête de la boutique : icône « Compte » visible. Clic → `/s/dantokpa-mode/compte/connexion`.
2. ☐ Saisir `0197010203`, « Recevoir un code ». **Attendu** : message « Si ce numéro peut recevoir des messages, un code vient d'être envoyé. », code à 6 chiffres dans la console du serveur. Un numéro jamais vu donne exactement le même message.
3. ☐ Code faux → « Code incorrect ou expiré. Vérifiez-le ou demandez-en un nouveau. » ; bon code, « Me connecter » → espace « Bonjour Grâce », session de 90 jours. Cookie `axi_buyer` (HttpOnly, SameSite=Lax) limité au chemin `/s/dantokpa-mode`.
4. ☐ Quatrième demande de code en moins de 15 minutes depuis la même IP pour le même numéro → message de limitation.
5. ☐ Saisir l'e-mail `grace.h@example.com` (non vérifié) → message « Si cette adresse est rattachée à un compte vérifié, un code vient d'être envoyé. Sinon, connectez-vous avec votre numéro. », aucun code envoyé.
6. ☐ Le cookie de Dantokpa Mode n'ouvre pas de session sur `/s/chez-aicha/compte` (redirection vers la connexion).
7. ☐ Marchand, `/app/{id}/parametres/comptes-clients` : décocher « Proposer un compte client sur ma boutique », « Enregistrer » → icône « Compte » absente de la boutique, `/s/dantokpa-mode/compte/connexion` affiche « Les comptes clients ne sont pas proposés par cette boutique. », l'acheteur connecté perd sa session. Réactiver.

### Espace client : commandes, adresses, favoris, réachat

1. ☐ « Mes commandes » : commandes de Grâce passées avec son numéro, y compris en invitée ; détail avec statut et lien de suivi.
2. ☐ « Commander à nouveau » sur une commande → toast « Articles ajoutés au panier » (articles indisponibles ignorés et comptés), prix actuels dans le panier.
3. ☐ « Mes adresses » : ajouter une adresse avec une zone de livraison, la mettre par défaut ; 11e adresse refusée (10 maximum).
4. ☐ Éditeur (Réglages du thème › Cartes produit) : activer « Cœur « favori » », publier. Sur le catalogue, cœur sur les cartes et à côté du titre de la fiche ; cliquer → produit dans « Favoris ». Déconnecté, le cœur renvoie vers la connexion puis revient sur la page.
5. ☐ Checkout connecté (`/s/dantokpa-mode/commander`) : nom et téléphone préremplis, téléphone verrouillé (« Numéro vérifié par code »), adresse par défaut proposée, case « Utiliser … points » si le solde de points le permet.
6. ☐ « Déconnecter tous mes appareils » → toutes les sessions révoquées ; le marchand voit « Aucune session active » sur la fiche client. Inversement, « Déconnecter tous les appareils » côté marchand (fiche client, carte « Compte client ») déconnecte l'acheteur au chargement suivant, audit `customer.sessions_revoked`.
7. ☐ « Supprimer mon compte » puis confirmation → déconnexion ; fiche client : alerte « Suppression demandée ».

### Remises automatiques et non-cumul

1. ☐ `/app/{id}/promotions/automatiques` (Dantokpa Mode) : deux remises actives, résumé en phrase, statut « Active ». Chez Aïcha : la remise de la fête des mères est « Expirée ».
2. ☐ Panier `/s/dantokpa-mode` : 3 × « Collier de perles » (4 500). **Attendu** au checkout : remise « 2 accessoires achetés = 1 offert » de 4 500 FCFA (le moins cher offert). Avec 2 colliers seulement : message de progression, aucune remise. Avec 6 colliers : 9 000 FCFA (2 applications maximum).
3. ☐ « Robe wax Abomey » (18 000) : remise « −15 % » de 2 700 FCFA. Ajouter le code `WAX15` → message « Ce code n'est pas cumulable avec les offres en cours : la meilleure offre a été appliquée. », remise retenue 2 700 FCFA (plus avantageuse que 1 500).
4. ☐ « Chemise wax homme » seule (15 000) + `WAX15` → code appliqué (1 500), aucun message de non-cumul.
5. ☐ Chez Aïcha : panier ≥ 20 000 FCFA → −5 % ; ≥ 50 000 FCFA → −10 % (un seul palier, le meilleur). Barre de progression au panier (« Plus que … pour … »).
6. ☐ Créer une remise « Remise sur des produits » sur un produit en promotion datée avec « Exclure les articles déjà en promotion » coché → aucune remise sur ce produit au panier.
7. ☐ Valider une commande avec remise : la fiche commande détaille la remise ; utilisations +1 dans la liste. « Supprimer » cette remise → refus (« … désactivez-la plutôt ») ; « Dupliquer » → copie « (copie) » désactivée.
8. ☐ Commandes maximum = 1 sur une remise, deux commandes successives → la seconde n'a plus la remise, statut « Épuisée ».

### Offres au panier (ajout et montée en gamme)

1. ☐ `/app/{id}/promotions/offres` (Dantokpa Mode) : offre « Complétez la tenue » active (Panier et tiroir, Vente croisée). « Nouvelle offre » avec un déclencheur égal au produit proposé → refus ; avec « Carte cadeau Dantokpa Mode » comme produit proposé → refus.
2. ☐ Boutique : « Robe wax Abomey » au panier → bloc « Vous aimerez aussi » avec le collier et le sac à main ; bouton + du collier → collier ajouté sans ouvrir le tiroir. Collier déjà au panier → plus proposé.
3. ☐ Commander : sur la liste des offres, conversions +1 et chiffre d'affaires augmenté du net du collier. Suppression de l'offre refusée (ventes déjà générées).
4. ☐ Créer une offre « Montée en gamme » (emplacement « Panier et tiroir ») : déclencheur « Robe soleil en pagne », produit proposé « Chemise wax homme » (même option « Taille »). 2 × Robe soleil taille M au panier → bouton de l'offre : la robe est **remplacée**, à la même place, par 2 × Chemise taille M. Avec un déclencheur dont les options n'existent pas sur le produit proposé (ex. « Sac en pagne tissé » Rouge vers « Robe wax Abomey »), le bouton ouvre la fiche du produit proposé. Avec une quantité supérieure au stock de la taille choisie, le panier n'est pas modifié et la fiche s'ouvre (aucun stock affiché).
5. ☐ Emplacement « Fiche produit » : bloc « Souvent achetés ensemble » sur la fiche du déclencheur. Emplacement « Paiement » : bloc « À ajouter avant de valider » au checkout.
6. ☐ Section « Panier » de l'éditeur : décocher « Produits proposés (offres au panier) », publier → plus aucune offre au panier ni dans le tiroir.

### Carte cadeau : achat, émission, utilisation partielle, annulation et recrédit

Produit utilisé : « Carte cadeau Dantokpa Mode » du seed (aucun écran ne permet encore de marquer un autre produit comme carte cadeau ; au besoin, `pnpm db:studio`, table `Product`, `isGiftCard` à `true`).

1. ☐ Fiche du produit : bloc « Carte cadeau : destinataire » (nom, WhatsApp ou e-mail, message 300 caractères, date d'envoi). Sans destinataire → erreur sous le champ. Bouton « Offrir cette carte ».
2. ☐ Panier avec seulement la carte : checkout en « Envoi numérique », paiement à la livraison absent. Panier avec 6 cartes → « Au plus 5 cartes cadeaux par commande. ». Un code promo ou une carte cadeau ne réduit pas le prix de la carte.
3. ☐ Payer en MoMo manuel → `/merci` : « La carte est émise et envoyée au destinataire dès que le paiement est confirmé par la boutique. » Aucune carte dans `/app/{id}/cartes-cadeaux`.
4. ☐ Marchand : « Confirmer le paiement » → job `giftcard.issue` DONE → carte « Achat » active de 10 000 FCFA, journal « Émission », audit `giftcard.issued`. Destinataire e-mail : e-mail reçu (console en dev) avec le code ; destinataire WhatsApp seul : `/merci` affiche « Envoyer sur WhatsApp ». L'acheteur ne voit que `•••• XXXX`.
5. ☐ Utilisation partielle : commande « Robe wax Abomey » + livraison Cotonou centre (15 300 + 1 000 = 16 300 FCFA), champ « Carte cadeau » `KD7M-4XQ2-9PRT-H3VW` → ligne « Carte cadeau •••• H3VW −16 300 », « Rien à payer » ; commande créée payée. Fiche de la carte : solde 8 700, journal « Utilisation » liée à la commande.
6. ☐ Code faux → « Carte cadeau invalide » ; `/s/dantokpa-mode/carte-cadeau` : vérification du solde, 11e vérification en 15 minutes refusée.
7. ☐ Annuler la commande du point 5 → solde de la carte revenu à 25 000, journal « Recrédit », note de l'historique de commande « Annulation : cartes cadeaux recréditées … ».
8. ☐ Fiche carte : « Révéler le code » (audit `giftcard.code_revealed`), « Ajuster le solde » (débit supérieur au solde refusé), « Prolonger », « Désactiver » avec motif → code refusé au checkout ; « Réactiver ». « Créer une carte » : code affiché une seule fois.
9. ☐ Annuler une commande d'achat de carte déjà émise → carte désactivée, solde non dépensé retiré.

### Avoir

1. ☐ Fiche client de Grâce, carte « Avoir » : « Créditer » 5 000 FCFA, motif « Geste commercial » → solde 5 000, journal « Geste commercial », audit `store_credit.granted`. Motif de moins de 3 caractères refusé ; « Débiter » 6 000 → refus.
2. ☐ Grâce connectée, checkout : case « Utiliser mon avoir (5 000 FCFA) » → ligne « Avoir », reste à payer diminué. Déconnectée : lien « Connectez-vous pour utiliser vos points ou votre avoir », aucune case.
3. ☐ Annuler cette commande → avoir rendu (journal « Recrédit (annulation) »).
4. ☐ Fiche d'une commande payée avec client : « Enregistrer un remboursement », « Rembourser vers » « Avoir client » → avoir crédité (journal « Remboursement en avoir »).
5. ☐ Tech Hub Cotonou (Starter) : aucun bouton « Créditer ».
6. ☐ Nadège Dossou (`0195070809`, avoir de 5 000 FCFA du seed) connectée : case « Utiliser mon avoir (5 000 FCFA) » proposée sans action préalable du marchand.

### Retour complet (Dantokpa Mode)

Contrôle rapide : `RT-DEMO01` apparaît dans l'onglet « À examiner » ; on peut lui appliquer les étapes 3 à 5.

Préparation : Grâce connectée commande 3 × « Chemise wax homme » taille M (stock suivi), paiement MoMo manuel ; le marchand confirme le paiement puis amène la commande jusqu'à « Livrée ».

1. ☐ Acheteur, `/compte/commandes/{référence}` : « Demande de retour possible jusqu'au … », « Retourner des articles ». Formulaire : 1 chemise, motif « Taille ou coupe », préférence « Avoir », « Envoyer la demande ». Même bouton depuis `/suivi/{token}`.
2. ☐ Marchand : notification « Demande de retour RT-… », onglet « À examiner » avec compteur dans la barre latérale.
3. ☐ « Approuver le retour » → e-mail à l'acheteur (s'il a un e-mail) avec les instructions de la politique ; onglet « En attente de réception ».
4. ☐ Réception (également possible avec le compte employé `benedicte@dantokpa-mode.demo`) : « Reçu (sur 1) » = 1, état « Neuf », « Remettre en stock » coché, « Enregistrer la réception » → « Réception enregistrée, 1 unité remise en stock », mouvement « Retour » +1 sur la fiche stock de la chemise.
5. ☐ Résolution « Avoir » : montant suggéré = valeur nette de l'article ; « Avoir accordé » = montant + 10 % ; « Valider : avoir » → retour « Résolu », avoir crédité (« Remboursement en avoir ») sur la fiche client.
6. ☐ « Créer un retour » depuis la commande (1 chemise, étape « Articles déjà reçus en boutique ») → résolution « Remboursement » → remboursement enregistré, statut de paiement de la commande « Partiellement remboursée ».
7. ☐ Troisième retour (1 chemise) → résolution « Échange », remplacement taille L → commande d'échange créée (« Commande d'échange … créée »), stock de la taille L décrémenté.
8. ☐ Une quatrième demande sur la même commande ne propose plus de chemise (quantités déjà retournées). Une demande refusée (« Refuser » avec motif) ou annulée par l'acheteur (« Annuler ma demande ») libère ses quantités.
9. ☐ Commande livrée **non payée** : résolution « Remboursement » bloquée (« La commande n'est pas payée : remboursement impossible. »), « Avoir » possible.
10. ☐ Politique : délai dépassé (commande livrée il y a plus de 7 jours) → bouton absent ; étiquette non retournable sur le produit → article non retournable. Activer la politique sans aucune résolution → refus.

### Plan Gratuit en upsell

1. ☐ `dr.adjovi@sante-plus.demo` : « Codes promo » (`/promotions`) et « Remises automatiques » → invitation à changer de plan (Starter) ; « Offres au panier » → plan Business.
2. ☐ « Cartes cadeaux » : indicateurs visibles, pas de bouton « Créer une carte », encart « Création et vente de cartes cadeaux incluses à partir du plan Business ». « Retours » et « Politique de retours » : invitation à changer de plan.
3. ☐ Comptes clients disponibles ; réglages : « Plan Gratuit : 30 codes par jour » sous « Expéditeur Axi ».
4. ☐ Tech Hub Cotonou (Starter) : remises sur des produits et paliers enregistrables ; types « X achetés = Y offerts » et « Lot de produits » marqués « (plan supérieur) », enregistrement impossible.

### Arrêts d'urgence (`/admin/connecteurs-ia`)

1. ☐ Console admin (MFA active, rôle Super admin) : cartes « Cartes cadeaux » et « Comptes acheteurs ». Activer « Cartes cadeaux suspendues » avec un message, « Enregistrer » → audit `admin.giftcards.kill_switch`, alerte « Arrêt d'urgence lot 1 actif ». **Attendu** : champ « Carte cadeau » refusé au checkout, vérification du solde refusée avec le message ; la gestion marchande des cartes reste possible. Désactiver.
2. ☐ Activer « Comptes acheteurs suspendus » → audit `admin.buyer_accounts.kill_switch`. **Attendu** (sous 10 s) : demande de code refusée avec le message ; un acheteur déjà connecté garde l'accès en lecture (bandeau de lecture seule). Désactiver : tout revient.
3. ☐ Rôle Support ou Finance : cartes visibles, interrupteurs non modifiables.

## 4 quinquies. Lot 1 bis : paiements Wave / Orange Money et catalogue WhatsApp

Guide utilisateur : [`docs/GUIDE-BOUTIQUE.md`](GUIDE-BOUTIQUE.md), sections 13 et 14. Procédure fournisseur par fournisseur
(comptes sandbox, clés, URL de webhook) : [`docs/DEPLOIEMENT.md`](DEPLOIEMENT.md) §7.1 bis. En local, exposez le port
3000 en HTTPS (ex. `cloudflared tunnel --url http://localhost:3000`) et mettez cette adresse dans `NEXT_PUBLIC_APP_URL`
le temps des tests.

### Paiements par agrégateur (Paystack, pawaPay, CinetPay)

À dérouler pour **chaque** agrégateur, avec une boutique du pays couvert (Côte d'Ivoire pour Paystack) et ses clés de test.

1. ☐ Paiements › Ajouter un moyen › « Mobile Money et carte en ligne » : la liste des fournisseurs montre les portefeuilles du pays ; cocher Wave / Orange Money ; le libellé client suit (« Wave, Orange Money ou MTN MoMo »). Plan Gratuit : choix verrouillé avec lien vers l'abonnement.
2. ☐ « Tester la connexion » avec la bonne clé → « Connexion Paystack réussie en mode test » (pawaPay : pays activés listés, avertissement si l'URL de rappel des dépôts n'est pas celle d'Axi). Badge « Mode test » dans la liste.
3. ☐ **R1** Paiement réussi (page du fournisseur, moyen de test ; pawaPay : numéro de test sandbox qui réussit) : tentative `CONFIRMED`, commande `PAID`, `OrderEvent` « Passerelle », job `payment.succeeded`, événement visible dans `/admin/paiements` (signature valide, traité).
4. ☐ **R2** Rejeu du même webhook : HTTP 200 `duplicate`, rien ne change.
5. ☐ **R3** Signature ou jeton invalide (modifier la clé) : HTTP 400, `ProviderEvent` `invalid_signature`, commande inchangée.
6. ☐ **R4** Montant falsifié : `amount/currency mismatch`, commande inchangée.
7. ☐ **R5** Webhook coupé, paiement fait : « Vérifier les paiements en attente » (ou le cron) → tentative confirmée.
8. ☐ **R6** Page abandonnée : tentative expirée au rapprochement (Paystack et CinetPay 30 min, pawaPay 20 min) ; le client peut relancer un paiement (nouvelle tentative). pawaPay : un numéro de test « échec » met la commande en échec de paiement.
9. ☐ **R7** Remboursement « vers le moyen d'origine » : Paystack / pawaPay → historique « Remboursement … demandé à … » ; CinetPay → notification « Remboursement à effectuer à la main ».
10. ☐ **R8** Test de connexion avec une fausse clé : message d'échec clair, aucun enregistrement.
11. ☐ **R9** Boutique au Bénin + Paystack : refus « Paystack n'encaisse pas dans le pays de votre boutique ».
12. ☐ CinetPay : montant hors de 100 à 2 500 000 XOF → message clair au client ; pays du compte différent du pays de la boutique → refus.

### Catalogue WhatsApp et flux (`/app/{storeId}/integrations/whatsapp-catalogue`)

1. ☐ Boutique Business publiée, flux Meta désactivé : `GET /s/{slug}/feeds/meta.xml` → 404. Activer → 200 `application/xml`, un `<item>` par variante, `&` des URL échappés, aucun SKU, stock ni prix d'achat.
2. ☐ Désactiver → 404 immédiat. Boutique au plan Starter → 404 et écran d'offre (`PlanGate`).
3. ☐ Produit sans photo : listé dans « Articles exclus », absent du flux. Produit en promotion datée : `g:price` = prix normal, `g:sale_price` = promotion, période renseignée.
4. ☐ Variante en rupture (« Bloquer à zéro ») : `out of stock` ; (« Continuer à vendre ») : `preorder`. Option « Publier aussi les articles en rupture » décochée : absente.
5. ☐ CSV TikTok ouvert dans un tableur : un nom commençant par `=` apparaît précédé d'une apostrophe (aucune formule).
6. ☐ Synchronisation (avec `SOCIAL_SYNC_DRY_RUN=1` et une intégration WhatsApp active) : saisir un ID de catalogue, activer, « Synchroniser maintenant », lancer `pnpm jobs` : statut « À jour », articles sur WhatsApp = articles publiables. Archiver un produit, resynchroniser : l'article disparaît (`DELETE`).
7. ☐ Jeton invalide (réel) : statut « Erreur », message sans jeton, prochaine tentative à +5 min puis +10 min.
8. ☐ Webhook WhatsApp signé avec un message `order` contenant une variante de la boutique et un identifiant d'une autre boutique : panier avec la seule variante de la boutique, réponse « 1 article indisponible », conversation visible dans la boîte.
9. ☐ Lien d'un article de flux pour une variante (`/p/{slug}?variant={variantId}`) : la fiche s'ouvre avec cette variante présélectionnée.
10. ☐ MCP : `get_catalog_sync_status` (scope `catalog:read`) renvoie les URL des flux activés et l'état ; `trigger_catalog_sync` (scope `catalog:write`) refusé au-delà de 6 par heure, audit `api.catalog.sync_requested`.

## 4 sexies. Lot 2 : devises, taxes et factures, blog, API REST et webhooks

Guide utilisateur : [`docs/GUIDE-BOUTIQUE.md`](GUIDE-BOUTIQUE.md), sections 15 à 18. Référence API : [`docs/API-REST.md`](API-REST.md).

### Devises et paiement multidevise (`/app/{storeId}/devises`)

1. ☐ Ajouter EUR → statut « Affichée », « 1 EUR = 655,957 FCFA (parité fixe BCEAO) », exemple « 10 000 FCFA ≈ 15,24 € ». Passer l'arrondi en « multiple de 5 » (`NEAREST_5`) : les prix deviennent des multiples de 5 €.
2. ☐ Vitrine, checkout, sélecteur → EUR : récapitulatif en €, mention « Vous serez débité de … FCFA (≈ … €) » ; choisir MTN MoMo : « Montant à envoyer : … FCFA ».
3. ☐ Commander : la commande a `total` en FCFA, `presentmentCurrency = EUR`, `presentmentTotal`, une note « Affiché en EUR… », la tentative de paiement en XOF.
4. ☐ Taxes TTC 18 % : « dont TVA (18 %) » ; HT : ligne « TVA (18 %) » et total majoré.
5. ☐ Carte cadeau avec affichage en euros : message « Les cartes cadeaux s'utilisent uniquement dans la devise de la boutique ».
6. ☐ Taux BCE vieux de plus de 73 h (modifier `fetchedAt` de `ExchangeRate`) : la devise BCE disparaît du sélecteur, l'euro reste (parité fixe).
7. ☐ Thème › En-tête : décocher « Afficher le sélecteur de devise », publier → plus de sélecteur dans l'en-tête malgré plusieurs devises (le sélecteur du checkout reste). Boutique à une seule devise : aucun sélecteur.
8. ☐ Plan Starter : une seule devise ajoutable ; plan Gratuit : écran d'offre.

### Taxes et factures (`/app/{storeId}/parametres/taxes`)

1. ☐ Plan Starter et plus, boutique au Bénin : « Ajouter TVA 18 % » → activer, TTC, IFU → Enregistrer. L'exemple affiche « dont TVA (18 %) » 1 678 pour 10 000 + 1 000.
2. ☐ Commande payée → `/app/{storeId}/commandes/{orderId}/facture` → « Émettre la facture » → `F-AAAA-000001`, « dont TVA 18 % », IFU et RCCM imprimés. Recharger : même numéro. Avec l'émission automatique (défaut), la facture existe dès le paiement (job `payment.succeeded`).
3. ☐ Imprimer : pas de menu ni de boutons.
4. ☐ Lien de suivi `/suivi/{jeton}/facture` sans session : même document ; jeton inconnu : « Facture introuvable » ; jeton expiré : « Lien expiré ».
5. ☐ Remboursement partiel puis total : avoirs `A-AAAA-000001`, `A-AAAA-000002` émis automatiquement ; Σ TVA des avoirs = TVA de la facture.
6. ☐ Membre d'une autre boutique : page facture introuvable ; plan Gratuit : écran d'offre.
7. ☐ Checkout d'une boutique qui applique les taxes : case « Facture au nom d'une entreprise » (raison sociale obligatoire, IFU/NIF facultatif) ; la facture porte ces informations. Régime TPS : « TVA non applicable ».

### Blog (`/app/{storeId}/blog`)

1. ☐ Plan Gratuit : `/app/{id}/blog` affiche la présentation du plan ; `/s/{slug}/blog` répond 404.
2. ☐ Starter : créer 20 articles puis tenter un 21e : refus avec message et lien vers l'abonnement ; modifier un article existant reste possible.
3. ☐ Créer une catégorie « Conseils », puis un article publié avec couverture, liste, citation, lien `/catalogue` et image dans le corps ; vérifier `/s/{slug}/blog`, `/blog/categorie/conseils`, l'article, le lien interne, le JSON-LD (outil de test des résultats enrichis).
4. ☐ Créer un second article avec le même titre : adresse `…-2`.
5. ☐ Programmer un article à +5 min : visiteur anonyme → 404 ; membre → bandeau d'aperçu ; après l'heure, l'article apparaît dans la liste, le RSS et le sitemap sans autre action.
6. ☐ Supprimer la catégorie : les articles restent visibles, sans catégorie.
7. ☐ Apparence › Accueil › Ajouter une section › « Derniers articles » ; publier ; l'accueil affiche les articles ; choisir la catégorie « Conseils » dans la liste déroulante : seuls ses articles. Un thème qui avait saisi l'adresse `conseils` en texte continue de filtrer.
8. ☐ Corps contenant `<script>` ou `[x](javascript:…)` : enregistrement refusé.
9. ☐ MCP : `create_blog_post` crée un brouillon invisible sur la boutique ; `list_blog_posts` le liste en `DRAFT`.
10. ☐ Mobile 375 px : pastilles de catégories défilantes, cartes en une colonne, cibles ≥ 44 px, pagination utilisable au clavier.
11. ☐ Éditeur : sélecteur de page → « Blog » puis « Article » ; modifier la section « Article » (réordonner les blocs), publier, vérifier un article. Créer un modèle alternatif d'article depuis « Modèles ».
12. ☐ Plan Business : « Rédiger avec l'IA » remplit le brouillon (3 crédits) sans l'enregistrer ; aucun prix ni promesse dans le texte ; « Rétablir le texte précédent » annule.

### Webhooks et API REST (`/app/{storeId}/integrations/webhooks`)

Test local de bout en bout : `AXI_WEBHOOKS_ALLOW_LOCALHOST=1` dans le processus qui crée le point (serveur Next) **et** dans celui qui livre (`pnpm jobs` ou `/api/jobs/run`) ; récepteur local à l'écoute en double pile (`::`), car `localhost` se résout d'abord en `::1`.

1. ☐ Business, propriétaire : ajouter `https://exemple.com/hook` → secret affiché une fois ; `http://…`, `https://10.0.0.1`, `https://x.internal`, port 8080 → refus explicite.
2. ☐ Envoyer un test → ligne « Test (ping) » ; sans serveur : « Nouvel essai prévu », prochain essai à +1 min.
3. ☐ Récepteur local : passer une commande sur la vitrine → `order.created` reçu, `Axi-Signature` vérifiée, corps sans nom ni téléphone.
4. ☐ Nouveau secret → pendant 24 h, deux `v1` dans l'en-tête.
5. ☐ Rejouer une livraison abandonnée → nouvel envoi, mêmes `Axi-Webhook-Id` / `Axi-Delivery-Id`.
6. ☐ Gérant / employé : pas d'accès à l'écran (menu masqué, redirection).
7. ☐ `curl /api/v1/products` sans jeton → 401 problem+json ; jeton Business → 200 ; `POST` → 403 `plan_required` ; `?limit=500` → 400 ; curseur forgé → 400 ; `/api/v1/nope` → 404 problem+json.
8. ☐ Scale : `POST /api/v1/products` sans `Idempotency-Key` → 400 ; même clé et même corps → réponse rejouée (`Idempotent-Replayed: true`) ; même clé, autre corps → 422.
9. ☐ Paiement confirmé et remboursement d'une commande : événements `order.paid` puis `order.refunded` reçus.
10. ☐ MCP : `list_webhook_deliveries` (scope `webhooks:write`, propriétaire) liste les livraisons filtrées par point et statut.

## 4 septies. Lot 4A : personnalisation de la boutique

Guide utilisateur : [`docs/GUIDE-BOUTIQUE.md`](GUIDE-BOUTIQUE.md), sections 19 et 20. Conception : [`docs/CONSTRUCTEUR-BOUTIQUE.md`](CONSTRUCTEUR-BOUTIQUE.md). Compte `demo@axi.africa`, boutique Chez Aïcha (essai Business) sauf mention contraire. Captures de référence du rendu : `docs/captures/vague2-rendu-*.png` (375 et 1440 px).

### Champs personnalisés, sections enregistrées, bibliothèque

1. ☐ Paramètres › Champs personnalisés : créer « Matière » (Produits, texte sur une ligne, visible, épinglé). La page Paramètres renvoie bien vers Champs personnalisés, Comptes clients, Taxes et factures, Politique de retours et Devises (carte « Autres réglages ») ; une seule entrée du menu est en surbrillance (« Taxes et factures » seule sur sa page, « Paramètres » sur les autres sous-pages).
2. ☐ Produit « Robe wax Abomey » de Dantokpa Mode : bloc Champs personnalisés, saisir « Wax hollandais », Enregistrer : toast, valeur conservée au rechargement.
3. ☐ Saisir une couleur invalide sur un champ couleur : message sous le champ, rien n'est enregistré.
4. ☐ Compte Starter : créer un 11e champ : refus avec le message de limite.
5. ☐ Champ client : la case « Visible dans la boutique » est absente (champ privé).
6. ☐ `/admin/bibliotheque` (admin avec double authentification) : les 6 éléments de démonstration (7 avec « nos-engagements » du seed complet), publication, ordre, aperçu. Création depuis un JSON contenant un identifiant de produit ou une image non https → refus.
7. ☐ Éditeur : enregistrer une section, l'insérer sur une autre page : identifiants différents. Insérer un élément premium de la bibliothèque sur un plan Starter → refus avec le plan requis.
8. ☐ MCP : `set_metafield` (scope `catalog:write`) sur un produit, valeur `null` → efface ; `list_saved_sections` liste les sections avec la limite du plan.

### Éditeur de thème (chez-aicha, `/app/{id}/apparence`)

1. ☐ Qualité : passer la couleur du texte à `#CFCFCF` → après ~0,5 s la jauge Accessibilité baisse, un problème « contraste » apparaît ; « Corriger » le règle ; Ctrl+Z le rétablit ; la jauge suit.
2. ☐ Animations : Thème › Animations › Vive ; une section › Zoom léger ; cocher « Réduire les animations » : l'aperçu n'anime plus rien.
3. ☐ Modèle Produit › Modèles › « Luxe » › Créer : le sélecteur affiche « Produit · luxe », l'aperçu le montre ; masquer une section dans ce modèle ne change pas « Produit (par défaut) ». Renommer en « prestige », puis supprimer (avertissement). Plan Gratuit : création refusée avec lien vers les plans (et refus serveur si contourné).
4. ☐ Produit › bannière › « Connecter une donnée » › Produit · Nom : carte avec exemple ; Déconnecter.
5. ☐ Section › Enregistrer cette section › « Bannière test » ; Ajouter une section › Mes sections › insérer ; Bibliothèque.
6. ☐ Section › Visible pour › Seulement si › Type de client : fidèle ; Simuler un visiteur : non connecté (section masquée dans l'aperçu), puis fidèle (visible).
7. ☐ Clavier : tout est atteignable (Tab), fenêtres fermables par Échap, focus rendu au bouton d'origine ; mobile 375 px : onglets Sections / Réglages / Aperçu, barre d'aperçu repliée sur plusieurs lignes.
8. ☐ Fiche produit et Collection : « Ajouter un bloc » › « Champ personnalisé », Libellé « Matière », Valeur reliée par « Connecter une donnée » au champ « Matière » ; publier : la ligne s'affiche sur la fiche ; produit sans valeur : rien.
9. ☐ En-tête : largeur du logo réglée à 300 px → rendu à 300 px sur ordinateur (45 % de l'écran au plus sur mobile), valeur conservée après enregistrement et rechargement.
10. ☐ Recherche globale de l'espace marchand : aucun avertissement d'hydratation dans la console du navigateur. Cause constatée : attribut `style="caret-color: transparent"` injecté dans les champs avant l'hydratation par l'outil de navigation (même effet avec certaines extensions) ; aucun écart côté code. À vérifier dans un navigateur sans extension ou en Playwright headless.

### Rendu de la boutique

1. ☐ Accueil d'une boutique : sections sous la ligne de flottaison qui apparaissent en fondu au défilement ; bannière jamais animée. `curl -H "Save-Data: on"` ou cookie `axi_lite=1` : ni `data-motion` sur `[data-store]`, ni `data-anim` sur les sections.
2. ☐ Préférence système « Réduire les animations » : rien ne bouge (y compris le bandeau défilant).
3. ☐ Produit avec `templateSuffix = "luxe"` (en base, aucun écran ne l'attribue encore) et `alternates.product.luxe` publié : la fiche utilise ce modèle ; suffixe supprimé du thème : modèle par défaut, sans erreur.
4. ☐ Champ personnalisé « Matière » (produit, visible sur la boutique) + section Caractéristiques : la valeur s'affiche ; définition passée à « non visible » : elle disparaît.
5. ☐ Section visible pour « clients fidèles » : invisible en navigation anonyme et pour Googlebot ; visible connecté avec 3 commandes ; dans l'aperçu, avec `axi:preview-audience` `{ customer: ["loyal"] }`.
6. ☐ Clavier : curseur avant/après (flèches), repères du look hors tabulation (la liste porte les liens), tableaux défilants focalisables, bouton Pause de la vidéo.

## 4 octies. Vague 2 : produits numériques et services

Automatisé : `pnpm e2e -- e2e/09-produits-numeriques.spec.ts` (parcours complet sur Dantokpa Mode).
Manuel, 10 minutes (détail et attendus : `docs/vague2/N-produits-numeriques.md` §6) :

1. **Produits › Ajouter un produit**, nature **Produit numérique**, prix 7 000, enregistrer : ni stock, ni expédition.
2. Carte « Fichiers à remettre » : téléverser un PDF ; régler 2 téléchargements, 30 jours, instructions ; enregistrer.
   La liste du catalogue affiche le badge « Numérique · 1 fichier ».
3. Ouvrir `/media/stores/…` avec la clé du fichier : **404** (aucun lien public).
4. Vitrine : acheter le produit (retrait) ⇒ commande « Envoi numérique », **0 frais**, sans adresse ; le paiement à
   la livraison n'est pas proposé.
5. Commerçant : **Confirmer le paiement**, puis `/api/jobs/run` (ou `pnpm jobs`). La commande passe seule en
   « Livrée / remise » et la carte « Téléchargements » affiche « 0 téléchargement sur 2 ».
6. `/suivi/{jeton}` › **Vos fichiers › Ouvrir** : la page liste le fichier et « 2 téléchargements restants sur 2 ».
   Télécharger deux fois (le compteur descend), la 3e fois est refusée.
7. **Renvoyer le lien** : le nouveau lien fonctionne, l'ancien non. Annuler la commande : le lien ne donne plus rien.

## 4 nonies. Vague 3 : caisse en magasin (réglages et écran de vente)

Plan Business minimum (Dantokpa Mode). Détail et attendus : `docs/vague3/OPS.md` §5.

1. **Menu latéral › Caisse** : on arrive sur `/app/{storeId}/caisse`, **dans l'espace marchand, barre latérale
   visible**. La page montre l'écran de vente (bouton « Ouvrir la caisse »), les sessions ouvertes, les rapports Z,
   les appareils, le code du gérant, les dépôts associés et le fonctionnement hors réseau.
   *Jamais* de bascule directe en plein écran depuis le menu.
2. **Appareils de caisse › Enregistrer un appareil** : nom « Tablette comptoir », dépôt. La fenêtre se ferme et le
   **jeton s'affiche une seule fois** dans un bandeau. Recharger la page : le jeton a disparu pour toujours.
   Au plan Business, un second enregistrement est refusé (« Limite d'appareils atteinte »).
3. **Code du gérant › Définir le code** : 4 à 6 chiffres, confirmation. L'état passe à « défini ».
   Codes trop faibles (1111, 1234) refusés ; confirmation différente refusée. « Retirer le code » le supprime.
   Avec un compte **STAFF** : les boutons d'enregistrement, de révocation et de code ne sont pas proposés.
4. **Ouvrir la caisse** : l'écran de vente `/caisse/{storeId}` s'ouvre **en plein écran, sans barre latérale**.
   L'en-tête porte le nom de la boutique, l'état **En ligne / Hors ligne**, la session en cours et un bouton
   **« Espace marchand »** qui ramène à l'étape 1 (vérifier aussi au clavier : Tab atteint ce bouton en premier).
5. Coller le jeton dans **« Associer cet appareil »** : l'appareil est reconnu et le catalogue se charge.
   Les réglages (enregistrement, révocation, code du gérant) ne sont **plus** présents sur cet écran.
6. Saisir le **fond de caisse** (10 000) puis « Ouvrir la caisse » : la session apparaît dans l'en-tête, et dans
   « Sessions ouvertes » de la page de réglage.
7. **Vente** : ajouter un article, saisir les espèces reçues, « Encaisser » : reçu affiché, rendu calculé.
   Remise au-delà du plafond du rôle : le **code du gérant** est demandé (refus si aucun code n'est défini).
8. **Hors réseau** (DevTools › Offline) : la vente reste possible, le badge passe à « Hors ligne », les ventes
   s'empilent (« n en attente ») ; au retour du réseau elles partent seules. Une vente refusée après encaissement
   reste dans « Ventes à régulariser » et n'est jamais supprimée automatiquement.
9. **Clôture** : saisir les espèces comptées, « Fermer la caisse » (refusée tant qu'il reste des ventes en file).
   Retour à `/app/{storeId}/caisse` : le **rapport Z** apparaît dans l'historique avec l'écart de caisse.
10. **Tablette 768 px et mobile 375 px** : aucun débordement horizontal, cibles ≥ 44 px, en-tête de vente lisible
    (titre sur sa propre ligne en mobile), bouton de retour toujours visible.

## 5. Checklist accessibilité mobile (WCAG 2.2 AA)

- ☐ Zoom navigateur 200 % : aucune perte de contenu, pas de scroll horizontal.
- ☐ Cibles tactiles ≥ 44 × 44 px (boutons, chips, lignes de liste) ; espacement suffisant.
- ☐ Inputs ≥ 16 px (pas de zoom automatique iOS), `inputMode="tel"`/`"numeric"` sur téléphone et montants.
- ☐ Chaque champ a un label visible ; erreurs annoncées (`role="alert"`) et liées (`aria-describedby`) ; focus envoyé sur la première erreur.
- ☐ Navigation clavier complète (Tab/Shift+Tab, Entrée, Échap ferme les dialogues/sheets, focus piégé dans le dialogue puis restitué).
- ☐ Contraste texte ≥ 4.5:1 (y compris thèmes de boutique : `contrastText` choisit blanc/noir) ; états désactivés distinguables.
- ☐ Images produits avec `alt` ; icônes décoratives `aria-hidden` ; aucun emoji comme icône.
- ☐ Lecteur d'écran (TalkBack) : parcours catalogue → panier → checkout compréhensible, statuts de commande annoncés, toasts `aria-live`.
- ☐ `prefers-reduced-motion` : animations désactivées.
- ☐ Mode hors connexion / réseau lent (DevTools « Slow 3G ») : squelettes de chargement, pas d'écran blanc, actions non dupliquées.
- ☐ Orientation paysage et petits écrans (360 px) : mise en page intacte.

## 6. Non-régression rapide (5 min)

`pnpm typecheck && pnpm lint && pnpm test && pnpm build`, puis : connexion démo → commande sur `/s/chez-aicha` → confirmation marchand → `/admin` (MRR, clients payants) → marquer payée une facture d'option → crédits visibles dans `/admin/credits`.
