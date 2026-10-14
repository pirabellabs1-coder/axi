# Apps v2 — équipe DEV (portail développeur)

## Livré

| Élément | Fichiers |
|---|---|
| Espace développeur DANS l'admin de la boutique : `/app/<storeId>/developpeur/**` hérite de l'AppShell (barre latérale, menu mobile, sélecteur de boutique). Sous-navigation en onglets (Vue d'ensemble, Mes applications, Revenus, Documentation, Paramètres). Entrée « Espace développeur » ajoutée dans `app-shell.tsx` (1 ligne). | `src/app/app/[storeId]/developpeur/layout.tsx`, `_components/{dev-nav,dev-link,dev-base,breadcrumbs}.tsx` |
| Ancienne entrée `/developpeur/**` : redirection vers `/app/<1re adhésion>/developpeur/...` ; sans boutique, page autonome (créer une boutique, retour au site) | `src/app/developpeur/[[...path]]/page.tsx` |
| Vue d'ensemble : parcours en 4 étapes (état réel), chiffres, raccourcis docs | `src/app/app/[storeId]/developpeur/page.tsx` |
| Fiche app en onglets : Vue d'ensemble · Identifiants · Configuration · Fiche catalogue · Tests · Statut et revue | `src/app/app/[storeId]/developpeur/apps/[appId]/**` |
| Installation de test | `installAppForTesting`, `uninstallTestInstall` dans `src/lib/apps/dev-actions.ts` ; règle pure `decideTestInstall` dans `dev-logic.ts` |
| Documentation (7 guides, blocs copiables) | `src/app/app/[storeId]/developpeur/docs/**` |
| Paramètres développeur | `src/app/app/[storeId]/developpeur/parametres/**`, `updateDeveloperProfile` |
| Lectures du portail | `src/lib/apps/dev-queries.ts` (`homeStoreHref`, `listTestStores`, `listDeveloperApps`, `getOwnedApp`, `lastReviewDecision`) |
| Tests | `tests/apps-dev-portal.test.ts` |

## Installation de test (contrat)

- Autorisée si l'utilisateur est **propriétaire de l'app** ET (OWNER non expiré de la boutique OU collaborateur actif avec `apps.test_install`) — MANAGER retiré (audit F4). Statuts DRAFT, IN_REVIEW, PUBLISHED acceptés ; SUSPENDED refusé.
- Installation `config: { test: true }`, `billingStatus: "none"`, `priceAmount: 0`, sans incrément de `installCount`. Scopes = demandés ∩ plan de la boutique.
- Même flux technique que l'installation réelle d'INT : `OAuthGrant` lié à l'installation, code d'installation (`createAppInstallCode`) et redirection signée (`buildInstallRedirect`) si le client est confidentiel avec une URI web ; webhook de cycle de vie (`scheduleLifecycleWebhook`) ; job `app.installed`/`app.uninstalled` (payload `test: true`). Le portail propose « Ouvrir mon application » (code valable 60 s).
- Refus si une installation non désinstallée existe déjà (test ou réelle). La désinstallation de test ne touche jamais une installation réelle.
- Audit : `app.test_installed`, `app.test_uninstalled`, `app.developer_profile_updated`.

## Écarts et dépendances

- **Captures d'écran de la fiche** : aucun champ en base → reporté (encart dans l'onglet Fiche).
- **E-mail de contact / site web du développeur** : aucun modèle de profil → reporté. Seul le nom public est persisté (propagé à `App.developerName` de toutes les apps du développeur, repris à la création d'une app).
- **Motif de refus** : pas de colonne ; lu dans l'audit `admin.app.reject|suspend|publish` (`metadata.reason`).
- **Collaborateurs (INT/COL)** : l'échange du code (`assertGrantAllowed`) et `POST /api/apps/session/verify` exigent une **adhésion** OWNER/MANAGER. Un collaborateur peut installer en test, mais ne peut pas encore obtenir de jetons ni valider une session embarquée.
- **Fiche marchand d'une app en test** : la page INT `/app/<storeId>/applications/<slug>` affiche une app installée ACTIVE même non publiée : le lien « Ouvrir dans la boutique » fonctionne pour une app en brouillon.
- La doc « Applications embarquées » et « OAuth » suit le code INT au 13/10 (`session-token.ts`, `install-signing.ts`, `api/apps/session/verify`, branche `APP_INSTALL_CODE_CHALLENGE`). À relire si INT change le contrat.
- Les apps restent rattachées au **compte** (`developerUserId`), pas à la boutique : la boutique de l'URL n'est qu'un contexte de navigation. L'accès exige une adhésion à cette boutique (layout marchand) ; un collaborateur sans boutique propre voit la page autonome de `/developpeur`.
- Import de `AppStatusBadge` corrigé dans `src/app/admin/applications/page.tsx` (déplacement du fichier).
