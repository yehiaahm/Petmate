import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { FlaskConical } from "lucide-react";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth/rbac";
import { isSandboxPayments } from "@/lib/payments/provider";
import { formatMoney } from "@/lib/money";
import { safeRedirect } from "@/lib/validation/common";
import { Card, Alert, DataRow } from "@/components/ui/primitives";
import { SandboxConfirm } from "@/components/checkout/sandbox-confirm";

export const metadata: Metadata = {
  title: "Sandbox payment",
  robots: { index: false, follow: false },
};

const PURPOSE_LABEL: Record<string, string> = {
  PET_PURCHASE: "Pet purchase (held in escrow)",
  PRODUCT_ORDER: "Product order",
  APPOINTMENT: "Veterinary appointment",
  SUBSCRIPTION: "Subscription",
  FEATURED_LISTING: "Featured listing",
  AD_CAMPAIGN: "Ad campaign",
  WALLET_TOPUP: "Wallet top-up",
};

/**
 * The sandbox payment screen.
 *
 * This is the internal ledger provider's equivalent of a card form. It is
 * emphatically not pretending to be one: there is no card field, and the page
 * says plainly that no real money moves. Everything downstream of it — escrow,
 * commission, payout, refund — is the real code path, which is the point.
 *
 * It 404s whenever a real gateway is configured.
 */
export default async function SandboxCheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string; return?: string }>;
}) {
  if (!isSandboxPayments()) notFound();

  const { ref, return: returnTo } = await searchParams;
  const auth = await requireAuth();

  if (!ref) notFound();

  const intent = await db.paymentIntent.findFirst({
    where: { providerRef: ref, userId: auth.user.id },
    select: {
      id: true,
      providerRef: true,
      status: true,
      amountCents: true,
      currency: true,
      purpose: true,
      createdAt: true,
      referenceId: true,
    },
  });

  // A stranger's reference resolves to nothing, exactly like a missing one.
  if (!intent) notFound();

  const destination = safeRedirect(returnTo, "/dashboard");

  if (intent.status === "SUCCEEDED") redirect(destination);

  return (
    <div className="container-page max-w-lg py-12">
      <Card className="p-6">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-[var(--warning-soft)] text-[var(--warning)]">
            <FlaskConical className="size-5" aria-hidden />
          </span>
          <div>
            <h1 className="font-display text-xl font-semibold text-fg">Sandbox payment</h1>
            <p className="text-sm text-fg-muted">No real money is involved.</p>
          </div>
        </div>

        <div className="mt-5">
          <Alert tone="warning" title="This deployment has no payment gateway configured">
            PetMate is running on its internal ledger provider. Confirming below records a real
            transaction in the double-entry ledger and runs the real escrow, commission and payout
            logic — but no card is charged and no money moves.
          </Alert>
        </div>

        <dl className="mt-5 divide-y divide-[var(--border)] border-y border-[var(--border)]">
          <DataRow
            label="For"
            value={PURPOSE_LABEL[intent.purpose] ?? intent.purpose.replace("_", " ").toLowerCase()}
          />
          <DataRow
            label="Amount"
            value={
              <span className="font-display text-lg font-semibold">
                {formatMoney(intent.amountCents, intent.currency)}
              </span>
            }
          />
          <DataRow label="Reference" value={<span className="font-mono text-xs">{intent.providerRef}</span>} />
        </dl>

        {intent.purpose === "PET_PURCHASE" && (
          <div className="mt-5">
            <Alert tone="info" title="What happens next">
              The payment is held in escrow. The seller is only paid once you have met the animal
              and you both confirm the handover — or automatically after the escrow window if
              nobody disputes.
            </Alert>
          </div>
        )}

        <div className="mt-6">
          <SandboxConfirm
            providerRef={intent.providerRef!}
            amount={formatMoney(intent.amountCents, intent.currency)}
            returnTo={destination}
          />
        </div>
      </Card>

      <p className="mt-4 text-center text-xs text-fg-subtle">
        To take real payments, set PAYMENT_PROVIDER=stripe with your keys. See docs/PAYMENTS.md.
      </p>
    </div>
  );
}
