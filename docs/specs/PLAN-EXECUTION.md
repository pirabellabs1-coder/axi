# Plan d'exécution des lots 1 à 4

## 1. Préalables (vague 0)
1. **Accord du porteur** pour modifier les fichiers protégés (`CLAUDE.md`) : `prisma/schema.prisma`, `src/lib/commerce/*`, `src/lib/payments/*`, `src/lib/jobs.ts`. Accordé le 11/10/2026 (« vas-y pour tout »). `src/components/ui` reste intouché ; tout nouveau composant va dans `src/components/app` ou `src/components/storefront`.
2. Clôture des chantiers « en cours » de la feuille de route : stockage objet (obligatoire pour photos de retour, icônes PWA, vidéos, IA), politique de stock, recette tablette / grand écran / sombre.
3. Outillage commun : `tests/helpers/fake-db.ts` étendu aux nouveaux modèles par chaque responsable de schéma ; fixtures E2E (`e2e/fixtures.ts`) ; client IA simulé (`AI_FAKE=1`) ; serveur webhook local pour les E2E.
4. Changements de comportement retenus (décision du 11/10/2026) :
   - `freeAbove` (livraison offerte) calculé sur le net après remises automatiques et coupon, avant les points de fidélité (utiliser ses points ne fait jamais perdre la livraison offerte) ;
   - points de fidélité calculés hors livraison et hors avoir ;
   - `excludeOnSale` vrai par défaut (pas de cumul remise automatique et promo datée).

## 2. Ordre des vagues et dépendances

```
V0 préalables
 │
 ├─► S1 (schéma lot 1) ─► Lot 1 équipes A–E ─► intégration B ─► QA ─► GO/NO-GO L1
 │        │
 │        └─► S4 (schéma lot 4, enchaîné après S1) ─► 4A (T1,T2,T3,T5) ───────┐
 │                                                                            │
 └─ après GO L1 ─► S2 ─► Lot 2 A–E ─► GO/NO-GO L2 ─► S3 ─► Lot 3 A–D ─► GO/NO-GO L3
                                                                              │
 4B (T4,T2) dès 4A terminé ─► 4C (T5 : audiences, tests ; dépend comptes L1, langues L2)
 4D (T6) dès 4A terminé (PWA, partage, flux) ; push après L1 (consentements)
```

| Vague | Contenu | Dépend de | Durée indicative |
|---|---|---|---|
| S1 | Schéma, plans, permissions, registre des jobs, scopes, types de thème du lot 1 | V0 | 3 jours |
| L1 | Comptes, remises, cartes cadeaux, retours | S1 | 4 semaines + 1 de recette |
| S4 | Schéma complet du lot 4 (après S1, horodatage postérieur) | S1 fusionné | 2 jours |
| 4A | Animations, scores, sections enregistrées, bibliothèque, champs personnalisés, modèles alternatifs | S4 ; fichiers disjoints du lot 1 | 4 semaines |
| S2 | Schéma du lot 2 | GO L1 (pipeline, répartition) | 3 jours |
| L2 | Langues, devises, taxes, blog, webhooks, API REST | S2 | 5 semaines + 1 |
| 4B | Kit de marque, édition en place, génération IA, assistant | 4A (opérations, scores) | 4 semaines |
| S3 | Schéma du lot 3 | GO L2 (taxes, reçus) | 3 jours |
| L3 | Dépôts, expédition, caisse | S3 | 5 semaines + 1 |
| 4C | Thèmes programmés, audiences, tests A/B | 4A, L1 (sessions), L2 (langues) | 4 semaines |
| 4D | PWA, économie de données, partage statut, flux, vidéos, live, push | 4A ; push après L1 | 5 semaines |

### Règles de vague de schéma
- Un seul responsable par lot.
- Migrations **additives** uniquement : nouvelles tables, colonnes nullables ou avec défaut, nouvelles valeurs d'enum, index. Aucune suppression ni renommage.
- Nommage `prisma/migrations/<AAAAMMJJHHMMSS>_lotN_<sujet>`.
- Deux migrations ne sont jamais générées en parallèle (S4 attend la fusion de S1).
- Après fusion : `pnpm prisma generate && pnpm typecheck` vert, annonce aux équipes. Toute demande de champ supplémentaire passe par le responsable du lot, en migration corrective additive.

