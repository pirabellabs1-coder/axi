# Analyse concurrentielle Axi (octobre 2026)

Date : 11 octobre 2026. Périmètre : commerce conversationnel (WhatsApp), Afrique francophone d'abord (Bénin, Côte d'Ivoire, Sénégal, Togo, Cameroun), puis le monde.
Décision servie : **où positionner Axi, quels prix tenir et quoi construire en priorité** dans la feuille de route (`docs/FEUILLE-DE-ROUTE.md`).

Conventions de lecture :
- `[n]` renvoie à la liste des sources en fin de document. Chaque chiffre est sourcé ; « non trouvé » signifie que la recherche n'a rien donné de fiable.
- **Fait** = donnée publiée par l'acteur ou une source indépendante. **Inférence** = notre lecture, signalée comme telle.
- Fiabilité des sources : (A) officielle (page tarifs, aide, communiqué) ; (B) presse spécialisée ; (C) blog de comparaison ou de prestataire (souvent intéressé). Une grande partie des chiffres « Afrique francophone » trouvés en ligne vient de **Kolonell**, une agence qui vend des boutiques sur mesure : niveau C, à recouper.
- Conversion : 1 € = 655,957 FCFA (parité fixe). Pour l'USD, hypothèse 1 USD ≈ 600 FCFA (taux variable, ordre de grandeur seulement).

---

## 1. Résumé exécutif

1. Le commerce par WhatsApp en Afrique francophone est une **tendance durable**, pas une mode : 58 % des Sénégalais et 50 % des Ivoiriens déclarent acheter sur WhatsApp (Kantar, avril 2026) [86].
2. Le concurrent direct le plus dangereux est **Take App** : déjà présent en Côte d'Ivoire, prix en FCFA (offre Essential à 2 900 FCFA/mois), Mobile Money via PawaPay/CinetPay, gratuit jusqu'à 50 commandes/mois [25].
3. **Meta** devient un concurrent : l'agent IA Meta Business Agent est disponible partout depuis juin 2026, gratuit au départ [31][32]. Il banalise la « réponse IA sur WhatsApp ».
4. Le **coût des messages WhatsApp augmente** à partir du 1er octobre 2026 : les messages de service deviennent payants au-delà de 1 000 par mois et par numéro (source fournisseur, à confirmer) [28][29]. Les quotas inclus d'Axi sont à revoir.
5. **Shopify** fixe le niveau attendu en IA (boutique générée par IA depuis 2025, vitrines agentiques depuis mars 2026) [7][3]. En revanche, il est absent du terrain local : pas de Shopify Payments en Afrique, et 2 % de frais en plus avec une passerelle tierce sur le plan Basic [1][8].
6. La **vente directe par des agents IA** est encore trop tôt pour l'Afrique : OpenAI a retiré son paiement intégré à ChatGPT six mois après le lancement [80], et les vitrines agentiques de Shopify ont d'abord ouvert aux États-Unis [6]. Le MCP d'Axi sert à se différencier dans le discours, pas à générer du revenu à court terme.
7. Positionnement libre : **« le Shopify du WhatsApp francophone »**, avec boutique riche, Mobile Money et paiement à la livraison natifs, 0 % de commission, prix en FCFA. Personne ne combine aujourd'hui ces quatre éléments avec une personnalisation forte.
8. Priorités : (a) Wave et Orange Money pour la Côte d'Ivoire et le Sénégal ; (b) synchronisation avec le catalogue WhatsApp et compatibilité avec l'agent Meta ; (c) une offre d'entrée de gamme face à Take App ; (d) une boutique générée par IA, désormais attendue par les clients.

---

## 2. Tableau comparatif principal

Légende : MM = Mobile Money. WA natif = commande ou gestion de la conversation dans WhatsApp intégrée au produit (pas seulement un bouton). Perso = personnalisation de la boutique. AF = présence en Afrique francophone.

