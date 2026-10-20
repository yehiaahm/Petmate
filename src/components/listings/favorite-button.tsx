"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Heart } from "lucide-react";
import { api, ApiError } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { useI18n } from "@/components/i18n/i18n-provider";

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
  const { t } = useI18n();
  const router = useRouter();
  const toast = useToast();
  const [favorited, setFavorited] = useState(initial);
  // Counts the user's own saves, so the heart only bursts when they tap it —
  // not for listings that load already saved.
  const [bursts, setBursts] = useState(0);
  const [pending, startTransition] = useTransition();

  async function toggle(event: React.MouseEvent) {
    event.preventDefault();
    event.stopPropagation();

    const next = !favorited;
    setFavorited(next);
    if (next) setBursts((n) => n + 1);

    try {
      const result = await api.post<{ favorited: boolean }>(`/api/listings/${listingId}`, {
        action: "favorite",
      });
      setFavorited(result.favorited);
    } catch (error) {
      setFavorited(!next);

      if (error instanceof ApiError && error.isAuth) {
        toast.info(t("Sign in to save listings"), t("Your saved pets sync across devices."));
        startTransition(() => router.push(`/login?next=/pets`));
        return;
      }
      toast.error(t("We could not save that"), t("Please try again."));
    }
  }

  return (
    <button
      type="button"
      onClick={(e) => void toggle(e)}
      disabled={pending}
      aria-pressed={favorited}
      aria-label={favorited ? t("Remove from saved") : t("Save this listing")}
      className={cn(
        "relative inline-flex items-center justify-center gap-2 rounded-full border border-[var(--glass-border)] bg-[var(--glass)] text-fg-muted shadow-[var(--shadow-card)] backdrop-blur-md transition-[color,background-color,transform] duration-200 hover:text-[var(--color-coral-500)] active:scale-90",
        size === "sm" ? "size-9" : "h-11 px-4",
        withLabel && "w-auto px-4",
        favorited && "text-[var(--color-coral-500)]",
      )}
    >
      {bursts > 0 && favorited && (
        <span
          key={bursts}
          className="pointer-events-none absolute inset-0 rounded-full border-2 border-[var(--color-coral-400)] [animation:heart-burst_600ms_var(--ease-out-soft)_forwards]"
          aria-hidden
        />
      )}
      <Heart
        key={favorited && bursts > 0 ? `on-${bursts}` : "idle"}
        className={cn(
          "size-[18px]",
          favorited && "fill-current",
          favorited && bursts > 0 && "animate-pop",
        )}
        aria-hidden
      />
      {withLabel && (
        <span className="text-sm font-medium">{favorited ? t("Saved") : t("Save")}</span>
      )}
    </button>
  );
}
