/** En-tête des écrans d'authentification : titre en 2 lignes maximum + sous-texte court. */
export function AuthHeading({ title, children }: { title: React.ReactNode; children?: React.ReactNode }) {
  return (
    <header>
      <h1 className="text-[34px] font-semibold leading-[1.04] tracking-[-0.04em] text-ink sm:text-[40px]">{title}</h1>
      {children && <p className="mt-3 text-[15px] leading-relaxed text-ink-muted">{children}</p>}
    </header>
  );
}
