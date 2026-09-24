import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { CreditCard } from "lucide-react";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth/rbac";
import { isSandboxPayments } from "@/lib/payments/provider";
import { formatMoney } from "@/lib/money";
import { Card, Alert, DataRow } from "@/components/ui/primitives";
import { ButtonLink } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Checkout",
  robots: { index: false, follow: false },
};

/**
 * Card checkout.
 *
 * When Stripe is configured the client secret is handed to Stripe Elements on
 * this page. Elements is not bundled unless a key exists, so a deployment
 * without one does not ship an unused payment SDK — and this page explains the
 * state rather than showing an empty card form that can never work.
 */
export default async function CheckoutPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireAuth();

  const intent = await db.paymentIntent.findFirst({
    where: { id, userId: auth.user.id },
    select: {
      id: true,
      status: true,
      amountCents: true,
      currency: true,
      purpose: true,
      provider: true,
      providerRef: true,
      referenceId: true,
    },
  });

  if (!intent) notFound();

  // The sandbox has its own screen; never show a card form for it.
  if (isSandboxPayments() && intent.providerRef) {
    redirect(`/checkout/sandbox?ref=${encodeURIComponent(intent.providerRef)}`);
  }

  if (intent.status === "SUCCEEDED") {
    return (
      <div className="container-page max-w-lg py-12">
        <Card className="p-6 text-center">
          <h1 className="font-display text-xl font-semibold text-fg">Already paid</h1>
          <p className="mt-2 text-sm text-fg-muted">
            {formatMoney(intent.amountCents, intent.currency)} has been received.
          </p>
          <div className="mt-5">
            <ButtonLink href="/dashboard" fullWidth>
              Back to dashboard
            </ButtonLink>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="container-page max-w-lg py-12">
      <Card className="p-6">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-brand-soft text-brand-soft-fg">
            <CreditCard className="size-5" aria-hidden />
          </span>
          <div>
            <h1 className="font-display text-xl font-semibold text-fg">Complete payment</h1>
            <p className="text-sm text-fg-muted">Secured by {intent.provider}.</p>
          </div>
        </div>

        <dl className="mt-5 divide-y divide-[var(--border)] border-y border-[var(--border)]">
          <DataRow
            label="Amount"
            value={
              <span className="font-display text-lg font-semibold">
                {formatMoney(intent.amountCents, intent.currency)}
              </span>
            }
          />
          <DataRow label="Status" value={intent.status.replace("_", " ").toLowerCase()} />
        </dl>

        <div className="mt-5">
          <Alert tone="info" title="Finishing this payment">
            Card entry is handled by the payment provider so card details never touch PetMate&rsquo;s
            servers. Follow the provider&rsquo;s prompt to complete it; this page updates as soon as
            the provider confirms.
          </Alert>
        </div>

        <div className="mt-5">
          <ButtonLink href="/dashboard" variant="outline" fullWidth>
            Back to dashboard
          </ButtonLink>
        </div>
      </Card>
    </div>
  );
}
