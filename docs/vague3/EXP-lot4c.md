# EXP — Lot 4C : thèmes programmés, tests A/B, audience

Vague 3 (12/10/2026). Spécification : `docs/specs/LOT-4-personnalisation.md` §11, §12, §13, §20 à §24.
Acquis de la vague 2 réutilisés : `docs/vague2/T1-moteur.md` (opérations, `audience.ts`), `docs/vague2/T2-editeur.md`,
`docs/vague2/T3-rendu.md`.

## 1. Thèmes programmés (§11)

### Résolution AU RENDU, sans cron
`applyScheduledTheme(store, doc, { now, preview, at })` (`src/lib/theme-schedules/storefront.ts`) est appelé une fois
par page de boutique, juste après `getThemeDocument`. Il charge la programmation dont `startsAt ≤ instant < endsAt`
(statut autre qu'annulé) et remplace le document complet.

- Borne de début **incluse**, borne de fin **exclue** : le retour au thème normal est exact à la milliseconde, sans
  aucune écriture ni tâche de fond.
- Un document de programmation devenu invalide est ignoré (la boutique reste sur son thème normal) ; une erreur de
  base est avalée (`scheduledThemeAt` renvoie `null`) : une programmation ne peut jamais faire tomber une vitrine.
- Modifier le thème principal pendant une programmation ne l'interrompt pas (la copie est figée dans
  `ThemeSchedule.document`).

### Chevauchements interdits
`createThemeSchedule` / `updateThemeSchedule` prennent `pg_advisory_xact_lock(hashtext('theme-schedule:<storeId>'))`
dans la transaction d'écriture, puis vérifient `overlappingSchedule`. Deux créations simultanées ne peuvent pas se
croiser. Les périodes bord à bord (fin == début) sont acceptées (intervalles semi-ouverts).

### Job `theme.schedule_notify`
`src/lib/theme-schedules/jobs.ts`. Planifié deux fois (`runAt = startsAt`, `runAt = endsAt`) par `enqueue()` dans la
même transaction que l'écriture. Rôle **purement informatif** : notification interne au commerçant
(`notifyStore`, clé idempotente `theme-schedule:<id>:<edge>`) et mise à jour de `status` (`ACTIVE`, `COMPLETED`).
Un job périmé (dates déplacées depuis sa planification) ne fait rien : l'instant réel est revérifié.

### Aperçu « voir à la date »
`?preview=1&at=<ISO ou AAAA-MM-JJ>` sur la vitrine. `preview=1` est déjà réservé aux membres actifs
(`isPreview` → `canPreviewStore`) ; `at` est borné à ±5 ans. Sans `at`, l'aperçu reste celui du brouillon (aucune
programmation n'est superposée). L'écran des programmations fournit deux liens par ligne : « Voir à cette date » et
« Après la fin » (pour vérifier le retour au thème normal).

