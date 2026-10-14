# Guide du commerçant : construire sa boutique

Ce guide s'adresse aux commerçants qui utilisent Axi. Il explique comment personnaliser la boutique, créer des fiches
produits avec variantes, organiser le catalogue en collections, régler les menus et suivre le stock. Les sections 7 à
12 couvrent les ventes et la fidélité : remises automatiques, offres au panier, cartes cadeaux, avoir, retours et
comptes clients. Les sections 13 à 20 couvrent la vague 2 (lot 1 bis, lot 2, lot 4A) : paiements Wave et Orange Money,
catalogue WhatsApp et flux, devises, taxes et factures, blog, webhooks et API REST, champs personnalisés et fonctions
avancées de l'éditeur (qualité, animations, modèles alternatifs, données dynamiques, sections enregistrées, audience,
nouvelles sections).
Document de conception (technique) : [`CONSTRUCTEUR-BOUTIQUE.md`](CONSTRUCTEUR-BOUTIQUE.md).

Toutes les pages citées se trouvent dans l'espace marchand, à l'adresse `/app/{boutique}/…`.

## Qui peut faire quoi

| Action | Propriétaire | Gestionnaire | Employé | Support Axi |
|---|---|---|---|---|
| Apparence (éditeur de thème) et navigation | oui | oui | non | non |
| Produits, variantes, collections, inventaire, import CSV | oui | oui | non | non |
| Export CSV du catalogue | oui | oui | non | non |
| Connecteurs IA : consulter, autoriser une application (OAuth) | oui | oui | non | non |
| Connecteurs IA : créer, faire tourner ou révoquer un jeton API | oui | non | non | non |
| Promotions : codes promo, remises automatiques, offres au panier | oui | oui | non | non |
| Cartes cadeaux : créer, révéler, renvoyer, ajuster, prolonger, désactiver | oui | oui | non | non |
| Avoir d'un client (créditer, débiter), déconnecter les appareils d'un client | oui | oui | non | non |
| Retours : consulter | oui | oui | oui | oui (lecture) |
| Retours : créer, approuver, refuser, annuler, résoudre | oui | oui | non | non |
| Retours : enregistrer la réception des articles | oui | oui | oui | non |
| Paramètres : politique de retours, comptes clients | oui | oui | non | non |
| Paiements : ajouter ou modifier un moyen (dont Wave / Orange Money en ligne), tester la connexion | oui | non | non | non |
| Devises, taxes et factures (réglages, taux), blog (articles, catégories) | oui | oui | non | non |
| Factures : consulter | oui | oui | oui | oui (lecture) |
| Factures : émettre une facture, émettre les avoirs manquants | oui | oui | oui | non |
| Catalogue WhatsApp et flux : consulter | oui | oui | non | non |
| Catalogue WhatsApp et flux : modifier, synchroniser | oui | non | non | non |
| Webhooks et API (écran, secrets, livraisons) | oui | non | non | non |
| Champs personnalisés : créer et modifier les définitions | oui | oui | non | non |
| Champs personnalisés : saisir les valeurs | selon l'élément (produit, collection, page, client) | selon l'élément | non | non |

## Ce qui dépend du plan

| Fonction | Gratuit | Starter | Business et plus |
|---|---|---|---|
| Produits | 100 | 200 | illimités |
| Photos par produit | 1 | 5 | 10 |
| Variantes (couleur, taille…) | oui | oui | oui |
| Suppléments payants à la commande | non | oui | oui |
| Suivi de stock et inventaire | non | oui | oui |
| Modèles de départ du thème | 2 | tous | tous |
| Masquer « Propulsé par Axi » | non | oui | oui |
| Historique des versions du thème et restauration | non | non | oui |
| Import et export CSV du catalogue | non | non | oui |
| Comptes clients (connexion par code, historique, adresses, favoris, réachat) | oui | oui | oui |
| Codes promo | non | oui | oui |
| Remises automatiques sur des produits et paliers de panier | non | oui | oui |
| Remises « X achetés = Y offerts » et lots de produits | non | non | oui |
| Offres au panier (ventes croisées, montées en gamme) | non | non | oui |
| Points de fidélité utilisables au paiement | non | non | oui |
| Cartes cadeaux et avoirs | non | non | oui |
| Retours en libre-service | non | non | oui |
| Paiement en ligne Mobile Money et carte (Paystack, pawaPay, CinetPay…) | non | oui | oui |
| Devises affichées en plus du FCFA | 0 | 1 | 3 (Scale 10, Enterprise illimité) |
| TVA (prix TTC ou HT), factures et avoirs numérotés | non | oui | oui |
| Blog (articles, tous statuts confondus) | non | 20 | illimités |
| Brouillon d'article rédigé par l'IA (3 crédits IA) | non | non | oui |
| Flux catalogues (Meta, Google, TikTok) et synchronisation du catalogue WhatsApp | non | non | oui |
| API REST | non | non | lecture (Scale et plus : lecture et écriture) |
| Webhooks sortants (points de réception) | non | non | 2 (Scale 10, Enterprise illimité) |
| Champs personnalisés (définitions) | non | 10 | 100 (Scale et plus : illimités) |
| Sections enregistrées | non | 20 | illimitées |
| Bibliothèque de sections Axi | éléments gratuits sans plan minimal | éléments gratuits | éléments gratuits et premium |
| Modèles de page alternatifs (par type) | non | non | 5 (Scale et Enterprise 20) |
| Contenus par audience (« Visible pour ») | non | non | type de client (Scale et plus : toutes les conditions) |
| Scores de qualité et animations dans l'éditeur | oui | oui | oui |

Après une baisse de plan, ce qui existe reste désactivable ou supprimable, et les cartes cadeaux déjà émises restent
utilisables par leurs porteurs.

Pendant l'essai de 14 jours, la boutique bénéficie du plan Business.

## 1. Personnaliser la boutique (Apparence)

Menu **Boutique › Apparence** (`/app/{boutique}/apparence`). L'éditeur s'ouvre en plein écran.

### Disposition de l'éditeur

- Sur ordinateur (1024 px et plus) : à gauche la structure de la page, au centre l'aperçu, à droite les réglages de
  l'élément sélectionné.
- Sur téléphone : trois onglets, **Sections**, **Réglages** et **Aperçu**.
- En haut : **Quitter**, l'état d'enregistrement, le choix de la page à modifier, la taille de l'aperçu (ordinateur,
  tablette, mobile), **Annuler** et **Rétablir**, le menu **Versions** et le bouton **Publier**.

### Choisir la page à modifier

Le sélecteur en haut propose les modèles de page : **Accueil**, **Produit** (toutes les fiches produits),
**Collection**, **Catalogue**, **Page** (pages de contenu), **Panier**, **Blog** (liste des articles) et **Article**.
Chaque modèle a ses propres sections. Les modèles alternatifs (« Produit · luxe »…) apparaissent aussi dans ce
sélecteur (section 20).

### Sections

Une page est une suite de sections (25 au maximum). Dans l'onglet **Sections** :

- **Ajouter une section** ouvre la bibliothèque, classée par catégorie ;
- glissez une section par sa poignée pour la déplacer, ou utilisez le menu « … » (**Monter**, **Descendre**,
  **Ajouter une section en dessous**, **Dupliquer**, **Supprimer**) ;
- l'icône en forme d'œil masque une section sans la supprimer ;
- après une suppression, le bouton **Annuler** du message la rétablit.

L'**En-tête** et le **Pied de page** sont toujours en haut et en bas de la liste : ils se règlent comme les réglages
du thème. Certaines sections sont **obligatoires** (cadenas) : la fiche produit sur le modèle Produit, la liste de
produits sur Collection et Catalogue, le contenu sur Page, le panier sur Panier. On peut les régler et les déplacer,
pas les supprimer.

Sections disponibles :

| Catégorie | Sections |
|---|---|
| Mise en avant | Bannière principale, Diaporama, Image avec texte, Compte à rebours, Barre d'offres (modèles Accueil et Panier, section 7), Vidéo et texte |
| Produits | Collection en vedette, Produit en vedette, Liste de collections, Tous les produits, Produits similaires (modèles Produit et Panier), Caractéristiques du produit (modèle Produit), Look à acheter, Guide des tailles |
| Texte | Texte enrichi, Colonnes, Questions fréquentes, Bandeau défilant, Derniers articles (section 17) |
| Médias | Galerie d'images, Vidéo, Avant, après |
| Confiance | Témoignages, Avis clients vérifiés, Logos (marques, partenaires), Garanties, Tableau comparatif |
| Contact | Inscription aux nouveautés, Appel WhatsApp, Contact et adresse, Horaires, Plan d'accès |
| Structure | Bandeau d'annonce, Espacement |
| Modèle (sections obligatoires) | Fiche produit, Collection, Contenu de la page, Panier, Liste des articles (Blog), Article |

Les sections ajoutées au lot 4A (Vidéo et texte, Caractéristiques du produit, Look à acheter, Guide des tailles,
Bandeau défilant, Avant, après, Tableau comparatif) sont décrites à la section 20.

### Blocs

Beaucoup de sections contiennent des **blocs** (un titre, un texte, un bouton, une diapositive, une question…).
Dépliez la section, puis **Ajouter un bloc**. Les blocs se déplacent, se masquent, se dupliquent et se suppriment
comme les sections. Certains blocs sont limités : par exemple un seul bloc « Prix » dans la fiche produit.

La section **Fiche produit** se compose entièrement de blocs : marque, titre, note moyenne, prix (avec l'économie
en %), variantes, options et suppléments, disponibilité (seuil « plus que X »), quantité, boutons d'achat (dont
« Commander sur WhatsApp »), infos livraison, description, onglets repliables, garanties, partage, référence (SKU),
texte libre. Le bloc **Variantes** propose trois styles : **Boutons**, **Liste** ou **Pastilles couleur**.
Trois blocs servent aux ventes : **Offres disponibles** (remises automatiques qui concernent le produit, section 7),
**Souvent achetés ensemble** (offres au panier, section 8) et **Carte cadeau : destinataire** (section 9). S'ils sont
absents de votre thème, ils s'affichent quand même lorsqu'ils ont un contenu ; pour ne pas les afficher, ajoutez le bloc
puis masquez-le avec l'icône en forme d'œil.

