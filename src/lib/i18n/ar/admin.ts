import type { Messages } from "../translate";

/**
 * Messages the staff console's services send back. The console itself is
 * English, but its API errors pass through the same translator as every other
 * service, so an Arabic-speaking moderator reads them in Arabic.
 */
export const admin: Messages = {
  "You cannot change that account.": "لا يمكنك تعديل هذا الحساب.",
  "That {fields} is already used by another record.": "قيمة {fields} هذه مستخدمة بالفعل في سجل آخر.",
  "Other records still point at this one, so it cannot be removed permanently. Archive it instead, or remove what depends on it first.":
    "لا تزال سجلات أخرى مرتبطة بهذا السجل، لذا لا يمكن حذفه نهائيًا. أرشفه بدلًا من ذلك، أو احذف ما يعتمد عليه أولًا.",
  "This table is not in the database yet. Run `npm run db:push` to bring the schema up to date.":
    "هذا الجدول غير موجود في قاعدة البيانات بعد. شغّل `npm run db:push` لتحديث المخطط.",
  "You cannot delete your own account from the console.": "لا يمكنك حذف حسابك من لوحة التحكم.",
  "You cannot change the status of your own account.": "لا يمكنك تغيير حالة حسابك.",
  "Some of those fields cannot be changed.": "بعض هذه الحقول لا يمكن تعديلها.",
  "Nothing to change.": "لا يوجد ما يُعدَّل.",
  "{records} can only be deleted permanently.": "لا يمكن حذف {records} إلا نهائيًا.",
  "A deleted {record} cannot be restored.": "لا يمكن استعادة {record} بعد حذفه.",
  "Choose a status.": "اختر حالة.",
  "Status is read-only here.": "الحالة للقراءة فقط هنا.",
  "That table": "هذا الجدول",
};
