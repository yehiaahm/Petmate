"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Heart } from "lucide-react";
import { api, ApiError } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

/**
 * Save a listing.
 *
 * Optimistic, because the round trip is slower than the user's next glance —
 * but it reverts on failure rather than leaving a lie on screen.
 */
export function FavoriteButton({
  listingId,
  initial,
  size = "sm",
  withLabel = false,
}: {
  listingId: string;
  initial: boolean;
  size?: "sm" | "md";
  withLabel?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [favorited, setFavorited] = useState(initial);
  const [pending, startTransition] = useTransition();

  async function toggle(event: React.MouseEvent) {
    event.preventDefault();
    event.stopPropagation();

    const next = !favorited;
    setFavorited(next);

    try {
      const result = await api.post<{ favorited: boolean }>(`/api/listings/${listingId}`, {
        action: "favorite",
      });
      setFavorited(result.favorited);
    } catch (error) {
      setFavorited(!next);

      if (error instanceof ApiError && error.isAuth) {
        toast.info("Sign in to save listings", "Your saved pets sync across devices.");
        startTransition(() => router.push(`/login?next=/pets`));
        return;
      }
      toast.error("We could not save that", "Please try again.");
    }
  }

  return (
    <button
      type="button"
      onClick={(e) => void toggle(e)}
      disabled={pending}
      aria-pressed={favorited}
      aria-label={favorited ? "Remove from saved" : "Save this listing"}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-full border border-[var(--border)] bg-bg-elevated/90 text-fg-muted shadow-[var(--shadow-subtle)] backdrop-blur transition-all hover:text-fg active:scale-95",
        size === "sm" ? "size-8" : "h-11 px-4",
        withLabel && "w-auto px-4",
        favorited && "border-transparent bg-accent-soft text-accent-soft-fg",
      )}
    >
      <Heart
        className={cn(size === "sm" ? "size-4" : "size-[18px]", favorited && "fill-current")}
        aria-hidden
      />
      {withLabel && (
        <span className="text-sm font-medium">{favorited ? "Saved" : "Save"}</span>
      )}
    </button>
  );
}
