# Mise en production Vercel — étapes restantes

> Runbook court et concret pour **terminer** le déploiement.
> Pour le détail exhaustif (VPS, Docker, stockage, paiements), voir `docs/DEPLOIEMENT.md`.
> La recette est **GO** : `tsc`, `lint`, 2217 tests unitaires et la recette E2E sont verts.

## État actuel (déjà fait)

- ✅ Projet Vercel **axi** (équipe `ctue`), prod en ligne : **https://axi-alpha.vercel.app**.
- ✅ Base **Supabase** branchée, `/api/health` → `database: ok`, **10 migrations appliquées**.
- ✅ Variables cœur posées : `DATABASE_URL` (pooler transaction 6543), `APP_SECRET`, `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_APP_DOMAIN`, `JOBS_RUN_KEY`.

## Ce qu'il reste (dans l'ordre d'importance)

1. **Créer un compte de connexion** (bloquant : aucun compte n'existe en prod, d'où l'impossibilité de se connecter).
2. **E-mail (Resend)** — sinon pas d'e-mails transactionnels (confirmations, réinitialisation…).
3. **Stockage médias (R2)** — sinon pas d'upload d'images produits en prod.
4. **Déclencheur de jobs** (cron externe, plan Hobby).
5. **Paiements** (ton domaine réservé).

> ⚠️ Les identifiants `demo@axi.africa` / `admin@axi.africa` n'existent **qu'en local** (base de démo). Ils ne marchent PAS sur axi-alpha.vercel.app tant que l'étape 1 n'est pas faite.

---

## 1. Créer un compte en prod (déblocage de la connexion)

Depuis ton poste, en pointant sur la base de prod via la chaîne **session (port 5432)** — pas la chaîne pooler 6543 qui sert au runtime :

```bash
# Compte super-admin SEUL (prod propre, sans boutiques de démo) :
DATABASE_URL="<chaîne session 5432>" SEED_ADMIN_EMAIL="toi@ton-domaine" SEED_ADMIN_PASSWORD="<mot de passe ≥ 12 car.>" pnpm tsx prisma/seed-admin.ts
```

> Le script `prisma/seed-admin.ts` est idempotent, tourne en prod et **exige** un e-mail + un mot de passe explicites (aucun mot de passe par défaut). **N'utilise pas `pnpm db:seed` en prod** : il ajoute le compte démo et 3 boutiques fictives.

Puis connecte-toi sur `https://axi-alpha.vercel.app` avec cet e-mail / mot de passe.

## 2. E-mail — variables à ajouter dans Vercel (Settings → Environment Variables → Production)

| Variable | Valeur |
|---|---|
| `EMAIL_PROVIDER` | `resend` |
| `RESEND_API_KEY` | ta clé Resend (`re_...`) |
| `EMAIL_FROM` | `Axi <no-reply@ton-domaine-verifie>` |

Puis **Redeploy**. (Domaine d'envoi à vérifier chez Resend au préalable.)

## 3. Stockage médias (Cloudflare R2 recommandé)

Ajoute dans Vercel : `STORAGE_DRIVER=s3` + `STORAGE_ENDPOINT` / `STORAGE_REGION` / `STORAGE_BUCKET` / `STORAGE_ACCESS_KEY_ID` / `STORAGE_SECRET_ACCESS_KEY` / `STORAGE_PUBLIC_URL`. Détails et migration des anciennes images data-URL : `docs/DEPLOIEMENT.md` §6 bis. Puis **Redeploy**.

## 4. Autres variables (quand tu intègres ces briques)

- Paiements ventes : `FEDAPAY_*` / `KKIAPAY_*` / `STRIPE_*` selon la zone.
- Facturation plateforme : `PLATFORM_BILLING_PROVIDER*`, `PLATFORM_MOMO_NUMBER`…
- WhatsApp Cloud API : `WHATSAPP_*`, `AXI_OTP_WHATSAPP_*`.
- IA : `ANTHROPIC_API_KEY` (sinon les fonctions IA sont désactivées proprement).
- Anti-bot : `TURNSTILE_SECRET_KEY` + `NEXT_PUBLIC_TURNSTILE_SITE_KEY`.
- Push web : `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` (`npx web-push generate-vapid-keys`).

**Ne mets JAMAIS en production** (drapeaux de dev, sinon faille de sécurité) : `ADMIN_MFA_OPTIONAL`, `AI_FAKE`, `AXI_WEBHOOKS_ALLOW_LOCALHOST`, `ALLOW_CONSOLE_EMAIL`.

## 5. Tâches de fond (IMPORTANT sur plan Hobby)

Le plan **Hobby n'exécute pas de cron Vercel** — sans déclencheur, les jobs ne tournent pas (taux de change, thèmes programmés, tests A/B, notifications push, octroi des accès aux produits numériques, relances). Deux options :

- **Déclencheur externe** (gratuit) : un planificateur type cron-job.org ou une GitHub Action qui appelle **toutes les 1–5 min** :
  ```
  POST https://TON-DOMAINE/api/jobs/run
  Header:  x-jobs-key: <JOBS_RUN_KEY>
  ```
- **Plan Vercel Pro** : réactive un cron dans `vercel.json` (envoie `Authorization: Bearer <CRON_SECRET>`, défini aussi en env).

> Tant que ce déclencheur n'est pas en place, l'app fonctionne mais les automatisations différées restent en attente.

## 6. Paiements (ton domaine réservé)

Suis `docs/DEPLOIEMENT.md` §7 : branche les passerelles (`src/lib/payments/gateways.ts`), la facturation plateforme (`src/lib/billing/platform-billing.ts`) et les webhooks entrants. Renseigne les secrets correspondants (étape 2) et déclare les URLs de webhook chez chaque fournisseur.

---

## Récapitulatif express

```
[x] Base Supabase + migrations + variables cœur (déjà fait)
[ ] 1. Créer le super-admin en prod (prisma/seed-admin.ts) → connexion possible
[ ] 2. E-mail Resend (EMAIL_PROVIDER/RESEND_API_KEY/EMAIL_FROM) + Redeploy
[ ] 3. Stockage médias R2 (STORAGE_*) + Redeploy
[ ] 4. Déclencheur /api/jobs/run toutes les 1–5 min (en-tête x-jobs-key)
[ ] 5. Paiements branchés (docs/DEPLOIEMENT.md §7)
```
