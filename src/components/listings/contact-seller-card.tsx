"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { MessageSquare, Lock, ShieldCheck, FileText } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, Alert } from "@/components/ui/primitives";
import { Field, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { FavoriteButton } from "./favorite-button";
import { AdoptionApplicationForm } from "./adoption-application-form";
import { goToPayment } from "@/lib/payment-redirect";
import { api, ApiError } from "@/lib/api-client";
import { uuid } from "@/lib/api-idempotency";

interface ListingSummary {
  id: string;
  slug: string;
  intent: string;
  status: string;
  priceLabel: string;
  negotiable: boolean;
  currency: string;
  petName: string;
  sellerId: string;
  sellerName: string;
  questions: { id: string; prompt: string; required: boolean }[];
}

/**
 * The action rail.
 *
 * Deliberately different per intent, because the three journeys are different:
 * a sale ends in escrow, an adoption ends in an application, and a breeding
 * listing ends in a compatibility check. One generic "Contact seller" button
 * would flatten all three into the worst of them.
 */
export function ContactSellerCard({
  listing,
  viewer,
  favorited,
}: {
  listing: ListingSummary;
  viewer: { id: string; emailVerified: boolean; name: string } | null;
  favorited: boolean;
}) {
  const router = useRouter();

  const [messageOpen, setMessageOpen] = useState(false);
  const [applyOpen, setApplyOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [buying, setBuying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isOwner = viewer?.id === listing.sellerId;
  const available = listing.status === "ACTIVE";

  function requireAuth(next: string): boolean {
    if (viewer) return true;
    router.push(`/login?next=${encodeURIComponent(next)}`);
    return false;
  }

  async function sendMessage() {
    setSending(true);
    setError(null);

    try {
      const { conversationId } = await api.post<{ conversationId: string }>(
        `/api/listings/${listing.id}`,
        { action: "contact", message: message.trim() },
      );
      setMessageOpen(false);
      router.push(`/messages/${conversationId}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "We could not send that message.");
    } finally {
      setSending(false);
    }
  }

  async function startPurchase() {
    if (!requireAuth(`/pets/${listing.slug}`)) return;

    setBuying(true);
    setError(null);

    try {
      const result = await api.post<{
        order: { id: string };
        payment: { redirectUrl: string | null; clientSecret: string | null; sandbox: boolean; id: string };
      }>(`/api/listings/${listing.id}`, {
        action: "buy",
        // A stable key per attempt: a double click cannot create two orders.
        idempotencyKey: uuid(),
      });

      if (result.payment.redirectUrl) {
        goToPayment(result.payment.redirectUrl, router.push);
      } else {
        router.push(`/checkout/${result.payment.id}`);
      }
    } catch (err) {
      if (err instanceof ApiError && err.isAuth) {
        router.push(`/login?next=/pets/${listing.slug}`);
        return;
      }
      setError(err instanceof ApiError ? err.message : "We could not start that purchase.");
      setBuying(false);
    }
  }

  return (
    <>
      <Card className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wider text-fg-subtle">
              {listing.intent === "SALE"
                ? "Price"
                : listing.intent === "ADOPTION"
                  ? "Adoption fee"
                  : "Stud fee"}
            </p>
            <p className="mt-1 font-display text-3xl font-semibold tabular text-fg">
              {listing.priceLabel}
            </p>
            {listing.negotiable && (
              <p className="mt-1 text-xs text-fg-muted">Open to offers</p>
            )}
          </div>
          <FavoriteButton listingId={listing.id} initial={favorited} />
        </div>

        {isOwner ? (
          <div className="mt-5 space-y-2">
            <Alert tone="info">This is your listing.</Alert>
            <ButtonLink href={`/dashboard/listings/${listing.id}`} fullWidth variant="outline">
              Manage listing
            </ButtonLink>
          </div>
        ) : !available ? (
          <div className="mt-5 space-y-3">
            <Alert tone="warning" title="No longer available">
              {listing.status === "RESERVED"
                ? `${listing.petName} is reserved while a purchase completes.`
                : "This listing has closed."}
            </Alert>
            <ButtonLink href="/pets" variant="outline" fullWidth>
              Browse similar pets
            </ButtonLink>
          </div>
        ) : (
          <div className="mt-5 space-y-2.5">
            {listing.intent === "SALE" && (
              <Button fullWidth size="lg" onClick={() => void startPurchase()} loading={buying} loadingText="Starting…">
                <Lock className="size-4" aria-hidden />
                Buy with escrow protection
              </Button>
            )}

            {listing.intent === "ADOPTION" && (
              <Button
                fullWidth
                size="lg"
                onClick={() => {
                  if (!requireAuth(`/pets/${listing.slug}`)) return;
                  setApplyOpen(true);
                }}
              >
                <FileText className="size-4" aria-hidden />
                Apply to adopt
              </Button>
            )}

            {listing.intent === "BREEDING" && (
              <ButtonLink href="/dashboard/breeding" fullWidth size="lg">
                Check compatibility
              </ButtonLink>
            )}

            <Button
              fullWidth
              variant={listing.intent === "SALE" ? "outline" : "secondary"}
              onClick={() => {
                if (!requireAuth(`/pets/${listing.slug}`)) return;
                setMessageOpen(true);
              }}
            >
              <MessageSquare className="size-4" aria-hidden />
              Message {listing.sellerName.split(" ")[0]}
            </Button>
          </div>
        )}

        {error && (
          <p className="mt-3 text-sm font-medium text-[var(--danger)]" role="alert">
            {error}
          </p>
        )}

        {listing.intent === "SALE" && available && !isOwner && (
          <div className="mt-5 space-y-2.5 border-t border-[var(--border)] pt-4">
            <p className="flex items-start gap-2 text-xs leading-relaxed text-fg-muted">
              <Lock className="mt-0.5 size-3.5 shrink-0 text-[var(--success)]" aria-hidden />
              Your payment is held by PetMate. The seller is only paid once you have met{" "}
              {listing.petName} and you both confirm the handover.
            </p>
            <p className="flex items-start gap-2 text-xs leading-relaxed text-fg-muted">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-[var(--success)]" aria-hidden />
              If the animal is not as described, open a dispute and the money stays put until a
              human reviews it.
            </p>
          </div>
        )}

        {viewer && !viewer.emailVerified && (
          <Alert tone="warning" className="mt-4">
            Confirm your email address to message sellers and make purchases.{" "}
            <Link href="/settings" className="font-semibold underline">
              Resend the link
            </Link>
          </Alert>
        )}
      </Card>

      <Modal
        open={messageOpen}
        onClose={() => setMessageOpen(false)}
        title={`Message ${listing.sellerName}`}
        description={`About ${listing.petName}. Keep the conversation here — it is what lets us help if something goes wrong.`}
      >
        <div className="space-y-4">
          <Field
            label="Your message"
            hint="Ask about temperament, health history, or arranging a visit."
            error={error}
            trailing={`${message.length}/2000`}
          >
            {({ id, describedBy, invalid }) => (
              <Textarea
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                rows={5}
                maxLength={2000}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={`Hi, I am interested in ${listing.petName}. Could you tell me more about how they are with other animals, and whether I could visit this week?`}
              />
            )}
          </Field>

          <p className="text-xs text-fg-subtle">
            Never share your phone number, address or payment details in a first message.
          </p>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setMessageOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => void sendMessage()}
              loading={sending}
              loadingText="Sending…"
              disabled={message.trim().length < 10}
            >
              Send message
            </Button>
          </div>
        </div>
      </Modal>

      <AdoptionApplicationForm
        open={applyOpen}
        onClose={() => setApplyOpen(false)}
        listingId={listing.id}
        petName={listing.petName}
        questions={listing.questions}
      />
    </>
  );
}
