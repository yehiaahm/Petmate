import Link from "next/link";
import { MessageCircle, ShieldAlert } from "lucide-react";
import { Avatar, Badge } from "@/components/ui/primitives";
import type { I18n } from "@/lib/i18n/server";
import { LikeButton } from "./community-actions";

export interface PostCardData {
  id: string;
  type: string;
  title: string | null;
  body: string;
  likeCount: number;
  commentCount: number;
  createdAt: Date;
  liked: boolean;
  flagged: boolean;
  author: { name: string; handle: string; avatarUrl: string | null };
  group: { slug: string; name: string } | null;
}

export function postTypeLabel(t: I18n["t"]): Record<string, string> {
  return {
    DISCUSSION: t("Discussion"),
    QUESTION: t("Question"),
    PHOTO: t("Photo"),
    MILESTONE: t("Milestone"),
    LOST_FOUND: t("Lost or found pet"),
  };
}

/** A post in a feed: enough to decide whether to open it. */
export function PostCard({ post, i18n, showGroup }: { post: PostCardData; i18n: I18n; showGroup?: boolean }) {
  const { t, fmt } = i18n;
  const typeLabel = postTypeLabel(t);

  return (
    <article className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--bg-elevated)] p-4">
      <header className="flex items-center gap-3">
        <Avatar src={post.author.avatarUrl} name={post.author.name} size="sm" />
        <div className="min-w-0 text-sm">
          <Link href={`/u/${post.author.handle}`} className="font-semibold text-fg hover:underline">
            {post.author.name}
          </Link>
          <p className="truncate text-xs text-fg-subtle">
            {showGroup && post.group && (
              <>
                <Link href={`/community/${post.group.slug}`} className="hover:underline">
                  {post.group.name}
                </Link>{" "}
                ·{" "}
              </>
            )}
            {fmt.relative(post.createdAt)}
          </p>
        </div>
        {post.type !== "DISCUSSION" && (
          <Badge tone={post.type === "LOST_FOUND" ? "warning" : "neutral"} size="sm" className="ms-auto">
            {typeLabel[post.type] ?? post.type}
          </Badge>
        )}
      </header>

      <Link href={`/community/posts/${post.id}`} className="mt-3 block">
        {post.title && <h3 className="font-semibold text-fg hover:underline">{post.title}</h3>}
        <p className="mt-1 line-clamp-4 whitespace-pre-line text-sm text-fg-muted">{post.body}</p>
      </Link>

      {post.flagged && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-[var(--warning)]">
          <ShieldAlert className="size-3.5" aria-hidden />
          {t("Be careful: this mentions paying outside PetMate. Payments made off the platform are not protected.")}
        </p>
      )}

      <footer className="mt-3 flex items-center gap-5">
        <LikeButton targetType="POST" targetId={post.id} liked={post.liked} count={post.likeCount} />
        <Link href={`/community/posts/${post.id}`} className="inline-flex items-center gap-1.5 text-sm text-fg-subtle hover:text-fg-muted">
          <MessageCircle className="size-4 rtl:-scale-x-100" aria-hidden />
          <span className="tabular">{fmt.number(post.commentCount)}</span>
          <span className="sr-only">{t("Comments")}</span>
        </Link>
      </footer>
    </article>
  );
}
