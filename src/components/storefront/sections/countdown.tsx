import { S } from "@/lib/storefront/theme-doc";
import { href, type SectionProps } from "../render-context";
import { CountdownTimer } from "../countdown-timer";
import { ButtonLink, headingClass, SectionShell } from "../ui";

/** Date de fin « AAAA-MM-JJ HH:MM » interprétée à l'heure du Bénin (UTC+1). */
function parseEnd(v: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?$/.exec(v.trim());
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] - 1 : 23 - 1, m[5] ? +m[5] : 59);
  return Number.isFinite(t) ? t : null;
}

export default function Countdown({ section, ctx }: SectionProps) {
  const end = parseEnd(S.str(section.settings, "ends_at"));
  const now = Date.parse(ctx.data.now);
  if (!end || end <= now) return null;
  return (
    <SectionShell section={section} ctx={ctx}>
      <div className="flex flex-col items-center gap-6 text-center">
        <h2 className={headingClass(S.str(section.settings, "heading_size", "md"))}>{S.str(section.settings, "heading", "Fin de la promotion dans")}</h2>
        <CountdownTimer endsAt={end} initialNow={now} />
        <ButtonLink href={href(ctx, S.str(section.settings, "button_link"), "/catalogue")} label={S.str(section.settings, "button_label")} style={S.str(section.settings, "button_style", "solid") as "solid"} arrow />
      </div>
    </SectionShell>
  );
}
