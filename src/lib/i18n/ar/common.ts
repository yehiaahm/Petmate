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

  // Shell
  "Skip to main content": "انتقل إلى المحتوى الرئيسي",
  "Change language to {language}": "تغيير اللغة إلى {language}",
};
