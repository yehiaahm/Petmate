import type { Metadata } from "next";
import {
  Lock,
  BadgeCheck,
  ShieldCheck,
  Flag,
  Scale,
  AlertTriangle,
  Eye,
  FileHeart,
} from "lucide-react";
import { getSettings } from "@/lib/settings";
import { Card, Badge, Alert } from "@/components/ui/primitives";
import { ButtonLink } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Trust & safety",
  description:
    "How PetMate protects buyers, sellers and animals: escrow on every purchase, clinic-verified health records, explainable trust scores, and a dispute process with a human at the end of it.",
  alternates: { canonical: "/trust" },
};

export const revalidate = 3600;

export default async function TrustPage() {
  const settings = await getSettings();
  const escrowDays = Math.round(settings.escrowAutoReleaseHours / 24);

  return (
    <div className="container-page py-12 lg:py-16">
      <div className="mx-auto max-w-2xl text-center">
        <Badge tone="brand">Trust &amp; safety</Badge>
        <h1 className="mt-4 font-display text-4xl font-semibold tracking-tight text-fg sm:text-5xl">
          How we make this safe
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-fg-muted">
          Buying an animal from a stranger is one of the least protected transactions most people
          ever make. These are the specific mechanisms that change that — and their limits.
        </p>
      </div>

      <section className="mx-auto mt-14 max-w-3xl space-y-4">
        {[
          {
            icon: Lock,
            title: "Your money is held, not sent",
            body: (
              <>
                <p>
                  When you buy a pet through PetMate, your payment goes into escrow — an account we
                  hold, not the seller&rsquo;s. The seller can see that it has been paid, which is
                  what makes them willing to hold the animal for you, but they cannot touch it.
                </p>
                <p>
                  The money is released when you and the seller both confirm the handover, or
                  automatically after {escrowDays} days if neither of you disputes. If you open a
                  dispute, it stays frozen until a person reviews it.
                </p>
              </>
            ),
          },
          {
            icon: FileHeart,
            title: "Health records with a signature on them",
            body: (
              <>
                <p>
                  Every health entry says who wrote it. A vaccination recorded by a clinic through
                  its own PetMate account is marked <strong>clinic verified</strong>. One typed in
                  by an owner is marked <strong>self-reported</strong>, everywhere it appears, with
                  no softer wording.
                </p>
                <p>
                  An owner cannot edit or delete a clinic&rsquo;s entry. That is the whole reason
                  the badge means anything.
                </p>
              </>
            ),
          },
          {
            icon: ShieldCheck,
            title: "Trust scores you can interrogate",
            body: (
              <>
                <p>
                  A trust score is the sum of individual signals: a confirmed email, a verified ID,
                  completed sales, reviews tied to real transactions. Every member can see exactly
                  which signals earned their score and what would raise it.
                </p>
                <p>
                  Repeatable signals are capped, so nobody can farm a high score with a hundred
                  token-price sales. Penalties are not capped.
                </p>
              </>
            ),
          },
          {
            icon: Eye,
            title: "Listings are checked before they go live",
            body: (
              <>
                <p>
                  Every listing is scored against the patterns that actually appear in pet scams:
                  contact details pushed into the description, untraceable payment methods,
                  advance-fee framing, prices far below the market, or a brand-new account listing
                  an expensive animal.
                </p>
                <p>
                  A high score does not remove anything automatically — it routes the listing to a
                  human. High-value listings always go through review.
                </p>
              </>
            ),
          },
          {
            icon: Scale,
            title: "Disputes end with a person, not a policy page",
            body: (
              <>
                <p>
                  You have {settings.disputeWindowDays} days after completion to open a dispute.
                  Both sides submit evidence, and the money does not move while it is open.
                </p>
                <p>
                  Outcomes can be a full refund, a partial refund, or release to the seller.
                  Whoever is found at fault takes a trust penalty, which is visible in their score
                  going forward.
                </p>
              </>
            ),
          },
          {
            icon: Flag,
            title: "Reporting that goes somewhere",
            body: (
              <>
                <p>
                  Anything on PetMate can be reported. Animal welfare concerns and suspected fraud
                  jump the queue. Several independent reports on one listing pull it out of
                  circulation pending review rather than waiting for a moderator to be at a desk.
                </p>
                <p>You are told the outcome. Silence is what makes people stop reporting.</p>
              </>
            ),
          },
        ].map((item) => (
          <Card key={item.title} className="p-6">
            <div className="flex gap-4">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand-soft-fg">
                <item.icon className="size-5" aria-hidden />
              </span>
              <div className="min-w-0">
                <h2 className="font-display text-lg font-semibold text-fg">{item.title}</h2>
                <div className="mt-2 space-y-2 text-[15px] leading-relaxed text-fg-muted">
                  {item.body}
                </div>
              </div>
            </div>
          </Card>
        ))}
      </section>

      <section className="mx-auto mt-14 max-w-3xl">
        <Alert tone="danger" title="What we cannot protect" icon={<AlertTriangle className="size-4" aria-hidden />}>
          <div className="mt-1 space-y-2">
            <p>
              None of the above applies to a payment made outside PetMate. If you send a bank
              transfer, hand over cash before seeing the animal, or pay by gift card or crypto,
              there is no escrow to freeze and no transaction for us to reverse.
            </p>
            <p>
              Anyone who asks you to move the conversation to WhatsApp or Telegram, pay a
              &ldquo;shipping agent&rdquo;, or send a deposit before you have seen the pet is
              running the oldest scam in this market. We flag those messages automatically, but the
              only complete protection is not doing it.
            </p>
          </div>
        </Alert>
      </section>

      <section className="mx-auto mt-14 max-w-3xl">
        <h2 className="font-display text-2xl font-semibold tracking-tight text-fg">
          Before you meet
        </h2>
        <ul className="mt-4 space-y-2.5">
          {[
            "Ask to see the animal with its mother, if it is young enough for that to be possible.",
            "Check the health record on PetMate for clinic-verified entries, not just the seller's word.",
            "Ask for the microchip number and confirm it matches the paperwork when you meet.",
            "Visit in person before paying. A seller unwilling to be visited is telling you something.",
            "Keep every message on PetMate, so there is a record if something goes wrong.",
          ].map((tip) => (
            <li key={tip} className="flex items-start gap-2.5 text-[15px] text-fg-muted">
              <BadgeCheck className="mt-0.5 size-4 shrink-0 text-[var(--success)]" aria-hidden />
              {tip}
            </li>
          ))}
        </ul>
      </section>

      <section className="mx-auto mt-14 max-w-2xl text-center">
        <h2 className="font-display text-2xl font-semibold tracking-tight text-fg">
          Something wrong?
        </h2>
        <p className="mt-2 text-[15px] text-fg-muted">
          Report it from any listing, profile or message. If an animal is at risk, say so — those
          reports go to the front of the queue.
        </p>
        <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
          <ButtonLink href="/support">Contact support</ButtonLink>
          <ButtonLink href="/pets" variant="outline">
            Browse pets
          </ButtonLink>
        </div>
      </section>
    </div>
  );
}
