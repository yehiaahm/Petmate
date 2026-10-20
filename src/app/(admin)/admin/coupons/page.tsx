import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/rbac";
import { listCoupons } from "@/lib/services/coupon.service";
import { getBalance, accounts } from "@/lib/payments/ledger-core";
import { PLATFORM_CURRENCY } from "@/lib/currency";
import { formatMoney } from "@/lib/money";
import { PageHeader, Stat } from "@/components/ui/primitives";
import { CouponAdmin } from "@/components/admin/coupon-admin";

export const metadata: Metadata = { title: "Coupons", robots: { index: false, follow: false } };

export default async function CouponsPage() {
  await requirePermission("admin:finance");
  const [coupons, promotions] = await Promise.all([listCoupons(), getBalance(accounts.platformPromotions())]);

  return (
    <>
      <PageHeader
        title="Coupons & promotions"
        description="Every discount and referral reward is paid from the promotions account, so shops always receive full price."
      />
      <div className="mt-6 max-w-sm">
        <Stat label="Spent on promotions (all time)" value={formatMoney(-promotions, PLATFORM_CURRENCY)} />
      </div>
      <div className="mt-6">
        <CouponAdmin
          currency={PLATFORM_CURRENCY}
          coupons={coupons.map((c) => ({
            id: c.id,
            code: c.code,
            description: c.description,
            kind: c.kind,
            percentBps: c.percentBps,
            amountCents: c.amountCents,
            maxDiscountCents: c.maxDiscountCents,
            minOrderCents: c.minOrderCents,
            endsAt: c.endsAt?.toISOString() ?? null,
            maxRedemptions: c.maxRedemptions,
            redemptionCount: c.redemptionCount,
            perUserLimit: c.perUserLimit,
            firstOrderOnly: c.firstOrderOnly,
            active: c.active,
            spentCents: c.spentCents,
            currency: c.currency,
          }))}
        />
      </div>
    </>
  );
}
