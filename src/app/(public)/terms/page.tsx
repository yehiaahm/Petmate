import type { Metadata } from "next";
import { LegalPage, type LegalSection } from "@/components/legal/legal-page";
import { getSettings } from "@/lib/settings";
import { bpsToPercent } from "@/lib/money";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
  title: t("Terms of service"),
  description: t("The rules for using PetMate: accounts, listings, transactions, escrow and disputes."),
  alternates: { canonical: "/terms" },
};
}

export const revalidate = 3600;

export default async function TermsPage() {
  const { t, fmt } = await getI18n();
  const settings = await getSettings();
  const escrowDays = Math.round(settings.escrowAutoReleaseHours / 24);

  const sections: LegalSection[] = [
    {
      heading: "Who we are and what this covers",
      paragraphs: [
        "PetMate is a marketplace and record-keeping service for pets. We connect buyers, adopters, breeders, veterinary clinics and shops, and we provide the payment, escrow and dispute infrastructure those transactions run on.",
        "PetMate is not a party to the transactions between members. We do not own, breed, sell, house or transport animals. We hold funds in escrow and adjudicate disputes, but the underlying agreement is between the two members.",
        "By creating an account you agree to these terms. If you do not, do not use the service.",
      ],
    },
    {
      heading: "Your account",
      paragraphs: [
        "You must be old enough to enter a binding contract where you live. One person, one account. You are responsible for everything done through your account and for keeping your password to yourself.",
        "The information on your profile must be accurate. Impersonating another person, a clinic, or a business is grounds for immediate closure.",
        "You may close your account at any time. Transactions still in progress must be completed or cancelled first, because closing an account with money in escrow would leave the other party stranded.",
      ],
    },
    {
      heading: "Listing an animal",
      paragraphs: [
        "You may only list an animal you legally own and are entitled to sell or rehome. Listings must be accurate about the animal's age, health, breed and history.",
        "The following are not permitted, and are removed on sight:",
        [
          "Animals that are illegal to sell or keep where you or the buyer are",
          "Animals below the legal minimum age for separation from their mother",
          "Protected or endangered species without the documentation the law requires",
          "Animals bred or kept in conditions that breach animal welfare law",
          "Listings that conceal a known health condition",
          "Contact details or payment instructions in the listing text",
        ],
        "We review listings before publication where our checks indicate a risk, and always above a value threshold. Review is not an endorsement and does not transfer responsibility for the listing to us.",
      ],
    },
    {
      heading: "Buying, escrow and completion",
      paragraphs: [
        t("When you buy an animal through PetMate, your payment is held in escrow. It is released to the seller when both parties confirm the handover, or automatically after {days} days if no dispute is opened.", { days: escrowDays }),
        "You are expected to see the animal in person before confirming. Confirming handover releases the money and is not reversible except through the dispute process.",
        "Ownership of the animal's PetMate record transfers with the transaction. The health history, documents and lineage go to the new owner.",
        "Prices shown are what you pay. We do not add a buyer fee at checkout.",
      ],
    },
    {
      heading: "Fees",
      paragraphs: [
        "PetMate charges the seller a commission on completed transactions. Current rates:",
        [
          t("Pet sales: {percent}", { percent: bpsToPercent(settings.commissionPetSaleBps) }),
          t("Products: {percent}", { percent: bpsToPercent(settings.commissionProductBps) }),
          t("Veterinary bookings: {percent}", { percent: bpsToPercent(settings.commissionAppointmentBps) }),
          t("Paid breeding arrangements: {percent}", { percent: bpsToPercent(settings.commissionBreedingBps) }),
        ],
        "Adoption is free and we take no commission on an adoption fee. Subscriptions, featured placements and advertising are optional and always labelled as paid.",
        "Commission is charged on completion. If a transaction is cancelled or refunded, the commission is reversed with it.",
      ],
    },
    {
      heading: "Disputes and refunds",
      paragraphs: [
        t("Either party may open a dispute within {days} days of completion. Funds still in escrow are frozen while a dispute is open.", { days: settings.disputeWindowDays }),
        "Both sides may submit evidence. We review it and decide: full refund, partial refund, or release to the seller. Our decision is final for the purposes of funds we hold; it does not affect either party's separate legal rights.",
        "Deliberately false claims in a dispute are grounds for account closure.",
      ],
    },
    {
      heading: "Health records",
      paragraphs: [
        "Health records are informational. PetMate is not a veterinary provider, does not verify the clinical accuracy of records, and nothing in the product is veterinary advice.",
        "Entries written by a verified clinic through its own account are marked as such. Entries added by an owner are marked self-reported. Neither is a guarantee of an animal's health.",
        "The health score measures how well documented an animal is. It is not a measure of the animal's wellbeing and must not be presented as one.",
      ],
    },
    {
      heading: "Breeding",
      paragraphs: [
        "Compatibility scores come from a deterministic rule engine using the data on PetMate. They are a starting point for a conversation, not veterinary or genetic advice.",
        "You are responsible for complying with the breeding laws and licensing requirements where you live. We block pairings that are obviously irresponsible — too young, neutered, or closely related on our records — but the absence of a block is not approval.",
      ],
    },
    {
      heading: "Prohibited conduct",
      paragraphs: [
        "You may not:",
        [
          "Arrange payment outside PetMate for a transaction that started on it",
          "Harass, threaten or abuse another member",
          "Post false reviews, or reviews for a transaction you were not part of",
          "Scrape, reverse engineer or overload the service",
          "Use PetMate to launder money or evade sanctions",
          "Create a new account to evade a suspension",
        ],
      ],
    },
    {
      heading: "Suspension and closure",
      paragraphs: [
        "We may suspend or close an account that breaches these terms, that presents a fraud risk, or where we are required to by law. Where we can, we tell you why and how to appeal.",
        "Money legitimately owed to you is not forfeited by a suspension. Funds may be held while an investigation runs.",
      ],
    },
    {
      heading: "Liability",
      paragraphs: [
        "PetMate provides the platform. We are not liable for the condition, health, temperament, legality or provenance of any animal or item traded through it, nor for the conduct of members.",
        "To the extent the law allows, our liability for any claim relating to a transaction is limited to the fees we earned on that transaction.",
        "Nothing here limits liability for death or personal injury caused by negligence, for fraud, or for anything else that cannot lawfully be limited.",
      ],
    },
    {
      heading: "Changes to these terms",
      paragraphs: [
        "We may update these terms. Material changes are notified in the product before they take effect. Continuing to use PetMate after that means you accept them.",
      ],
    },
  ];

  return (
    <LegalPage
      title={t("Terms of service")}
      updated={fmt.date("2026-09-20T12:00:00Z", "long")}
      intro="These terms describe how PetMate works and what we each commit to. They are written to be read, not to be impenetrable."
      sections={sections}
    />
  );
}