### Fichiers à point d'enregistrement
Propriétaire unique par lot ; les autres équipes demandent l'ajout d'une ligne : `src/lib/jobs.ts` (registre paresseux), `src/config/plans.ts`, `src/lib/auth/permissions.ts`, `src/lib/mcp/scopes.ts`, `src/lib/mcp/merchant/server.ts`, `src/lib/theme-engine/render-registry.tsx`, `src/lib/theme-engine/schemas.ts` (agrégateur après le refactor du lot 4), `src/proxy.ts`, `src/lib/commerce/orders.ts`.

## 3. Risques et parades

| Risque | Gravité | Parade |
|---|---|---|
| Régression du checkout (`createOrder` enrichi de remises, tenders, taxes, devises, dépôts) | Critique | Pipeline pur testé par propriétés ; propriétaire unique de `orders.ts` par lot ; non-régression (`pricing.test.ts`, `order-variant-availability.test.ts`) ; E2E checkout sur build de production à chaque vague |
| Erreurs d'arrondi (XOF, conversions, TVA par ligne) | Haute | Arithmétique entière, plus fort reste, invariants `Σ lignes = total` testés ; règles documentées et affichées |
| Fraude cartes cadeaux, abus de remises | Haute | Entropie 80 bits, HMAC, débits limités, émission après paiement, plafonds, arrêt d'urgence, audit |
| Stock incohérent multi-dépôts et caisse hors ligne | Haute | Invariant agrégat = Σ niveaux dans la même transaction, réconciliation quotidienne, survente hors ligne tracée |
| Qualité ou coût de l'IA | Moyenne | Brief compilé (jamais de document direct), validation, crédits débités puis remboursés, débit limité, modèle configurable, client simulé en test |
| Taille du document de thème | Moyenne | Plafonds, stockage objet des images, contrôle `MAX_DOCUMENT_BYTES` |
| Performance de la vitrine | Moyenne | Évaluation serveur pure, aucune requête par section, LCP < 2,5 s en 4G simulée, mode économie |
| SEO multilingue et personnalisation (cloaking) | Moyenne | hreflang, robots servis par défaut, pas de redirection automatique de langue |
| Conformité (factures, données personnelles, consentements) | Moyenne | Numérotation sans trou, documents immuables, anonymisation, consentements journalisés, mention « pas de conseil fiscal » |
| Conflits entre équipes | Moyenne | Propriété de fichiers par tableau, contrats figés au jour 3, schémas de sections en fichiers séparés |
| Intégrations externes indisponibles (WhatsApp Cloud, transporteurs, taux de change) | Moyenne | Points d'intégration avec replis (e-mail, transporteur manuel, taux manuel), jamais « envoyé » à tort |

## 4. Critères de « terminé »

### Pour chaque fonctionnalité
- Comportement conforme à la spec du lot, cas limites compris.
- Actions serveur : `guard` + zod + `requireStore(capacité)` + filtre `storeId` + `audit()` pour le sensible + `enqueue()` dans la transaction.
- Interface en français, vouvoiement, composants du kit, états vide / chargement / erreur / succès, cibles ≥ 44 px, 375 px d'abord, contraste AA.
- Contrôle de plan côté serveur avec message d'upsell, comparatif des offres à jour.
- Outils MCP prévus, avec scopes, confirmations et `untrusted_customer_input`.

### Pour chaque lot (GO/NO-GO)
1. `pnpm prisma generate && pnpm typecheck && pnpm lint && pnpm test && pnpm build` verts.
2. Tests Vitest de la spec verts : modules purs ≥ 90 % de lignes, test d'isolation entre boutiques pour chaque action.
3. E2E du lot verts sur build de production, plus les E2E existants.
4. Revue de code et audit de sécurité ; `docs/AUDIT-SECURITE.md` à jour.
5. Documentation à jour : `docs/ARCHITECTURE.md`, `docs/API-MCP.md`, `docs/GUIDE-BOUTIQUE.md`, `docs/RECETTE.md`, `docs/CONSTRUCTEUR-BOUTIQUE.md`.
6. Seed de démonstration enrichi (`pnpm db:seed`).
7. Mesures : LCP < 2,5 s (accueil et fiche produit, 4G simulée), accueil < 300 Ko en mode économie (lot 4D).
8. Migration testée sur une copie de base réaliste.
9. Verdict GO/NO-GO de l'agent `quality-gatekeeper`.
