# App Store v2 — COL : collaborateurs développeurs

Équivalent des « collaborateurs » Shopify : le propriétaire d'une boutique invite un développeur, qui peut alors
installer ses applications en test sur cette boutique, sans accès aux commandes, clients, paiements ni réglages.

## Fichiers
- `src/lib/apps/collaborator-logic.ts` — pur : schéma zod d'invitation, libellés des permissions, états
  (en attente / expirée / active / révoquée), transitions, expiration (7 jours), contrôle d'acceptation.
- `src/lib/apps/collaborator-actions.ts` — actions : `inviteDeveloper(_prev, formData)` (storeId dans le formulaire,
  convention du dépôt), `resendInvite(storeId, id)`, `revokeCollaborator(storeId, id)`, `acceptInvite(token)`, `declineInvite(token)`.
- `src/app/app/[storeId]/developpeurs/**` — page marchand (propriétaire, capacité `integrations.manage`).
- `src/app/invitation-developpeur/[token]/**` — page d'acceptation.
- `src/components/app/app-shell.tsx` — une ligne de navigation « Développeurs » (propriétaire).
- `tests/apps-collaborators.test.ts` — 13 tests.

## Règles
- Jeton aléatoire de 32 octets ; seul son SHA-256 est stocké. Un upsert par (storeId, email) ; réinviter une adresse
  révoquée la repasse en attente avec un nouveau jeton.
- E-mail envoyé avec `sendMail` après la transaction (un échec d'envoi n'annule pas l'invitation : message « renvoyez-la »).
- Acceptation : utilisateur connecté et vérifié dont l'e-mail correspond (insensible à la casse) ; mise à jour
  conditionnelle (`status = PENDING` et non expirée) contre les doubles clics et révocations concurrentes ; redirection `/developpeur`.
- Refus : l'enum n'a pas d'état « refusé » → `REVOKED`, distingué dans l'audit (`collaborator.declined`).
- Révocation : désinstalle les installations de la boutique faites par ce collaborateur ET portant sur ses propres apps
  (`app.developerUserId`) ; grants/jetons OAuth révoqués, `installCount` décrémenté. Les apps installées par le marchand ne sont pas touchées.
- Audit : `collaborator.invited | reinvited | accepted | declined | revoked`. Rate limit : 20 envois/heure/boutique.

## Limites connues
- Pas de champ « installée en tant que collaborateur » sur `AppInstallation` : l'identification se fait par
  `installedById` + développeur de l'app.
- Le module `jobs.ts` (non modifiable) n'a pas de type de job dédié : envoi direct, pas d'outbox.
