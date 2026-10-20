import type { Metadata } from "next";
import { ShoppingCart } from "lucide-react";
import { requireAuth } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { getCart } from "@/lib/services/commerce.service";
import { listMyCoupons } from "@/lib/services/coupon.service";
import { getI18n } from "@/lib/i18n/server";
import { EmptyState, PageHeader } from "@/components/ui/primitives";
import { ButtonLink } from "@/components/ui/button";
import { CartView } from "@/components/store/cart-view";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("Your basket"), robots: { index: false, follow: false } };
}

export default async function CartPage() {
  const [auth, { t }] = await Promise.all([requireAuth(), getI18n()]);
  const [cart, coupons, user] = await Promise.all([
    getCart(auth.user.id),
    listMyCoupons(auth.user.id),
    db.user.findUniqueOrThrow({ where: { id: auth.user.id }, select: { phone: true, phoneVerifiedAt: true } }),
  ]);

  return (
    <div className="container-page max-w-4xl py-8">
      <PageHeader title={t("Your basket")} />

      {cart.items.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            icon={<ShoppingCart className="size-6" aria-hidden />}
            title={t("Your basket is empty")}
            description={t("Food, health products, toys and beds from independent pet shops.")}
            action={<ButtonLink href="/store">{t("Browse the store")}</ButtonLink>}
          />
        </div>
      ) : (
        <div className="mt-8">
          <CartView
            initialCart={cart}
            defaultName={auth.user.name}
            defaultCity={auth.user.city}
            defaultCountry={auth.user.country}
            defaultPhone={user.phoneVerifiedAt && user.phone ? user.phone : ""}
            myCoupons={coupons.map((c) => c.code)}
          />
        </div>
      )}
    </div>
  );
}
