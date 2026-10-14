# Déploiement — Mode partenaire WhatsApp (Embedded Signup) sur AWS

Mémo opérationnel pour **activer** le mode partenaire WhatsApp en production. Le code est déjà sur `main`
(voir `docs/DEPLOIEMENT.md` §7.3 ter/quater pour la conception). Hébergement cible : **AWS** (Vercel abandonné).

> ⚠️ **Aucun secret dans ce fichier ni dans Git.** Les valeurs sensibles (App Secret, verify token) vivent
> uniquement dans `/opt/axi/.env` sur l'EC2. Ci-dessous, elles sont en placeholders `<…>`.

## 0. Déployer le bon code

Le mode partenaire + l'écran Modèles sont sur **`main`**.

```bash
git fetch origin main && git checkout main && git pull
# puis le flux habituel : tar → S3 → SSM deploy.sh
```

## 1. Variables à mettre dans `/opt/axi/.env`

| Variable | Valeur | Nature |
|---|---|---|
| `NEXT_PUBLIC_META_APP_ID` | `1858789872223719` | public (App ID Meta) |
| `NEXT_PUBLIC_META_ESIGNUP_CONFIG_ID` | `1098977682895494` | public (config Embedded Signup) |
| `META_GRAPH_VERSION` | `v26.0` | version Graph (aligne SDK + webhook) |
| `META_APP_SECRET` | `<APP_SECRET_META>` | **secret** — Meta for Developers › app › Paramètres › Général › « Afficher » |
| `WHATSAPP_APP_SECRET` | `<MEME_APP_SECRET>` | **secret** — identique à `META_APP_SECRET` (signature webhook) |
| `WHATSAPP_VERIFY_TOKEN` | `<VERIFY_TOKEN>` | **secret** — chaîne aléatoire choisie, identique côté Meta |
| `NEXT_PUBLIC_APP_URL` | `https://16-192-144-250.nip.io` | URL publique AWS (ou domaine définitif) |

```env
# --- Mode partenaire WhatsApp (Embedded Signup) ---
NEXT_PUBLIC_META_APP_ID=1858789872223719
NEXT_PUBLIC_META_ESIGNUP_CONFIG_ID=1098977682895494
META_GRAPH_VERSION=v26.0
META_APP_SECRET=<APP_SECRET_META>
WHATSAPP_APP_SECRET=<MEME_APP_SECRET>
WHATSAPP_VERIFY_TOKEN=<VERIFY_TOKEN>
NEXT_PUBLIC_APP_URL=https://16-192-144-250.nip.io
```

> Générer un verify token robuste : `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

## 2. Rebuild + redémarrage

```bash
pnpm install
pnpm build            # OBLIGATOIRE : les NEXT_PUBLIC_* sont figés au build (bouton + CSP facebook.com)
pm2 restart axi --update-env
pm2 restart axi-jobs --update-env
```

- Le **GET** de vérification du webhook n'a besoin que de `WHATSAPP_VERIFY_TOKEN` (lu au démarrage) — pas de rebuild pour ça.
- Le **rebuild** reste nécessaire pour afficher le bouton « Connecter avec WhatsApp » et élargir la CSP.

## 3. Réseau (cause n°1 des échecs de validation Meta)

- **Security Group EC2** : port **443** ouvert en entrée à `0.0.0.0/0` (sinon les serveurs Meta ne joignent pas le webhook).
- **Caddy** : certificat Let's Encrypt valide sur `https://16-192-144-250.nip.io`.

## 4. Tester l'endpoint AVANT Meta

```bash
curl -i "https://16-192-144-250.nip.io/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=<VERIFY_TOKEN>&hub.challenge=test12345"
```

| Réponse | Cause | Correctif |
|---|---|---|
| `200` + corps `test12345` | ✅ OK | Valider dans Meta |
| `403 Forbidden` | token absent/mal chargé | corriger `.env` + `pm2 restart --update-env` |
| timeout / refus | non joignable | ouvrir 443, vérifier PM2 `online` |
| erreur TLS | certificat Caddy | vérifier Caddy |

## 5. Côté Meta (après `test12345` OK)

- *WhatsApp › Configurez un webhook* → **URL de rappel** : `https://16-192-144-250.nip.io/api/webhooks/whatsapp`
- **Vérifier le token** : la même valeur que `WHATSAPP_VERIFY_TOKEN`
- Champ **`messages`** abonné (déjà fait) → **« Vérifier et enregistrer »** doit passer au vert.

## 6. Domaines autorisés (Embedded Signup)

Éditeur d'inscription intégrée → « Gérer la liste d'éléments autorisés » : garder **`16-192-144-250.nip.io`** (https).
Ajouter le domaine définitif le moment venu. Retirer `axi-alpha.vercel.app`.

## 7. Validation finale

- `https://16-192-144-250.nip.io` → boutique **plan Business** → *WhatsApp* → le bouton **« Connecter avec WhatsApp »** apparaît.
- Compte **admin de l'app Meta** autorisé en **mode test**. La **production complète** (onboarding d'autres marchands)
  s'active après la **vérification d'entreprise** + le **contrôle app** validés par Meta.

## Prérequis Meta (porteur, hors AWS)

- Vérification de l'entreprise (en cours, ~2 j ouvrés).
- « Devenir fournisseur de technologies » → **Independent Tech Provider** (revue de l'app, vidéo de démonstration).
- Configuration Embedded Signup (ID `1098977682895494`) : token *System User*, permissions
  `whatsapp_business_messaging` + `whatsapp_business_management`, assets WABA + numéros.
- Ligne de crédit / paiement partagé dans Meta Business Settings (facturation au nom des clients).
