import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { MessageSquare } from "lucide-react";
import { requireAuth } from "@/lib/auth/rbac";
import { listConversations } from "@/lib/services/chat.service";
import { relativeTime, truncate } from "@/lib/utils";
import { formatMoney } from "@/lib/money";
import { Avatar, EmptyState, PageHeader } from "@/components/ui/primitives";
import { ButtonLink } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Messages",
  robots: { index: false, follow: false },
};

export default async function MessagesPage() {
  const auth = await requireAuth();
  const conversations = await listConversations(auth);

  return (
    <div className="container-page max-w-3xl py-8">
      <PageHeader
        title="Messages"
        description="Keep conversations here. It is the only way we can help if something goes wrong."
      />

      {conversations.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            icon={<MessageSquare className="size-6" aria-hidden />}
            title="No messages yet"
            description="When you contact a seller, apply to adopt, or send a breeding request, the conversation appears here."
            action={<ButtonLink href="/pets">Browse pets</ButtonLink>}
          />
        </div>
      ) : (
        <ul className="mt-8 space-y-2">
          {conversations.map((conversation) => (
            <li key={conversation.id}>
              <Link
                href={`/messages/${conversation.id}`}
                className={cn(
                  "surface surface-lift flex items-center gap-3 p-4",
                  conversation.unreadCount > 0 && "border-brand/40 bg-brand-soft/30",
                )}
              >
                {conversation.listing?.pet.photos[0] ? (
                  <div className="relative size-12 shrink-0 overflow-hidden rounded-[var(--radius-field)]">
                    <Image
                      src={conversation.listing.pet.photos[0].url}
                      alt=""
                      fill
                      sizes="48px"
                      className="object-cover"
                    />
                  </div>
                ) : (
                  <Avatar
                    src={conversation.counterparty?.avatarUrl}
                    name={conversation.counterparty?.name ?? "PetMate"}
                    size="md"
                  />
                )}

                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p
                      className={cn(
                        "truncate text-sm",
                        conversation.unreadCount > 0
                          ? "font-semibold text-fg"
                          : "font-medium text-fg",
                      )}
                    >
                      {conversation.counterparty?.name ?? "PetMate"}
                    </p>
                    <span className="shrink-0 text-xs text-fg-subtle">
                      {relativeTime(conversation.lastMessageAt)}
                    </span>
                  </div>

                  {conversation.subject && (
                    <p className="truncate text-xs text-fg-muted">
                      {conversation.subject}
                      {conversation.listing && conversation.listing.priceCents > 0 && (
                        <span className="text-fg-subtle">
                          {" · "}
                          {formatMoney(conversation.listing.priceCents, conversation.listing.currency)}
                        </span>
                      )}
                    </p>
                  )}

                  <p
                    className={cn(
                      "mt-0.5 truncate text-sm",
                      conversation.unreadCount > 0 ? "text-fg" : "text-fg-muted",
                    )}
                  >
                    {conversation.preview ? truncate(conversation.preview, 90) : "No messages yet"}
                  </p>
                </div>

                {conversation.unreadCount > 0 && (
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-accent text-[10px] font-bold text-accent-fg">
                    {conversation.unreadCount > 9 ? "9+" : conversation.unreadCount}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
