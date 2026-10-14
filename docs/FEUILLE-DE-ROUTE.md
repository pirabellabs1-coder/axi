# Feuille de route Axi : dépasser Shopify

Objectif du porteur (11/10/2026) : devenir la référence mondiale du commerce conversationnel, au-delà de Shopify, en particulier sur la personnalisation de boutique. Ce document fixe l'ordre de construction ; les spécifications détaillées de chaque lot sont dans `docs/specs/`.

## Déjà au niveau (octobre 2026)
Éditeur à sections et blocs avec aperçu cliquable, versions, menus ; produits à options et variantes (pastilles, photos) ; collections manuelles et automatiques ; inventaire et CSV compatible Shopify ; commandes, clients, équipe, audit ; codes promo, fidélité, avis, paniers abandonnés, campagnes WhatsApp ; domaine personnalisé ; connecteur IA (MCP, OAuth) ; facturation zones Monde / Afrique.

## En cours
- Stockage objet des médias (R2 / S3 / local).
- Politique de stock (« continuer à vendre », seuils, alertes, précommande).
- Recette tablette, grand écran et thème sombre.

## Livré : vague 2 (11/10/2026)
Lot 1 bis, lot 2 hors langues et lot 4A, construits par 10 équipes en parallèle (`docs/specs/BRIEF-VAGUE-2.md`). Guide : `docs/GUIDE-BOUTIQUE.md` §13 à §20 ; recette : `docs/RECETTE.md` §4 quinquies à 4 septies ; architecture : `docs/ARCHITECTURE.md` §7 quinquies ; rapports d'équipes : `docs/vague2/`.
- **Lot 1 bis** : Wave, Orange Money, MTN MoMo et Moov Money automatiques par agrégateur (Paystack, pawaPay, CinetPay), remboursement automatique chez Paystack et pawaPay ; flux catalogues Meta, Google, TikTok, synchronisation du catalogue WhatsApp (API Graph, à valider avec un compte Meta) et paniers WhatsApp convertis en liens de commande.
- **Lot 2 (hors langues)** : multi-devises avec arrondis, marge et prix fixés (lot 2 B) ; TVA TTC / HT, factures et avoirs numérotés sans trou (lot 2 C) ; blog avec catégories, programmation, RSS, sitemap, section « Derniers articles » et brouillon IA (lot 2 D) ; webhooks sortants signés et API REST `/api/v1` (lot 2 E).
- **Lot 4A** : préréglages d'animation, scores qualité en direct avec correction en un clic, sections enregistrées et bibliothèque premium, champs personnalisés et sources dynamiques, modèles alternatifs (produit, collection, page, article), sept nouvelles sections. Livrés en avance : personnalisation par audience (prévue en 4C) et flux catalogues (prévus en 4D, faits au lot 1 bis) ; contrat d'édition directe (`edit-attrs.ts`) prêt pour le 4B.
- Écarts connus restants : `docs/ARCHITECTURE.md` §8.

**Restent à faire** : langues et traduction de l'interface boutique (lot 2 A, schéma `Translation` déjà en base) ; lot 4B (kit de marque, édition directe dans l'aperçu, boutique générée par l'IA, assistant de design) ; lot 4C (thèmes programmés, tests A/B) ; lot 4D (PWA et mode économie de données, partage en statut WhatsApp, vidéos et stories achetables, live shopping, notifications push) ; lot 3 (opérations). Lot 1 bis non commercial : offre gratuite élargie, premier mois Starter à prix d'appel, revue des quotas WhatsApp.

## Lot 1 bis : priorités issues de l'analyse concurrentielle (11/10/2026)
Voir `docs/ANALYSE-CONCURRENTIELLE.md`. À faire juste après le lot 1, avant le lot 2 :
- **Livré (vague 2)** : Wave et Orange Money automatiques en Côte d'Ivoire et au Sénégal (agrégateurs Paystack, pawaPay et CinetPay ; clés à valider en sandbox par le porteur, `docs/DEPLOIEMENT.md` §7.1 bis).
- **Livré (vague 2)** : synchronisation du catalogue WhatsApp (Commerce Manager) et compatibilité avec l'agent IA de Meta (flux et API Graph, `docs/DEPLOIEMENT.md` §7.3 bis).
- Offre gratuite élargie (environ 50 commandes par mois) face à Take App ; premier mois Starter à prix d'appel.
- Revue des quotas de messages WhatsApp (tarification Meta du 1er octobre 2026, à confirmer).
- Boutique générée par IA avancée en tête du lot 4.

