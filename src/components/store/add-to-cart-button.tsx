"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ShoppingCart, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api-client";

/**
 * Add to basket.
 *
 * Shows a brief confirmed state rather than only a toast, because on a grid of
 * products the toast appears far from the button the person just pressed.
 */
export function AddToCartButton({
  variantId,
  signedIn,
  quantity = 1,
  compact,
  fullWidth,
}: {
  variantId: string;
  signedIn: boolean;
  quantity?: number;
  compact?: boolean;
  fullWidth?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();

  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);

  async function add() {
    if (!signedIn) {
      router.push("/login?next=/store");
      return;
    }

    setAdding(true);

    try {
      await api.post("/api/cart", { action: "add", variantId, quantity });

      setAdded(true);
      setTimeout(() => setAdded(false), 2200);

      // Refresh so the header basket count updates.
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError && err.isAuth) {
        router.push("/login?next=/store");
        return;
      }
      toast.error(
        "Could not add to your basket",
        err instanceof ApiError ? err.message : "Please try again.",
      );
    } finally {
      setAdding(false);
    }
  }

  return (
    <Button
      variant={added ? "secondary" : compact ? "outline" : "primary"}
      size={compact ? "sm" : "lg"}
      fullWidth={fullWidth ?? compact}
      onClick={() => void add()}
      loading={adding}
      loadingText="Adding…"
    >
      {added ? (
        <>
          <Check className="size-4" aria-hidden />
          Added
        </>
      ) : (
        <>
          <ShoppingCart className="size-4" aria-hidden />
          {compact ? "Add" : "Add to basket"}
        </>
      )}
    </Button>
  );
}
