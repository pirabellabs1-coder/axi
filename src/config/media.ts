/**
 * Photographies (Unsplash, licence Unsplash : usage commercial libre, sans attribution obligatoire).
 * Servies par le CDN images.unsplash.com avec redimensionnement à la volée.
 * À remplacer par des photos de commerçants réels dès le pilote.
 */
export function unsplash(id: string, w = 1200, h?: number, q = 72): string {
  const params = new URLSearchParams({ auto: "format", fit: "crop", w: String(w), q: String(q) });
  if (h) params.set("h", String(h));
  return `https://images.unsplash.com/${id}?${params.toString()}`;
}

/** Visuels du site vitrine et de la marketplace. */
export const MEDIA = {
  heroMerchant: { id: "photo-1687422809654-579d81c29d32", alt: "Commerçante devant son étal de fruits, téléphone en main" },
  shopCounter: { id: "photo-1687422808311-a776f467a468", alt: "Commerçante au comptoir de sa boutique" },
  apronPhone: { id: "photo-1687422808248-f807f4ea2a2e", alt: "Commerçant en tablier consultant ses commandes sur son téléphone" },
  tailorSmiling: { id: "photo-1687422809069-0fa3546b8471", alt: "Couturier souriant à sa machine à coudre" },
  seamstresses: { id: "photo-1790943780822-9918073fe9f1", alt: "Deux couturières en tenues en pagne au travail" },
  laptopBraids: { id: "photo-1604933762021-54a5858c9832", alt: "Entrepreneuse travaillant sur son ordinateur" },
  delivery: { id: "photo-1667844141318-ee2ba9d088d6", alt: "Livraison à moto dans une rue animée" },
  fabrics: { id: "photo-1768212565426-58b089b6386d", alt: "Pagnes colorés exposés à la vente" },
  market: { id: "photo-1585540083814-ea6ee8af9e4f", alt: "Commerçant devant son étal au marché" },
  chef: { id: "photo-1709837167686-a2e33aad1bf0", alt: "Cheffe cuisinière en cuisine" },
  jollof: { id: "photo-1665332195309-9d75071138f0", alt: "Riz jollof servi avec du poisson grillé" },
  phonePink: { id: "photo-1680879275304-bbe20f7e28fb", alt: "Jeune femme tenant son téléphone" },
  blazer: { id: "photo-1563132337-f159f484226c", alt: "Entrepreneuse en blazer orange" },
  braids: { id: "photo-1572955304332-bf714bd49add", alt: "Femme aux tresses colorées" },
  electronicsShop: { id: "photo-1790765105380-b1052be0c9e9", alt: "Vendeur dans une boutique de téléphonie" },
  bakery: { id: "photo-1583338917451-face2751d8d5", alt: "Vitrine de pâtisserie avec tartes et gâteaux" },
  boutique: { id: "photo-1441984904996-e0b6ba687e04", alt: "Intérieur d'une boutique de vêtements" },
} as const;

/** Photos produits utilisées par le seed de démonstration. */
export const PRODUCT_PHOTOS = {
  chocolateCake: "photo-1606890737304-57a1ca8a5b62",
  fruitTart: "photo-1670819916757-e8d5935a6c65",
  lemonCake: "photo-1691242720281-9269de4d9f86",
  croissants: "photo-1623334044303-241021148842",
  painChocolat: "photo-1681218424681-b4f8228ecea9",
  beignets: "photo-1527904324834-3bda86da6771",
  bissap: "photo-1618924385045-52295bd2dfeb",
  breakfastBox: "photo-1528699633788-424224dc89b5",
  waxFabric: "photo-1768212565424-efa3a3852b81",
  waxFabric2: "photo-1768212566108-4ce4f329e4d2",
  dress: "photo-1709809081557-78f803ce93a0",
  dressYellow: "photo-1696962678565-bee84e6b9cb6",
  menShirt: "photo-1763823133159-c6f8ec380e33",
  handbag: "photo-1605733513597-a8f8341084e6",
  sandals: "photo-1585120824848-8a5cd41493d2",
  necklace: "photo-1629481995102-ff98d306dd8a",
  sneakers: "photo-1600269452121-4f2416e55c28",
  waxBag: "photo-1655682604476-96976c1917fb",
  smartphone: "photo-1592890288564-76628a30a657",
  earbuds: "photo-1606841837239-c5a1a4a07af7",
  powerBank: "photo-1566554738544-d962991c3fee",
  smartwatch: "photo-1579586337278-3befd40fd17a",
  speaker: "photo-1608043152269-423dbba4e7e1",
  phoneCases: "photo-1535157412991-2ef801c1748b",
  charger: "photo-1557767382-97b28f5488e7",
  headphones: "photo-1590658268037-6bf12165a8df",
  jollof: "photo-1665332195309-9d75071138f0",
  riceDish: "photo-1569058242252-623df46b5025",
  foodTray: "photo-1666190092689-e3968aa0c32c",
  sheaButter: "photo-1573812461383-e5f8b759d12e",
} as const;
