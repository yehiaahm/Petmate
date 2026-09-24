import type { Metadata } from "next";
import { ShoppingCart } from "lucide-react";
import { requireAuth } from "@/lib/auth/rbac";
import { getCart } from "@/lib/services/commerce.service";
import { EmptyState, PageHeader } from "@/components/ui/primitives";
import { ButtonLink } from "@/components/ui/button";
import { CartView } from "@/components/store/cart-view";

export const metadata: Metadata = {
  title: "Your basket",
  robots: { index: false, follow: false },
};

export default async function CartPage() {
  const auth = await requireAuth();
  const cart = await getCart(auth.user.id);

  return (
    <div className="container-page max-w-4xl py-8">
      <PageHeader title="Your basket" />

      {cart.items.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            icon={<ShoppingCart className="size-6" aria-hidden />}
            title="Your basket is empty"
            description="Food, health products, toys and beds from independent pet shops."
            action={<ButtonLink href="/store">Browse the store</ButtonLink>}
          />
        </div>
      ) : (
        <div className="mt-8">
          <CartView
            initialCart={cart}
            defaultName={auth.user.name}
            defaultCity={auth.user.city}
            defaultCountry={auth.user.country}
          />
        </div>
      )}
    </div>
  );
}
