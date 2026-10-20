"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  Bell,
  BellOff,
  MessageSquare,
  ShoppingBag,
  CreditCard,
  CalendarDays,
  Dna,
  Heart,
  Syringe,
  Truck,
  ShieldAlert,
  Megaphone,
  Tag,
  CheckCheck,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, EmptyState } from "@/components/ui/primitives";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useI18n } from "@/components/i18n/i18n-provider";

export interface FeedNotification {
  id: string;
  category: string;
  type: string;
  title: string;
  body: string | null;
  url: string | null;
  imageUrl: string | null;
  readAt: string | null;
  createdAt: string;
}

const ICONS: Record<string, typeof Bell> = {
  MESSAGE: MessageSquare,
  LISTING: Tag,
  ORDER: ShoppingBag,
  PAYMENT: CreditCard,
  APPOINTMENT: CalendarDays,
  BREEDING: Dna,
  ADOPTION: Heart,
  HEALTH: Syringe,
  DELIVERY: Truck,
  COMMUNITY: Users,
  SECURITY: ShieldAlert,
  SYSTEM: Bell,
  MARKETING: Megaphone,
};

export function NotificationFeed({
  initial,
  initialUnread,
}: {
  initial: FeedNotification[];
  initialUnread: number;
}) {
  const { t, tm, fmt } = useI18n();
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [unread, setUnread] = useState(initialUnread);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exhausted, setExhausted] = useState(initial.length < 30);
  const [pending, startTransition] = useTransition();

  async function markAll() {
    // Optimistic: the server call is idempotent, so a failure is recoverable by
    // a refresh rather than by unwinding state.
    setItems((prev) => prev.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
    setUnread(0);
    await api.post("/api/notifications", { action: "read" });
    startTransition(() => router.refresh());
  }

  async function markOne(id: string) {
    setItems((prev) =>
      prev.map((n) => (n.id === id ? { ...n, readAt: n.readAt ?? new Date().toISOString() } : n)),
    );
    setUnread((u) => Math.max(0, u - 1));
    await api.post("/api/notifications", { action: "read", ids: [id] });
    startTransition(() => router.refresh());
  }

  async function loadMore() {
    const oldest = items[items.length - 1];
    if (!oldest) return;
    setLoadingMore(true);
    try {
      const result = await api.get<{ notifications: FeedNotification[] }>(
        `/api/notifications?limit=30&before=${encodeURIComponent(oldest.createdAt)}`,
      );
      setItems((prev) => [...prev, ...result.notifications]);
      if (result.notifications.length < 30) setExhausted(true);
    } finally {
      setLoadingMore(false);
    }
  }

  if (items.length === 0) {
    return (
      <EmptyState
        icon={<BellOff className="size-5" aria-hidden />}
        title={t("Nothing here yet")}
        description={t("Messages, orders, appointments and health reminders land here. You control which ones also email you.")}
        action={
          <Button variant="outline" onClick={() => router.push("/settings/notifications")}>
            {t("Notification settings")}
          </Button>
        }
      />
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-fg-muted tabular" role="status" aria-live="polite">
          {t("{count} unread", { count: unread })}
        </p>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={markAll}
            disabled={unread === 0 || pending}
          >
            <CheckCheck className="size-4" aria-hidden />
            {t("Mark all read")}
          </Button>
          <Button variant="outline" size="sm" onClick={() => router.push("/settings/notifications")}>
            {t("Settings")}
          </Button>
        </div>
      </div>

      <ul className="mt-4 space-y-2">
        {items.map((n) => {
          const Icon = ICONS[n.category] ?? Bell;
          const isUnread = n.readAt === null;

          const inner = (
            <Card
              as="article"
              className={cn(
                "flex gap-3.5 p-4 transition-colors",
                isUnread && "border-brand/25 bg-brand-soft/20",
              )}
            >
              {n.imageUrl ? (
                <Image
                  src={n.imageUrl}
                  alt=""
                  width={40}
                  height={40}
                  className="size-10 shrink-0 rounded-xl object-cover"
                />
              ) : (
                <span
                  className={cn(
                    "flex size-10 shrink-0 items-center justify-center rounded-xl",
                    isUnread ? "bg-brand text-brand-fg" : "bg-bg-sunken text-fg-subtle",
                  )}
                >
                  <Icon className="size-4.5" aria-hidden />
                </span>
              )}

              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <p
                    className={cn(
                      "text-[15px] leading-snug",
                      isUnread ? "font-semibold text-fg" : "font-medium text-fg-muted",
                    )}
                  >
                    {tm(n.title)}
                  </p>
                  <time
                    dateTime={n.createdAt}
                    className="shrink-0 text-xs text-fg-subtle"
                    title={new Date(n.createdAt).toLocaleString()}
                  >
                    {fmt.relative(new Date(n.createdAt))}
                  </time>
                </div>
                {n.body && (
                  <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-fg-muted">
                    {tm(n.body)}
                  </p>
                )}
                {isUnread && (
                  <span className="sr-only">{t("Unread")}</span>
                )}
              </div>
            </Card>
          );

          return (
            <li key={n.id}>
              {n.url ? (
                <Link
                  href={n.url}
                  onClick={() => {
                    if (isUnread) void markOne(n.id);
                  }}
                  className="block rounded-[var(--radius-card)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
                >
                  {inner}
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    if (isUnread) void markOne(n.id);
                  }}
                  className="block w-full text-start rounded-[var(--radius-card)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
                >
                  {inner}
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {!exhausted && (
        <div className="mt-5 text-center">
          <Button variant="outline" onClick={loadMore} loading={loadingMore} loadingText={t("Loading…")}>
            {t("Load older")}
          </Button>
        </div>
      )}
    </div>
  );
}
