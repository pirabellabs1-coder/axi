# Dossier « Contrôle de l'app » Meta — Pirabel Labs – Axi

Objectif : obtenir l'**accès avancé** (Advanced Access) aux permissions WhatsApp pour que **n'importe quel marchand**
connecte son numéro à Axi (nouveau numéro ou coexistence avec l'app WhatsApp Business). Sans cet accès, seuls les
numéros de test et les actifs des administrateurs de l'app fonctionnent (erreur #2655111).

App Meta : **Pirabel Labs – Axi** (App ID 1858789872223719). Entreprise : **Pirabel Labs** (vérification en cours).
Où : developers.facebook.com → ton app → **Contrôle app** (App Review) → **Demandes de permissions et fonctionnalités**.

---

## 0. Pré-requis à cocher avant de soumettre

- [ ] Vérification de l'entreprise Pirabel Labs **validée** (l'accès avancé n'est accordé qu'après).
- [ ] App en mode **En ligne (Live)**, icône (1024×1024), catégorie « Business et pages ».
- [ ] **URL de politique de confidentialité** accessible publiquement : `https://16-192-144-250.nip.io/legal/confidentialite`
      (à remplacer par le vrai domaine dès qu'il existe ; l'ancienne adresse Vercel ne doit plus être utilisée).
- [ ] **URL des conditions d'utilisation** : `https://16-192-144-250.nip.io/legal/cgu`
- [ ] **Instructions de suppression des données** (URL ou e-mail `contact@pirabellabs.com`).
- [ ] Un **compte de test** pour l'examinateur (voir §4).
- [ ] Les **vidéos** enregistrées (voir §3).

> Conseil : vérifier que ces URL répondent (200) juste avant la soumission. Un lien mort = refus immédiat.

---

## 1. Permissions à demander (accès avancé)

| Permission | Pourquoi Axi en a besoin |
|---|---|
| `whatsapp_business_management` | Lire le compte WhatsApp Business (WABA) et le numéro partagés par le marchand via l'inscription intégrée, abonner l'app au WABA, gérer les modèles de messages, lire la qualité du numéro. |
| `whatsapp_business_messaging` | Envoyer et recevoir les messages du marchand : confirmations et suivis de commande, réponses aux clients depuis la boîte de réception Axi. |
| `business_management` *(si proposée par le formulaire)* | Lire le portefeuille d'entreprise rattaché au WABA lors de l'inscription intégrée. |

---

## 2. Textes d'usage (à coller dans chaque demande)

### `whatsapp_business_management` — FR
Axi est une plateforme de commerce en ligne pour les commerçants d'Afrique francophone. Depuis son espace « WhatsApp »,
le marchand clique sur « Connecter avec WhatsApp » et suit l'inscription intégrée de Meta pour partager son compte
WhatsApp Business et son numéro avec Axi. Nous utilisons whatsapp_business_management uniquement pour : (1) lire le
numéro partagé (numéro affiché, nom vérifié) et l'afficher au marchand ; (2) abonner notre application au compte
WhatsApp Business afin de recevoir les messages de ses clients sur notre webhook ; (3) créer, lister et supprimer les
modèles de messages du marchand depuis l'écran « Modèles » ; (4) afficher la qualité et la limite d'envoi du numéro.
Nous n'accédons à aucun compte que le marchand n'a pas explicitement partagé, et il peut déconnecter son numéro à tout moment.

### `whatsapp_business_management` — EN
Axi is an e-commerce platform for merchants in French-speaking Africa. In the "WhatsApp" section of their dashboard, the
merchant clicks "Connect with WhatsApp" and completes Meta's Embedded Signup to share their WhatsApp Business account and
phone number with Axi. We use whatsapp_business_management only to: (1) read the shared phone number (display number,
verified name) and show it to the merchant; (2) subscribe our app to the merchant's WhatsApp Business Account so their
customers' messages reach our webhook; (3) create, list and delete the merchant's message templates from the "Templates"
screen; (4) display the number's quality rating and messaging limit. We never access an account the merchant has not
explicitly shared, and the merchant can disconnect their number at any time.

