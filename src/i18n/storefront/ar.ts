import type { StorefrontDictionary } from "./fr";

/**
 * ARABE (droite à gauche) — dictionnaire partiel (lot 2 §1.1) : toute clé absente retombe sur le français.
 * La direction du texte vient de `localeDir("ar") === "rtl"` (attribut `dir` sur la racine de la boutique).
 */
export const ar: StorefrontDictionary = {
  "copy.browseCta": "تصفح المنتجات",
  "copy.catalogTitle": "منتجاتنا",
  "copy.featuredTitle": "مختارات",
  "copy.addLabel": "أضف",
  "copy.searchPlaceholder": "ابحث عن منتج",
  "copy.emptyCatalog": "لا توجد منتجات بعد.",
  "copy.pickupTitle": "الاستلام من المتجر",
  "copy.checkoutTitle": "طلبك",
  "copy.confirmLabel": "اطلب الآن",
  "copy.itemNoun": "منتج",

  "nav.home": "الرئيسية",
  "nav.catalog": "الكتالوج",
  "nav.search": "بحث",
  "nav.account": "حسابي",
  "nav.cart": "السلة",
  "nav.menu": "القائمة",

  "product.addToCart": "أضف إلى السلة",
  "product.buyNow": "اطلب الآن",
  "product.soldOut": "نفدت الكمية",
  "product.inStock": "متوفر",
  "product.from": "ابتداءً من",
  "product.description": "الوصف",
  "product.details": "التفاصيل",
  "product.quantity": "الكمية",
  "product.reviews": "التقييمات",
  "product.share": "مشاركة",

  "cart.title": "السلة",
  "cart.empty": "سلتك فارغة.",
  "cart.subtotal": "المجموع الفرعي",
  "cart.total": "الإجمالي",
  "cart.delivery": "التوصيل",
  "cart.discount": "خصم",
  "cart.checkout": "إتمام الطلب",
  "cart.continue": "متابعة التسوق",
  "cart.remove": "إزالة",

  "search.placeholder": "بحث",
  "search.noResults": "لا توجد نتائج.",
  "list.seeAll": "عرض الكل",

  "checkout.name": "الاسم الكامل",
  "checkout.phone": "الهاتف",
  "checkout.address": "عنوان التوصيل",
  "checkout.submit": "تأكيد الطلب",

  "common.loading": "جارٍ التحميل…",
  "common.close": "إغلاق",
  "common.back": "رجوع",

  "locale.suggestion": "هل تريد عرض المتجر بـ {language}؟",
  "locale.switch": "تغيير اللغة",
  "locale.dismiss": "لا، شكراً",
  "locale.label": "اللغة",
};

export default ar;
