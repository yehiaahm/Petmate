import type { Messages } from "../translate";

/** Shared vocabulary: formatting phrases, generic actions and states. */
export const common: Messages = {
  // Formatting
  "just now": "الآن",
  "Age unknown": "العمر غير معروف",
  "Under 1 month": "أقل من شهر",
  "{count} months": { zero: "{count} شهر", one: "شهر واحد", two: "شهران", few: "{count} أشهر", many: "{count} شهرًا", other: "{count} شهر" },
  "{count} years": { zero: "{count} سنة", one: "سنة واحدة", two: "سنتان", few: "{count} سنوات", many: "{count} سنة", other: "{count} سنة" },
  "{years} and {months}": "{years} و{months}",
  "Less than 1 km away": "على بُعد أقل من 1 كم",
  "{distance} km away": "على بُعد {distance} كم",

  // Generic actions and fields
  Cancel: "إلغاء",
  "Save changes": "حفظ التغييرات",
  "Saving…": "جارٍ الحفظ…",
  Email: "البريد الإلكتروني",
  Phone: "رقم الهاتف",
  City: "المدينة",
  Country: "الدولة",
  Contact: "التواصل",
  Description: "الوصف",
  Title: "العنوان",
  Price: "السعر",
  Stock: "المخزون",
  Actions: "الإجراءات",
  Orders: "الطلبات",
  Products: "المنتجات",
  Product: "المنتج",
  Shop: "المتجر",
  Photos: "الصور",
  Published: "منشور",
  Draft: "مسودة",
  Live: "مفعَّل",
  "In review": "قيد المراجعة",
  "What it costs": "التكلفة",
  "Uploading…": "جارٍ الرفع…",
  "That photo was not accepted": "لم يتم قبول هذه الصورة",
  "Please try a different image.": "جرّب صورة أخرى.",
  "Remove one before adding more.": "احذف واحدة قبل إضافة المزيد.",
  "Up to {count} photos": "حتى {count} صور",
  "Remove photo {n}": "حذف الصورة {n}",

  // Shell
  "Skip to main content": "انتقل إلى المحتوى الرئيسي",
  "Change language to {language}": "تغيير اللغة إلى {language}",
};