Les sections **Fiche produit** et **Collection** proposent aussi le bloc **Champ personnalisé** (Libellé + Valeur) :
reliez la valeur à un champ personnalisé avec « Connecter une donnée » (section 20) ; si la valeur est vide, rien ne
s'affiche.

### Réglages

Sélectionnez une section ou un bloc : ses réglages s'affichent à droite (titres, textes, images, liens, couleurs de
la section, marges…). Un réglage incorrect est signalé en rouge et l'état passe à « À corriger » : le brouillon n'est
pas enregistré tant qu'il n'est pas corrigé. Les liens acceptés sont les chemins de la boutique (`/catalogue`) et les
adresses commençant par `https://`.

L'onglet **Réglages du thème** regroupe ce qui s'applique à toute la boutique : **Couleurs** (palette et schémas de
couleurs), **Typographie**, **Boutons**, **Cartes produit**, **Mise en page**, **En-tête** (logo, disposition, menu,
bandeau d'annonce), **Pied de page** (menus affichés, texte), **Fiche produit**, **Panier**, **Réseaux sociaux**,
**Favicon et partage**, ainsi que le **Modèle de départ** et la mention **« Propulsé par Axi »**.

Pour les couleurs de texte et de boutons, l'éditeur affiche le contraste mesuré avec le fond (ratio et niveau) : visez au moins 4,5:1 pour le texte.

### Aperçu

L'aperçu montre la boutique avec vos modifications, sans rechargement. Sélectionner une section dans la liste fait
défiler l'aperçu jusqu'à elle et l'encadre. À l'inverse, **cliquez sur une section dans l'aperçu** pour la sélectionner
et ouvrir ses réglages : au survol, un contour pointillé indique son nom. Un clic sur l'en-tête ou le pied de page
ouvre leurs réglages. Dans l'aperçu, les liens ne changent pas de page : pour tester un autre modèle, utilisez le
choix de la page en haut de l'éditeur. L'aperçu fonctionne aussi tant que la boutique n'est pas publiée : seuls les
membres de la boutique le voient.

### Enregistrer et publier

- Chaque modification est **enregistrée automatiquement** dans un brouillon (environ une seconde après la dernière
  saisie). Raccourcis : `Ctrl+S` pour enregistrer, `Ctrl+Z` pour annuler, `Ctrl+Y` pour rétablir.
- Le brouillon **n'est pas visible** de vos clients. Le point de couleur sur **Publier** indique des modifications non
  publiées.
- **Publier** met le brouillon en ligne. Le logo de l'en-tête devient le logo de la boutique.

### Versions

Chaque publication crée une version (5 conservées, 50 sur Business et plus). Le menu **Versions** permet de :

- **restaurer** une version publiée (plan Business et plus) : elle est chargée dans le brouillon, publiez pour la
  remettre en ligne ;
- **Voir la boutique en ligne** ;
- **Abandonner les modifications** : le brouillon revient à la version en ligne.

### Changer de modèle de départ

**Réglages du thème › Modèle de départ** propose les modèles par secteur (restauration, mode, beauté…). Cochez
« Conserver mon logo, mes menus, mes réseaux sociaux et le pied de page » pour ne pas perdre ces éléments. Le plan
Gratuit donne accès à 2 modèles.

## 2. Menus de navigation

Menu **Boutique › Navigation** (`/app/{boutique}/navigation`).

- Deux menus existent toujours : **Menu principal** (en-tête) et **Pied de page**. Ils peuvent être vidés, pas
  supprimés.
- **Créer un menu** ajoute un menu supplémentaire (par exemple « aide » ou « informations légales »), 6 au maximum.
  Pour l'afficher, choisissez-le dans l'éditeur : **Pied de page › Menus affichés**.
- **Ajouter un élément** : un libellé et une destination : **Accueil**, **Catalogue**, une **Collection**, un
  **Produit**, une **Page** ou une **Adresse web** (`https://…` ou chemin de la boutique comme `/catalogue`).
- Deux niveaux au maximum : le menu « … » d'un élément propose **Placer sous l'élément précédent**, **Ajouter un
  sous-élément** et **Remonter au premier niveau**. Jusqu'à 20 éléments par menu et 15 sous-éléments par élément.
- Réordonner : glissez la poignée, ou au clavier, Espace pour saisir puis les flèches.
- Cliquez sur **Enregistrer** : les menus sont mis à jour sur la boutique sans passer par **Publier**.

L'en-tête affiche le menu choisi dans **En-tête › Menu** de l'éditeur (par défaut le menu principal).

## 3. Fiches produits

Menu **Vendre › Produits**, puis **Ajouter un produit** ou un produit existant.

### Choisir le type de produit (première étape)

À la création, la page s'ouvre sur la question **« Que vendez-vous ? »**, avant le titre et avant toute saisie :
quatre cartes, **Produit physique** (choisi par défaut), **Produit numérique**, **Service** et **Carte cadeau**.
Cliquez sur une carte (ou naviguez aux flèches du clavier) : le formulaire s'adapte aussitôt. Le commerçant qui vend
un article classique ne change rien et continue normalement.

| Type | Ce que ça change |
|---|---|
| Produit physique | Livré ou retiré en boutique : stock, poids et expédition disponibles. |
| Produit numérique | Fichiers téléchargeables remis dès le paiement confirmé : ni stock, ni poids, ni livraison ; carte « Fichiers à remettre ». |
| Service | Prestation (durée, lieu ou à distance) : ni livraison, ni poids ; stock **facultatif** pour limiter les places. |
| Carte cadeau | Chaque variante est une valeur ; carte émise au paiement, TVA non appliquée (plan Business et plus). |

Sur un produit **déjà enregistré**, le type est rappelé en haut du formulaire : « **Type de produit : …** » avec un
bouton **Changer**. Une fenêtre liste alors les conséquences avant de confirmer (ventes passées inchangées, suivi de
stock désactivé, fichiers qui ne seront plus remis, exonération de TVA d'une carte cadeau…). Le changement n'est
définitif qu'une fois le produit **enregistré**.

### Colonne principale

- **Titre** et **Description** (éditeur de texte).
- **Médias** : ajoutez ou glissez vos photos (JPG, PNG, WebP), compressées automatiquement à 300 Ko ; la première
  est la photo principale (« Définir comme principale ») ; renseignez le **texte alternatif** pour l'accessibilité.
  Une adresse d'image doit commencer par `https://`.
- **Prix** : prix, prix barré (supérieur au prix, affiché barré), coût par article (jamais affiché aux clients),
  prix promotionnel avec dates de début et de fin facultatives.
- **Inventaire** (plan Starter et plus) : **Suivre la quantité**, SKU, **code-barres** (EAN, UPC, ISBN ; produit
  sans variante), quantité disponible, quantités minimum et maximum par commande.
  - **Continuer à vendre en cas de rupture** : décoché (par défaut), le produit passe en rupture à zéro. Coché, les
    clients peuvent commander à zéro : la boutique affiche « Précommande » (expédition différée) au lieu de
    « Épuisé », le stock devient négatif (« survente ») et chaque vente reste tracée comme mouvement de stock.
    Avec des variantes, le réglage est **par variante** ; la case de la fiche l'applique à toutes.
  - **Seuil d'alerte « stock bas »** : propre au produit ; vide = seuil par défaut de la boutique (menu
    **Notifications**, 5 par défaut). Il pilote le filtre « Stock bas », le tableau de bord, la mention « Plus que X »
    de la vitrine et les alertes.
- **Expédition** : poids en grammes (produit physique uniquement).
- **Variantes** : voir ci-dessous.
- **Suppléments** (plan Starter et plus) : groupes de choix à la commande (« Emballage », « Papier cadeau »…),
  obligatoires ou non, gratuits ou avec supplément de prix.
- **Détails de la fiche** : onglets repliables sous la description (composition, guide des tailles, entretien,
  livraison et retours).

### Colonne latérale

- **Statut** : **Actif** (visible et commandable), **Brouillon** (masqué), **Archivé** (retiré de la boutique).
  **Produit vedette** le met en avant.
- **Organisation** : type de produit, marque, **Collection principale** (fil d'Ariane et filtres), **Autres
  collections** (collections manuelles), **Étiquettes** (filtres et collections automatiques). Les collections
  automatiques qui contiennent le produit sont indiquées (« Inclus automatiquement dans : … »).
- **Référencement** : aperçu Google, titre de la page, méta-description, adresse (URL).

### Variantes couleur, taille et autres options

1. Dans **Variantes**, cliquez sur **Couleur**, **Taille** ou **Option libre** (matière, pointure…). Trois options au
   maximum, 50 valeurs par option.
2. Saisissez les valeurs ; Entrée ou virgule permet d'en ajouter plusieurs à la suite.
3. Pour une **couleur**, choisissez la **pastille** (sélecteur de couleur ou code `#RRGGBB`) et, si vous le souhaitez,
   une **image** parmi les photos du produit. Ajoutez d'abord les photos dans **Médias**.
4. Le tableau des variantes se remplit avec toutes les combinaisons (100 au maximum). Pour chacune : prix (vide =
   prix de base), prix barré, stock, image, référence, code-barres et, si le stock est suivi, **Vendre en rupture**.
5. **Édition groupée** : cochez plusieurs variantes (ou utilisez **Sélectionner :** par valeur) puis appliquez un prix,
   un prix barré, un stock ou une image à toutes, ou **Vendre en rupture** / **Bloquer à zéro**.

Sur la boutique, une couleur choisie affiche son image. Pour afficher des pastilles plutôt que des boutons, réglez le
style du bloc **Variantes** sur **Pastilles couleur** dans l'éditeur (modèle Produit), puis publiez. Une variante en
rupture apparaît comme épuisée et ne peut pas être commandée, sauf si elle est en **Vendre en rupture** : elle reste
achetable, affichée « Précommande » (bouton « Précommander », mention « expédition différée », données Google
`BackOrder`), sans jamais révéler la quantité exacte si le thème masque le stock.

Si une vente modifie le stock pendant que vous éditez la fiche et que votre saisie le rendrait négatif,
l'enregistrement est refusé : rechargez la fiche puis recommencez.

## 4. Collections

Menu **Vendre › Collections** (`/app/{boutique}/collections`), jusqu'à 100 collections.

### Collection manuelle

Vous choisissez les produits un par un : **Ajouter des produits** (recherche), puis ordonnez-les en glissant ou avec
les flèches (tri **Manuel**). Un produit peut aussi y être rattaché depuis sa fiche (**Autres collections**).

### Collection automatique

Les produits qui remplissent les conditions sont ajoutés tout seuls, y compris les nouveaux produits.

| Champ | Conditions possibles |
|---|---|
| Étiquette | est égale à, n'est pas |
| Prix | est inférieur à, est supérieur à (montant entier) |
| Titre | contient, est égal à |
| En promotion | est (oui ou non) |
| Type de produit | est égal à |
| Marque | est égale à |

Choisissez si les produits doivent remplir **toutes les conditions** ou **au moins une condition** (20 conditions au
maximum). L'aperçu montre en direct les produits concernés.

### Réglages communs

- **Trier par** : Manuel (collections manuelles), Nouveautés, Prix croissant, Prix décroissant, Meilleures ventes,
  Alphabétique (A à Z).
- **Publication** : une collection non publiée n'est pas visible sur la boutique.
- **Image**, **Description** (en tête de la page de collection) et **Référencement** (titre, méta-description,
  adresse).
- Adresse publique : `/s/{boutique}/collections/{adresse}`.
- Supprimer une collection ne supprime pas ses produits.

Pour montrer une collection : ajoutez-la à un menu, ou placez une section **Collection en vedette** ou **Liste de
collections** dans l'éditeur.

### Ordre des collections

Sur la liste des collections, choisissez l'ordre d'affichage : glissez la poignée, ou au clavier, Espace pour saisir
puis les flèches (Espace pour déposer, Échap pour annuler), ou utilisez les boutons **Monter** et **Descendre**.
L'ordre est enregistré automatiquement et s'applique à la boutique : section **Liste de collections** (quand aucune
collection n'y est choisie), menus par défaut (tant que vous n'avez pas enregistré vos menus) et filtre
**Collection** du catalogue.

## 5. Inventaire

Menu **Produits › Actions › Inventaire par variante** (`/app/{boutique}/produits/stock`), plan Starter et plus.
Seuls les produits dont **Suivre la quantité** est activé y figurent.

- Une ligne par variante, avec indicateurs : articles suivis, en rupture (dont surventes), stock bas (sous le seuil
  du produit, sinon celui de la boutique), mouvements des 7 derniers jours. Badges **Rupture**, **Précommande**
  (rupture vendue quand même), **Survente** (stock négatif : unités vendues à réapprovisionner), **Stock bas**.
- Filtres **Tout**, **Stock bas**, **Rupture**, **Survente** (s'il y en a) et recherche par produit ou SKU.
- Liste des produits : filtre **Stock bas** selon les mêmes seuils, badges **Survente** / **Précommande**, action
  groupée **Continuer à vendre en rupture** / **Bloquer la vente à zéro** (produit et toutes ses variantes).
- Tableau de bord : carte **Stock bas et ruptures** (les plus urgents d'abord).
- **Alertes** (centre de notifications) : une alerte **Stock bas** quand un article passe sous son seuil, une alerte
  **Survente** quand son stock devient négatif. Une seule alerte par passage : rester sous le seuil n'en recrée pas ;
  un réassort au-dessus du seuil réarme l'alerte. Un article créé ou déjà sous le seuil ne déclenche pas d'alerte mais
  figure dans les listes « Stock bas ». **Relever un seuil** (produit ou boutique) n'alerte pas pour des passages
  antérieurs : seuls les passages après le changement comptent. Un passage **directement en négatif** ne donne que
  l'alerte « Survente ». Les variantes désactivées (non disponibles) sont exclues des listes et des alertes.
  L'automatisation **Alerte stock bas** (e-mail, notification) suit la même règle et le même seuil.
- Un réassort (+) s'applique toujours, même après une survente ; un retrait (−) ne peut pas rendre le stock négatif.
  Dans l'inventaire, un stock négatif s'affiche avec son signe ; « + » le remonte, « − » est désactivé à zéro ou moins.
- Si le thème n'affiche pas le stock, l'acheteur ne voit jamais de quantité restante (« Quantité demandée
  indisponible ») et la précommande n'est signalée qu'à stock nul.
- Annuler une commande rend exactement les quantités qu'elle avait retirées.
- **Ajustement rapide** : boutons + et −, ou saisie de la quantité, puis **Valider**. Chaque changement est enregistré
  comme mouvement de stock.
- **Fiche Stock et mouvements** d'un produit : ajustement avec sens (**Entrée** ou **Sortie**), quantité et motif
  (réception, casse, inventaire), stock par variante et historique. Les ventes, annulations et retours y sont
  enregistrés automatiquement.

## 6. Importer et exporter le catalogue (CSV)

Menu **Produits › Actions**, plan Business et plus.

- **Exporter le catalogue** : fichier `produits-{boutique}-{date}.csv`, une ligne par variante, réimportable tel quel.
  Depuis la liste, cochez des produits puis **Exporter la sélection**.
- **Importer des produits** : CSV UTF-8 (ou export Excel), séparateur virgule ou point-virgule, 2 000 lignes au
  maximum. Les lignes d'un même produit partagent le même **Handle** ; les colonnes Option1 à Option3 créent les
  variantes.
  1. Choisissez le fichier, indiquez si la première ligne contient les titres.
  2. Associez les colonnes (Titre et Prix obligatoires ; « Ignorer » pour une colonne inutile).
  3. Vérifiez l'aperçu : chaque erreur indique sa ligne.
  4. **Mettre à jour les produits existants** : un produit dont le Handle existe déjà est remplacé (les variantes sont
     conservées par combinaison) ; sinon il est ignoré.

Colonnes reconnues : Handle, Titre, Description, Marque, Type, Étiquettes, Statut, Collection, Option1 Nom,
Option1 Valeur, Option2 Nom, Option2 Valeur, Option3 Nom, Option3 Valeur, SKU, Prix, Prix barré, Coût, Stock,
Code-barres, Poids (g), Image variante, Disponible, **Variant Inventory Policy** (`deny` ou `continue`, comme
l'export Shopify ; par ligne de variante, ou sur la ligne d'un produit simple), **Seuil stock bas** (1re ligne du
produit), Image, Texte alternatif, Titre SEO, Description SEO. En mise à jour, une colonne absente conserve la valeur
existante ; un stock négatif réexporté est traité comme inchangé (aucun mouvement ; s'il a bougé depuis l'export, la
valeur du fichier est ignorée avec un avertissement), une quantité négative pour un nouveau produit est refusée, et
une cellule Stock illisible est signalée sur sa ligne et ignorée (le stock existant est conservé).
Sans suivi de stock dans le plan, la colonne Stock n'est pas importée. La limite de produits du plan s'applique.

## 7. Remises automatiques

Menu **Marketing › Codes promo** (`/app/{boutique}/promotions`), onglet **Remises automatiques**. Une remise
automatique s'applique sans code, au panier et au paiement, dès que ses conditions sont réunies. Les remises sur des
produits et les paliers de panier sont inclus à partir du plan Starter ; « X achetés = Y offerts » et les lots, à partir
du plan Business.

### Créer une remise

**Nouvelle remise** ouvre le formulaire :

- **Titre affiché au client** (2 à 80 caractères), par exemple « 2 accessoires achetés = 1 offert ».
- **Type de remise** : voir le tableau ci-dessous. Un type non inclus dans votre plan est signalé « (plan supérieur) » :
  vous pouvez préparer la remise, pas l'enregistrer.
- Les conditions propres au type.
- **Exclure les articles déjà en promotion** (coché par défaut, sauf pour les paliers) : un article vendu à un prix
  promotionnel daté ne reçoit pas la remise.
- **Début** et **Fin (incluse)** : jours entiers, dans le fuseau horaire de la boutique.
- **Commandes maximum** : nombre de commandes remisées (vide = illimité).
- **Priorité** (de −100 à 100) : la plus haute s'applique d'abord.
- **Cumulable avec les codes promo**, **Cumulable avec les autres remises automatiques**, **Remise active**.

Sous le formulaire, un **Résumé** en une phrase se met à jour pendant la saisie ; tant qu'il manque une information, il
indique ce qui reste à compléter. Une boutique compte au plus 200 remises automatiques.

| Type | Conditions | Exemple |
|---|---|---|
| Remise sur des produits | Produits concernés : tous, certains produits (200 au maximum) ou certaines collections (50 au maximum). Remise en pourcentage (1 à 100 %) ou en montant fixe ; en montant fixe, **Par article** la déduit pour chaque article, sinon une seule fois sur l'ensemble. **Quantité minimale** (vide = dès 1 article). | −15 % sur la collection Femme |
| X achetés = Y offerts | **Condition d'achat** : nombre d'articles achetés ou montant acheté, parmi les articles choisis. **Articles offerts parmi les mêmes produits** (le panier doit alors contenir les articles achetés plus les articles offerts) ou parmi d'autres produits. Nombre d'articles offerts ou remisés : les moins chers sont choisis. **Avantage** : offert, pourcentage ou montant fixe. **Applications maximum par commande** (1 à 20). | 2 accessoires achetés = 1 offert |
| Paliers de panier | Jusqu'à 5 paliers à seuils strictement croissants : **Dès** (montant) et **Avantage** (pourcentage, montant fixe ou livraison offerte). **Montant calculé sur** : tous les produits, certains produits ou certaines collections. | −5 % dès 20 000 FCFA, −10 % dès 50 000 FCFA |
| Lot de produits | 2 à 6 produits, chacun avec sa variante (ou toutes) et sa quantité ; un même produit ne figure qu'une fois (augmentez plutôt sa quantité). **Prix du lot** : prix fixe ou remise en %. **Lots max. par commande** (1 à 10). | 3 produits de soin pour 15 000 FCFA |

Les quantités vont de 1 à 100. Une référence retirée de votre catalogue (produit, collection, variante) est simplement
ignorée au paiement ; l'enregistrement, lui, refuse un produit ou une collection qui n'existe plus.

### Priorité et cumul

- Chaque article reçoit **au plus une** remise de type produit, « X achetés = Y offerts » ou lot. Les remises sont
  examinées par priorité décroissante, puis par économie décroissante ; une remise appliquée « consomme » les articles
  qu'elle utilise (achetés ou offerts).
- Un **palier de panier** s'applique ensuite : un seul, le plus avantageux atteint, calculé sur le panier après les
  remises sur les produits, hors cartes cadeaux. Le palier « livraison offerte » ne vaut que pour une livraison.
- Une remise **non cumulable avec les autres remises automatiques** est comparée à l'ensemble des remises cumulables :
  le client obtient la combinaison la plus avantageuse.
- Un **code promo** s'ajoute aux remises automatiques, sauf si le code ou une remise appliquée n'est pas cumulable : le
  client obtient alors la meilleure des deux offres, avec le message « Ce code n'est pas cumulable avec les offres en
  cours : la meilleure offre a été appliquée. ». Le minimum d'un code se compare au panier après les remises
  automatiques.
- Les points de fidélité se cumulent avec tout le reste. Les cartes cadeaux ne sont jamais remisées.
- Au panier, le client voit sa progression (« Plus que … pour … »). Pour l'afficher ailleurs, ajoutez la section
  **Barre d'offres** (modèles Accueil et Panier) dans l'éditeur ; seuls les paliers calculés sur tous les produits y
  figurent.
- Sur la fiche produit, le bloc **Offres disponibles** liste jusqu'à 4 remises actives qui concernent le produit.

### Statut, duplication, suppression

- Statut calculé : **Active**, **Programmée** (début à venir), **Expirée**, **Épuisée** (commandes maximum atteintes)
  ou **Désactivée**. L'interrupteur **Active** de chaque ligne active ou désactive la remise.
- **Dupliquer** crée une copie « (copie) » **désactivée**, à relire avant de l'activer.
- Le type d'une remise déjà appliquée à une commande ne peut plus changer : dupliquez-la plutôt.
- **Supprimer** est refusé si la remise a déjà été appliquée : désactivez-la (l'historique des commandes est conservé).
- Indicateurs : remises actives, programmées, utilisations et remises accordées (hors commandes annulées).
- Après une baisse de plan, les remises non incluses ne s'appliquent plus ; elles restent désactivables et
  supprimables.

## 8. Offres au panier

Même menu, onglet **Offres au panier** (plan Business). Une offre propose des produits complémentaires (vente
croisée) ou une version supérieure (montée en gamme). **Nouvelle offre** :

- **Titre affiché au client** (2 à 80 caractères).
- **Emplacement** : **Fiche produit** (bloc « Souvent achetés ensemble »), **Panier et tiroir** (sous le titre « Vous
  aimerez aussi ») ou **Paiement** (au-dessus du total, sous le titre « À ajouter avant de valider »).
- **Type d'offre** :
  - **Vente croisée** : un produit simple s'ajoute au panier en un clic (bouton +) ; un produit à variantes ou à
    options ouvre sa fiche pour choisir ;
  - **Montée en gamme** : le bouton remplace l'article déclencheur du panier par le produit proposé, avec les mêmes
    valeurs d'options (même nom d'option, même valeur) et les mêmes suppléments ; le nouvel article prend la place
    et la quantité de l'ancien. Si une option ou un supplément manque, ou si cette quantité n'est pas disponible ou
    sort du minimum ou du maximum du produit proposé, le panier n'est pas modifié : la fiche du produit proposé
    s'ouvre pour que le client choisisse.
- **Déclencheurs : produits** (50 au maximum) et **Déclencheurs : collections** (20 au maximum) : l'offre apparaît
  quand l'un de ces produits est au panier, ou sur sa fiche pour l'emplacement Fiche produit. Un déclencheur au moins
  est obligatoire.
- **Produits proposés** (1 à 10) : 4 au plus sont affichés, dans l'ordre choisi. Un produit déjà au panier, non actif
  ou épuisé (sans vente en rupture) est masqué. Un produit proposé ne peut pas être aussi un déclencheur, et une carte
  cadeau ne peut pas être proposée.
- **Remise liée (facultatif)** : une remise « Remise sur des produits » déjà créée. Elle s'applique selon ses propres
  conditions (produits concernés, dates) : créez-la sur les produits proposés pour que l'offre soit remisée.
- **Ordre d'affichage** (0 à 1 000, les plus petits d'abord) et **Offre active**.

Plusieurs offres d'un même emplacement se partagent les 4 produits affichés. Une boutique compte au plus 100 offres.
Côté thème, l'emplacement Panier dépend du réglage **Produits proposés** de la section **Panier**, et l'emplacement
Fiche produit du bloc **Souvent achetés ensemble** (titre et nombre de produits, 1 à 4).

**Mesure** : quand le client ajoute un produit proposé (ou ouvre sa fiche depuis l'offre), l'offre est mémorisée ; si
la commande contient ce produit, l'offre gagne une **conversion** et le montant net de ces articles s'ajoute à son
**chiffre d'affaires**. Indicateurs : offres actives, conversions, chiffre d'affaires, panier moyen ajouté.

Une offre qui a déjà généré des ventes ne peut pas être supprimée : désactivez-la (mesures conservées).

## 9. Cartes cadeaux

Menu **Marketing › Cartes cadeaux** (`/app/{boutique}/cartes-cadeaux`). La création et la vente sont incluses à partir
du plan Business ; après une baisse de plan, les cartes déjà émises restent utilisables et gérables.

### Liste

Indicateurs : cartes émises, cartes utilisables (actives et non expirées), soldes en circulation (montant dû aux
porteurs). Filtres **Toutes**, **Actives**, **Épuisées**, **Désactivées**, **Expirées**, et recherche par les
4 derniers caractères du code. Le code complet n'est jamais affiché dans la liste (`•••• H3VW`).

### Vendre des cartes cadeaux

Un produit « carte cadeau » se vend comme un autre produit : ses variantes sont les valeurs faciales, de 1 000 à
500 000 FCFA. La fiche produit de l'espace marchand ne permet pas encore de marquer un produit comme carte cadeau.

Sur la boutique, la fiche d'une carte cadeau affiche le bloc **Carte cadeau : destinataire** (nom, numéro WhatsApp ou
e-mail, message de 300 caractères, date d'envoi facultative) et le bouton **Offrir cette carte**. Règles :

- au plus 5 cartes et 1 000 000 FCFA de cartes par commande ;
- ni remise, ni code promo, ni points de fidélité sur une carte ; une carte cadeau ou un avoir ne peut pas payer une
  carte cadeau ;
- un panier composé uniquement de cartes passe en **Envoi numérique** (aucune livraison) ; le paiement à la livraison
  n'est pas proposé ;
- la carte est **émise après la confirmation du paiement** (bouton **Confirmer le paiement** de la commande, ou
  paiement en ligne), une carte par unité, valable 365 jours ;
- envoi au destinataire : par e-mail s'il en a indiqué un ; sinon la page de confirmation de l'acheteur propose
  **Envoyer sur WhatsApp** (message prérempli). L'acheteur ne voit que les 4 derniers caractères du code.

### Créer une carte manuellement

**Créer une carte** (geste commercial, concours…) :

- **Valeur** (1 000 à 500 000 FCFA) ;
- **Expiration** (par défaut dans 365 jours, fin de journée, 5 ans au maximum) ou **Sans date d'expiration** ;
- **Destinataire (facultatif)** : nom, **Téléphone WhatsApp** (rattache la carte à la fiche client de ce numéro),
  e-mail, message (300 caractères), case **Envoyer la carte par e-mail maintenant** ;
- **Note interne**, visible dans le journal.

Le code complet (`XXXX-XXXX-XXXX-XXXX`) s'affiche **une seule fois**, avec **Copier**. Notez-le ou envoyez-le.

### Fiche d'une carte

Indicateurs (solde, valeur initiale, expiration), blocs **Destinataire** et **Origine** (commande d'achat, client
rattaché), et **Journal** : chaque mouvement (émission, utilisation, recrédit, ajustement, expiration, réactivation).

- **Révéler le code** : affiche le code en clair ; chaque révélation est enregistrée dans le journal d'audit.
- **Renvoyer** (carte active, non expirée, avec un destinataire) : par e-mail si la carte en a un ; sinon WhatsApp
  s'ouvre avec un message prérempli qui contient le code, envoyé seulement si vous appuyez sur « Envoyer ».
- **Ajuster le solde** : **Créditer** ou **Débiter** un montant, avec un **Motif** (3 caractères minimum). Le solde ne
  dépasse jamais 500 000 FCFA ni ne devient négatif ; créditer exige le plan Business.
- **Prolonger** : nouvelle date d'expiration (future, 5 ans au maximum). Une carte expirée redevient active.
- **Désactiver** (avec un motif) : la carte ne peut plus servir au paiement. **Réactiver** la remet en service, sauf
  si elle est expirée (prolongez-la d'abord).
- **Expiration** : une carte dont la date est passée s'affiche « Expirée » et n'est plus acceptée ; un traitement
  quotidien la passe ensuite au statut expiré. « Épuisée » signifie un solde à zéro.

### Utilisation par le client

Au paiement, le champ **Carte cadeau** accepte jusqu'à 3 cartes ; le solde s'affiche seulement après saisie du code.
La section **Panier** de l'éditeur peut aussi afficher ce champ (réglage **Champ « carte cadeau »**), repris à la
commande. Les cartes réduisent le **reste à payer** ; si elles couvrent tout, la commande est payée dès sa création.
Annuler une commande recrédite automatiquement les cartes utilisées. Le client peut vérifier son solde sur
`/s/{boutique}/carte-cadeau`. Un code inconnu, désactivé ou expiré donne toujours le même message, « Carte cadeau
invalide », et les essais sont limités.

## 10. Avoir client

L'avoir est un solde en FCFA rattaché à la fiche d'un client, sans date d'expiration. Il est alimenté par un geste
commercial, une résolution de retour en avoir (section 11) ou un remboursement vers l'avoir (fiche commande,
**Enregistrer un remboursement**, choix **Avoir client**).

Fiche client (menu **Vendre › Clients**), carte **Avoir** :

- le solde ;
- **Créditer** (plan Business) et **Débiter** (si le solde est positif) : un montant et un **Motif** (3 caractères
  minimum) ; un débit supérieur au solde est refusé ;
- les 10 derniers mouvements (geste commercial, utilisé sur une commande, recrédit, ajustement, remboursement en
  avoir) ;
- le lien vers les cartes cadeaux rattachées au client, s'il en a.

Le client utilise son avoir **uniquement connecté à son compte** (case « Utiliser mon avoir » au paiement), jamais en
commande invitée. Annuler la commande lui rend son avoir.

## 11. Retours

Menu **Vendre › Retours** (`/app/{boutique}/retours`), plan Business.

### Politique de retours

Bouton **Politique de retours** de la page Retours (`/app/{boutique}/parametres/retours`) :

- **Accepter les demandes de retour en ligne** : affiche le bouton « Retourner des articles » au client ;
- **Délai** : 1 à 90 jours après la livraison ;
- **Frais de remise en stock** : 0 à 30 % ;
- **Bonus si avoir** : 0 à 20 %, ajouté quand le retour se règle en avoir ;
- **Résolutions proposées au client** : **Remboursement** (seulement si la commande a été payée), **Avoir**,
  **Échange** (autre taille ou couleur, au prix actuel) ; au moins une ;
- **Frais de retour à la charge de** : client ou boutique ;
- **Étiquettes non retournables** (séparées par des virgules) : les produits qui portent l'une d'elles ne sont pas
  retournables, pas plus que les cartes cadeaux ;
- **Exiger au moins une photo** (le client en joint jusqu'à 3) ;
- **Instructions envoyées après approbation** (1 000 caractères) : adresse de dépôt, horaires, emballage.

### Demande du client

Pour une commande **livrée** et dans le délai, le client clique sur **Retourner des articles** depuis son compte
(**Mes commandes**) ou depuis son lien de suivi. Il choisit les articles et quantités, le motif (taille ou coupe,
article défectueux, non conforme à la description, changement d'avis, autre), sa préférence parmi les résolutions
proposées, une note et ses photos, puis **Envoyer la demande**. Vous recevez une notification « Demande de retour
RT-… » ; il peut annuler sa demande tant qu'elle n'est pas traitée.

### Traitement

Onglets **À examiner**, **En attente de réception**, **À résoudre**, **Résolus**, **Refusés ou annulés**, **Tous**. La
fiche d'un retour propose les actions de son étape :

1. **Approuver le retour**, **Refuser** (motif communiqué au client) ou **Annuler le retour**.
2. Après approbation : **Réception des articles**. Pour chaque article, quantité **Reçu**, **État** (Neuf, Ouvert,
   Abîmé) et **Remettre en stock** (décoché pour un article abîmé), puis **Enregistrer la réception**. La remise en
   stock crée un mouvement de stock ; un retour approuvé peut encore être annulé.
3. **Résolution** : **Avoir**, **Remboursement**, **Échange** ou **Aucune**. Le calcul suggéré affiche la valeur des
   articles (remises de la commande déduites), les frais de remise en stock, la livraison remboursée et le plafond
   restant sur la commande. Options : **Ne pas appliquer les frais de remise en stock**, **Rembourser la livraison**
   (retour total uniquement), **Montant retenu** (vide = montant suggéré, jamais plus).

Les résolutions :

- **Avoir** : le montant, majoré du bonus de la politique, est crédité sur l'avoir du client (fiche créée si
  nécessaire).
- **Remboursement** : enregistré sur la commande comme un remboursement (paiement externe à effectuer par vos soins,
  cartes cadeaux et avoir utilisés recrédités) ; impossible si la commande n'est pas payée.
- **Échange** : choisissez la variante de remplacement de chaque article ; une commande d'échange est créée au prix
  actuel, la valeur retournée en est déduite. Une différence reste due par le client, un excédent va en avoir.
- **Aucune** : **Clôturer sans remboursement**.

Les points de fidélité gagnés sur la commande sont retirés au prorata du montant rendu. À chaque étape, le client est
prévenu par e-mail s'il en a laissé un.

**Créer un retour** depuis une commande livrée (retour en boutique ou accepté par téléphone) : articles, quantités,
état et remise en stock, motif, et **Étape** : **Articles déjà reçus en boutique** (directement à résoudre) ou
**Retour accepté, articles à recevoir**.

## 12. Comptes clients

Vos clients se connectent à la boutique avec un code à 6 chiffres reçu sur WhatsApp (ou par e-mail s'ils ont vérifié
leur adresse). La commande sans compte reste toujours possible. Inclus dans tous les plans.

### Réglages

Page **Comptes clients** (`/app/{boutique}/parametres/comptes-clients`, lien depuis la page **Paramètres**, qui
renvoie aussi vers Taxes et factures, Champs personnalisés, Retours et Devises) :

- **Proposer un compte client sur ma boutique** (activé par défaut). Désactivé, l'icône « Compte » et les cœurs
  « favori » disparaissent et les clients ne peuvent plus se connecter.
- **Envoi du code de connexion** :
  - **WhatsApp de votre boutique** (par défaut) : si votre WhatsApp Business est connecté, le code part de votre numéro
    (1 crédit WhatsApp utilitaire par code, remboursé si l'envoi échoue) ; sinon l'expéditeur Axi est utilisé ;
  - **Expéditeur Axi** : le code part du numéro Axi, sans crédit. Plan Gratuit : 30 codes par jour.
  Un client qui a vérifié son e-mail depuis son compte peut aussi recevoir son code par e-mail.
- **Texte d'accueil de la page de connexion** (280 caractères au maximum).

Indicateurs : clients vérifiés, sessions actives, codes envoyés et connexions réussies sur 30 jours. Les codes ne sont
jamais visibles par votre équipe.

### Côté client

- Icône **Compte** dans l'en-tête (réglage **En-tête › Icône « Compte »** de l'éditeur) et cœur **favori** sur les
  cartes produit et la fiche (réglage **Cartes produit › Cœur « favori »**, désactivé par défaut).
- Connexion : numéro de téléphone (ou e-mail vérifié), **Recevoir un code**, puis le code (valable 10 minutes,
  5 essais) et **Me connecter**. Le client reste connecté 90 jours sur l'appareil.
- Espace client : **Commandes** (détail, suivi, **Commander à nouveau** avec les articles encore disponibles aux prix
  actuels), **Adresses** (10 au maximum, une par défaut), **Favoris** (200 au maximum), **Retours**, avoir et points
  de fidélité, préférences WhatsApp, **Me déconnecter**, **Déconnecter tous mes appareils** et **Supprimer mon
  compte**.
- Au paiement, connecté : nom et téléphone préremplis (téléphone vérifié, non modifiable), choix d'une adresse
  enregistrée, cases pour utiliser ses points et son avoir. Non connecté : lien « Connectez-vous pour utiliser vos
  points ou votre avoir ».

### Fiche client

Carte **Compte client** : badge « Compte vérifié le … », « E-mail vérifié », dernière connexion et sessions actives
(type d'appareil et dernière activité ; l'adresse IP n'est jamais affichée). **Déconnecter tous les appareils**
ferme toutes ses sessions (action journalisée). Si le client a demandé la suppression de son compte, une alerte
« Suppression demandée » vous invite à anonymiser sa fiche.

## 13. Paiements en ligne : Wave, Orange Money, MTN MoMo, Moov Money

Menu **Paiements** (`/app/{boutique}/paiements`, propriétaire). Axi encaisse automatiquement Wave, Orange Money,
MTN MoMo et Moov Money (et la carte selon le fournisseur) en Côte d'Ivoire, au Sénégal et dans d'autres pays UEMOA
et CEMAC, via un agrégateur, **sur votre propre compte**, toujours à 0 % de commission Axi.

| Fournisseur | Pays (portefeuilles) | Parcours du client | Remboursement automatique |
|---|---|---|---|
| Paystack | Côte d'Ivoire : Wave, Orange Money, MTN MoMo, carte (XOF) | page de paiement Paystack | oui |
| pawaPay | CI : Wave, Orange, MTN ; SN : Wave, Orange ; BJ : MTN, Moov ; BF : Moov, Orange ; CM : MTN, Orange | page de paiement pawaPay (15 min) ; demande poussée sur le téléphone si le portefeuille et le numéro sont connus | oui |
| CinetPay | CI : Wave, Orange, MTN, Moov ; SN : Wave, Orange ; BF, ML, TG, BJ, CM, GN, NE | page de paiement CinetPay | non : remboursement à faire depuis l'espace CinetPay |

1. **Paiements › Ajouter un moyen › Type : « Mobile Money et carte en ligne »** (plan Starter et plus ; sinon le choix
   est verrouillé avec un lien vers l'abonnement).
2. **Fournisseur** : la liste montre d'abord les agrégateurs avec les portefeuilles disponibles dans le pays de la
   boutique (« Paystack : Wave, Orange Money, MTN MoMo, Carte bancaire »). Un agrégateur qui ne couvre pas votre pays
   est marqué « pays non couvert » et refusé à l'enregistrement avec un message clair (exemple : « Paystack n'encaisse
   pas dans le pays de votre boutique » pour une boutique au Bénin).
3. **Moyens proposés au client** : cases à cocher (Wave, Orange Money…). Le libellé vu par le client suit
   automatiquement (« Wave, Orange Money ou MTN MoMo ») tant que vous ne l'avez pas modifié.
4. **Identifiants** : clé(s) du fournisseur, environnement (pawaPay), pays du compte (CinetPay, qui doit être le pays de
   la boutique). Les clés sont chiffrées et ne sont jamais réaffichées ; un secret laissé vide est conservé lors d'une
   modification.
5. **Tester la connexion** : vérifie les clés auprès du fournisseur sans rien débiter (10 essais par 10 minutes),
   rappelle l'URL de webhook à déclarer et, pour pawaPay, signale si l'URL de rappel des dépôts n'est pas celle d'Axi.
   Une fausse clé donne un message d'échec clair, sans rien enregistrer.
6. Copiez l'**URL de webhook** et déclarez-la chez le fournisseur (sauf CinetPay, qui la reçoit à chaque paiement).

Mode test ou production : Paystack et CinetPay le déduisent du préfixe de la clé (`sk_test_` / `sk_live_`), pawaPay a
un champ « Environnement ». Le badge **Mode test** s'affiche dans la liste des moyens.

Côté client : il voit le libellé du moyen, la pastille « En ligne » et la phrase « Vous serez redirigé vers une page de
paiement sécurisée ». Une redirection ne vaut jamais paiement : la commande passe **Payée** seulement quand le
fournisseur confirme. Une page abandonnée expire (Paystack et CinetPay après 30 minutes, pawaPay après 20 minutes) ;
le client peut relancer un paiement. Si une notification du fournisseur s'est perdue, le bouton **Vérifier les paiements
en attente** (ou le traitement automatique toutes les 5 minutes) interroge le fournisseur. CinetPay accepte de 100 à
2 500 000 XOF par paiement.

**Remboursement** : un remboursement « vers le moyen d'origine » enregistré sur une commande ou un retour déclenche
automatiquement la demande chez Paystack ou pawaPay pour la part payée en ligne ; l'historique de la commande indique
« Remboursement … demandé à … ». En cas d'échec, ou avec CinetPay, une notification « Remboursement à effectuer à la
main » est créée.

Pas à pas par fournisseur (comptes, clés de test, URL de webhook) : [`DEPLOIEMENT.md`](DEPLOIEMENT.md) §7.1 bis.

## 14. Catalogue WhatsApp et flux (Meta, Google, TikTok)

Écran **Intégrations › Catalogue WhatsApp** (`/app/{boutique}/integrations/whatsapp-catalogue`, plan Business et plus).
Lecture pour le propriétaire et le gérant, modification réservée au propriétaire. Axi devient la **source du
catalogue** de WhatsApp et de l'agent IA de Meta, et récupère les commandes passées depuis WhatsApp.

1. **Flux Meta** : activez le flux Meta, copiez l'adresse. Dans Commerce Manager, créez un catalogue « E-commerce »,
   puis Sources de données › Flux de données › Flux programmé : collez l'adresse, mise à jour toutes les heures.
2. **Relier au numéro** : Gestionnaire WhatsApp › Outils du compte › Catalogue : choisissez ce catalogue. Les clients le
   voient dans le profil WhatsApp et l'agent de Meta peut recommander les produits.
3. **Synchronisation directe (facultatif)** : avec l'API WhatsApp officielle connectée (page WhatsApp), saisissez
   l'identifiant du catalogue Meta et cochez « Synchroniser automatiquement ». Le jeton doit avoir la permission
   `catalog_management`. Pour un même catalogue, utilisez **soit** le flux, **soit** la synchronisation.
4. **Commandes** : un panier envoyé depuis WhatsApp reçoit en réponse un lien vers la boutique (livraison, paiement),
   ouvert sur un panier prérempli ; les prix et le stock sont recalculés au paiement. La conversation est dans
   **Conversations** (« [Panier WhatsApp reçu] N articles »). La réponse consomme 1 crédit WhatsApp utilitaire ; sans
   crédit, le lien reste visible dans la boîte. Boutique fermée temporairement : message d'attente, pas de panier.
   10 paniers par 10 minutes et par numéro au maximum.
5. **Google et TikTok** : activez leur flux et collez l'adresse dans Merchant Center ou TikTok Ads Manager (renseignez-y
   les frais de livraison).

L'écran affiche : nombre d'articles publiables, articles **exclus** (sans photo publique https, prix nul) avec un lien
vers la fiche, articles sur WhatsApp, articles **refusés par Meta** avec le motif, dates de dernière et de prochaine
synchronisation, échecs consécutifs, et le bouton **Synchroniser maintenant** (6 par heure). Options : marque affichée,
publier ou non les articles en rupture.

Ce que contiennent les flux : une ligne par variante (ou par produit sans variante), titre, description en texte
brut, lien vers la fiche (avec la variante présélectionnée), photos, prix et devise, prix barré ou promotion datée,
disponibilité selon la politique de stock (« Continuer à vendre » = précommande ; boutique fermée temporairement =
rupture), marque (option, sinon marque du produit, sinon nom de la boutique), code-barres seulement s'il est valide,
couleur et taille, collection publiée. **Jamais** : prix d'achat, quantité en stock, SKU, étiquettes, notes, produits
non actifs, cartes cadeaux. Un flux n'est servi que si la boutique est publiée (ou fermée temporairement), si le plan
l'inclut et s'il est activé ; activer, désactiver ou changer une option prend effet immédiatement.

Échecs de synchronisation : le statut passe à « Erreur » avec un message (sans jamais afficher le jeton), puis
nouvelle tentative après 5 minutes, 10, 20… (24 h au plus). Une condition manquante (identifiant de catalogue,
intégration WhatsApp inactive, boutique non publiée) suspend la synchronisation jusqu'à correction ; enregistrer les
réglages la relance. Une boutique dépubliée ne supprime rien chez Meta.

## 15. Devises

Menu **Devises** (`/app/{boutique}/devises`). Les prix restent saisis en FCFA ; les autres devises sont **affichées**
au client.

- **Plan** : Gratuit aucune devise en plus, Starter 1, Business 3, Scale 10, Enterprise illimité. Après une baisse de
  plan, les premières devises (ordre d'activation) restent affichées, les autres sont conservées.
- **Ajouter une devise** : l'euro et le franc CFA de l'autre zone (parités fixes BCEAO) et les devises publiées par la
  Banque centrale européenne (BCE) ont un taux automatique. Les autres (naira, cedi, dirham…) sont créées désactivées
  en mode manuel : saisissez un taux.
- **Taux** :
  - automatique : parités fixes 1 € = 655,957 FCFA (XOF et XAF), XOF = XAF ; autres devises : taux quotidien de la BCE ;
  - manuel : « 1 unité affichée = x FCFA », ne périme jamais (sous votre responsabilité) ;
  - un taux automatique de plus de 72 h n'est plus utilisé : la boutique s'affiche en FCFA (statut « Taux de plus de
    72 h »). L'euro, à parité fixe, reste toujours disponible.
- Exemple affiché : EUR → « 1 EUR = 655,957 FCFA (parité fixe BCEAO) », « 10 000 FCFA ≈ 15,24 € ».
- **Marge de change** : 0 à 5 %. **Arrondi** des prix et de la livraison (jamais des remises ni des taxes) : au plus
  proche, multiple supérieur de 5, 10, 25, 50 ou 100 unités, ou terminaison ,99 / ,95 (devises à centimes).
- **Prix fixés** (produits sans variantes) : un prix rond par devise (ex. 15 €) remplace la conversion ; une promotion
  datée en cours reste prioritaire (elle est convertie).

Ce que voit le client : un **sélecteur de devise** dans l'en-tête et au paiement (rien s'il n'y a qu'une devise ; vous
pouvez le retirer de l'en-tête avec **Thème › En-tête › Afficher le sélecteur de devise**). La devise est choisie
automatiquement selon le pays et la langue du navigateur, puis mémorisée. Les remises, paliers, minimum de code promo
et livraison offerte sont **toujours évalués en FCFA**, puis convertis. Au paiement, le client lit « Vous serez débité
de 6 560 FCFA (≈ 10,00 €) » : le Mobile Money et les moyens manuels sont toujours débités en FCFA. Les cartes cadeaux ne
s'utilisent qu'en FCFA (« Les cartes cadeaux s'utilisent uniquement dans la devise de la boutique »). La commande est
enregistrée en FCFA, avec une note « Affiché en EUR… » et le total affiché conservé à titre indicatif. Un taux
verrouillé au paiement reste valable 15 minutes ; si la devise est désactivée ou son taux périmé pendant le paiement,
la commande repasse en FCFA avec un message.

## 16. Taxes et factures

Menu **Taxes et factures** (`/app/{boutique}/parametres/taxes`), plan Starter et plus. **Axi ne fournit pas de conseil
fiscal** : vérifiez vos taux avec votre comptable.

1. « Ajouter TVA 18 % (Bénin, indicatif) » crée le taux normal du pays de la boutique (préréglages : BJ, SN, CI, TG, BF,
   ML, GA, GN 18 % ; NE 19 % ; CM 19,25 % ; CG 18,9 % ; FR 20 %). Le pays de taxation est celui de la boutique.
2. Activez « Collecter la TVA sur mes ventes », choisissez **TTC** (usage courant : le prix affiché est le prix payé,
   « dont TVA ») ou **HT** (la TVA s'ajoute au total). L'exemple de l'écran affiche « dont TVA (18 %) » 1 678 pour
   10 000 + 1 000 de livraison.
3. Identité fiscale : raison sociale, numéro fiscal (IFU, NIF : obligatoire pour facturer la TVA), RCCM, adresse,
   régime (TVA, TPS, autre) et, si besoin, une mention d'exonération. En régime TPS, aucune TVA n'est collectée et les
   factures portent « TVA non applicable » (ou votre mention).
4. Taux supplémentaires : un taux par pays et par catégorie (normal, réduit, exonéré), livraison taxée ou non, actif
   ou non.
5. Produit : soumis à la TVA et catégorie fiscale (par défaut : soumis, taux normal). Les cartes cadeaux sont toujours
   exonérées. La carte « Taxes » de la fiche produit est prête mais pas encore affichée sur la fiche (écart connu).

**Au paiement** : en TTC, « dont TVA (18 %) » sous le total ; en HT, une ligne « TVA (18 %) » avant le total, majoré
d'autant. Sans taux (TPS, autre) : « TVA non applicable » ou votre mention. Quand la boutique applique les taxes, la
case « Facture au nom d'une entreprise » demande la raison sociale (obligatoire) et le numéro fiscal IFU/NIF
(facultatif). La TVA est calculée ligne par ligne, après toutes les remises ; l'écart d'arrondi est au plus d'une unité
par ligne.

**Factures** (`/app/{boutique}/commandes/{commande}/facture`, d'une commande payée ; pas encore de bouton sur la fiche
commande, ouvrez l'adresse directement) :
- émission automatique au paiement (case proposée cochée à la première configuration de vos réglages fiscaux ; aucune facture n'est émise automatiquement avant cet enregistrement) ou bouton « Émettre la facture » ;
- numéro `F-AAAA-000001`, séquentiel sans trou par boutique (année d'émission dans le fuseau de la boutique) ; avoir
  `A-AAAA-000001` à chaque remboursement d'une commande facturée ; la somme des TVA des avoirs ne dépasse jamais la TVA
  de la facture ;
- une facture émise ne change plus jamais (ni suppression, ni modification) : on corrige par un avoir ;
- si des remboursements n'ont pas d'avoir, la page les signale et propose « Émettre les avoirs manquants » ; émettre
  une facture régularise aussi les remboursements antérieurs ;
- « Imprimer ou PDF » : impression du navigateur (enregistrer en PDF), sans menu ni boutons ;
- l'acheteur consulte ses documents par son lien de suivi : `/suivi/{jeton}/facture` (même expiration que le suivi ;
  « Facture introuvable » pour un jeton inconnu, « Lien expiré » sinon). Le lien n'est pas encore affiché sur la page
  de suivi.

Une boutique rétrogradée peut seulement désactiver les taxes ; les documents émis restent consultables et les avoirs
continuent d'être émis (obligation fiscale).

## 17. Blog

Menu **Blog** (propriétaire et gérant), plan Starter (20 articles, tous statuts confondus) ; illimité à partir de
Business. Sur le plan Gratuit, l'écran explique ce que le blog apporte et propose de changer de plan.

**Écrire un article** (**Blog › Nouvel article**) :
- titre, image de couverture (téléversée, compressée dans le navigateur, avec sa description pour l'accessibilité) ;
- contenu en mise en forme simple : `## intertitre`, `**gras**`, `*italique*`, `- liste`, `> citation`,
  `[lien](https://…)` ou lien vers la boutique `[voir](/catalogue)`, images insérées avec « Insérer une image » (une
  image par ligne). Un contenu avec du HTML (`<script>`) ou un lien `javascript:` est refusé ;
- onglet **Aperçu** pour relire le rendu ; temps de lecture calculé automatiquement ;
- **Organisation** : résumé (affiché sur les cartes), catégorie, étiquettes (séparées par des virgules), auteur ;
- **Référencement** : adresse de l'article (si elle est déjà prise, un suffixe `-2` est ajouté), titre et
  description pour Google, avec un aperçu du résultat de recherche.

**Publier** : *Brouillon*, *Publier maintenant*, *Programmer* (date et heure dans le fuseau de la boutique, au moins
2 minutes et au plus un an dans le futur) ou *Archiver*. Un article programmé apparaît tout seul à l'heure dite. Depuis
la liste, le menu « … » publie, repasse en brouillon ou archive ; la corbeille supprime définitivement (confirmation),
même après un passage au plan Gratuit. Au-delà du quota, la création est refusée avec un lien vers l'abonnement ; les
articles existants restent modifiables.

**Aperçu d'un article non publié** : ouvert depuis Axi (« Aperçu »), il s'affiche sur la boutique avec un bandeau
« Aperçu : article programmé… » visible des seuls membres. Les clients reçoivent une page introuvable.

**Catégories** (**Blog › Catégories**) : nom, adresse, présentation (en tête de la page de la catégorie), ordre
(flèches). Supprimer une catégorie laisse ses articles publiés, sans catégorie.

**Brouillon avec l'IA** (plan Business, 3 crédits IA) : indiquez un sujet et, si vous voulez, vos notes. L'assistant
remplit titre, résumé, contenu, étiquettes et référencement ; rien n'est enregistré ni publié avant votre relecture. Il
n'écrit jamais de prix, de délai, de promotion ni de garantie (phrases retirées automatiquement). En cas d'échec, les
crédits ne sont pas débités. « Rétablir le texte précédent » annule la proposition.

**Sur la boutique** :
- `/blog` : liste paginée, filtre par catégorie (pastilles), filtre par étiquette (`?etiquette=`), premier article à la
  une, lien vers le flux RSS ;
- `/blog/categorie/{adresse}` : articles d'une catégorie ;
- `/blog/{adresse}` : l'article (fil d'Ariane, partage WhatsApp, Facebook, copie du lien, articles liés) ;
- `/blog/rss.xml` : flux RSS (30 derniers articles) ;
- `/sitemap.xml` de la boutique : accueil, catalogue, collections, produits, pages et blog.

Les dates des articles sont affichées en heure UTC (écart d'au plus un jour autour de minuit pour un fuseau non UTC).

**Apparence** (éditeur de thème) :
- modèle **Blog** : section obligatoire « Liste des articles » (titre, présentation, filtre, article à la une, grille
  ou liste, 2 ou 3 colonnes, articles par page, éléments des cartes) ;
- modèle **Article** : section obligatoire « Article » avec blocs réordonnables *Titre*, *Date et auteur*, *Image de
  couverture*, *Contenu*, *Partager*, *Articles liés* ; des modèles alternatifs d'article se créent comme pour les
  produits (section 20) ;
- section **« Derniers articles »**, ajoutable à l'accueil et aux autres modèles : 2 à 12 articles, catégorie (liste
  déroulante des catégories de la boutique ; vide = toutes), disposition grille / à la une / liste, colonnes, image et
  format, extrait, date, catégorie, lien « Tous les articles ». Masquée pour les clients tant qu'aucun article n'est
  publié.

## 18. Webhooks et API REST

Écran **Intégrations › Webhooks et API** (`/app/{boutique}/integrations/webhooks`, propriétaire uniquement ; le gérant
et l'employé ne voient pas le menu). Référence développeur complète : [`API-REST.md`](API-REST.md).

- **Ajouter un point** : URL `https://` de votre logiciel, événements à recevoir, option « données personnelles »
  (désactivée par défaut). Les adresses `http://`, les adresses internes ou privées et les ports non standard sont
  refusés. Le **secret** `whsec_…` s'affiche **une seule fois** : copiez-le dans votre logiciel.
- **Envoyer un test** : événement `app.ping` immédiat.
- **Mettre en pause / Réactiver**. Un point qui échoue 50 fois de suite pendant plus de 72 h est **désactivé
  automatiquement** (notification et e-mail) ; réactivez-le après correction.
- **Nouveau secret** : rotation sans coupure, l'ancien secret reste valide 24 h.
- **Livraisons** : statut (Livré, Nouvel essai prévu, Abandonné, En attente), code HTTP, durée, extrait de la réponse ;
  filtres ; **Rejouer**. En cas d'échec, nouvel essai après 1 minute, puis de plus en plus espacés (jusqu'à 24 h),
  abandon après 8 essais.
- **API REST** : base `…/api/v1`, avec les jetons de **Connecteurs IA**. Business : lecture ; Scale et plus : lecture
  et écriture. Webhooks : Business 2 points, Scale 10, Enterprise illimité.

Événements envoyés aujourd'hui : commandes (`order.created`, `order.paid`, `order.status_changed`, `order.cancelled`,
`order.refunded`), produits (`product.created`, `product.updated`, `product.deleted`) et stock (`inventory.updated`)
modifiés depuis l'espace marchand ou l'API REST. Sans l'option « données personnelles », les messages ne contiennent ni
nom ni téléphone du client.

## 19. Champs personnalisés

**Paramètres › Champs personnalisés** (`/app/{boutique}/parametres/champs`).

- Créez un champ (ex. « Matière », texte sur une ligne) pour les produits, variantes, collections, pages, clients,
  commandes, la boutique ou les articles.
- 17 types : texte (ligne, paragraphes, mis en forme, liste), nombre entier ou décimal, note, dimension, poids,
  montant, oui / non, date, couleur, lien, image, produit lié, collection liée.
- Validations : longueur ou valeur minimale et maximale, liste de choix, format imposé (expression régulière courte,
  100 caractères au plus, sans quantificateurs imbriqués). Modifier une validation ne revérifie pas les valeurs déjà
  saisies : elles le seront à leur prochaine modification.
- **Visible dans la boutique** : le thème peut afficher le champ (« Connecter une donnée », section 20). Les champs
  **clients et commandes restent toujours privés** (la case est absente).
- **Épingler** : le champ est toujours affiché dans le formulaire ; les autres sont repliés sous « Afficher les autres
  champs ». Ordre réglable (flèches).
- Saisie : bloc **Champs personnalisés** en bas des fiches produit, collection, page et client (bouton « Enregistrer les
  champs », indépendant du formulaire principal ; lien « Gérer les champs »). Une valeur invalide (une couleur mal
  écrite, par exemple) est signalée sous le champ et rien n'est enregistré.
- Plans : Starter 10 champs, Business 100, Scale et plus illimité. Après une baisse de plan, les valeurs restent
  affichées mais ne sont plus modifiables.
- Supprimer un champ supprime ses valeurs ; les sections qui l'affichaient reprennent leur valeur par défaut.

## 20. Éditeur de thème : fonctions avancées (lot 4A)

### Qualité

Colonne de gauche, onglet **Qualité** (score global sur l'onglet). Quatre jauges : accessibilité, performance,
référencement, conversion (score sur 100 et libellé « Bon », « À améliorer » ou « Faible »). Cliquer une jauge filtre la
liste. Chaque problème indique sa gravité (Important, À améliorer, Conseil) et propose :
- **Corriger** : la correction est appliquée au brouillon en une seule étape, annulable par Ctrl+Z ou par le bouton
  « Annuler » de la notification ;
- **Ouvrir** (nouvel onglet) quand la correction se fait hors du thème (fiche produit, paramètres, collections) ;
- **Voir** : sélectionne la section concernée (ou bascule sur le bon modèle de page).

Les scores sont recalculés 500 ms après la dernière modification. Les poids et dimensions des images téléversées ne
sont pas encore mesurés ; les suggestions « texte alternatif par l'IA » et « référencement par l'IA » ouvrent pour
l'instant la fiche concernée.

### Animations

**Thème › Animations** : intensité (Aucune, Sobre, Vive), apparition au défilement, parallaxe, zoom au survol. Chaque
section a un réglage **Animation d'apparition** (Selon le thème, Aucune, Fondu vers le haut, Fondu, Zoom léger,
Glissement). Dans l'aperçu, la case **Réduire les animations** coupe toutes les animations (aperçu seulement).

Sur la boutique, la première section (souvent la bannière) et les sections principales (fiche produit, collection,
page, panier) ne sont jamais animées. Aucune animation pour un visiteur qui a demandé à réduire les animations, en mode
économie de données ou avec l'option « Aucune » ; sans JavaScript, rien n'est masqué.

### Modèles de page alternatifs

Sur **Produit**, **Collection**, **Page** ou **Article**, le bouton **Modèles** (icône calques, à côté du sélecteur de
page) ouvre la gestion : créer par duplication (« Partir de »), renommer, supprimer (avertissement avec la liste des
éléments qui l'utilisent ; ils retrouvent le modèle par défaut). Le sélecteur de page liste « Produit (par défaut) »,
« Produit · luxe »… Masquer une section dans un modèle alternatif ne change pas le modèle par défaut. Dans l'aperçu
d'un modèle alternatif, **Aperçu avec** affiche une fiche réelle qui l'utilise. Renommer ou supprimer un modèle
enregistre d'abord le brouillon et ne peut pas être annulé (annoncé). Plan : Business 5 par type, Scale et Enterprise
20 (plafond global 20) ; le plan Gratuit ou Starter ne peut pas en créer (lien vers les plans).

Une fiche dont le modèle a été supprimé du thème s'affiche avec le modèle par défaut. Aucun écran ne permet encore
d'attribuer un modèle alternatif à un produit, une collection, une page ou un article (écart connu).

### Connecter une donnée (sources dynamiques)

Sous les champs compatibles (texte, zone de texte, texte enrichi, image, lien, couleur) : **Connecter une donnée**. Le
sélecteur propose les données du produit, de la variante, de la collection, de la page ou de la boutique selon la page
éditée, ainsi que les champs personnalisés marqués visibles en boutique. Chaque choix montre une valeur d'exemple
(premier produit actif). Une donnée connectée s'affiche en carte (« Produit · Matière », exemple) avec **Changer** et
**Déconnecter** (la valeur par défaut du réglage revient). Les données des clients et des commandes ne sont jamais
proposées.

### Sections enregistrées et bibliothèque

Dans l'inspecteur d'une section : icône **Enregistrer cette section** (nom unique dans la boutique) ; elle se réutilise
sur toute page compatible. « Ajouter une section » a trois onglets : **Sections**, **Mes sections** (insérer,
supprimer), **Bibliothèque** (compositions Axi groupées par catégorie, badge Premium, cadenas et plan requis). Une
section insérée reçoit de nouveaux identifiants ; si elle citait un produit ou une collection disparus, ces références
sont retirées (« Certaines références introuvables ont été retirées. »). Plans : sections enregistrées Starter 20,
Business et plus illimité ; bibliothèque pour tous, éléments premium à partir de Business (contrôle à l'insertion).

### Visible pour (audience)

En bas des réglages d'une section : **Visible pour** = Tout le monde, Seulement si, Sauf si ; conditions combinées
(toutes ou au moins une) : type de client (nouveau, récurrent, fidèle, avec des points), ville, provenance (WhatsApp,
Instagram, TikTok…), appareil, jours et heures (fuseau de la boutique), langue. Business : type de client seulement ;
Scale et plus : tout. Les sections principales (fiche produit, panier…) restent visibles pour tous. Les robots
d'indexation voient l'audience par défaut ; les prix ne sont jamais masqués ni modifiés. Dans l'aperçu, **Simuler un
visiteur** (client, provenance, ville, jour, heure ; appareil = taille d'aperçu).

### Nouvelles sections

- **Caractéristiques du produit** (modèle Produit) : en mode automatique, tous les champs personnalisés du produit
  visibles sur la boutique (triés par nom), puis vos lignes (libellé + valeur fixe ou donnée connectée). Ligne vide
  omise ; section absente s'il ne reste rien ; « Masquer la section si une donnée connectée est vide ». Tableau ou
  grille.
- **Vidéo et texte** : fichier MP4 ou WebM https direct (pas YouTube), sans son, en boucle, bouton Pause/Lecture.
  L'image de couverture est indispensable : elle s'affiche d'abord (et reste seule en mode économie de données ou si le
  visiteur réduit les animations). La vidéo n'est téléchargée que lorsque la section est visible.
- **Look à acheter** : une photo, jusqu'à 6 repères numérotés vers des produits, et la liste des produits avec leur
  prix à côté. Sans produit choisi, la section est masquée.
- **Avant, après** : deux images au même cadrage, curseur utilisable au clavier (flèches) et annoncé par les lecteurs
  d'écran.
- **Guide des tailles** : jusqu'à 4 mesures, 12 tailles, cm ou pouces, éventuellement replié.
- **Tableau comparatif** : 2 ou 3 colonnes, « oui » / « non » affichés en coche / croix (lisibles sans la couleur).
  N'affirmez que ce que vous pouvez prouver.
- **Bandeau défilant** : messages courts ; arrêté au survol et au focus, immobile si le visiteur réduit les
  animations. Un seul par page conseillé.

### En-tête : logo et devise

La largeur du logo va de 40 à 300 px (45 % de la largeur de l'écran au plus sur mobile). **Afficher le sélecteur de
devise** (coché par défaut) : décoché, l'en-tête n'affiche pas de sélecteur de devise, même si la boutique propose
plusieurs devises.

## 20 bis. Produits numériques et services (vague 2)

Détail complet : [`vague2/N-produits-numeriques.md`](vague2/N-produits-numeriques.md).

**Choisir le type de produit.** À la création, la page s'ouvre sur « Que vendez-vous ? » (quatre cartes, avant le
titre) : **Produit physique** (défaut), **Produit numérique**, **Service** ou **Carte cadeau**. Sur un produit
existant, le type est rappelé en haut du formulaire (« Type de produit : … · Changer », avec les conséquences
listées avant confirmation). Le formulaire s'adapte : le numérique et le service n'ont ni stock (le service peut en
activer un pour limiter les places), ni poids, ni livraison. Détail : §3, « Choisir le type de produit ».

**Vendre un fichier.** Enregistrez d'abord le produit, puis carte « Fichiers à remettre » : PDF, ZIP, EPUB, MP3, MP4,
JPEG, PNG, WebP, **50 Mo par fichier**, 20 fichiers par produit (l'espace occupé est celui de votre plan, partagé avec
les photos). Réglez le nombre de téléchargements autorisés (défaut 5, `0` = illimité), la validité du lien en jours
(défaut 365, `0` = sans limite) et les instructions envoyées après l'achat. « Remplacer » envoie une nouvelle version :
tous les acheteurs, anciens compris, téléchargent la nouvelle.

**Ce que vit l'acheteur.** Un panier composé uniquement de produits numériques, de services ou de cartes cadeaux n'a
ni livraison, ni retrait, ni adresse, ni frais ; le paiement à la livraison est refusé dès qu'un fichier ou une carte
cadeau s'y trouve. Dès le paiement confirmé, l'acheteur reçoit un **lien personnel** par e-mail et retrouve ses
fichiers depuis le suivi de commande (« Vos fichiers »). La commande 100 % numérique passe seule en « Livrée / remise ».

**Suivre.** Fiche commande › carte « Téléchargements » : téléchargements utilisés, limite, expiration, dernier accès.
« Renvoyer le lien » émet un **nouveau** lien (l'ancien cesse de fonctionner).

**Services.** Durée, lieu ou prestation à distance, note de réservation affichée sur la fiche, instructions envoyées
après l'achat. Il n'y a pas encore de calendrier ni de réservation de créneau.

**Plans.** Inclus dans tous les plans, Gratuit compris : la limite est l'espace de stockage du plan.

## 21. Pour aller plus loin

- Piloter la boutique depuis un assistant IA (Claude, ChatGPT, Cursor) : **Boutique › Connecteurs IA**, voir
  [`API-MCP.md`](API-MCP.md).
- Intégrer un logiciel (ERP, comptabilité) : [`API-REST.md`](API-REST.md).
- Scénarios de vérification : [`RECETTE.md`](RECETTE.md), sections 4 ter (constructeur et catalogue), 4 quater
  (ventes et fidélité), 4 quinquies (paiements Wave / Orange Money et catalogue WhatsApp), 4 sexies (devises, taxes et
  factures, blog, API REST et webhooks), 4 septies (personnalisation de la boutique) et 4 octies (produits numériques).
