# Axi — Design System v2 (Master)

> Source de vérité visuelle. Construit avec les skills `high-end-visual-design`, `design-taste-frontend`,
> `ui-ux-pro-max`, `premium-web-motion`, `emil-design-eng`. Remplace la v1 (jugée trop « template »).

## 0. Lecture du brief
**SaaS de commerce conversationnel pour commerçants non techniques d'Afrique francophone (puis monde), langage premium « Forest + Lime », mobile-first, photographies réelles de commerçants, mouvement fluide et motivé.**
Dials : `DESIGN_VARIANCE 7` (marketing) / `4` (espace marchand) · `MOTION_INTENSITY 6` / `3` · `VISUAL_DENSITY 4` / `6`.
Références : Take App (simplicité, chat → commande), Watfy (CRM WhatsApp, entonnoir), Wise / Linear / Stripe (finition).

## 1. Couleur (tokens CSS dans `src/app/globals.css`, thème clair + sombre)
| Rôle | Clair | Sombre | Classe |
|---|---|---|---|
| Fond | `#f3f4ef` | `#0a0f0c` | `bg-canvas` |
| Surface | `#ffffff` | `#111814` | `bg-surface` |
| Surface 2 | `#f0f2ec` | `#18211c` | `bg-surface-2` |
| Ligne | `#e1e4dc` | blanc 8 % | `border-line`, `ring-line` |
| Texte | `#0e1411` | `#eef2ec` | `text-ink` |
| Texte secondaire | `#56605a` | `#a3aea7` | `text-ink-muted` |
| Primaire (forêt / lime en sombre) | `#0d3b2e` | `#b8f06a` | `bg-primary text-on-primary` |
| Accent lime (CTA de conversion, surbrillance) | `#b8f06a` | `#b8f06a` | `bg-accent text-on-accent` |
| Couleurs fixes de marque | `forest #0d3b2e`, `forest-deep #072319`, `lime #b8f06a`, `bone #f3f4ef` | | `bg-forest`, `text-lime`… |

Règles : un seul accent (lime). Texte sur lime = `text-on-accent` (quasi noir), jamais blanc. Blocs « forêt » (`bg-forest text-white`) autorisés comme sections d'emphase **dans le même thème** (une à deux par page). Aucune couleur hex en dur dans les composants hors marque fixe et thèmes boutique. Interdits : violet IA, dégradés néon, beige/laiton.

## 2. Typographie
- **Geist** (sans) pour tout, **Geist Mono** pour références, montants dans les tableaux, codes.
- Titres : `font-semibold`, `tracking-[-0.04em]`, `leading-[1.02]`. Tailles : `text-display` (hero), `text-h1`, `text-h2`, `text-h3`. Emphase dans un titre = italique ou couleur `text-ink-muted` du **même** fichier de police, jamais une autre famille.
- Corps : 15–17 px, `leading-relaxed`, `max-w-[60ch]`, `text-ink-muted` pour le secondaire.
- Zéro tiret cadratin (—) ou demi-cadratin (–) dans les textes visibles : utiliser point, virgule, deux-points, trait d'union.

## 3. Formes et matière
- **Boutons : pilule** (`rounded-full`), hauteur 36/44/52. CTA principal avec icône nichée (`trailing` du composant `Button`). Pression `active:scale-[0.98]`.
- **Cartes : 20 px** (`rounded-[var(--radius-lg)]`), anneau `ring-1 ring-line`, ombre teintée `shadow-[var(--shadow-card)]`. Pas de bordure grise 1px « par défaut ».
- **Double-bezel** (`<Bezel>` ou `.bezel` + `.bezel-core`) pour les blocs majeurs : tarifs, mises en avant, aperçus produit, panneaux clés du tableau de bord.
- **Champs : 14 px** (`rounded-[var(--radius-md)]`), hauteur 48, anneau interne, focus anneau primaire 2 px.
- Grandes sections : `rounded-[var(--radius-2xl)]` (36 px) pour les blocs forêt / images plein cadre.
- Icônes : `lucide-react` (dépendance existante), trait fin 1.6 réglé globalement. Pas d'emoji comme icône. Pas de SVG faits main (sauf logo).

## 4. Mouvement
- Courbes : `ease-spring` = `cubic-bezier(0.32,0.72,0,1)`, `ease-out-expo` = `cubic-bezier(0.16,1,0.3,1)`. Jamais `linear`/`ease-in-out` sur l'UI.
- Entrée au scroll : `.reveal` (fade-up + flou 8 px → 0, 900 ms), décalages via `style={{ transitionDelay }}`. `IntersectionObserver` uniquement.
- Uniquement `transform`, `opacity`, `filter`. `backdrop-blur` seulement sur éléments fixes (nav). `prefers-reduced-motion` respecté.
- Un seul marquee par page maximum. Chaque animation a une raison (hiérarchie, récit, retour d'action, changement d'état).

## 5. Composition (site vitrine)
- Nav « île flottante » : pilule détachée du haut (`mt-4`), fond verre (`backdrop-blur-xl bg-surface/75 ring-1 ring-line`), une seule ligne, ≤ 72 px. Menu mobile plein écran avec liens en cascade.
- Hero : split asymétrique (texte à gauche, **vraie photo** de commerçant à droite dans un cadre double-bezel avec une carte UI réelle superposée), titre ≤ 2 lignes, sous-texte ≤ 20 mots, 1 CTA principal + 1 secondaire, pas de bandeau sous les CTA.
- Au moins 4 familles de mise en page différentes par page (bento asymétrique, bloc forêt plein, carrousel horizontal, split image, grille de cartes, FAQ accordéon). Pas 3 cartes identiques en ligne. Max 1 eyebrow pour 3 sections.
- Images : `src/config/media.ts` (Unsplash via `unsplash(id, w, h)`), `next/image` avec `sizes` et `priority` sur le hero.
- Sections : `py-24 md:py-32`. Conteneur `container-x` (1280 px).

## 6. Espace marchand / admin (densité produit)
- Inspiration Linear / Stripe Dashboard : sidebar 260 px sobre, typo 14 px, tableaux avec en-têtes discrets, chiffres `tabular`, KPI en cartes double-bezel légères, graphiques SVG fins.
- États obligatoires par écran : vide (illustré par icône + action), chargement (`Skeleton` à la forme finale), erreur, accès refusé, limite de plan (`PlanGate` : ce qui est bloqué, pourquoi, quel plan ou option débloque, sans pression trompeuse).

## 7. Boutique publique
- Thème du commerçant (variables `--store-*`), forcée en clair (`data-theme="light"`), photos produits réelles plein cadre `aspect-[4/5]`, panier en tiroir, checkout une colonne.

## 8. Accessibilité et performance
WCAG 2.2 AA (contraste, focus visible, cibles ≥ 44 px, labels au-dessus des champs, erreurs liées). LCP < 2,5 s : hero `priority`, polices `next/font`, Server Components par défaut. Tester 375 / 768 / 1280 px et thème sombre.

## 9. Anti-patterns interdits
Inter, emoji-icônes, fausses captures construites en `<div>` dans le hero, 3 cartes égales, eyebrows partout, numérotation de sections (« 01 / »), points décoratifs, tirets cadratins, métriques inventées présentées comme réelles, témoignages inventés présentés comme réels, noms génériques (John Doe, Acme), dégradé violet.