### `whatsapp_business_messaging` — FR
Une fois son numéro connecté, le marchand utilise Axi pour communiquer avec ses propres clients : envoi automatique des
confirmations de commande, avis « commande prête » et suivis de livraison (modèles approuvés), et réponses aux clients
depuis la boîte de réception partagée d'Axi. Les messages entrants des clients arrivent sur notre webhook et s'affichent
dans la conversation correspondante. Les envois marketing ne concernent que les clients ayant donné leur consentement,
et le désabonnement est respecté. Aucun message n'est envoyé à des personnes qui ne sont pas clientes du marchand.

### `whatsapp_business_messaging` — EN
Once their number is connected, the merchant uses Axi to communicate with their own customers: automatic order
confirmations, "order ready" notices and delivery updates (approved templates), and replies to customers from Axi's
shared inbox. Customers' incoming messages reach our webhook and appear in the matching conversation. Marketing messages
are only sent to customers who opted in, and opt-outs are honoured. No message is ever sent to people who are not the
merchant's customers.

---

## 3. Script des vidéos de démonstration (une vidéo par permission, 1 à 3 min, en anglais à l'écran si possible)

Enregistrer l'écran (OBS, Loom ou l'enregistreur Windows `Win + Alt + R`), résolution lisible, souris visible,
**sans montrer aucun secret** (jetons, mots de passe). Ajouter des sous-titres courts si possible.

### Vidéo A — `whatsapp_business_management`
1. Page d'accueil Axi → **Connexion** avec le compte de test marchand.
2. Menu **WhatsApp** → montrer la carte « Connexion partenaire ».
3. Cliquer **« Connecter avec WhatsApp »** → la fenêtre Meta s'ouvre (montrer l'URL facebook.com).
4. Choisir le portefeuille, le compte WhatsApp Business et le numéro → **partager** → **Terminer**.
5. Retour dans Axi : la carte affiche **« Connecté »** avec le numéro et le nom vérifié (= lecture du numéro).
6. Ouvrir **WhatsApp → Modèles** : créer un modèle (« confirmation de commande »), le voir apparaître avec son statut,
   puis le supprimer (= gestion des modèles).
7. Montrer l'indicateur de **qualité / limite d'envoi** du numéro.
8. Montrer le bouton de déconnexion / « Changer de numéro ».

### Vidéo B — `whatsapp_business_messaging`
1. Axi connecté (début de vidéo A déjà fait).
2. **Téléphone filmé ou WhatsApp Web** d'un « client » : envoyer « Bonjour, je veux commander » au numéro du marchand.
3. Dans Axi → **Conversations** : le message arrive en temps réel dans la conversation du client.
4. Répondre depuis Axi → montrer la réponse reçue sur le téléphone du client.
5. Passer une **commande** sur la boutique Axi avec ce client → montrer la **confirmation de commande WhatsApp**
   reçue automatiquement sur son téléphone.
6. Changer le statut de la commande en « prête » → montrer le message « commande prête » reçu.

---

## 4. Compte de test pour l'examinateur

Dans « Instructions pour l'examinateur » :

- URL : `https://16-192-144-250.nip.io/connexion`
- E-mail : *(créer un compte marchand dédié à l'examen, par ex. `review@pirabellabs.com`)*
- Mot de passe : *(à créer, ne pas réutiliser un mot de passe existant — à saisir directement dans le formulaire Meta,
  jamais dans un chat)*
- Étapes : se connecter → menu WhatsApp → « Connecter avec WhatsApp » → suivre la fenêtre Meta avec le numéro de test
  fourni par Meta → Conversations / Modèles.

> Créer ce compte avec une boutique au **plan Business** (le bouton n'apparaît pas sur les plans inférieurs).

---

## 5. Après la soumission

- Délai habituel : quelques jours. Meta peut demander une nouvelle vidéo si une étape n'est pas visible : refaire
  uniquement l'étape demandée.
- Une fois l'accès avancé accordé : retester la coexistence avec le vrai numéro (bouton « J'utilise déjà WhatsApp
  Business »). La limite de 5 messages / 24 h saute après vérification de l'entreprise et approbation du nom affiché.
- Pensez à cocher dans le webhook les champs `history`, `smb_app_state_sync`, `smb_message_echoes` (coexistence).