### Préréglages d'occasion
`src/config/occasions.ts` : Tabaski, Korité et Ramadan, Noël, Nouvel An, Saint-Valentin, Fête des mères, Fête de
l'indépendance (par pays, table `INDEPENDENCE_DAYS`), Rentrée, Black Friday (4ᵉ vendredi de novembre, calculé),
Soldes. Quatre opérations seulement, toutes via `operations.ts` (`src/lib/theme-schedules/occasion-doc.ts`) :
annonce d'en-tête, couleur d'accent, bannière (section « Texte enrichi » en tête d'accueil), compte à rebours
(section `countdown`, `ends_at` écrit dans le fuseau de la boutique).

**Dates mobiles non devinées** : Tabaski, Korité/Ramadan, Fête des mères et Soldes n'ont pas de suggestion
(`suggestedRange` renvoie `null`) ; l'écran demande explicitement les dates. Aucun calendrier lunaire n'est embarqué :
mieux vaut une saisie qu'une date fausse.

### Fuseau
Saisie et affichage dans le fuseau de la boutique (`Store.timezone`), jamais celui du navigateur du commerçant.
`localDateTimeToUtc` fait deux passes sur le décalage (correct même avec changement d'heure).

### Limites de plan
`scheduleAllowance(planId)` : 0 avant Business, 3 en Business, illimité à partir de Scale. La limite compte les
programmations **à venir ou en cours** non annulées. Vérification côté serveur à la création ; l'écran affiche
`PlanGate` quand la fonction n'est pas incluse.

## 2. Tests A/B de sections (§13)

### Affectation
`src/lib/experiments/assign.ts` (pur) : `bucketOf(vid, experimentId) = fnv1a32(vid + ":" + experimentId) % 10 000`,
comparé aux poids cumulés. L'affectation est **toujours recalculée côté serveur** (rendu, balise, commande) : le
client n'envoie jamais sa variante. Deux tests sont indépendants (l'identifiant du test entre dans le hachage).

Cookie `axi_vid` : 128 bits (`crypto.randomBytes`), 1 an, `Path=/`, `SameSite=Lax`, `Secure` en https.

### Exposition, conversions
- **Exposition** : `IntersectionObserver` (seuil 25 %) sur la section testée, dans
  `src/components/experiments/experiment-runtime.tsx`. Variante « masquée » : l'ancre devient la section suivante
  (sinon la précédente) pour que la variante soit comptée elle aussi.
- `navigator.sendBeacon` → `POST /api/s/[slug]/events`, corps `{ events: [{ t, e }] }` (≤ 1 Ko, ≤ 5 événements).
- **Dédoublonnage** : mémoire locale (par visiteur, par jour) côté client, puis dédoublonnage serveur
  `rateLimit('exp:<id>:<métrique>:<vid>:<jour>', 1, fin de journée locale)`.
- **Débit** : 120 requêtes / 10 min par IP, 240 / h par visiteur, plafond 200 000 événements / jour / boutique.
- **Robots ignorés** (`isBotUserAgent`), requêtes intersites refusées (`Sec-Fetch-Site`), réponse toujours 204.
- `add_to_cart` : événement `axi:add-to-cart` déjà émis par la fiche produit. `checkout_start` : clic sur un lien
  vers `/commander` (capture au niveau du document).
- **`order` côté serveur** : `<ExperimentOrderAttribution>` sur la page de confirmation écrit
  `Order.attribution.experiments` dans `after()`. Idempotent (verrou `exporder:<orderId>`, 30 jours) et limité aux
  tests que ce visiteur a **réellement vus** (mémoire d'exposition `expseen:<id>:<vid>`, 30 jours).

### Agrégation et statistiques
`ExperimentStat` : `upsert` incrémental par (test, variante, jour local, métrique).
`src/lib/experiments/stats.ts` (pur, graine fixe `DEFAULT_SEED`) : Beta(1+conversions, 1+échecs), 10 000 tirages
(mulberry32 + Marsaglia-Tsang), probabilité d'être la meilleure, gain relatif médian et intervalle à 95 %.

**Verdict** seulement si ≥ 7 jours **et** ≥ 200 expositions sur chaque variante **et** probabilité ≥ 95 %. Sinon,
message « résultats indicatifs » + avertissement explicite contre l'arrêt prématuré. Deux lectures de l'écran
donnent exactement les mêmes chiffres (graine fixe).

### Cycle de vie
`DRAFT` → `RUNNING` (démarrage, limite de plan vérifiée sous verrou) → `PAUSED` / `COMPLETED`.
Un seul test vivant par (modèle, section) : contrainte vérifiée sous verrou consultatif.
Un test dont la section est absente du modèle rendu (thème programmé, section supprimée) est **suspendu tout seul** :
aucune variante appliquée, aucune exposition comptée.

### « Appliquer la gagnante »
`applyExperimentWinner` remplace la section dans **`themeDocDraft` uniquement** (jamais en ligne), après
`validateThemeDocument` + `lot4PlanIssue`, puis termine le test et mémorise `winnerKey`.

### Variantes
A = section actuelle. B et C = « autre version de la section » ou « section masquée ». L'éditeur de variante de
l'écran `/apparence/tests` ne propose que les champs **texte, zone de texte, texte enrichi et lien** de la section
et de ses blocs : on teste un titre, une promesse ou un libellé d'appel à l'action, et il est structurellement
impossible qu'une variante touche un prix, un stock ou une donnée client. La variante est reconstruite à partir de
la section d'origine puis **revalidée par le moteur de thème** (`validateVariantSection`), identifiant et type forcés
à ceux de la section d'origine. Une section obligatoire (`schema.required`) ne peut pas être masquée.

### Limites de plan
`experimentAllowance` : 0 avant Scale, 3 en Scale, 10 en Enterprise (tests **en cours**).

## 3. Audience (§12) — complément

Le §12 était déjà livré en vague 2 (évaluation pure `evaluateVisibility`, panneau « Visible pour », simulateur
`axi:preview-audience`, robots servis par l'audience par défaut, contrôle de plan `lot4PlanIssue` +
`AUDIENCE_RULES_BY_PLAN`, tests `tests/audience.test.ts` et `tests/theme-editor-lot4.test.ts`).

**Seul manque constaté : le cookie `axi_src` n'était posé par personne** (le proxy ne le fait pas), donc la règle
`source` ne correspondait jamais. Complété par `src/lib/experiments/visitor.ts` (`detectFirstTouchSource` : pur,
liste fermée de sources, `utm_source` → `ref` → `source` → `utm_campaign` → référent, navigation interne = direct) et
la persistance par l'îlot client (30 jours). Vérifié par `tests/experiments-assign.test.ts`.

Anti-cloaking : confirmé de bout en bout — robots servis avec l'audience par défaut (`requestAudience`), **et** sans
aucun test A/B ni cookie (`applyExperiments` sort immédiatement sur `isBotUserAgent`).

## 4. Cookies et vie privée

| Cookie | Durée | Contenu | Rôle |
|---|---|---|---|
| `axi_vid` | 1 an | 128 bits aléatoires | affectation stable aux variantes, dédoublonnage des affichages |
| `axi_src` | 30 jours | une valeur parmi 7 | règle d'audience « source » |

Cookies fonctionnels de **premier niveau**, aucune donnée personnelle, aucun partage, aucune lecture par un tiers,
aucun profil. À mentionner dans la page de confidentialité de la boutique (déjà prévu au §12).

`src/proxy.ts` appartenant à l'équipe Langues cette vague, les deux cookies sont **calculés côté serveur au rendu**
(la valeur est donc utilisée dès la première page, sans hésitation ni scintillement) puis **persistés par l'îlot
client**. Conséquence assumée : un visiteur sans JavaScript n'est jamais compté — ce qui est exactement le
comportement voulu pour une mesure d'affichage.

> Si l'équipe Langues préfère, le dépôt peut être déplacé dans `src/proxy.ts` sans rien changer d'autre : il suffit
> d'y poser `axi_vid` (128 bits hex) et `axi_src` (valeur de `AUDIENCE_SOURCES`) ; `applyExperiments` les lira et
> `persistVisitor` / `persistSource` passeront à `false` d'eux-mêmes.

## 5. Fichiers

### Créés (propriété EXP)
```
src/config/occasions.ts
src/lib/theme-schedules/{rules,occasion-doc,service,storefront,actions,jobs}.ts
src/lib/experiments/{assign,stats,rules,service,storefront,visitor,actions}.ts
src/app/api/s/[slug]/events/route.ts
src/components/experiments/{experiment-runtime.tsx,order-attribution.tsx}
src/app/app/[storeId]/apparence/programmations/{page,loading,programmations-client}.tsx
src/app/app/[storeId]/apparence/tests/{page,loading,tests-client}.tsx + data.ts
tests/{schedule-resolve,experiments-assign,experiments-stats,lot4c-isolation}.test.ts
```

### Hors périmètre, modifications minimales (relues juste avant)
| Fichier | Modification |
|---|---|
| `src/components/storefront/storefront-view.tsx` | 3 imports + 2 lignes (`applyScheduledTheme`, `applyExperiments`) + 1 ligne de rendu `<ExperimentRuntime>` |
| `src/app/s/[slug]/merci/[token]/page.tsx` | 1 import + 1 ligne `<ExperimentOrderAttribution>` |
| `src/components/app/app-shell.tsx` | 1 import d'icônes + 2 entrées de menu (« Thèmes programmés », « Tests A/B ») |

`src/lib/jobs.ts`, `src/config/plans.ts`, `prisma/schema.prisma` : **non modifiés** (tout était déjà en place).

### Ligne à insérer par une autre équipe (facultative)
`src/app/s/[slug]/layout.tsx` (équipe Langues) applique encore le thème **normal** pour les variables CSS des états
chargement / erreur / page introuvable. Les pages elles-mêmes (en-tête, pied de page, sections, couleurs) passent
bien par le thème programmé, car `StoreFrame` repose les variables. Pour que les écrans transitoires suivent aussi la
programmation :

```tsx
// après : const doc = getThemeDocument(sf.store, { preview: !!sf.preview?.draft });
const { doc: themed } = await applyScheduledTheme(sf.store, doc, { now: new Date(), preview: !!sf.preview?.draft });
// puis utiliser `themed` dans themeCssVars(...)
```

## 6. Tests

| Fichier | Couverture |
|---|---|
| `tests/schedule-resolve.test.ts` | bornes à la seconde, chevauchements (croisement, englobement, bord à bord), fuseau (UTC+1, heure d'été, fuseau inconnu), validation des bornes, statut dérivé de l'horloge, préréglages d'occasion (document toujours valide, dates mobiles non devinées, Black Friday, report à l'année suivante, compte à rebours en heure locale) |
| `tests/experiments-assign.test.ts` | déterminisme, indépendance entre tests, poids 80/20 et 3 variantes, absence d'identifiant, lecture défensive des variantes, application au document (masquée, section, section obligatoire, section absente), revalidation par le moteur, limites de plan, source de premier contact |
| `tests/experiments-stats.test.ts` | reproductibilité à graine fixe, effet de la graine, loi Beta, seuils 7 jours / 200 expositions, verdict et absence de verdict, partition des probabilités, bornage des entrées aberrantes |
| `tests/lot4c-isolation.test.ts` | isolation A/B entre boutiques sur **toutes** les actions, capacité `theme.manage`, chevauchements, limites de plan (Business 3 programmations, Scale 3 tests), un seul test par section, « appliquer la gagnante » n'écrit que le brouillon, résolution au rendu, comptage sur la variante calculée par le serveur, dédoublonnage, test en pause ignoré |
| existants | `tests/audience.test.ts` et `tests/theme-editor-lot4.test.ts` couvrent déjà le §12 (anti-cloaking, règles par plan) |

## 7. Vérification réelle (http://localhost:3000, Chrome système, headless)

Boutique de vérification dédiée `exp-verif-4c` (plan Scale, fuseau Africa/Porto-Novo) créée pour l'occasion puis
**supprimée** : aucune donnée des autres équipes n'a été modifiée (les boutiques de démonstration étaient en plan
Business au moment du passage, A/B étant réservé à Scale).

| Étape | Résultat | Capture |
|---|---|---|
| Écran des programmations (plan, fuseau, préréglages, dates mobiles signalées) | OK | `vague3-exp-programmations-vide.png` |
| Programmation « Noël » créée (début + 3 min, fin + 3 j) | OK, 2 jobs `theme.schedule_notify` | `vague3-exp-programmations-creee.png` |
| `?preview=1&at=<pendant>` | annonce « Noël approche… », accent rouge, bannière, compte à rebours qui finit à la seconde de fin | `vague3-exp-apercu-at-pendant.png` |
| `?preview=1&at=<après la fin>` | **thème normal revenu**, aucune trace de Noël | `vague3-exp-apercu-at-apres.png` |
| Écran des tests A/B, création et démarrage | OK | `vague3-exp-tests-formulaire.png`, `vague3-exp-tests-en-cours.png` |
| Visiteur : cookies posés | `axi_vid` 32 hex, `axi_src=whatsapp` (depuis `utm_source`) | `vague3-exp-vitrine-visiteur.png` |
| Affectation stable sur deux visites | OK (mêmes sections rendues, même `axi_vid`) | — |
| Exposition comptée après défilement | OK : 1 affichage sur la variante affectée | `vague3-exp-tests-resultats.png` |
| Verdict | aucun (« Résultats encore indicatifs : il manque 7 jours… ») + avertissement contre l'arrêt prématuré | idem |

Commandes : `pnpm exec tsc --noEmit` (0 erreur dans le périmètre EXP ; les erreurs restantes appartiennent à
d'autres équipes en cours), `pnpm exec vitest run` (4 fichiers en échec, tous hors périmètre : instantané de
`section-schemas` modifié par l'équipe Canaux, et `APP_SECRET` absent de l'environnement de ce shell),
`pnpm lint` (0 erreur).

## 8. Écarts et limites connues

1. **Cookies posés côté client** (voir §4) : choix imposé par la propriété de `src/proxy.ts` cette vague. Aucun
   impact sur le déterminisme de l'affectation ; un visiteur sans JavaScript n'est pas mesuré.
2. **Variables CSS des états transitoires** du `layout.tsx` de la vitrine : voir la ligne à insérer (§5).
3. **Éditeur de variante limité aux champs texte** : volontaire (sécurité et simplicité). Les panneaux
   `schedule-panel` / `experiment-panel` dans l'éditeur de thème relèvent de `src/components/theme-editor/**`,
   propriété de l'équipe IA cette vague : les deux écrans dédiés les remplacent.
4. **`loadRenderData` lit le document d'origine** pour quelques réglages de données (nombre de produits par page,
   avis) : comme une variante ne modifie que du texte, l'écart est nul en pratique.
5. **Exposition de la variante « masquée »** comptée sur la section voisine : approximation inévitable (il n'y a
   aucun élément à observer). Documentée ici, identique sur les deux variantes en moyenne.
6. **Attribution `order`** : rattachée à la confirmation de commande plutôt qu'à `createOrder`
   (`src/lib/commerce/*` est protégé). Le résultat est équivalent et vérifié côté serveur.
7. **Bandeau d'aperçu** : en `?preview=1&at=…`, `StoreFrame` affiche « Aperçu du thème brouillon » alors qu'il
   s'agit du thème programmé. Cosmétique, dans un fichier partagé ; à ajuster lors de la consolidation.
