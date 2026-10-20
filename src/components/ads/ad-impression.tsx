"use client";

import { useEffect, useRef } from "react";
import { api } from "@/lib/api-client";

/**
 * Counts an ad only once at least half of it has been on screen for a second:
 * an ad rendered below the fold that nobody scrolled to is not an impression,
 * and advertisers should not pay for it.
 */
export function AdImpression({ campaignId, children }: { campaignId: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let sent = false;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (sent) return;
        if (entry?.isIntersecting) {
          timer = setTimeout(() => {
            sent = true;
            observer.disconnect();
            void api.post("/api/ads", { action: "impression", campaignId }).catch(() => undefined);
          }, 1000);
        } else if (timer) {
          clearTimeout(timer);
          timer = null;
        }
      },
      { threshold: 0.5 },
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, [campaignId]);

  return <div ref={ref}>{children}</div>;
}
