"use client";

import { useState } from "react";
import Image from "next/image";
import { ShoppingBag } from "lucide-react";
import { cn } from "@/lib/utils";

export function ProductGallery({
  images,
  title,
}: {
  images: { id: string; url: string; alt: string | null }[];
  title: string;
}) {
  const [index, setIndex] = useState(0);
  const current = images[index];

  if (!images.length) {
    return (
      <div className="flex aspect-square items-center justify-center rounded-[var(--radius-panel)] border border-dashed border-[var(--border-strong)] text-fg-subtle">
        <ShoppingBag className="size-10" aria-hidden />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="relative aspect-square overflow-hidden rounded-[var(--radius-panel)] bg-bg-sunken">
        {current && (
          <Image
            src={current.url}
            alt={current.alt ?? title}
            fill
            priority
            sizes="(max-width: 1024px) 100vw, 55vw"
            className="object-cover"
          />
        )}
      </div>

      {images.length > 1 && (
        <ul className="flex gap-2 overflow-x-auto pb-1 hide-scrollbar">
          {images.map((image, i) => (
            <li key={image.id}>
              <button
                type="button"
                onClick={() => setIndex(i)}
                aria-label={`Show image ${i + 1} of ${images.length}`}
                aria-current={i === index}
                className={cn(
                  "relative size-16 shrink-0 overflow-hidden rounded-[var(--radius-field)] transition-all sm:size-20",
                  i === index
                    ? "ring-2 ring-brand ring-offset-2 ring-offset-[var(--bg)]"
                    : "opacity-60 hover:opacity-100",
                )}
              >
                <Image src={image.url} alt="" fill sizes="80px" className="object-cover" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
