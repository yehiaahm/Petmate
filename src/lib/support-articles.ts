import type { HelpArticle } from "@/components/support/help-articles";

/**
 * Help centre content.
 *
 * Kept as data rather than markup so the same corpus can be rendered as a
 * page, injected into the assistant's context, and emitted as FAQPage
 * structured data without three copies drifting apart.
 */
export const HELP_ARTICLES: HelpArticle[] = [
  {
    id: "escrow-how",
    category: "Payments",
    question: "How does escrow work when I buy a pet?",
    answer: [
      "Your payment goes to a PetMate-held account, not the seller's. The seller can see it has cleared — which is what makes them willing to hold the animal — but cannot withdraw it.",
      "The money moves to the seller when you confirm the handover, or automatically after the auto-release window if nobody opens a dispute. Opening a dispute freezes it until a person reviews the case.",
      "Ownership of the pet's PetMate record transfers in the same transaction that releases the money. The two cannot come apart.",
    ],
  },
  {
    id: "escrow-not-released",
    category: "Payments",
    question: "I confirmed the handover but the seller says they have not been paid",
    answer: [
      "Escrow releases when both sides confirm, so if only you have confirmed, the funds are still held. The order page shows exactly which confirmations are in.",
      "If the seller has confirmed and you have not, nothing moves until you do or the auto-release window elapses.",
      "Released funds land in the seller's PetMate balance, not their bank account. Getting them to a bank is a separate payout, which takes its own processing time.",
    ],
  },
  {
    id: "refund",
    category: "Payments",
    question: "How do I get a refund?",
    answer: [
      "If the money is still in escrow, open a dispute from the order. Funds are frozen while it is open and can be returned in full.",
      "If escrow has already released, you can still open a dispute within the dispute window. A refund then comes out of the seller's balance, and the platform commission is reversed with it.",
      "We cannot refund a payment made outside PetMate. There is no transaction for us to reverse.",
    ],
  },
  {
    id: "payment-methods",
    category: "Payments",
    question: "Why can I not pay by bank transfer?",
    answer: [
      "Bank transfer, cash, gift cards and crypto give you no recourse, and they are the payment methods every pet scam steers toward. Accepting them would mean advertising buyer protection we could not actually provide.",
      "Any seller who asks you to pay that way is breaking our rules. Report them from the listing.",
    ],
  },
  {
    id: "commission",
    category: "Payments",
    question: "What does PetMate charge?",
    answer: [
      "Buyers pay the listed price. There is no buyer fee at checkout.",
      "Sellers pay a commission on completed transactions, which varies by category and is shown on the pricing page and in the seller console before you list.",
      "Adoption is free. We take no commission on an adoption fee.",
    ],
  },
  {
    id: "verify-account",
    category: "Account",
    question: "How do I get verified?",
    answer: [
      "Settings → Verification. Email verification is instant. ID verification needs a government document, and business or clinic verification needs a registration number.",
      "Verification raises your trust score, unlocks higher-value listings, and puts a badge on your profile that buyers filter for.",
      "Documents you upload are visible only to the reviewers who process them, never to other members.",
    ],
  },
  {
    id: "trust-score",
    category: "Account",
    question: "How is my trust score calculated?",
    answer: [
      "It is the sum of individual signals: confirmed email, verified ID, completed transactions, reviews tied to real purchases, clinic-verified records on your pets.",
      "Your dashboard lists every signal that earned you points and what would raise the score. Nothing about it is a black box.",
      "Repeatable signals are capped, so a hundred trivial sales cannot manufacture a high score. Penalties from upheld reports and lost disputes are not capped.",
    ],
  },
  {
    id: "cannot-sign-in",
    category: "Account",
    question: "I cannot sign in",
    answer: [
      "Use the forgot-password link. The reset email arrives within a minute, expires in an hour, and can be used once.",
      "Too many failed attempts locks sign-in for a short period. Waiting it out is faster than trying again.",
      "If the address itself is wrong or you no longer have access to it, send us a message from this page — a signed-out visitor can open a ticket, which is exactly what this case needs.",
    ],
  },
  {
    id: "delete-account",
    category: "Account",
    question: "How do I delete my account?",
    answer: [
      "Settings → Account → Close account. Transactions in progress must be resolved first, otherwise the other party would be left with money in escrow and nobody to resolve it with.",
      "Closing anonymises your personal data. Invoices and the other side of completed transactions are kept because tax law requires it.",
      "Your pets' records follow the animal, not the account. Transfer them first if someone else should have them.",
    ],
  },
  {
    id: "listing-review",
    category: "Listings",
    question: "Why is my listing under review?",
    answer: [
      "Listings are scored against the patterns that appear in pet scams: contact details in the description, off-platform payment terms, prices far below market, or a new account listing a high-value animal.",
      "A high score routes the listing to a human rather than removing it. High-value listings always go through review.",
      "Review usually completes within a few hours. You are told the outcome either way.",
    ],
  },
  {
    id: "listing-rejected",
    category: "Listings",
    question: "My listing was removed",
    answer: [
      "The notification says which rule it hit. The most common are an animal below the legal minimum separation age, contact details in the description, and a species that cannot lawfully be sold in the buyer's country.",
      "Fix the cause and resubmit. Repeated removals for the same reason affect your trust score.",
    ],
  },
  {
    id: "health-records",
    category: "Pets & health",
    question: "What is the difference between clinic-verified and self-reported?",
    answer: [
      "A clinic-verified entry was written by a veterinary clinic through its own PetMate account. An owner cannot edit or delete it, which is the only reason the badge means anything.",
      "A self-reported entry was typed in by the owner. It is labelled that way everywhere it appears, with no softer wording.",
      "Both are useful. Only one is evidence.",
    ],
  },
  {
    id: "health-score",
    category: "Pets & health",
    question: "What does the health score measure?",
    answer: [
      "How well documented the animal is: vaccinations current, clinic-verified entries present, records recent, history continuous.",
      "It is not a diagnosis and not a measure of the animal's wellbeing. A perfectly healthy animal with no paperwork scores low, and that is the intended behaviour.",
    ],
  },
  {
    id: "transfer-pet",
    category: "Pets & health",
    question: "How do I transfer a pet to a new owner?",
    answer: [
      "A sale through PetMate transfers the record automatically when escrow releases.",
      "For a private handover, use Dashboard → Pets → Transfer. The new owner accepts from their account, and the full health history, documents and lineage go with the animal.",
    ],
  },
  {
    id: "breeding-match",
    category: "Breeding",
    question: "How are breeding matches scored?",
    answer: [
      "A deterministic rule engine weighs breed compatibility, health documentation, age suitability, distance, temperament, verification status and each owner's stated preferences, and shows you the breakdown.",
      "It is a rule engine, not machine learning, and we do not describe it as one. Every number on the screen can be traced to a rule you can read.",
      "Some pairings are blocked outright: different species, same sex, neutered animals, animals below the minimum breeding age, and animals our records show to be closely related.",
    ],
  },
  {
    id: "clinic-join",
    category: "Clinics & shops",
    question: "How does my clinic join PetMate?",
    answer: [
      "Register an account, then apply from the clinics page. We verify the registration number before your profile goes live.",
      "Once verified you get a bookable calendar, and records your vets write carry the clinic-verified badge.",
    ],
  },
  {
    id: "payout",
    category: "Clinics & shops",
    question: "When do I get paid out?",
    answer: [
      "Completed transactions credit your PetMate balance immediately. A payout moves that balance to your bank.",
      "Funds tied to an order still inside its dispute window are shown separately as pending, because a refund would have to come from somewhere.",
    ],
  },
  {
    id: "report",
    category: "Safety",
    question: "How do I report a listing, message or member?",
    answer: [
      "Every listing, profile and message has a report action. Choose animal welfare or fraud if either applies — those jump the queue.",
      "We do not tell the person who reported them. We do tell you the outcome.",
    ],
  },
  {
    id: "scam-signs",
    category: "Safety",
    question: "How do I spot a scam?",
    answer: [
      "The pattern is nearly always the same: the animal is priced well below market, the seller cannot meet in person, and you are asked to pay a shipping agent or send a deposit by an untraceable method.",
      "Anyone pushing you to WhatsApp or Telegram is trying to get the conversation somewhere we cannot see it. We flag those messages, but leaving is your decision.",
      "See the animal before you pay. Keep every message on PetMate.",
    ],
  },
  {
    id: "data",
    category: "Safety",
    question: "Who can see my personal information?",
    answer: [
      "Your name, handle, photo, city, trust score and listings are public. Your email address, phone number, exact address, payment history, messages and verification documents are not.",
      "A buyer sees a coarse health summary on a listing, not the full medical file. The full record transfers only when ownership does.",
    ],
  },
];

export const HELP_CATEGORIES = Array.from(new Set(HELP_ARTICLES.map((a) => a.category)));
