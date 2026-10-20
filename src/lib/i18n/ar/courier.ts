import type { Messages } from "../translate";

/** Courier integration (Bosta) for shops and buyers. */
export const courier: Messages = {
  "Bosta API key": "مفتاح Bosta API",
  "Bosta connected": "تم ربط Bosta",
  "Bosta dashboard → Settings → API integration.": "لوحة Bosta ← الإعدادات ← ربط API.",
  "Bosta {tracking}": "Bosta {tracking}",
  "Connect your own Bosta account to have every order booked with Bosta automatically. Until then you deliver and update parcels yourself.": "اربط حسابك على Bosta لتُحجز كل الطلبات مع Bosta تلقائيًا. وحتى ذلك الحين تتولى أنت التوصيل وتحديث الشحنات.",
  "Connect": "ربط",
  "Connected": "مربوط",
  "Not connected": "غير مربوط",
  "Courier": "شركة الشحن",
  "Disconnect Bosta": "إلغاء ربط Bosta",
  "In your Bosta dashboard, open Settings → Webhooks and add this address, with the secret as the Authorization header:": "في لوحة Bosta افتح الإعدادات ← Webhooks وأضف هذا العنوان، مع وضع الرمز السري في ترويسة Authorization:",
  "New orders are booked with Bosta automatically, and Bosta's updates move each parcel here. Bosta pays cash-on-delivery money to your Bosta account.": "تُحجز الطلبات الجديدة مع Bosta تلقائيًا، وتحديثات Bosta تنقل حالة كل شحنة هنا. وتحوّل Bosta مبالغ الدفع عند الاستلام إلى حسابك لديها.",
  "One more step in Bosta": "خطوة أخيرة في Bosta",
  "That does not look like a Bosta API key.": "هذا لا يبدو مفتاح Bosta API صحيحًا.",
  "We could not reach Bosta to check that key. Try again in a minute.": "تعذّر الاتصال بـ Bosta للتحقق من المفتاح. حاول بعد دقيقة.",
  "Bosta did not accept that API key.": "لم تقبل Bosta هذا المفتاح.",
  "This parcel is already booked with Bosta.": "هذه الشحنة محجوزة بالفعل مع Bosta.",
  "Bosta updates this parcel. To change or cancel it, use your Bosta dashboard.": "Bosta هي التي تحدّث هذه الشحنة. لتعديلها أو إلغائها استخدم لوحة Bosta.",
  "That delivery could not be found.": "تعذّر العثور على هذه الشحنة.",
};
