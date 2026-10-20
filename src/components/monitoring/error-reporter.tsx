"use client";

import { useEffect } from "react";
import { api } from "@/lib/api-client";

type Source = "window" | "promise" | "boundary";

let sent = 0;

/** Reports a browser error once; at most five per page load. */
export function reportClientError(error: unknown, source: Source, digest?: string) {
  if (sent >= 5 || typeof window === "undefined") return;
  sent++;
  const e = error instanceof Error ? error : new Error(String(error));
  void api
    .post("/api/client-errors", {
      message: e.message.slice(0, 1000) || "Unknown error",
      name: e.name?.slice(0, 100),
      stack: e.stack?.slice(0, 8000),
      url: window.location.href.split("?")[0]!.slice(0, 1000),
      digest,
      source,
    })
    .catch(() => undefined);
}

/**
 * Listens for errors nothing else caught, so a broken button in someone's
 * browser shows up in Sentry instead of only in an angry review.
 */
export function ErrorReporter() {
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      // Errors from browser extensions and cross-origin scripts arrive without detail.
      if (!event.error && event.message === "Script error.") return;
      reportClientError(event.error ?? event.message, "window");
    };
    const onRejection = (event: PromiseRejectionEvent) => reportClientError(event.reason, "promise");
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}