## Lot 1 : ventes et fidélité (parité Shopify)
1. Compte client acheteur : connexion par code WhatsApp ou e-mail, historique, adresses, favoris, réachat en un clic.
2. Remises automatiques : X achetés = Y offerts, paliers de panier, lots (bundles), ventes croisées et montées en gamme au panier.
3. Cartes cadeaux et avoirs (store credit), utilisables au checkout et pour les remboursements.
4. Retours et échanges : demande client, validation marchand, remise en stock, avoir ou remboursement.

## Lot 2 : international et contenu
5. Boutique multilingue (fr, en, puis langues locales) et multi-devises avec arrondis. **Multi-devises livré (vague 2) ; langues et traduction de l'interface boutique à faire (lot 2 A).**
6. Taxes : TVA par pays, prix TTC/HT, mentions sur facture. **Livré (vague 2).**
7. Blog boutique (articles, catégories, SEO, sections « derniers articles »). **Livré (vague 2).**
8. Webhooks sortants signés et API REST d'administration (jetons existants). **Livré (vague 2).**

## Lot 3 : opérations
9. Expédition avancée : transporteurs locaux, étiquettes, suivi, plusieurs dépôts et stock par dépôt.
10. Caisse en magasin (PWA hors ligne, paiement Mobile Money / espèces, stock partagé).

## Lot 4 : personnalisation sans concurrent (au-delà de Shopify)
Ce que Shopify ne fait pas, ou mal, et qui fera la différence (découpage 4A à 4D : `docs/specs/LOT-4-personnalisation.md` ; **4A livré** en vague 2 : modèles alternatifs et champs personnalisés, sections enregistrées et bibliothèque, scores en direct, préréglages d'animation, plus la personnalisation par audience et les flux catalogues ; restent 4B, 4C, 4D) :
- **Boutique générée par l'IA** : à partir d'une phrase, d'un logo ou de photos, l'IA propose 3 directions complètes (palette, typographie, sections, textes, images) ; le commerçant choisit et ajuste.
- **Kit de marque automatique** : extraction des couleurs du logo, contrôle de contraste AA, déclinaison claire/sombre.
- **Édition directe dans l'aperçu** : cliquer sur un texte pour le modifier en place, glisser une image sur une section pour la remplacer.
- **Modèles alternatifs** par produit et par collection (une fiche « luxe », une fiche « promo ») et champs personnalisés (metafields) reliables aux sections (sources dynamiques).
- **Sections enregistrées et bibliothèque** : sauvegarder une section pour la réutiliser ; bibliothèque de sections premium.
- **Thèmes programmés** : bascule automatique (Tabaski, Noël, soldes) à date et heure, avec retour au thème normal.
- **Personnalisation par audience** : contenus différents selon la ville, nouveau ou client fidèle, provenance (WhatsApp, Instagram, TikTok).
- **Tests A/B de sections** avec mesure de conversion intégrée.
- **Scores en direct dans l'éditeur** : accessibilité, performance (poids des images), SEO, et suggestions de correction en un clic.
- **Préréglages d'animation** sobres (apparition, parallaxe légère) respectant `prefers-reduced-motion`.
- **Commerce social natif** : stories et vidéos achetables, live shopping, catalogue synchronisé WhatsApp / Instagram / TikTok.
- **Boutique installable (PWA)** avec notifications, pensée pour les réseaux lents (mode économie de données).

## Méthode (inchangée)
Chaque lot : spécification, construction par équipes sur des fichiers séparés (un seul responsable du schéma Prisma par vague, migrations additives), tests unitaires, revue de code, audit de sécurité, tests de bout en bout sur build de production, verdict GO / NO-GO.