| Acteur | Positionnement / cible | Prix (devise) | Commission / frais | MM | WA natif | Perso | IA | AF | Force principale | Faiblesse face à Axi |
|---|---|---|---|---|---|---|---|---|---|---|
| **Axi** | Commerce WhatsApp + boutique riche, PME d'Afrique francophone puis le monde | 0 / 9 / 29 / 79 / dès 199 € ; 0 / 5 000 / 15 000 / 45 000 / dès 130 000 FCFA par mois | 0 % (frais du prestataire de paiement seulement) | Oui (FedaPay, KkiaPay) + paiement à la livraison + Stripe | Oui (boîte partagée, campagnes, entonnoir) | Forte (sections façon Shopify) | MCP marchand + OAuth, MCP vitrine public, crédits IA | Oui (Bénin d'abord) | Seul acteur qui réunit boutique riche, WhatsApp, Mobile Money et FCFA | Couverture Wave / Orange Money non confirmée ; marque inconnue |
| Shopify | Plateforme e-commerce de référence, toutes tailles | Basic 29–39 $, Grow 79–105 $, Advanced 299–399 $ / mois [1][2] | 2 % / 1 % / 0,6 % si passerelle tierce [1] | Indirect (application Paystack ; pas de Shopify Payments en Afrique) [8][9] | Non (applications tierces) | Très forte | Boutique générée par IA, Sidekick, vitrines agentiques (ChatGPT, Copilot, Gemini) [3][7] | Faible (pas de paiement local natif) | Écosystème, IA, agentique | Coût en FCFA (≈ 19 000 FCFA/mois selon [10]) + 2 % ; pas de Wave natif |
| WooCommerce | Extension libre WordPress | Gratuit ; hébergement 25–350 $/mois ; extensions 29–299 $/an [12] | 0 % plateforme | Via extensions (Paystack, CinetPay, KkiaPay…) [13][63] | Non | Très forte (code) | Dépend des extensions | Moyenne (agences locales) | Liberté, extensions locales | Maintenance technique, pas fait pour le mobile seul |
| Wix | Créateur de sites + e-commerce | Core 29 $, Business 39 $, Elite 159 $ / mois (annuel) [14] | 0 % plateforme [14] | Non trouvé | Non | Forte | Wix Harmony (IA, janvier 2026), commerce agentique via PayPal/Stripe [15][16] | Faible | Facilité, IA | Pas de paiement africain, prix en USD |
| Squarespace | Sites haut de gamme + boutique | Core 23–29 $, Plus 39–49 $, Advanced 99 $ / mois (annuel) [17][18] | 0 % sur Core et plus ; 2 % sur Basic [18] | Non trouvé | Non | Forte (design) | Non détaillé | Faible | Design | Hors sujet pour l'Afrique (paiements) |
| Ecwid (Lightspeed) | Boutique intégrable dans un site existant | Starter 5 $, Venture 29–35 $, Business 49–65 $, Unlimited 119–149 $ ; plus de plan gratuit depuis 2025 [19][20] | 0 % [19] | Non trouvé | Non | Moyenne | Non détaillé | Faible | Intégration simple | Hausse de prix en mars 2026 [19] ; aucun ancrage local |
| BigCommerce | Marques moyennes et grandes | Core 29–39 $, Growth 79–105 $, Scale 299–399 $ ; plafonds de CA abaissés en juin 2026 [21] | Jusqu'à 2 % hors passerelles agréées ; 0,9 % au-delà du plafond sur Scale [21] | Non trouvé | Non | Forte | Non détaillé | Non trouvé | Catalogue B2B | Hors cible |
| Shopline | Alternative asiatique à Shopify | Starter 29 $, Essential 79 $, Premium 159 $ (pays non précisé) [23] | Variable selon le marché | Non trouvé | Non | Forte | Non détaillé | Non trouvé | Social commerce en Asie | Absent d'Afrique |
| **Take App** | Boutique + commande WhatsApp, marchés émergents (soutenu par Meta et Y Combinator selon son site) [25] | Basic 0 ; Essential 2 900 FCFA/mois (CI) ; Business 50 $/mois [25] | « 0 commission » sur Basic [25] | Oui : PawaPay, CinetPay, DPO, Flutterwave ; Wave, Orange, MTN en manuel (CI) [25] | Oui (API, boîte, diffusion, workflows) [24] | Moyenne (inférence : thèmes simples) | Chatbot IA WhatsApp et Instagram (Business) [24] | **Oui (CI)** | Prix en FCFA, gratuit jusqu'à 50 commandes, présence mondiale | Personnalisation et outils de fidélité moins riches (inférence) ; Business cher (≈ 30 000 FCFA) |
| Watfy | Non trouvé | Non trouvé | Non trouvé | Non trouvé | Non trouvé | Non trouvé | Non trouvé | Non trouvé | — | Introuvable en ligne : pas une menace visible |
| WhatsApp Business (Meta) | Application gratuite + plateforme API | App gratuite ; API facturée au message [27] ; Meta One Essential 14,99 $ / Advanced 49,99 $ par mois [33] | Messages : marketing et utilitaires payants ; service payant au-delà de 1 000/mois dès le 1/10/2026 [28] | Paiements dans le chat : Inde, Brésil, Singapour seulement [36][37] | Natif | Faible (catalogue) | Meta Business Agent, gratuit puis payant [31][32] | Oui (usage massif) | Canal incontournable | Pas de boutique riche, pas de Mobile Money, pas de livraison |
| Wati | Plateforme API WhatsApp pour PME | Growth 59–69 $, Pro 119–149 $, Business 279–349 $ / mois [29][30] | Majoration sur les messages Meta (jusqu'à environ 60 %) [29] | Non | Oui | Aucune boutique | Chatbots | Non trouvé | Boîte partagée, automatisations | Pas de boutique ; cher en FCFA |
| Interakt | API WhatsApp, Inde | Starter ≈ 33 $, Advanced ≈ 116 $ / mois [39] ; 11 999 ₹/an Starter [38] | Majoration de 12 à 25 % sur les messages [38] | Non | Oui | Faible | Automatisations | Non trouvé | Prix bas en Inde | Centré sur l'Inde |
| SleekFlow | Messagerie omnicanale, Asie et Moyen-Orient | Pro 119–149 $, Premium 299–349 $ / mois [40] ; AED 399 / 999 [41] | Frais messages en plus [40] | Non | Oui | Aucune boutique | Offres IA en supplément [40] | Non trouvé | Omnicanal | Pas de boutique, cher |
| Zoko | WhatsApp pour marchands Shopify | Dès 49,99 $/mois [42][43] | Agent IA de commande : 3 % de la valeur de la commande [42] | Non | Oui | Aucune (dépend de Shopify) | Agents IA payants | Non trouvé | Intégration Shopify | Suppose Shopify ; commission IA |
| Paystack Storefront | Boutique gratuite d'un acteur du paiement (filiale de Stripe) | 0 abonnement [45] | CI : 1,95 % Mobile Money (Wave, MTN, Orange), 3,2 % carte locale, 3,8 % international [44] | **Oui (Wave, MTN, Orange en CI)** [44] | Bouton de discussion WhatsApp seulement [45] | Faible | Non trouvé | Oui (CI) | Gratuit, Wave natif | Boutique basique, pas de CRM ni de campagnes WhatsApp |
| Flutterwave Store | Boutique gratuite (lancée en 2020) | Gratuit en 2020 [46] | Frais de transaction | Oui (2020) | Non | Faible | Non | Non trouvé | — | Statut 2025-2026 non trouvé |
| Bumpa | Gestion commerciale pour vendeurs sur réseaux sociaux (Nigeria) | Gratuit ; Starter 15 000 ₦ et Pro 30 000 ₦ par trimestre [47] | Non trouvé | Oui (Nigeria ; M-Pesa au Kenya) [48] | Partiel (messages Instagram, Facebook, WhatsApp) [49] | Moyenne | IA de tri des messages (source C) | **Non** (Nigeria, Kenya depuis juin 2026) [48] | Application mobile, logistique | Anglophone ; extension vers l'Afrique francophone non annoncée |
| Selar | Produits numériques et créateurs | Commission de 4 à 6 % en monnaies africaines selon TechCabal 2024 [50] | Commission | Oui | Non | Faible | Non trouvé | Faible | 9,8 milliards ₦ versés en 2024 [51] | Hors cible (numérique) |
| Chariow | Produits numériques, Afrique francophone | 0 abonnement | 15 %, puis 10 % au-delà de 5 000 $ de CA [68] | Oui | Non | Faible | Non trouvé | Oui (CI, SN, Guinée) | Francophone, Mobile Money | Hors cible (numérique), commission élevée |
| Jumia | Place de marché généraliste | Gratuit au départ | 8 à 22 % selon la catégorie (Sénégal, source C) [55] | Oui | Non | Aucune | Non trouvé | Oui (CI en croissance [53]) | Trafic, logistique | Pas de marque propre ni de relation client ; s'est retiré de plusieurs pays [52][54] |
| Afrikrea / ANKA | Place de marché mode et artisanat africain, export | 60 €/trimestre, 100 €/semestre ou 200 €/an + commission [56] | Commission variable (10–15 % selon une source non datée [57]) | Non trouvé | Non | Faible | Non trouvé | Oui (origine CI) | Diaspora, export | Place de marché, pas de boutique propre |
| Glovo | Livraison et quick commerce | Non trouvé | Non trouvé | Oui | Non | Aucune | Non trouvé | Oui (CI : environ 1 500 partenaires, dont 90 % de PME) [58] | Livreurs | Complémentaire (livraison) plutôt que concurrent |
| Wave (marchands) | Mobile Money, paiement marchand | 0 abonnement | Environ 1 % (SN) ; 1 à 1,5 % (CI) selon des sources C [60] | — | Non | Aucune | Non | Oui | Adoption massive | Ne fait pas de boutique : c'est un partenaire |
| Orange Money / Max it | Super application + Mobile Money | Non trouvé | Non trouvé | — | Non | Aucune | Non | Oui (Max it depuis 2023 ; OM Pay en CI en 2025) [61][62] | Base d'utilisateurs | Partenaire de paiement, pas une boutique |
| KkiaPay / FedaPay | Agrégateurs de paiement (Bénin) | 0 abonnement | KkiaPay : 3 % Mobile Money (côté client), 3,5 % carte [63] ; FedaPay : 1,8 à 2,5 % Mobile Money (source C) [67] | Oui (MTN, Moov ; FCFA) [64] | Non | Page de paiement personnalisable (FedaPay) [65] | Non | Oui | Déjà intégrés à Axi | Pas de boutique : partenaires |
| Agences (ex. Kolonell) | Boutiques sur mesure | Dès 400 000 FCFA [71] | — | Oui (intégrations) | Variable | Forte (sur mesure) | Variable | Oui (SN, CI) | Accompagnement, référencement | Coût initial 10 à 100 fois plus élevé qu'Axi |
| Genuka | Gestion des ventes et des stocks + site (Cameroun, 2024) [69] | Non trouvé | Non trouvé | Non trouvé | Non trouvé | Moyenne | Non trouvé | Oui (CM) | Gestion de plusieurs points de vente | Petit acteur ; tarifs non publics |
| TikTok Shop | Commerce par la vidéo | — | — | Non (problème signalé au Nigeria) [76] | Non | — | — | **Non confirmé** [75] | Audience | Indisponible officiellement en Afrique francophone (aucune source A) |
| Facebook / Instagram Shops | Catalogue social | Création gratuite | Paiement intégré supprimé en 2025 : renvoi vers le site du marchand [78][79] | Non | Non | Faible | — | Oui (usage) | Découverte des produits | Renvoie vers une boutique : complémentaire d'Axi |
| ChatGPT (OpenAI) | Découverte de produits par IA | — | Paiement intégré (Instant Checkout) lancé en septembre 2025 puis retiré en mars 2026 [80][81] | Non | Non | — | Applications marchandes, protocole ACP | Non | Audience | Bascule vers le site du marchand : un MCP ou un flux catalogue suffit |
| Google (AI Mode / Gemini) | Paiement dans Search et Gemini via le protocole UCP | — | Google Pay, marchands aux États-Unis [82] | Non | Non | — | UCP (protocole ouvert, co-développé avec Shopify) [82][83] | Non | Standard ouvert | États-Unis d'abord |
| Perplexity | Achat dans la conversation avec PayPal | Gratuit aux États-Unis [85] | Frais PayPal | Non | Non | — | Plus de 5 000 marchands au lancement [84] | Non | — | États-Unis seulement |

---

## 3. Fiches par concurrent

### 3.1 Plateformes mondiales

**Shopify**. Prix : Basic 29 $ (annuel) ou 39 $ (mensuel), Grow 79 / 105 $, Advanced 299 / 399 $ [1][2]. Hors Shopify Payments, frais en plus de 2 % / 1 % / 0,6 % [1]. Shopify Payments n'est disponible dans aucun pays africain [8] ; l'application Paystack couvre le Nigeria, le Ghana, le Kenya, le Rwanda, la Côte d'Ivoire et l'Afrique du Sud [9]. IA : boutique générée à partir d'une description (édition Summer '25, trois propositions de mise en page) [7]. Vitrines agentiques annoncées début mars 2026 [4], actives dans ChatGPT depuis le 24 mars 2026, aussi dans Copilot, Google AI Mode et Gemini, « sans frais au-delà du traitement du paiement » [3]. Plan « Agentic » sans abonnement pour les marques qui ne vendent pas sur Shopify [5]. Accès hors États-Unis : progressif, non confirmé par une source officielle [6]. Pas de passerelle XOF officielle ; au Sénégal, coût total estimé à 32 000–45 000 FCFA/mois avec les applications de paiement locales (source C) [11].
- *Forces* : niveau de personnalisation de référence, IA, agents d'achat, écosystème d'applications.
- *Faiblesses face à Axi* : pas de Mobile Money natif ; coût total en FCFA élevé (environ 19 000 FCFA/mois + 2 % selon une source C [10]) ; WhatsApp seulement via des applications tierces payantes (par exemple Zoko dès 49,99 $ [42]).
- *Inférence* : Shopify reste la référence de produit, pas un concurrent de terrain en Afrique francophone en 2026-2027.

