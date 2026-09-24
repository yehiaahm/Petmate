import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { ArrowLeft, ShieldAlert } from "lucide-react";
import { requireAuth } from "@/lib/auth/rbac";
import { getConversation, listMessages, markConversationRead } from "@/lib/services/chat.service";
import { formatMoney } from "@/lib/money";
import { Avatar, Badge, Alert } from "@/components/ui/primitives";
import { MessageThread } from "@/components/messages/message-thread";

export const metadata: Metadata = {
  title: "Conversation",
  robots: { index: false, follow: false },
};

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireAuth();

  // Both calls throw 404 for a non-participant, so an id alone grants nothing.
  const [conversation, messages] = await Promise.all([
    getConversation(auth, id),
    listMessages(auth, id, { limit: 60 }),
  ]);

  if (!conversation) notFound();

  // Opening the thread is what marks it read.
  await markConversationRead(auth, id).catch(() => undefined);

  const counterparty = conversation.counterparty;

  return (
    <div className="container-page max-w-3xl py-6">
      <Link
        href="/messages"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-fg-muted transition-colors hover:text-fg"
      >
        <ArrowLeft className="size-4" aria-hidden />
        All messages
      </Link>

      <div className="surface overflow-hidden">
        <header className="flex items-center gap-3 border-b border-[var(--border)] p-4">
          <Avatar src={counterparty?.avatarUrl} name={counterparty?.name ?? "PetMate"} size="md" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              {counterparty ? (
                <Link
                  href={`/u/${counterparty.handle}`}
                  className="font-display text-base font-semibold text-fg hover:underline"
                >
                  {counterparty.name}
                </Link>
              ) : (
                <span className="font-display text-base font-semibold text-fg">PetMate</span>
              )}
              {counterparty && (
                <Badge tone={counterparty.trustScore >= 50 ? "success" : "neutral"} size="sm">
                  Trust {counterparty.trustScore}
                </Badge>
              )}
            </div>
            {conversation.subject && (
              <p className="truncate text-xs text-fg-muted">{conversation.subject}</p>
            )}
          </div>
        </header>

        {conversation.listing && (
          <Link
            href={`/pets/${conversation.listing.slug}`}
            className="flex items-center gap-3 border-b border-[var(--border)] bg-bg-sunken p-3 transition-colors hover:bg-bg-inset"
          >
            {conversation.listing.pet.photos[0] && (
              <div className="relative size-11 shrink-0 overflow-hidden rounded-[var(--radius-field)]">
                <Image
                  src={conversation.listing.pet.photos[0].url}
                  alt=""
                  fill
                  sizes="44px"
                  className="object-cover"
                />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-fg">{conversation.listing.title}</p>
              <p className="text-xs text-fg-muted">
                {conversation.listing.priceCents > 0
                  ? formatMoney(conversation.listing.priceCents, conversation.listing.currency)
                  : conversation.listing.intent === "ADOPTION"
                    ? "For adoption"
                    : "Breeding"}
                {conversation.listing.status !== "ACTIVE" && (
                  <span className="text-fg-subtle">
                    {" · "}
                    {conversation.listing.status.toLowerCase()}
                  </span>
                )}
              </p>
            </div>
          </Link>
        )}

        {conversation.isBlocked && (
          <div className="p-4">
            <Alert tone="warning" title="You have blocked this member">
              They cannot see your messages and you will not receive theirs. Unblock from their
              profile to continue.
            </Alert>
          </div>
        )}

        <MessageThread
          conversationId={id}
          viewerId={auth.user.id}
          initialMessages={messages.map((m) => ({
            id: m.id,
            body: m.body,
            senderId: m.senderId,
            senderName: m.sender?.name ?? null,
            senderAvatar: m.sender?.avatarUrl ?? null,
            systemType: m.systemType,
            createdAt: m.createdAt.toISOString(),
            flagged: m.flagged,
            flagReason: m.flagReason,
          }))}
          disabled={conversation.isBlocked}
          counterpartyName={counterparty?.name ?? "PetMate"}
        />
      </div>

      <div className="mt-4">
        <Alert tone="info" icon={<ShieldAlert className="size-4" aria-hidden />}>
          Never pay by bank transfer, gift card or crypto, and never send a deposit before you have
          seen the animal. Paying through PetMate is what makes escrow and disputes possible.
        </Alert>
      </div>
    </div>
  );
}
