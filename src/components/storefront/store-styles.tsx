import { MOTION_CSS } from "@/lib/theme-engine/motion";

/**
 * Styles propres à la vitrine (sans toucher à globals.css) : typographie et boutons pilotés par les variables
 * du thème, conteneur, micro-interactions, zones sûres, sélection de section en aperçu.
 * Animations : transform / opacity / filter uniquement ; `prefers-reduced-motion` respecté.
 * Lot 4 §2 : `MOTION_CSS` (apparitions, parallaxe, zoom au survol) actif seulement sous `[data-motion]` et
 * `prefers-reduced-motion: no-preference` ; sans `data-motion` (Save-Data, mode économie, aperçu « Réduire les
 * animations », préréglage « Aucune »), les animations décoratives existantes (montée, fondu, défilement) sont coupées.
 */
const CSS = `
[data-store]{font-family:var(--store-font);background:var(--c-canvas);color:var(--c-ink);line-height:var(--store-body-leading,1.6)}
[data-store] h1,[data-store] h2,[data-store] h3,[data-store] .sf-heading{font-family:var(--store-font-heading);font-weight:var(--store-heading-weight,600);letter-spacing:calc(-0.025em + var(--store-heading-tracking,0em));line-height:var(--store-heading-leading,1.06);text-transform:var(--store-heading-transform,none);font-variant:var(--store-heading-variant,normal)}
[data-store] .sf-heading{text-wrap:balance}
.sf-container{width:100%;max-width:var(--section-max,var(--store-page-width,1280px));margin-inline:auto;padding-inline:max(16px,calc(var(--store-gutter,20px)))}
@media (max-width:640px){.sf-container{padding-inline:16px}[data-store]{--sf-pad:.7}}
.sf-bg-wrap{position:absolute;inset:0;overflow:hidden;z-index:0;pointer-events:none}
.sf-bg{position:absolute;inset:0;background-size:cover;background-repeat:no-repeat}
.sf-bg-fixed{background-attachment:fixed}
@media (prefers-reduced-motion:reduce){.sf-bg-fixed{background-attachment:scroll}}
.sf-bg-overlay{position:absolute;inset:0}
.sf-btn{display:inline-flex;align-items:center;justify-content:center;gap:.5rem;border-radius:var(--store-radius);font-weight:600;text-transform:var(--store-btn-transform,none);letter-spacing:var(--sf-btn-tracking,0);transition:transform 160ms cubic-bezier(.23,1,.32,1),background-color 200ms,color 200ms,box-shadow 200ms,opacity 200ms;white-space:nowrap;-webkit-tap-highlight-color:transparent}
[data-store][data-upper-buttons] .sf-btn{--sf-btn-tracking:.06em;font-size:13px}
.sf-btn:active{transform:scale(.97)}
.sf-btn:disabled,.sf-btn[aria-disabled=true]{opacity:.5;pointer-events:none}
.sf-btn-md{min-height:var(--store-btn-h,48px);padding-inline:var(--store-btn-px,24px)}
.sf-btn-solid{background:var(--store-primary);color:var(--store-primary-contrast);box-shadow:var(--store-btn-shadow,none)}
.sf-btn-solid:hover{background:color-mix(in srgb,var(--store-primary) 88%,#000)}
[data-btn-style=outline] .sf-btn-solid{background:transparent;color:var(--c-ink);box-shadow:inset 0 0 0 var(--store-btn-border,1.5px) currentColor}
[data-btn-style=outline] .sf-btn-solid:hover{background:var(--store-primary);color:var(--store-primary-contrast)}
[data-btn-style=soft] .sf-btn-solid{background:var(--store-primary-soft);color:var(--store-primary);box-shadow:inset 0 0 0 1px var(--store-primary-ring)}
.sf-schemed .sf-btn-solid{background:var(--store-primary);color:var(--store-primary-contrast);box-shadow:none}
.sf-btn-secondary{background:var(--store-secondary,transparent);color:var(--store-secondary-contrast,var(--c-ink));box-shadow:var(--store-secondary-ring,inset 0 0 0 var(--store-btn-border,1.5px) color-mix(in srgb,var(--c-ink) 42%,transparent))}
.sf-btn-secondary:hover{background:var(--store-secondary,color-mix(in srgb,var(--c-ink) 8%,transparent));filter:brightness(.96)}
.sf-btn-outline{background:transparent;color:var(--c-ink);box-shadow:inset 0 0 0 var(--store-btn-border,1.5px) color-mix(in srgb,var(--c-ink) 40%,transparent)}
.sf-btn-outline:hover{box-shadow:inset 0 0 0 var(--store-btn-border,1.5px) var(--c-ink)}
.sf-btn-soft{background:var(--c-surface-2);color:var(--c-ink)}
.sf-btn-soft:hover{background:color-mix(in srgb,var(--c-ink) 10%,var(--c-surface))}
.sf-btn-light{background:#fff;color:#111412}
.sf-btn-ghost-light{background:rgb(255 255 255/.14);color:#fff;box-shadow:inset 0 0 0 1px rgb(255 255 255/.4);backdrop-filter:blur(10px)}
.sf-btn-ghost-light:hover{background:rgb(255 255 255/.24)}
.sf-btn-whatsapp{background:#0f7a5c;color:#fff}
.sf-btn-whatsapp:hover{background:#0c6a50}
.sf-link{color:var(--c-link,var(--c-ink))}
.sf-card-frame{border-radius:var(--store-card-radius);box-shadow:0 0 0 var(--store-card-ring,0px) var(--c-line)}
.sf-media{border-radius:var(--store-media-radius)}
.sf-input{height:48px;width:100%;border-radius:min(var(--store-radius),14px);background:var(--c-surface);color:var(--c-ink);padding-inline:14px;font-size:16px;box-shadow:inset 0 0 0 1px var(--c-line-strong);transition:box-shadow 160ms}
.sf-input:focus{outline:none;box-shadow:inset 0 0 0 2px var(--store-primary)}
@keyframes sf-bump{0%{transform:scale(1)}35%{transform:scale(1.3)}100%{transform:scale(1)}}
.sf-bump{animation:sf-bump 380ms cubic-bezier(0.32,0.72,0,1)}
@keyframes sf-pop{from{opacity:0;transform:scale(.92);filter:blur(2px)}to{opacity:1;transform:none;filter:none}}
.sf-pop{animation:sf-pop 220ms cubic-bezier(0.23,1,0.32,1) both}
@keyframes sf-rise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
.sf-rise{animation:sf-rise 700ms cubic-bezier(0.16,1,0.3,1) both}
@keyframes sf-fade{from{opacity:0}to{opacity:1}}
.sf-fade{animation:sf-fade 400ms cubic-bezier(0.16,1,0.3,1) both}
.sf-media img{transition:transform 900ms cubic-bezier(0.16,1,0.3,1),opacity 500ms cubic-bezier(0.16,1,0.3,1)}
@media (hover:hover) and (pointer:fine){[data-motion-hover] .sf-card:hover .sf-media img.sf-img-main{transform:scale(1.035)}.sf-card:hover .sf-img-second{opacity:1}}
.sf-img-second{opacity:0}
.sf-safe-bottom{padding-bottom:max(12px,env(safe-area-inset-bottom))}
@media (max-width:1023px){[data-store]:has([data-sticky-cta][data-visible=true]) footer{padding-bottom:96px}}
.sf-snap{scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch;overscroll-behavior-x:contain}
.sf-snap>*{scroll-snap-align:start}
.sf-marquee{display:flex;gap:3rem;width:max-content;animation:sf-marquee var(--sf-marquee-dur,28s) linear infinite}
.sf-marquee-reverse{animation-direction:reverse}
.sf-marquee-wrap:hover .sf-marquee,.sf-marquee-wrap:focus-within .sf-marquee{animation-play-state:paused}
@keyframes sf-marquee{to{transform:translateX(-50%)}}
[data-preview] [data-section-id]{scroll-margin-top:96px}
[data-preview] [data-section-id][data-selected=true]{outline:2px solid #2459d6;outline-offset:-2px}
[data-preview] [data-section-id][data-selected=true]::after{content:attr(data-section-label);position:absolute;top:0;left:0;z-index:5;background:#2459d6;color:#fff;font:600 11px/1 var(--font-geist),system-ui;padding:5px 8px;border-bottom-right-radius:6px}
[data-preview] :is([data-section-id],[data-section-group])[data-hovered=true]:not([data-selected=true]){outline:1px dashed rgba(36,89,214,.7);outline-offset:-1px}
[data-preview] :is([data-section-id],[data-section-group])[data-hovered=true]:not([data-selected=true])::after{content:attr(data-section-label);position:absolute;top:0;left:0;z-index:5;background:rgba(36,89,214,.85);color:#fff;font:600 11px/1 var(--font-geist),system-ui;padding:5px 8px;border-bottom-right-radius:6px;pointer-events:none}
[data-store]:not([data-motion]) :is(.sf-rise,.sf-fade,.sf-marquee){animation:none}
@media (prefers-reduced-motion:reduce){.sf-bump,.sf-pop,.sf-rise,.sf-fade{animation:none}.sf-media img{transition:none}.sf-marquee{animation:none}.sf-btn{transition:none}}
/* En-tête transparent sur la bannière (type Shopify) : en-tête collant qui chevauche la 1re section
   (marge négative = hauteur de la barre), sans la pousser vers le bas. Les bandeaux (annonce, langue, état)
   restent au-dessus dans le flux. Au défilement, l'en-tête reste épinglé et devient opaque. */
.sf-header-overlay{position:sticky;top:0;z-index:30;margin-bottom:-64px;transition:background-color .3s ease,box-shadow .3s ease,border-color .3s ease,color .3s ease}
@media (min-width:1024px){.sf-header-overlay{margin-bottom:-72px}}
/* État « top » : transparent, texte clair lisible sur la bannière (voile dégradé de secours pour l'AA). */
[data-overlay-state=top] .sf-header-overlay{background:transparent;border-bottom:1px solid transparent;box-shadow:none;--c-ink:#fff;--c-ink-muted:rgba(255,255,255,.82);--c-ink-faint:rgba(255,255,255,.64);--c-link:#fff;--c-line:rgba(255,255,255,.28);--c-line-strong:rgba(255,255,255,.5)}
[data-overlay-state=top] .sf-header-overlay::before{content:"";position:absolute;inset-inline:0;top:0;bottom:0;background:linear-gradient(to bottom,rgba(0,0,0,.42),rgba(0,0,0,0));pointer-events:none;z-index:-1}
/* État « pinned » (défilé) : style opaque actuel. */
[data-overlay-state=pinned] .sf-header-overlay{background:color-mix(in srgb,var(--c-surface) 90%,transparent);border-bottom:1px solid color-mix(in srgb,var(--c-line) 70%,transparent);-webkit-backdrop-filter:blur(16px);backdrop-filter:blur(16px)}
/* Survol translucide clair sur la barre en état « top » (hors popovers, remis à plat ci-dessous). */
[data-overlay-state=top] .sf-header-overlay :is(a,button,summary):hover{background-color:rgba(255,255,255,.16)}
/* Popovers (menu déroulant, recherche, menu mobile) : ton remis au thème sous l'état « top » pour rester lisibles. */
[data-overlay-state=top] .sf-ink-reset{--c-ink:var(--store-text);--c-link:var(--store-text);--c-ink-muted:color-mix(in srgb,var(--store-text) 72%,var(--c-surface));--c-ink-faint:color-mix(in srgb,var(--store-text) 55%,var(--c-surface));--c-line:color-mix(in srgb,var(--store-text) 16%,var(--c-surface));--c-line-strong:color-mix(in srgb,var(--store-text) 30%,var(--c-surface));color:var(--store-text)}
[data-overlay-state=top] .sf-ink-reset :is(a,button,summary):hover{background-color:var(--c-surface-2)}
@media (prefers-reduced-motion:reduce){.sf-header-overlay{transition:none}}
`;

export function StoreStyles() {
  return <style>{CSS + MOTION_CSS}</style>;
}