**WooCommerce**. Extension gratuite. Hébergement de 25 à 350 $/mois, extensions de 29 à 299 $/an [12]. Mobile Money uniquement via des extensions (le support natif n'existe qu'à l'état de demande de fonctionnalité [13]) ; KkiaPay propose une extension WooCommerce [63]. C'est le choix habituel des agences locales. Faiblesse : demande de la technique et de la maintenance, ce qui ne convient pas à un vendeur seul sur mobile.

**Wix / Squarespace / Ecwid / BigCommerce / Shopline**. Généralistes facturés en USD, sans Mobile Money trouvé ni WhatsApp natif. À noter : Wix Harmony (IA, janvier 2026) [15] et le commerce agentique de Wix via PayPal et Stripe [16] ; Ecwid a supprimé son plan gratuit en 2025 et augmenté ses prix en mars 2026 [19][20] ; BigCommerce a abaissé ses plafonds de chiffre d'affaires en juin 2026 [21] ; Shopline publie quatre plans (Starter, Essential, Premium, Enterprise) avec des prix variables selon le pays [22]. Aucune présence locale trouvée. **Menace faible** sur le cœur de cible d'Axi.

### 3.2 Commerce WhatsApp

**Take App** (concurrent direct numéro 1). Plans : Basic gratuit (50 commandes/mois, produits illimités, sans commission), Essential 2 900 FCFA/mois en Côte d'Ivoire (290 FCFA le premier mois) avec commandes illimitées, domaine personnalisé et CSV, Business 50 $/mois (5 boutiques, 5 membres, 1 000 messages WhatsApp automatiques) [25]. Paiements en Côte d'Ivoire : PawaPay, CinetPay, DPO et Flutterwave en automatique ; Wave, Orange Money et MTN MoMo en manuel ; paiement à la livraison [25]. Business : chatbot IA WhatsApp et Instagram, catalogue WhatsApp, boîte de réception, diffusion, workflows, webhooks, intégrations de livraison [24]. Version française de l'interface disponible [25]. Pas de page pays pour le Bénin (404). Au Kenya, Essential est à 649 KSh/mois avec M-Pesa automatique [26] : le prix local est une stratégie systématique chez Take App.
- *Forces* : entrée gratuite généreuse, prix d'entrée en FCFA inférieur à Axi Starter (2 900 contre 5 000 FCFA), présence mondiale, Mobile Money automatique en Côte d'Ivoire.
- *Faiblesses face à Axi* : plan Business deux fois plus cher qu'Axi Business (≈ 30 000 contre 15 000 FCFA, inférence de conversion) ; personnalisation, fidélité, avis, entonnoir et MCP non trouvés chez Take App.

**WhatsApp Business et Meta**. L'API est facturée au message depuis le 1er juillet 2025 [27]. À partir du 1er octobre 2026 : messages de service gratuits jusqu'à 1 000 par mois et par numéro, puis payants ; modèles utilitaires envoyés dans la fenêtre de 24 h payants dès le premier message [28]. Seules sources : respond.io et l'aide de Wati citée par Macha [29] ; la page Meta consultée ne le mentionne pas [27]. **À vérifier dans le Business Manager.** Les conversations ouvertes depuis une publicité « Click-to-WhatsApp » restent gratuites pendant 72 h [27][28].
- Meta Business Agent : disponible partout depuis le 3 juin 2026 (WhatsApp, Instagram, Messenger). Il répond aux clients, recommande des produits, qualifie les prospects, prend des rendez-vous et passe la main à un humain [31]. Gratuit au départ, offres payantes ensuite [32]. Le paiement par l'agent est un objectif annoncé, pas une fonction disponible [32].
- Meta One (offres professionnelles) : Essential 14,99 $ et Advanced 49,99 $ par mois [33]. Selon un résumé de presse non vérifié en direct, l'agent est inclus dans Essential [34].
- Paiements dans WhatsApp : Inde, Brésil, Singapour ; aucun pays africain trouvé [36][37].
- Politique : depuis le 15 janvier 2026, les assistants IA généralistes sont interdits sur l'API ; les bots métier (service client, commandes, ventes) restent autorisés [35].

**Wati / Interakt / SleekFlow / Zoko**. Outils de messagerie sans boutique, facturés en USD ou INR, avec une majoration sur les messages Meta (Wati jusqu'à environ 60 % sur les petits plans [29], Interakt de 12 à 25 % [38]). Aucune présence en Afrique francophone trouvée. Zoko facture son agent IA de commande 3 % de la valeur de la commande [42]. **Menace faible à moyenne** : ils fixent le prix de référence d'une boîte WhatsApp partagée (60 à 150 $/mois), ce qui rend le plan Business d'Axi à 29 € ou 15 000 FCFA très compétitif.

**Watfy**. Non trouvé (aucune source). **Kwik** : KwikStore, boutique gratuite liée à un service de livraison au Nigeria, lancée vers 2022 ; lien avec WhatsApp non trouvé [72]. **Sukhiba** (Kenya) : commerce dans WhatsApp, 1,55 M$ levés en 2024, 8 marchés, centré sur l'Afrique de l'Est [73].

### 3.3 Afrique

**Paystack Storefront**. Boutique gratuite, sans abonnement, frais uniquement sur les transactions [45]. Fonctions : variantes, alertes de stock, bouton de discussion WhatsApp, frais de livraison [45]. Côte d'Ivoire : 1,95 % sur le Mobile Money (Wave, MTN, Orange), 3,2 % sur carte locale, 3,8 % à l'international, hors TVA [44]. Liste complète des pays de Storefront non vérifiée (page officielle inaccessible en 403).
- *Inférence* : concurrent gratuit « suffisant » pour les très petits vendeurs ivoiriens, et surtout **partenaire potentiel** pour l'accès à Wave en Côte d'Ivoire.

**Flutterwave Store**. Lancé gratuitement en 2020 dans 15 pays [46]. Statut 2025-2026 : non trouvé.

**Bumpa**. Nigeria. Plans gratuit, 15 000 ₦ ou 30 000 ₦ par trimestre [47]. Arrivée au Kenya en juin 2026 avec M-Pesa (article sponsorisé) [48]. Messages Instagram, Facebook et WhatsApp regroupés ; Instagram représente 40 % des ventes enregistrées [49]. Présence en Afrique francophone : non trouvée. *Inférence* : profil le plus proche d'Axi parmi les acteurs africains ; son extension va vers l'Est anglophone, pas vers l'UEMOA.

**Selar / Chariow**. Produits numériques. Chariow : commission de 15 %, puis 10 % au-delà de 5 000 $ de chiffre d'affaires, Mobile Money, présent en Côte d'Ivoire, au Sénégal et en Guinée [68]. Hors cible, sauf si Axi accentue les produits numériques (le plan Business les inclut déjà).

**Jumia**. Côte d'Ivoire en croissance au 4e trimestre 2025 [53]. Sortie d'Algérie en 2026 [54], et auparavant d'Afrique du Sud, de Tunisie, du Cameroun et du Gabon [52][54]. Commissions au Sénégal de 8 à 22 % selon les sources C [55]. *Inférence* : canal d'acquisition pour les vendeurs, pas une alternative à une boutique propre.

**Afrikrea / ANKA**. Abonnement de 60 €/trimestre à 200 €/an + commission [56]. Place de marché orientée export.

**Glovo**. Côte d'Ivoire : environ 1 500 partenaires, dont 90 % de PME [58] ; le quick commerce est le segment le plus dynamique [59]. **Partenaire de livraison** plutôt que concurrent.

**Wave / Orange Money**. Frais marchands Wave d'environ 1 % (SN) et 1 à 1,5 % (CI) selon des sources C [60]. Orange : super application Max it (2023) [61], OM Pay en Côte d'Ivoire (2025) [62]. Ce sont des **partenaires indispensables** : Paystack les donne comme couverts en Côte d'Ivoire [44]. Les documents de KkiaPay ne mentionnent que MTN, Moov et les cartes [64]. Pour FedaPay, la couverture « de la plupart des moyens mobiles » au Sénégal, en Côte d'Ivoire, au Togo et au Niger date de 2021 [66] ; Wave n'y est pas cité explicitement. **Lacune probable d'Axi en Côte d'Ivoire et au Sénégal.**

**KkiaPay / FedaPay**. Pas de boutique au sens propre. FedaPay propose une page de paiement personnalisable, présentée comme « une présence en ligne sans site e-commerce » [65]. Les frais officiels de KkiaPay (3 % sur le Mobile Money côté client, 3,5 % carte, 7 000 FCFA par virement bancaire) proviennent d'une documentation v1 peut-être ancienne [63].

**Autres acteurs francophones**. Genuka (Cameroun, 2024 : stocks, plusieurs points de vente, site) [69] ; TillPaid (Bénin, paiements pour WooCommerce, présent dans 6 pays) [70] ; agences comme Kolonell (boutique dès 400 000 FCFA) [71]. **Aucune plateforme SaaS francophone de commerce WhatsApp avec boutique riche n'a été trouvée.** C'est l'espace libre que vise Axi (confiance moyenne, l'absence de preuve n'étant pas une preuve d'absence). Le financement est rare : la Côte d'Ivoire, la Tanzanie et le Maroc n'ont levé ensemble que 25 M$ au premier semestre 2026 [87] ; en juillet 2026, 102 M$ pour toute l'Afrique, dont trois levées sur quatre en dette [88]. *Inférence* : peu de nouveaux entrants locaux bien financés à court terme ; la menace vient plutôt d'acteurs mondiaux déjà financés (Take App, Meta).

### 3.4 Commerce social

**TikTok Shop**. Aucune annonce officielle de lancement en Afrique trouvée. TechCabal indiquait l'absence de la fonction en Afrique [75] ; des blogs C affirment des tests en Côte d'Ivoire et au Sénégal [77] sans preuve. Au Nigeria, l'intégration du Mobile Money et le paiement dans l'application sont jugés défaillants [76]. Verdict : **signal faible, non confirmé**.

**Facebook / Instagram Shops**. Meta a supprimé le paiement dans Facebook et Instagram : les acheteurs sont renvoyés vers le site du marchand depuis août-septembre 2025 [78][79]. *Inférence* : bonne nouvelle pour Axi. Le catalogue social devient une vitrine qui renvoie vers une boutique, rôle qu'Axi peut remplir.

### 3.5 Agents IA acheteurs

- **ChatGPT** : Instant Checkout lancé le 29 septembre 2025 (États-Unis, Etsy puis Shopify) [90]. Retiré environ six mois plus tard, au profit du paiement sur le site du marchand ou d'une application contrôlée par le marchand [80]. Une synthèse secondaire évoque une trentaine de marchands actifs seulement (chiffre non recoupé) ; Digital Commerce 360 confirme le rôle de Stripe et l'absence de déploiement confirmé hors États-Unis [81].
- **Google** : protocole UCP (janvier 2026, co-développé avec Shopify). Paiement dans AI Mode et Gemini auprès de marchands américains via Google Pay [82][83].
- **Perplexity** : achat dans la conversation avec PayPal depuis fin novembre 2025, plus de 5 000 marchands, États-Unis [84][85].
- **Verdict** : tendance structurelle aux États-Unis (Shopify, Google, OpenAI et PayPal investissent), mais le **paiement dans le chat recule** au profit de la découverte suivie d'un renvoi vers le marchand. Pour l'Afrique francophone : **trop tôt** côté acheteurs. Côté marchands, l'usage quotidien de l'IA atteint 39 % au Sénégal et en Côte d'Ivoire (Kantar) [86], ce qui crédibilise l'argument « gérez votre boutique depuis ChatGPT ou Claude ».

---

## 4. Carte de positionnement (description)

Axe horizontal : **généraliste** (gauche) à **spécialisé Afrique / WhatsApp** (droite).
Axe vertical : **profondeur fonctionnelle** (catalogue, personnalisation, marketing, opérations), faible en bas, forte en haut.

- **Haut gauche** (profonds et généralistes) : Shopify, BigCommerce, puis Wix, Squarespace, Shopline, WooCommerce (profond mais technique). Ecwid un peu plus bas.
- **Milieu gauche** (outils de messagerie généralistes) : Wati, SleekFlow, Interakt, Zoko. Profonds sur la conversation, absents sur la boutique.
- **Bas droite** (spécialisés Afrique, peu profonds) : Paystack Storefront, Flutterwave Store, KwikStore, pages de paiement FedaPay, catalogue WhatsApp Business, Chariow et Selar (numérique).
- **Milieu droite** : Take App (WhatsApp, Mobile Money, FCFA, profondeur moyenne), Bumpa (Afrique anglophone, gestion + réseaux sociaux), Genuka.
- **Hors carte** : places de marché (Jumia, ANKA, Glovo, TikTok Shop) qui louent du trafic, et Meta (Business Agent) qui se place comme couche IA au-dessus de tout le monde.
- **Haut droite** (spécialisé et profond) : **vide à part Axi.** C'est la case à occuper, à condition que la profondeur soit réelle sur ce qui compte localement (Mobile Money de chaque pays, paiement à la livraison, livraison, WhatsApp) et pas seulement sur la parité avec Shopify.

Risque de position : Take App peut monter verticalement (plus de profondeur) plus vite qu'Axi ne gagne en notoriété ; Meta peut écraser le milieu de la carte (conversation et IA) gratuitement.

---

## 5. Tendances : mode ou tendance durable ?

| Signal | Preuves | Verdict | Moteur durable | Confiance |
|---|---|---|---|---|
| Achat par WhatsApp en Afrique francophone | Kantar 2026 : 58 % (SN), 50 % (CI) déclarent acheter sur WhatsApp ; les réseaux sociaux pèsent 85 % des usages d'achat principaux [86] ; présence de Take App en CI [25] ; sortie du paiement intégré de Meta [78] | **Tendance durable** | WhatsApp omniprésent, Mobile Money, confiance par la conversation | Moyenne-haute (données déclaratives) |
| IA conversationnelle de vente sur WhatsApp | Meta Business Agent mondial et gratuit [31] ; Take App et Zoko proposent des agents [24][42] | Tendance, mais **banalisée par Meta** | Coût du service client | Haute |
| Agents IA acheteurs | Instant Checkout retiré [80] ; UCP, Perplexity et Shopify aux États-Unis [3][82][84] | Tendance aux États-Unis ; **trop tôt** en Afrique | Découverte par l'IA | Moyenne |
| Boutique générée par IA | Shopify (2025) [7], Wix Harmony (2026) [15] | Devenue **un standard attendu** (plus un différenciateur) | Coût d'acquisition et d'activation | Haute |
| TikTok Shop en Afrique francophone | Seulement des blogs C [77] ; TechCabal : indisponible [75] | **Non confirmé** | — | Faible |
| Hausse du coût des messages WhatsApp | respond.io [28], Wati via Macha [29] ; absent de la page Meta consultée [27] | Probable | Monétisation par Meta | Moyenne |

---

## 6. Menaces classées (probabilité × impact)

Échelle de 1 à 5. Score = P × I.

| # | Menace | P | I | Score | Pourquoi | Parade |
|---|---|---|---|---|---|---|
| 1 | **Take App gagne la Côte d'Ivoire et le Sénégal avant Axi** | 4 | 5 | 20 | Déjà en CI, 2 900 FCFA/mois, gratuit jusqu'à 50 commandes, Mobile Money automatique [25] | Offre d'entrée équivalente, Wave et Orange natifs, messages comparatifs (Business deux fois moins cher) |
| 2 | **Meta banalise l'IA de vente et la boîte de réception** | 5 | 4 | 20 | Agent gratuit et mondial [31][32] ; Meta One à 14,99 $ [33] | Ne pas vendre « l'IA qui répond » ; vendre la boutique, le paiement, la livraison et les données ; être la source catalogue et commandes de l'agent Meta |
| 3 | **Couverture Mobile Money incomplète hors Bénin** | 4 | 4 | 16 | KkiaPay documente MTN et Moov seulement [64] ; Wave non confirmé chez FedaPay [66] ; Wave est central en CI et au SN [60] | Ajouter un agrégateur avec Wave et Orange en CI et au SN (Paystack CI [44], PawaPay [89] ou CinetPay) |
| 4 | **Coût des messages en hausse** (1/10/2026) | 4 | 3 | 12 | Service payant au-delà de 1 000, utilitaires payants dans la fenêtre [28] | Revoir les quotas et les packs, privilégier les publicités Click-to-WhatsApp (72 h gratuites [27]) et les liens vers l'application WhatsApp Business |
| 5 | Paystack Storefront gratuit en CI | 3 | 3 | 9 | 0 abonnement, Wave natif [44][45] | Se différencier sur WhatsApp, le CRM, la personnalisation ; envisager un partenariat |
| 6 | Shopify ouvre l'agentique et le paiement local en Afrique | 2 | 4 | 8 | Accès hors États-Unis en cours [6] ; pas de Shopify Payments en Afrique [8] | Garder l'avance « locale » ; import CSV compatible Shopify pour accueillir ceux qui partent |
| 7 | Bumpa s'étend vers l'Afrique francophone | 2 | 4 | 8 | Kenya en juin 2026 [48] ; rien sur l'UEMOA | Surveiller ; verrouiller tôt la marque francophone |
| 8 | Politique Meta sur l'IA / risque de plateforme | 2 | 4 | 8 | Assistants généralistes interdits [35] ; dépendance à l'API | Bots métier uniquement ; boutique web et Mobile Money indépendants de WhatsApp |
| 9 | TikTok Shop lancé en Afrique francophone | 2 | 3 | 6 | Non confirmé [75][77] | Préparer une synchronisation de catalogue seulement si le lancement est confirmé |
| 10 | Agences locales (sur mesure) | 3 | 2 | 6 | Fort référencement (Kolonell) [71] | Programme revendeurs et agences (plan Enterprise, marque blanche) |

---

## 7. Opportunités (hypothèses testables)

**O1. Le haut de gamme accessible du commerce WhatsApp francophone.**
Hypothèse : des vendeurs ivoiriens et sénégalais qui dépassent 50 commandes/mois paieront 15 000 FCFA pour une boîte partagée, des campagnes et une boutique soignée, plutôt que Take App Business à environ 30 000 FCFA ou Wati à plus de 59 $.
Test peu coûteux : page d'atterrissage CI/SN « Axi vs Take App » avec un comparatif de prix ; 200 € de publicité Click-to-WhatsApp ; mesurer le taux d'essai Business, avec un seuil de succès à 3 % des visiteurs (seuil arbitraire à calibrer).
Fenêtre : ouverte mais **se referme** (Take App déjà en place). Adéquation aux forces d'Axi : forte.

**O2. Wave et Orange Money natifs avec rapprochement automatique en CI et au SN.**
Hypothèse : l'encaissement automatique Wave double la part de commandes payées en ligne par rapport à Wave manuel (Take App propose Wave en manuel seulement en CI [25]).
Test : 10 boutiques pilotes avec un agrégateur (Paystack CI à 1,95 % [44] ou PawaPay) ; comparer la part payée en ligne et le délai de confirmation.
Fenêtre : ouverte. Adéquation : forte (le rapprochement existe déjà dans Axi).

**O3. Axi comme source de catalogue et de commandes de l'agent Meta.**
Hypothèse : en synchronisant le catalogue Axi vers le catalogue WhatsApp (Commerce Manager) et en reprenant les commandes, Axi transforme Meta Business Agent d'une menace en canal.
Test : prototype de synchronisation sur 3 boutiques ; vérifier que l'agent Meta recommande les produits et renvoie vers le panier Axi.
Fenêtre : s'ouvre maintenant (juin 2026). Adéquation : moyenne à forte (le lien de panier MCP `create_checkout_link` existe déjà).

**O4. « Prête pour l'IA » comme argument différenciant, sans en attendre de revenu.**
Hypothèse : l'argument « gérez votre boutique depuis ChatGPT ou Claude » augmente la conversion des marchands technophiles (39 % d'usage quotidien de l'IA au SN et en CI [86]).
Test : test A/B du message sur la page tarifs ; suivre l'activation OAuth dans les comptes Business.
Fenêtre : trop tôt pour l'achat par agent en Afrique, juste à temps pour la gestion par IA côté marchand.

**O5. Diaspora et export (multidevise, carte).**
Hypothèse : les marques de mode et de beauté vendant à la diaspora (le créneau d'ANKA [56]) paieront le plan Scale pour une boutique en EUR + FCFA.
Test : entretiens avec 10 marques ; préventes du lot 2 (multilingue et multidevise).
Fenêtre : ouverte. Adéquation : moyenne (dépend du lot 2).

### Dimensionnement (ordres de grandeur, hypothèses explicites)
Il n'existe pas de chiffre public fiable sur le nombre de vendeurs WhatsApp formels en UEMOA (**non trouvé**). Nous dimensionnons donc par l'unité économique, pas par un marché total inventé.
- ARPU payant (hypothèse de répartition) : Starter 60 % × 5 000 + Business 30 % × 15 000 + Scale 10 % × 45 000 = **12 000 FCFA/mois (≈ 18 €)**. Fourchette : 8 000 FCFA (bas : 70 % Starter, 30 % Business) à 16 000 FCFA (haut : 50 % Starter, 30 % Business, 20 % Scale).
- Pour 10 M FCFA de revenu mensuel (≈ 15 200 €) : 625 (haut), 830 (attendu) ou 1 250 (bas) marchands payants.
- Avec une conversion gratuit vers payant de 2 à 5 % (hypothèse classique du freemium, **non validée pour Axi**), il faut **12 500 à 62 500 inscriptions gratuites**. La conversion réelle à 60 jours est la première mesure à suivre.
- Confiance : faible sur les volumes, moyenne sur l'ARPU (prix connus).

---

## 8. Recommandations pour Axi

### 8.1 Prix
1. **Garder 0 % de commission** sur tous les plans. C'est un avantage net face à Chariow (15 %), Jumia (8 à 22 %), Zoko (3 % sur les commandes IA) et Shopify (+2 % hors Shopify Payments) [68][55][42][1].
2. **Rendre le plan gratuit au moins équivalent à Take App** : passer de 15 produits / 20 commandes à environ 50 commandes/mois et des produits illimités (ou 100). Take App Basic offre 50 commandes et des produits illimités [25]. Sinon, Axi perd la comparaison au premier coup d'œil.
3. **Offre d'entrée face à Essential (2 900 FCFA)** : deux options à tester, (a) Starter à 3 000 FCFA en Afrique, ou (b) Starter maintenu à 5 000 FCFA mais avec ce que Take Essential n'a pas (Mobile Money automatique, coupons, sans logo) et un premier mois à 500 FCFA. Recommandation : **tester (b)** avant de baisser le prix catalogue.
4. **Business à 15 000 FCFA : ne pas toucher.** C'est l'argument « deux fois moins cher que Take App Business, quatre fois moins cher que Wati ».
5. **Messages WhatsApp** : après le 1er octobre 2026, distinguer service / utilitaire / marketing dans les quotas ; vérifier les tarifs Meta « Reste de l'Afrique » avant de fixer le prix des packs (tarifs Afrique non trouvés en clair [27]) ; afficher une facturation au coût Meta plus une marge transparente (les concurrents prennent de 12 à 60 % [29][38]).

### 8.2 Feuille de route : ce qui remonte et ce qui descend

| Priorité | Élément | Raison (preuve) |
|---|---|---|
| **P0** (nouveau) | Wave + Orange Money automatiques en CI et SN (agrégateur) | Lacune probable [64][66] ; Wave central [60] ; Paystack CI couvre Wave, MTN et Orange [44] |
| **P0** (nouveau) | Synchronisation avec le catalogue WhatsApp et compatibilité Meta Business Agent | Agent gratuit et mondial [31] ; Facebook et Instagram renvoient vers le site [78] |
| **P0** | Plan gratuit et offre d'entrée revus | Take App [25] |
| P1 (lot 4, à avancer) | **Boutique générée par l'IA** | Standard depuis Shopify 2025 [7] et Wix 2026 [15] : réduit le temps avant la première vente |
| P1 (lot 4) | PWA, mode économie de données | Réseaux lents, usage mobile (inférence) |
| P1 (lot 4) | Thèmes programmés (Tabaski, Noël) | Peu coûteux, très parlant en marketing local |
| P1 | Confirmation de commande et paiement à la livraison par WhatsApp (modèles utilitaires) | Paiement à la livraison ≈ 25 % des commandes en zone rurale au Bénin et confirmation par WhatsApp recommandée (source C) [74] ; attention au coût des utilitaires [28] |
| P2 (lot 1, en cours) | Comptes acheteurs, remises automatiques, cartes cadeaux, retours | Parité utile, mais pas ce qui fait gagner face à Take App |
| P2 (lot 2) | Multilingue, multidevise, TVA | Monde et diaspora (O5) |
| P2 (lot 3) | Caisse, plusieurs dépôts | Genuka va déjà sur le multi-points de vente [69] ; marchands plus avancés |
| P3 | Tests A/B de sections, personnalisation par audience, live shopping, TikTok | Volume insuffisant pour l'A/B chez les petits vendeurs ; TikTok Shop non confirmé [75] |
| P3 | Achat par agent IA (au-delà du MCP vitrine actuel) | Paiement dans le chat en recul [80] ; États-Unis d'abord [6][82] : garder l'existant, ne pas investir davantage |

### 8.3 Partenariats
- **Paiements** : un agrégateur qui couvre Wave et Orange en CI et au SN (Paystack, PawaPay ou CinetPay) ; Wave Business en direct à terme.
- **Meta** : statut de prestataire technique (Tech Provider / BSP) pour l'inscription intégrée, et programme partenaire pour la synchronisation de catalogue.
- **Livraison** : Glovo CI (environ 1 500 partenaires PME [58]) et coursiers locaux ; Take App intègre déjà Lalamove et Uber Direct ailleurs [24].
- **Agences et revendeurs** : transformer les agences (Kolonell et d'autres) en revendeurs du plan Enterprise en marque blanche plutôt qu'en concurrents.
- **Données** : obtenir l'étude Kantar Afrique francophone complète pour fiabiliser le dimensionnement.

### 8.4 Messages marketing (à tester)
1. « Votre boutique WhatsApp, payée en Wave, Orange Money ou à la livraison. 0 % de commission. » (local, concret ; à publier seulement quand Wave et Orange seront réellement disponibles)
2. « Le WhatsApp professionnel en équipe pour 15 000 FCFA, deux fois moins cher que les autres. » (contre Take App et Wati ; vérifier les prix avant publication)
3. « Une vraie boutique, pas juste un catalogue. » (contre Paystack Storefront et le catalogue WhatsApp)
4. « Gérez votre boutique depuis ChatGPT ou Claude. » (différenciation, cible technophile)
5. « Changez de thème pour la Tabaski en un clic. » (quand les thèmes programmés seront livrés)
Éviter : « dépasser Shopify » dans les messages publics (promesse non crédible pour un marchand ; Shopify est la référence de produit, pas l'ennemi de terrain).

---

## 9. Limites de cette analyse
- Plusieurs prix viennent de comparateurs (niveau C) ; les pages tarifs officielles de Shopify, Wix, Squarespace et Wati n'ont pas pu être consultées directement. À revérifier avant toute publication comparative (obligation de loyauté de la publicité comparative).
- Chiffres africains souvent issus de Kolonell (agence, intéressée) : Wave, FedaPay, Jumia SN.
- La couverture Wave / Orange Money d'Axi via FedaPay et KkiaPay est **déduite de leur documentation publique**, pas du code d'Axi ni des contrats : à confirmer en interne.
- Non trouvés : Watfy, tarifs Genuka, Glovo (commissions), Orange Money (frais marchands en ligne), Flutterwave Store 2025-2026, tarifs Meta « Reste de l'Afrique », pays officiels de Paystack Storefront, nombre de vendeurs WhatsApp en UEMOA, lancement officiel de TikTok Shop en Afrique.

---

## 10. Sources

Consultées entre le 10 et le 11 octobre 2026. Fiabilité : A officielle, B presse, C blog ou comparateur.

1. Qualimero, Shopify transaction fees 2026 (C) : https://qualimero.com/en/blog/shopify-transaction-fees
2. Rigby, Shopify cost 2026 (C) : https://rigbyjs.com/blog/shopify-cost
3. Shopify, Agentic commerce momentum, 24/03/2026 (A) : https://shopify.com/news/agentic-commerce-momentum
4. Shopifreaks, Shopify agentic storefronts in ChatGPT, 13/03/2026 (B) : https://www.shopifreaks.com/shopify-launches-agentic-storefronts-in-chatgpt-as-openai-shifts-away-from-native-instant-checkout/
5. eCommerce Fastlane, Shopify Agentic plan (C) : https://ecommercefastlane.com/shopify-agentic-plan/
6. Shopify Community, agentic shopping US only (C) : https://community.shopify.com/t/chatgpt-copilot-agentic-shopping-is-it-live-for-all-shopify-stores/585319
7. TechCrunch, Shopify AI store builder, 21/05/2025 (B) : https://techcrunch.com/2025/05/21/shopify-launches-an-ai-powered-store-builder-as-part-of-its-latest-update
8. CS-Cart, Shopify Payments supported countries (C) : https://www.cs-cart.com/blog/shopify-payments-supported-countries/
9. Shopify App Store, Paystack (A) : https://apps.shopify.com/paystack
10. Kolonell, Créer boutique en ligne Abidjan 2026 (C) : https://kolonell.com/fr/blog/creer-boutique-en-ligne-abidjan-guide-complet-2026
11. Kolonell, Shopify Sénégal paiement local 2026 (C) : https://kolonell.com/fr/blog/shopify-senegal-configuration-paiement-local-2026
12. eSEOspace, WooCommerce costs 2026 (C) : https://eseospace.com/blog/woocommerce-costs/
13. WooCommerce, feature request Mobile Money Africa (A) : https://woocommerce.com/feature-request/mobile-money-payments-for-africa/
14. CostBench, Wix eCommerce (C) : https://costbench.com/software/ecommerce/wix-ecommerce
15. Shopifreaks, Wix Harmony, 22/01/2026 (B) : https://www.shopifreaks.com/wix-launches-harmony-ai-website-builder-with-natural-language-tools/
16. Wix Blog, AI agents buy from your store (A, marketing) : https://www.wix.com/blog/how-to-get-ai-agents-to-buy-from-your-online-store
17. Beancount, Squarespace new pricing, 17/09/2026 (C) : https://beancount.io/blog/2026/09/17/squarespace-new-pricing-basic-core-plus-advanced-small-business-guide
18. CostBench, Squarespace Commerce (C) : https://www.costbench.com/software/ecommerce/squarespace-commerce/
19. CostBench, Ecwid (C) : https://costbench.com/software/ecommerce/ecwid/
20. trusted.de, Ecwid (C) : https://trusted.de/ecwid
21. Elsner, BigCommerce pricing 2026 (C) : https://www.elsner.com/bigcommerce-pricing-plans/
22. SHOPLINE Help, Pricing plans (A) : https://help.shopline.com/hc/en-001/articles/14197432326041
23. SoftwareSuggest, Shopline pricing (C) : https://www.softwaresuggest.com/shopline/pricing
24. Take App Help, Subscription plans and features (A) : https://www.take.app/help/subscription-plans-and-features
25. Take App, Ivory Coast (A) : https://www.take.app/country/ivory-coast
26. Take App, Kenya (A) : https://www.take.app/country/kenya
27. Meta for Developers, WhatsApp pricing (A) : https://developers.facebook.com/docs/whatsapp/pricing
28. respond.io, Changement de tarification WhatsApp 2026, 03/09/2026, mis à jour le 06/10/2026 (C, fournisseur) : https://respond.io/fr/blog/whatsapp-pricing-change-2026
29. Macha, Wati pricing explained (C) : https://www.getmacha.com/blog/wati-pricing-explained
30. Chatarmin, Wati pricing (C) : https://chatarmin.com/en/blog/wati-pricing
31. TechCrunch, Meta's AI agent for WhatsApp Business available globally, 03/06/2026 (B) : https://www.techcrunch.com/2026/06/03/metas-ai-agent-for-whatsapp-business-is-now-available-globally/
32. Allwork, Meta launches AI agent, 06/2026 (B) : https://allwork.space/2026/06/meta-launches-ai-agent-that-can-book-appointments-process-payments-and-close-sales/
33. Dawan Africa, Meta subscription plans, 28/05/2026 (B) : https://www.dawan.africa/news/meta-rolls-out-new-subscription-plans-for-facebook-instagram-whatsapp-and-meta-ai
34. PetaPixel, Meta One, 15/09/2026 (B ; page inaccessible, contenu repris d'un résumé de recherche) : https://petapixel.com/2026/09/15/meta-adds-more-subscription-offerings-in-the-form-of-meta-one/
35. respond.io, WhatsApp general-purpose chatbots ban (C) : https://respond.io/blog/whatsapp-general-purpose-chatbots-ban
36. Sinch, WhatsApp Pay (C) : https://sinch.com/de/blog/whatsapp-pay-mobile-payment-news-statistiken-und-entwicklungen/
37. eGrow, WhatsApp Pay and payments 2026 (C) : https://www.egrow.com/en/blog/whatsapp-pay-and-payments-2026
38. Codingclave, Interakt pricing India 2026 (C) : https://codingclave.com/blog/interakt-pricing-india-2026
39. Toolradar, Interakt pricing (C) : https://toolradar.com/tools/interakt/pricing
40. eesel, SleekFlow pricing 2026 (C) : https://www.eesel.ai/blog/sleekflow-pricing
41. SleekFlow, Pricing UAE (A) : https://sleekflow.io/en-ae/pricing
42. Pulse Signal, Zoko pricing, vérifié le 29/09/2026 (C) : https://getpulsesignal.com/pricing/zoko
43. Shopify App Store, Zoko (A) : https://apps.shopify.com/whatsapp-button-chat
44. Paystack Support, Transactions pricing (A) : https://support.paystack.com/hc/en-us/articles/360009881920
45. Paystack, Introducing Storefront (A) : https://paystack.com/blog/product/storefront et https://paystack.com/storefront
46. TechCrunch, Flutterwave Store, 30/04/2020 (B) : https://techcrunch.com/2020/04/30/african-fintech-firm-flutterwave-launches-sme-e-commerce-portal/
47. Bumpa, Pricing (A) : https://getbumpa.com/pricing
48. The Standard (Kenya), Bumpa enters Kenya, 10/06/2026 (B, contenu sponsorisé) : https://test.standardmedia.co.ke/business/amp/branding-voice/article/2001549990/west-african-business-management-platform-bumpa-enters-kenyan-market
49. Techpoint Africa, Bumpa Meta integration (B) : https://techpoint.africa/news/bumpa-meta-integration/
50. TechCabal, Selar, 24/01/2024 (B) : https://techcabal.com/2024/01/24/selar-africa-creator-economy/
51. Techpoint Africa, Selar paid out ₦9.8bn in 2024 (B) : https://techpoint.africa/news/selar-paid-out-9-8-billion-in-2024/
52. Gazette Nigeria, Jumia exits South Africa, Tunisia (B) : https://gazettengr.com/jumia-exits-south-africa-tunisia-to-focus-on-nigeria-other-african-markets/
53. Fintool, Jumia Q4 2025 earnings (C) : https://fintool.com/app/research/companies/JMIA/earnings/Q4%202025
54. Tuniscope, Jumia Algérie, 11/02/2026 (B) : https://www.tuniscope.com/article/424758/business/economie/jumia-272011
55. Kolonell, Local marketplace vs Jumia Senegal 2026 (C) : https://kolonell.com/en/blog/local-marketplace-vs-jumia-senegal-2026
56. ANKA Support, How it works (A, non daté) : https://support.anka.africa/en/articles/19842-how-it-works
57. Wellfound, Afrikrea (C, non daté) : https://wellfound.com/company/afrikrea
58. Digital Mag CI, Glovo Partner Academy 2026 (B) : https://digitalmag.ci/glovo-ci-partner-academy-2026-entre-formation-et-digitalisation-des-services-au-profil-des-pme/?amp=1
59. Financial Afrik, Interview Sacha Michaud (Glovo), 08/07/2026 (B) : https://www.financialafrik.com/2026/07/08/interview-exclusive-de-sacha-michaud-co-fondateur-de-glovo/
60. Kolonell, Wave CI vs Sénégal frais marchand 2026 (C) : https://kolonell.com/fr/blog/wave-cote-ivoire-vs-senegal-frais-marchand-comparatif-2026
61. FinTech Futures, Orange launches Max it (B) : https://www.fintechfutures.com/fintech-innovation/orange-launches-super-app-max-it-in-africa
62. Osiris, Orange CI lance OM Pay (B) : https://www.osiris.sn/orange-cote-d-ivoire-lance-om-pay-pour-simplifier-les-paiements-mobiles.html
63. KkiaPay Docs, Frais (A, v1) : https://docs.kkiapay.me/v1/en-1.0.0/paiements/frais
64. KkiaPay Docs, Méthodes de paiement (A) : https://docs.kkiapay.me/v1/paiements/methodes-de-paiement
65. FedaPay Support, Accepter des paiements (A) : https://support.fedapay.com/portal/en/kb/articles/comment-accepter-des-paiements-avec-fedapay
66. CIO Mag, Ambitions panafricaines de FedaPay, 28/12/2021 (B) : https://cio-mag.com/fintech-les-ambitions-panafricaines-de-lagregateur-de-paiement-fedapay/
67. Kolonell, KkiaPay / FedaPay Bénin 2026 (C) : https://kolonell.com/fr/blog/kkiapay-fedapay-benin-integration-marchand-cotonou-2026
68. Chariow Help, Pricing model (A) : https://help.chariow.com/en/articles/166-pricing-model-on-chariow
69. We Are Tech Africa, Genuka (B) : https://www.wearetech.africa/fr/fils/tech-stars/genuka-wilfried-djopa-automatise-la-gestion-des-ventes-et-des-stocks
70. We Are Tech Africa, TillPaid Bénin (B) : https://www.wearetech.africa/fr/fils/solutions/benin-tillpaid-propose-des-solutions-de-paiement-via-mobile-money-aux-sites-de-commerce-en-ligne
71. Kolonell, Services e-commerce (A pour son propre prix) : https://kolonell.com/fr/services/ecommerce
72. Logistafrica, Kwik launches KwikStore (B) : https://logistafrica.com/en/e-commerce-en/kwik-launches-kwikstore-an-easy-to-use-e-commerce-solution-to-help-african-merchants-sell-online-from-their-smartphone/
73. TechEconomy, Sukhiba seed extension (B) : https://www.techeconomy.ng/kenyas-sukhiba-secures-1-5m-seed-extension-to-scale-whatsapp-based-ecommerce
74. Kolonell, Créer boutique en ligne Cotonou 2026 (C) : https://kolonell.com/fr/blog/creer-boutique-en-ligne-cotonou-guide-2026
75. TechCabal (FR), TikTok Shop indisponible en Afrique (B) : https://techcabal.com/fr/?p=150573
76. TechEconomy, Instagram vs TikTok Shop African brands (B) : https://techeconomy.ng/instagram-vs-tiktok-shop-african-brands-sales-2025
77. iambeezy, TikTok Shop Côte d'Ivoire 2026 (C) : https://blog.iambeezy.app/fr/tiktok-shop-vendre-produits-cote-divoire-2026/
78. PPC Land, Meta phases out Shops checkout (B) : https://ppc.land/meta-phases-out-facebook-and-instagram-shops-checkout-by-august-2025/
79. Shopifreaks, Meta ditches onsite checkout (B) : https://www.shopifreaks.com/meta-ditches-onsite-checkout-on-facebook-and-instagram/
80. Adweek, OpenAI's ChatGPT big change to commerce strategy (B) : https://www.adweek.com/commerce/openais-chatgpt-is-making-a-big-change-to-its-commerce-strategy/
81. Digital Commerce 360, OpenAI expands agentic commerce push, 16/02/2026 (B) : https://www.digitalcommerce360.com/2026/02/16/openai-expands-agentic-commerce-push/
82. Retail TouchPoints, Google direct checkout in Search, Gemini (B) : https://www.retailtouchpoints.com/news/google-launches-direct-checkout-in-search-gemini/156360/
83. Constellation Research, Google UCP (B) : https://www.constellationr.com/blog-news/insights/google-launches-agentic-commerce-tools-universal-commerce-protocol-gemini
84. PYMNTS, PayPal and Perplexity Instant Buy (B) : https://www.pymnts.com/artificial-intelligence-2/2025/paypal-and-perplexity-debut-instant-buy-ahead-of-black-friday-shopping
85. Shopifreaks, Perplexity agentic shopping free (B) : https://www.shopifreaks.com/perplexity-to-make-its-agentic-shopping-available-to-everyone-for-free/
86. Digital Mag CI, ADICOM Days 2026 (Kantar), 16-17/04/2026 (B) : https://digitalmag.ci/adicom-days-2026-comprendre-les-nouvelles-tendances-digitales/?amp=1
87. TechCabal, Francophone weekly, 28/07/2026 (B) : https://techcabal.com/2026/07/28/francophone-weekly-by-techcabal-033/
88. Digital Mag CI, 102 M$ levés en juillet 2026 (B) : https://digitalmag.ci/startups-africaines-102-millions-de-dollars-leves-au-mois-de-juillet-2026/
89. pawaPay (A, marketing) : https://pawapay.io
90. PPC Land, OpenAI launches Instant Checkout with Stripe (B) : https://ppc.land/openai-launches-instant-checkout-for-chatgpt-with-stripe-partnership/
