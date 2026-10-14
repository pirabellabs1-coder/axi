import type { Metadata } from "next";
import { getStoreContext } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { SITE } from "@/config/site";
import { encodeText, toRows, toSvgString } from "@/lib/qr/encoder";
import { formatPhone } from "@/lib/utils";
import { waLink } from "@/lib/whatsapp";
import { PageHeader, Alert } from "@/components/ui/misc";
import { ShareClient } from "./share-client";

export const metadata: Metadata = { title: "Partager ma boutique" };

export default async function SharePage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const ctx = await getStoreContext(storeId, "store.view");
  const store = ctx.store;

  const domain = await db.domain.findFirst({ where: { storeId: store.id, verified: true }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }], select: { hostname: true } });
  const url = domain ? `https://${domain.hostname}` : `${SITE.url.replace(/\/$/, "")}/s/${store.slug}`;
  const display = url.replace(/^https?:\/\//, "");

  const qr = encodeText(url, { ecc: "Q" });
  const svg = toSvgString(qr, { border: 4, title: `QR code de ${store.name}` });

  const number = store.whatsappNumber;
  const catalogue = number ? waLink(number, `Bonjour ${store.name}, je voudrais voir votre catalogue : ${url}`) : null;
  const pitch = store.tagline?.trim() || store.description?.trim().split(/[.!?]/)[0] || `Découvrez ${store.name}`;
  const bio = `${pitch.slice(0, 80)}. Commandez en ligne, réponse sur WhatsApp : ${display}`.slice(0, 150);

  const messages = [
    {
      key: "status",
      title: "Statut WhatsApp",
      hint: "Publiez-le avec une photo de vos produits.",
      text: `${store.name} est en ligne ! Voyez nos produits et commandez en 1 minute, sans créer de compte : ${url}`,
    },
    { key: "bio", title: "Bio Instagram ou TikTok", hint: `${bio.length} / 150 caractères.`, text: bio },
    {
      key: "facebook",
      title: "Publication Facebook",
      hint: "Idéal en publication épinglée sur votre page.",
      text: `Bonne nouvelle : ${store.name} a sa boutique en ligne.\n\n${pitch}.\n\nRegardez nos produits, choisissez, et validez votre commande : nous vous répondons sur WhatsApp pour la livraison ou le retrait.\n\n${url}`,
    },
    {
      key: "clients",
      title: "Message à vos clients",
      hint: "À transférer à vos contacts ou dans vos groupes.",
      text: `Bonjour, c'est ${store.name}. Vous pouvez maintenant voir tous nos produits et commander directement ici : ${url}\nMerci pour votre confiance !`,
    },
  ];

  return (
    <>
      <PageHeader title="Partager ma boutique" description="Votre lien, votre QR code et des messages prêts à copier pour WhatsApp, Instagram et Facebook." />
      {store.status !== "PUBLISHED" && (
        <Alert tone="warning" className="mb-6" title="Boutique pas encore publiée">
          Vos clients verront une boutique indisponible tant qu'elle n'est pas publiée. Publiez-la depuis le tableau de bord avant de partager le lien.
        </Alert>
      )}
      <ShareClient
        storeName={store.name}
        tagline={pitch}
        url={url}
        display={display}
        svg={svg}
        rows={toRows(qr)}
        slug={store.slug}
        whatsapp={number ? formatPhone(number) : null}
        catalogue={catalogue}
        messages={messages}
        settingsHref={`/app/${store.id}/parametres`}
      />
    </>
  );
}
