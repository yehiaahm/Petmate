import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { CreditCard, Clock, CheckCircle2, XCircle } from "lucide-react";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth/rbac";
import { isSandboxPayments, paymentProvider } from "@/lib/payments/provider";
import { getI18n } from "@/lib/i18n/server";
import { Card, Alert, DataRow } from "@/components/ui/primitives";
import { ButtonLink } from "@/components/ui/button";
import { PaymentActions } from "@/components/checkout/payment-actions";
import { PurchaseTracker } from "@/components/analytics/purchase-tracker";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("Checkout"), robots: { index: false, follow: false } };
}

/**
 * Where a payer lands between the app and the payment provider: to go to the
 * hosted payment page, to see that it went through, or to try again.
 *
 * The status shown is the one our database holds, which only a verified
 * provider callback can move. The provider's redirect back here is never
 * treated as proof of payment.
 */
export default async function CheckoutPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [auth, { t, fmt }] = await Promise.all([requireAuth(), getI18n()]);

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
      clientSecret: true,
      referenceType: true,
      referenceId: true,
      failureMessage: true,
      createdAt: true,
    },
  });

  if (!intent) notFound();

  // The sandbox has its own screen; never show a provider page for it.
  if (isSandboxPayments() && intent.provider === "ledger" && intent.providerRef) {
    redirect(`/checkout/sandbox?ref=${encodeURIComponent(intent.providerRef)}`);
  }

  // A failed attempt that was retried: follow the newest attempt instead.
  if (intent.status === "FAILED" && intent.referenceId) {
    const later = await db.paymentIntent.findFirst({
      where: {
        userId: auth.user.id,
        referenceType: intent.referenceType,
        referenceId: intent.referenceId,
        createdAt: { gt: intent.createdAt },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (later) redirect(`/checkout/${later.id}`);
  }

  const provider = paymentProvider();
  const open = intent.status === "REQUIRES_PAYMENT";
  const resumeUrl = open && provider.name === intent.provider ? provider.resumeUrl(intent, "") : null;
  const amount = fmt.money(intent.amountCents, intent.currency);

  const state =
    intent.status === "SUCCEEDED" || intent.status === "REFUNDED" || intent.status === "PARTIALLY_REFUNDED"
      ? { icon: CheckCircle2, tone: "text-[var(--success)] bg-[var(--success-soft)]", title: t("Payment received"), body: t("{amount} has been received.", { amount }) }
      : intent.status === "PROCESSING"
        ? { icon: Clock, tone: "text-[var(--warning)] bg-[var(--warning-soft)]", title: t("Payment pending"), body: t("We are waiting for the payment provider to confirm. For kiosk payments this happens once you pay at the kiosk with your reference.") }
        : intent.status === "FAILED"
          ? { icon: XCircle, tone: "text-[var(--danger)] bg-[var(--danger-soft)]", title: t("Payment not completed"), body: t("Nothing was charged. You can try again with the same or a different method.") }
          : { icon: CreditCard, tone: "bg-brand-soft text-brand-soft-fg", title: t("Complete payment"), body: t("You pay on the provider's secure page, so your card and wallet details never reach PetMate.") };

  const Icon = state.icon;

  return (
    <div className="container-page max-w-lg py-12">
      <Card className="p-6">
        <div className="flex items-center gap-3">
          <span className={`flex size-10 items-center justify-center rounded-xl ${state.tone}`}>
            <Icon className="size-5" aria-hidden />
          </span>
          <div>
            <h1 className="font-display text-xl font-semibold text-fg">{state.title}</h1>
            {intent.provider === "paymob" && <p className="text-sm text-fg-muted">{t("Secured by Paymob")}</p>}
          </div>
        </div>

        <p className="mt-4 text-sm leading-relaxed text-fg-muted">{state.body}</p>

        <dl className="mt-5 divide-y divide-[var(--border)] border-y border-[var(--border)]">
          <DataRow label={t("Amount")} value={<span className="font-display text-lg font-semibold">{amount}</span>} />
        </dl>

        {intent.status === "FAILED" && intent.failureMessage && (
          <Alert tone="danger" className="mt-5">
            {intent.failureMessage}
          </Alert>
        )}

        <div className="mt-5 space-y-3">
          <PaymentActions intentId={intent.id} resumeUrl={resumeUrl} canRetry={intent.status === "FAILED"} />
          {intent.status === "SUCCEEDED" && (
            <PurchaseTracker paymentId={intent.id} valueCents={intent.amountCents} currency={intent.currency} />
          )}
          <ButtonLink href="/dashboard" variant="outline" fullWidth>
            {t("Back to dashboard")}
          </ButtonLink>
        </div>
      </Card>
    </div>
  );
}
