import { LinkTabs } from "@/components/ui/tabs";
import { DOC_PAGES } from "./_ui";
import { devBase } from "@/app/app/[storeId]/developpeur/_components/dev-base";

export default async function DocsLayout({ children, params }: { children: React.ReactNode; params: Promise<{ storeId: string }> }) {
  const dev = devBase((await params).storeId);
  return (
    <>
      <LinkTabs
        className="mb-6"
        items={[{ href: `${dev}/docs`, label: "Sommaire", exact: true }, ...DOC_PAGES.map((d) => ({ href: `${dev}/docs/${d.slug}`, label: d.title }))]}
      />
      <article className="min-w-0">{children}</article>
    </>
  );
}
