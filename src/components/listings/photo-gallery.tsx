"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight, Expand, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/components/i18n/i18n-provider";

interface Photo {
  id: string;
  url: string;
  alt: string | null;
  width: number | null;
  height: number | null;
}

/**
 * Photo gallery.
 *
 * Keyboard-navigable, with a lightbox that traps focus and restores it on
 * close. The main image reserves its aspect ratio so the page does not jump
 * while it loads.
 */
export function PhotoGallery({ photos, petName }: { photos: Photo[]; petName: string }) {
  const { t } = useI18n();
  const [index, setIndex] = useState(0);
  const [lightbox, setLightbox] = useState(false);

  const current = photos[index];

  useEffect(() => {
    if (!lightbox) return;

    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setLightbox(false);
      if (event.key === "ArrowRight") setIndex((i) => (i + 1) % photos.length);
      if (event.key === "ArrowLeft") setIndex((i) => (i - 1 + photos.length) % photos.length);
    }

    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKey);
    };
  }, [lightbox, photos.length]);

  if (!photos.length) {
    return (
      <div className="aspect-card flex items-center justify-center rounded-[var(--radius-panel)] border border-dashed border-[var(--border-strong)] text-sm text-fg-subtle">
        {t("No photos yet")}
      </div>
    );
  }

  return (
    <>
      <div className="space-y-3">
        <div className="group relative aspect-card overflow-hidden rounded-[var(--radius-panel)] bg-bg-sunken">
          {current && (
            <Image
              src={current.url}
              alt={current.alt ?? t("{name}, photo {n} of {total}", { name: petName, n: index + 1, total: photos.length })}
              fill
              priority
              sizes="(max-width: 1024px) 100vw, 60vw"
              className="object-cover"
            />
          )}

          <button
            type="button"
            onClick={() => setLightbox(true)}
            className="absolute end-3 top-3 inline-flex size-9 items-center justify-center rounded-full bg-[var(--overlay)] text-white opacity-0 backdrop-blur transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
            aria-label={t("View full size")}
          >
            <Expand className="size-4" aria-hidden />
          </button>

          {photos.length > 1 && (
            <>
              <GalleryArrow
                direction="prev"
                onClick={() => setIndex((i) => (i - 1 + photos.length) % photos.length)}
              />
              <GalleryArrow
                direction="next"
                onClick={() => setIndex((i) => (i + 1) % photos.length)}
              />
              <p className="absolute bottom-3 end-3 rounded-full bg-[var(--overlay)] px-2.5 py-1 text-xs font-medium tabular text-white backdrop-blur">
                {index + 1} / {photos.length}
              </p>
            </>
          )}
        </div>

        {photos.length > 1 && (
          <ul className="flex gap-2 overflow-x-auto pb-1 hide-scrollbar">
            {photos.map((photo, i) => (
              <li key={photo.id}>
                <button
                  type="button"
                  onClick={() => setIndex(i)}
                  aria-label={t("Show photo {value}", { value: i + 1 })}
                  aria-current={i === index}
                  className={cn(
                    "relative size-16 shrink-0 overflow-hidden rounded-[var(--radius-field)] transition-all sm:size-20",
                    i === index
                      ? "ring-2 ring-brand ring-offset-2 ring-offset-[var(--bg)]"
                      : "opacity-60 hover:opacity-100",
                  )}
                >
                  <Image
                    src={photo.url}
                    alt=""
                    fill
                    sizes="80px"
                    className="object-cover"
                  />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {lightbox && current && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/92 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={t("{petName} photo viewer", { petName })}
        >
          <button
            type="button"
            onClick={() => setLightbox(false)}
            className="absolute end-4 top-4 inline-flex size-11 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
            aria-label={t("Close photo viewer")}
            autoFocus
          >
            <X className="size-5" aria-hidden />
          </button>

          <div className="relative max-h-full w-full max-w-5xl">
            <Image
              src={current.url}
              alt={current.alt ?? t("{name}, photo {n}", { name: petName, n: index + 1 })}
              width={current.width ?? 1600}
              height={current.height ?? 1200}
              className="mx-auto max-h-[85dvh] w-auto rounded-[var(--radius-card)] object-contain"
            />
          </div>

          {photos.length > 1 && (
            <>
              <button
                type="button"
                onClick={() => setIndex((i) => (i - 1 + photos.length) % photos.length)}
                className="absolute start-4 inline-flex size-11 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
                aria-label={t("Previous photo")}
              >
                <ChevronLeft className="rtl:-scale-x-100 size-6" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => setIndex((i) => (i + 1) % photos.length)}
                className="absolute end-4 top-1/2 inline-flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
                aria-label={t("Next photo")}
              >
                <ChevronRight className="rtl:-scale-x-100 size-6" aria-hidden />
              </button>
            </>
          )}
        </div>
      )}
    </>
  );
}

function GalleryArrow({
  direction,
  onClick,
}: {
  direction: "prev" | "next";
  onClick: () => void;
}) {
  const { t } = useI18n();
  const Icon = direction === "prev" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "absolute top-1/2 inline-flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-bg-elevated/90 text-fg shadow-[var(--shadow-card)] backdrop-blur transition-all hover:bg-bg-elevated",
        // Always visible on touch, where there is no hover to reveal them.
        "opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100",
        direction === "prev" ? "start-3" : "end-3",
      )}
      aria-label={direction === "prev" ? t("Previous photo") : t("Next photo")}
    >
      <Icon className="size-5" aria-hidden />
    </button>
  );
}
