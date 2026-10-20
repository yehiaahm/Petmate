import type { Messages } from "../translate";

/** Pet hotels, dog training, pickup and drop-off, and the bookings they make. */
export const care: Messages = {
  // Navigation and marketing
  "Pet hotels": "فنادق الحيوانات",
  "Dog training": "تدريب الكلاب",
  Hotels: "الفنادق",
  Training: "التدريب",
  "For pet hotels & trainers": "لفنادق الحيوانات والمدرّبين",
  "Hotel & training bookings": "حجوزات الفنادق والتدريب",
  "Provider console": "لوحة مقدّم الخدمة",
  "Pet care business": "نشاط رعاية الحيوانات",
  "Search pets, breeds, pet hotels…": "ابحث عن حيوانات، سلالات، فنادق حيوانات…",
  "Care while you're away": "رعاية وأنت مسافر",
  "Pet hotels and trainers with real availability, photo updates and pickup from your door.":
    "فنادق حيوانات ومدرّبون بمواعيد متاحة فعلًا، وتحديثات بالصور، واستلام من باب بيتك.",
  "Find a pet hotel": "ابحث عن فندق للحيوانات",
  "Hotels & trainers": "الفنادق والمدرّبون",
  "Book a pet hotel": "احجز فندقًا لحيوانك",
  "Book dog training": "احجز تدريبًا لكلبك",
  "From the first search to every stay away": "من أول بحث حتى كل إقامة بعيدًا عنك",
  "Find, buy, adopt and breed pets from people you can actually check. Every pet gets a health record that follows them for life, plus pet hotels with pickup and drop-off, dog training and a pet store in one place.":
    "ابحث واشترِ وتبنَّ وزاوِج الحيوانات من أشخاص يمكنك التحقق منهم فعلًا. لكل حيوان سجل صحي يرافقه مدى الحياة، إلى جانب فنادق للحيوانات مع الاستلام والتوصيل، وتدريب للكلاب، ومتجر لمستلزماتها — في مكان واحد.",
  "Verified health records, payments held safely until you meet the pet, and trusted pet hotels and trainers — all in one place.":
    "سجلات صحية موثّقة، ومدفوعات محفوظة بأمان حتى تقابل الحيوان، وفنادق ومدرّبون موثوقون — كل ذلك في مكان واحد.",
  "PetMate is where pets get a verified identity. Buy, adopt and find breeding matches from people you can check, keep a lifelong health record, book a pet hotel or a trainer and shop what your pet needs — in one place.":
    "PetMate هو المكان الذي يحصل فيه الحيوان الأليف على هوية موثّقة. اشترِ وتبنَّ وابحث عن شريك تزاوج من أشخاص يمكنك التحقق منهم، واحتفظ بسجل صحي مدى الحياة، واحجز فندقًا أو مدرّبًا، وتسوّق كل ما يحتاجه حيوانك — في مكان واحد.",
  "Join PetMate to find, adopt and care for pets with verified health records, escrow-protected purchases, pet hotels and dog training in one place.":
    "انضم إلى PetMate لتجد الحيوانات وتتبنّاها وترعاها، مع سجلات صحية موثّقة ومشتريات محمية بالضمان وفنادق للحيوانات وتدريب للكلاب في مكان واحد.",

  // Sign-up
  "I own or want a pet": "عندي حيوان أو أريد واحدًا",
  "Buy, adopt, book hotels and training": "اشترِ، تبنَّ، احجز فنادق وتدريبًا",
  "I run a pet hotel or train dogs": "أدير فندقًا للحيوانات أو أدرّب الكلاب",
  "Take bookings, pickups, updates": "استقبل الحجوزات والاستلام وأرسل التحديثات",

  // Dashboard
  "Hotel and training": "الفنادق والتدريب",
  "All bookings": "كل الحجوزات",
  "In care": "في الرعاية",
  "In progress": "جارٍ",

  // Errors from booking a stay or a programme
  "You cannot book your own business.": "لا يمكنك الحجز لدى نشاطك الخاص.",
  "That pet can no longer be booked.": "لم يعد من الممكن حجز هذا الحيوان.",
  "{what} is not offered for {species}.": "{what} غير متاح لـ {species}.",
  "This provider does not offer boarding.": "مقدّم الخدمة هذا لا يقدّم الإقامة.",
  "{unit} has a weight limit. Add {pet}'s weight to their profile first.":
    "{unit} له حد أقصى للوزن. أضف وزن {pet} إلى ملفه أولًا.",
  "{unit} takes pets up to {kg} kg.": "{unit} يستقبل الحيوانات حتى {kg} كجم.",
  "Choose valid check-in and check-out dates.": "اختر تاريخي وصول ومغادرة صحيحين.",
  "Check-out must be after check-in.": "يجب أن يكون تاريخ المغادرة بعد تاريخ الوصول.",
  "Stays are limited to {nights} nights.": "الحد الأقصى للإقامة {nights} ليلة.",
  "This provider does not offer training.": "مقدّم الخدمة هذا لا يقدّم التدريب.",
  "Add {pet}'s date of birth to their profile first.": "أضف تاريخ ميلاد {pet} إلى ملفه أولًا.",
  "{program} is for dogs from {months} months old.": "{program} مخصّص للكلاب من عمر {months} أشهر.",
  "That start time is no longer available. Pick another.": "موعد البدء هذا لم يعد متاحًا. اختر موعدًا آخر.",
  "{provider} needs an up-to-date vaccination on {pet}'s health record for the whole booking. Add it from the pet's health page.":
    "يشترط {provider} تطعيمًا ساريًا في السجل الصحي لـ {pet} طوال مدة الحجز. أضفه من صفحة صحة الحيوان.",
  "{pet} already has a booking at that time ({reference}).": "لدى {pet} حجز بالفعل في هذا الوقت ({reference}).",
  "This provider does not offer pickup and drop-off.": "مقدّم الخدمة هذا لا يقدّم الاستلام والتوصيل.",
  "This provider has not set its location, so it cannot come to you.":
    "لم يحدّد مقدّم الخدمة موقعه بعد، لذا لا يمكنه الوصول إليك.",
  "Add your address and pin your location so the team can find you.":
    "أضف عنوانك وحدّد موقعك على الخريطة حتى يتمكّن الفريق من الوصول إليك.",
  "You are {km} km away. {provider} covers up to {radius} km.":
    "تبعد {km} كم. يغطّي {provider} مسافة حتى {radius} كم.",
  "Someone booked that a moment ago. Please choose again.": "حجزه شخص آخر قبل لحظات. اختر مرة أخرى.",
  "That room type is fully booked on {date}. Try other dates or another room.":
    "هذا النوع من الغرف محجوز بالكامل يوم {date}. جرّب تواريخ أخرى أو غرفة أخرى.",
  "A session in that programme has just been taken. Pick another start.":
    "حُجزت للتو جلسة في هذا البرنامج. اختر موعد بدء آخر.",
  "The driver is already on the way. Message the team to change plans.":
    "السائق في الطريق بالفعل. راسل الفريق لتغيير الترتيبات.",
  "This booking has just changed. Refresh and try again.": "تغيّر هذا الحجز للتو. حدّث الصفحة وحاول مرة أخرى.",
  "Training starts when the first session is recorded.": "يبدأ التدريب عند تسجيل أول جلسة.",
  "Only a confirmed stay can be checked in.": "لا يمكن تسجيل الوصول إلا لإقامة مؤكّدة.",
  "Check-in opens on the day of arrival.": "يُتاح تسجيل الوصول في يوم الوصول.",
  "This stay has a pickup. Complete it with the owner's handover code.":
    "هذه الإقامة تشمل استلامًا. أكمله باستخدام رمز التسليم الخاص بالمالك.",
  "This booking has just changed.": "تغيّر هذا الحجز للتو.",
  "This trip has already started or finished.": "هذه الرحلة بدأت أو انتهت بالفعل.",
  "This trip is not due yet.": "لم يحن موعد هذه الرحلة بعد.",
  "This trip has just changed.": "تغيّرت هذه الرحلة للتو.",
  "Start the trip before completing it.": "ابدأ الرحلة قبل إنهائها.",
  "Too many incorrect codes. Contact PetMate support to complete this handover.":
    "رموز خاطئة كثيرة. تواصل مع دعم PetMate لإتمام هذا التسليم.",
  "That code is not correct. Ask the owner to read it from their booking page.":
    "هذا الرمز غير صحيح. اطلب من المالك قراءته من صفحة الحجز.",
  "This trip has already been completed.": "اكتملت هذه الرحلة بالفعل.",
  "This session has already been recorded.": "سُجّلت هذه الجلسة بالفعل.",
  "This booking is not active.": "هذا الحجز غير نشط.",
  "This session has not happened yet.": "لم تُعقد هذه الجلسة بعد.",
  "This session has just been recorded.": "سُجّلت هذه الجلسة للتو.",
  "Only a booking that is in progress can be completed.": "لا يمكن إكمال إلا حجز جارٍ.",
  "This booking has a drop-off. Complete it with the owner's handover code.":
    "هذا الحجز يشمل توصيلًا. أكمله باستخدام رمز التسليم الخاص بالمالك.",
  "Record every session before closing the programme.": "سجّل كل الجلسات قبل إغلاق البرنامج.",
  "Only a confirmed booking can be marked as a no-show.": "لا يمكن تسجيل عدم الحضور إلا لحجز مؤكّد.",
  "Wait until at least two hours after the start time.": "انتظر ساعتين على الأقل بعد موعد البدء.",
  "Updates can only be posted to an active booking.": "لا يمكن نشر التحديثات إلا على حجز نشط.",
  "Upload the photo as a care update photo.": "ارفع الصورة كصورة تحديث رعاية.",

  // Errors from running a provider
  "You have reached the limit of pet care businesses per account.":
    "وصلت إلى الحد الأقصى لأنشطة رعاية الحيوانات في الحساب الواحد.",
  "{count} of these rooms are already booked on one night. Capacity cannot go below that.":
    "{count} من هذه الغرف محجوزة بالفعل في ليلة واحدة. لا يمكن أن تقل السعة عن ذلك.",
  "A provider can list up to 30 room types.": "يمكن لمقدّم الخدمة إضافة 30 نوعًا من الغرف كحد أقصى.",
  "A provider can list up to 30 programmes.": "يمكن لمقدّم الخدمة إضافة 30 برنامجًا كحد أقصى.",
  "We could not find a PetMate account with that email or handle.":
    "لم نعثر على حساب PetMate بهذا البريد الإلكتروني أو اسم المستخدم.",
  "That account already owns this business.": "هذا الحساب يملك هذا النشاط بالفعل.",
  "The owner cannot be removed.": "لا يمكن إزالة المالك.",
  "This is your own business.": "هذا نشاطك الخاص.",

  // Subjects of "{what} could not be found."
  "That provider": "مقدّم الخدمة هذا",
  "That room type": "نوع الغرفة هذا",
  "That programme": "هذا البرنامج",
  "That booking": "هذا الحجز",
  "That trip": "هذه الرحلة",
  "That session": "هذه الجلسة",
  "That team member": "عضو الفريق هذا",
};
