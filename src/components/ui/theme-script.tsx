"use client";

/**
 * Script anti-flash : applique le thème et l'état de la barre latérale mémorisés avant le premier rendu.
 *
 * Rendu côté serveur, c'est un <script> classique exécuté par le navigateur pendant l'analyse du HTML
 * (aucun flash, contrairement à `next/script` `beforeInteractive` dont le code inline n'est exécuté
 * qu'une fois le runtime Next chargé). Côté client, React ne doit jamais créer ce <script> lui-même
 * (« Encountered a script tag while rendering React component ») : on le déclare alors en bloc de
 * données (`type="text/plain"`), que React accepte sans avertissement et que le navigateur n'exécute pas.
 * À l'hydratation, l'écart d'attribut `type` est volontaire (suppressHydrationWarning).
 */
const code = `try{var d=document.documentElement,t=localStorage.getItem("axi-theme");if(t==="light"||t==="dark")d.dataset.theme=t;if(localStorage.getItem("axi-sidebar")==="collapsed")d.dataset.sidebar="collapsed"}catch(e){}`;

export function ThemeScript() {
  const isServer = typeof window === "undefined";
  return <script type={isServer ? undefined : "text/plain"} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: code }} />;
}
