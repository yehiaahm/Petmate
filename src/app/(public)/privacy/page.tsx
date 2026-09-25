import type { Metadata } from "next";
import { LegalPage, type LegalSection } from "@/components/legal/legal-page";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
  title: t("Privacy policy"),
  description:
    t("What PetMate collects, why, who can see it, how long we keep it, and how to get it deleted."),
  alternates: { canonical: "/privacy" },
};
}

const sections: LegalSection[] = [
  {
    heading: "What we collect",
    paragraphs: [
      "Information you give us:",
      [
        "Account details: name, email address, password (stored only as a scrypt hash, never in plain text)",
        "Profile: handle, photo, bio, city and country, phone number if you add one",
        "Pet records: species, breed, age, photos, health entries, documents, microchip number",
        "Transactions: what you bought or sold, delivery address, invoices",
        "Messages you send to other members",
        "Verification documents, if you choose to get verified",
      ],
      "Information we generate:",
      [
        "Trust signals and the score derived from them",
        "Health documentation scores derived from your pet's records",
        "Risk signals on listings and messages",
        "Audit logs of security-relevant actions on your account",
        "First-party analytics: which pages were viewed and which actions completed",
      ],
      "Information from your device: IP address, browser user agent, and approximate location only if you explicitly grant it for a distance search.",
    ],
  },
  {
    heading: "Why we process it",
    paragraphs: [
      "To provide the service: showing listings, delivering messages, taking payments, holding escrow, booking appointments, keeping health records.",
      "To keep it safe: detecting fraud, reviewing listings, investigating reports and disputes, enforcing suspensions.",
      "To meet legal obligations: tax and accounting records, responding to lawful requests.",
      "To improve the product: understanding which parts are used and where people get stuck, using our own analytics rather than a third-party tracker.",
    ],
  },
  {
    heading: "Who can see what",
    paragraphs: [
      "Public: your name, handle, photo, bio, city, country, trust score, verification badges, your active listings, and reviews you have written or received.",
      "Not public: your email address, phone number, exact address, delivery addresses, payment history, messages, your pets' full health records, microchip numbers, and any verification document you upload.",
      "A buyer sees a coarse health summary on a listing — whether the animal is vaccinated and how many entries a clinic verified — not the full medical file. The full record transfers only when ownership does.",
      "Clinic staff can see the health record of an animal their clinic has actually treated, and only that one.",
    ],
  },
  {
    heading: "Who we share it with",
    paragraphs: [
      "Payment providers, to process payments. Card details are entered on the provider's own form and never reach PetMate's servers.",
      "Email delivery providers, to send transactional email.",
      "Hosting and infrastructure providers, who store the data on our behalf under contract.",
      "Law enforcement or regulators where we are legally required to, or where there is a serious risk to a person or an animal.",
      "We do not sell personal data, and we do not share it with advertisers.",
    ],
  },
  {
    heading: "How long we keep it",
    paragraphs: [
      "Account and profile data: while your account is open.",
      "Transaction and invoice records: as long as tax and accounting law requires, typically several years, even after an account closes.",
      "Messages: while both participants have the conversation, and in backups for a limited window after.",
      "Audit logs: retained for security investigation.",
      "Raw analytics events: pruned after 180 days.",
      "Login attempts and expired sessions: pruned after 30 days.",
    ],
  },
  {
    heading: "Deleting your account",
    paragraphs: [
      "You can close your account from Settings. Transactions still in progress must be resolved first.",
      "On closure we anonymise your personal data: your name becomes 'Deleted member', your email is replaced with a non-routable placeholder, and your photo, bio, phone number and location are removed. Active listings are withdrawn.",
      "What survives: the other side of completed transactions, invoices we are legally required to keep, and audit entries. Reviews you left remain, attributed to a deleted member, because removing them would distort the record for the people they were about.",
      "Your pets' records follow the animal. If you transferred a pet, the record stays with the new owner.",
    ],
  },
  {
    heading: "Your rights",
    paragraphs: [
      "Depending on where you live you may have the right to access, correct, export, delete or restrict the processing of your data, and to object to it.",
      "Most of this is self-service in Settings. For anything else, contact support and we will respond within the period the law requires.",
    ],
  },
  {
    heading: "Security",
    paragraphs: [
      "Passwords are hashed with scrypt using OWASP-recommended parameters and are never stored or logged in plain text.",
      "Session tokens are stored as hashes, so a database leak does not hand anyone a working session.",
      "Delivery confirmation codes are stored hashed and are never shown to anyone but the recipient.",
      "Access to health records, messages and orders is checked per record against the caller's identity, not only against their role.",
      "No system is perfectly secure. If you find a vulnerability, tell us and we will treat the report seriously.",
    ],
  },
  {
    heading: "Cookies",
    paragraphs: [
      "Without asking, we use only these: a session cookie that keeps you signed in, a CSRF token that stops another site submitting forms as you, a cookie that remembers the language you chose, and one that remembers your cookie choice. The service needs them to work as you set it up.",
      "Sponsored placements on PetMate are chosen by the page they appear on, never by who is looking. To count an ad once per visitor we use a one-way hash of the CSRF token, kept for at most 30 minutes and never linked to your account.",
      "Analytics cookies from Google Analytics and the Meta Pixel are used only if you allow them in the cookie choice, to measure which of our adverts bring people to PetMate. They receive the pages you visit and, for purchases, the amount and an order reference; never your name, email, phone number or address. You can change your choice at any time from \"Cookie settings\" at the bottom of every page.",
      "Errors that happen on our servers or in your browser are reported to our error-monitoring service (Sentry) with the technical details needed to fix them. Passwords, tokens, cookies and contact details are removed before anything is sent.",
    ],
  },
  {
    heading: "Children",
    paragraphs: [
      "PetMate is not for children. We do not knowingly collect data from anyone below the age of contractual capacity where they live. If you believe a child has an account, tell us and we will remove it.",
    ],
  },
];

export default async function PrivacyPage() {
  const { t, fmt } = await getI18n();
  return (
    <LegalPage
      title={t("Privacy policy")}
      updated={fmt.date("2026-09-20T12:00:00Z", "long")}
      intro="This explains what PetMate collects, why, and what control you have. It is written to be specific: where we say 'not public', that is enforced in code, not policy."
      sections={sections}
    />
  );
}
