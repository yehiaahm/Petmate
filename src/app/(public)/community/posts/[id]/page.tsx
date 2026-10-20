import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { getAuth } from "@/lib/auth/session";
import { isStaff } from "@/lib/auth/rbac";
import { getPost } from "@/lib/services/community.service";
import { isAppError } from "@/lib/errors";
import { getI18n } from "@/lib/i18n/server";
import { truncate } from "@/lib/utils";
import { Breadcrumbs, Avatar, Alert, Badge } from "@/components/ui/primitives";
import { ButtonLink } from "@/components/ui/button";
import { LikeButton, CommentForm, ReplyToggle, RemoveButton } from "@/components/community/community-actions";
import { postTypeLabel } from "@/components/community/post-card";
import { ReportButton } from "@/components/listings/report-button";

async function load(id: string, viewerId: string | null) {
  return getPost(id, viewerId).catch((error) => {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  });
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const post = await load(id, null);
  return { title: post.title ?? truncate(post.body, 60), description: truncate(post.body, 160) };
}

export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [auth, i18n] = await Promise.all([getAuth(), getI18n()]);
  const { t, fmt } = i18n;
  const viewerId = auth?.user.id ?? null;
  const post = await load(id, viewerId);

  const moderator = post.myRole === "OWNER" || post.myRole === "MODERATOR" || (auth ? isStaff(auth.user) : false);
  const canRemove = (authorId: string) => Boolean(auth) && (authorId === viewerId || moderator);
  const typeLabel = postTypeLabel(t);

  return (
    <div className="container-page max-w-3xl py-8 lg:py-10">
      <Breadcrumbs
        items={[
          { label: t("Community"), href: "/community" },
          ...(post.group ? [{ label: post.group.name, href: `/community/${post.group.slug}` }] : []),
          { label: post.title ? truncate(post.title, 40) : t("Post") },
        ]}
      />

      <article className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--bg-elevated)] p-5">
        <header className="flex items-center gap-3">
          <Avatar src={post.author.avatarUrl} name={post.author.name} />
          <div className="min-w-0 text-sm">
            <Link href={`/u/${post.author.handle}`} className="font-semibold text-fg hover:underline">
              {post.author.name}
            </Link>
            <p className="text-xs text-fg-subtle">{fmt.dateTime(post.createdAt)}</p>
          </div>
          {post.type !== "DISCUSSION" && (
            <Badge tone={post.type === "LOST_FOUND" ? "warning" : "neutral"} size="sm" className="ms-auto">
              {typeLabel[post.type] ?? post.type}
            </Badge>
          )}
        </header>

        {post.title && <h1 className="mt-4 font-display text-2xl font-semibold text-fg">{post.title}</h1>}
        <p className="mt-3 whitespace-pre-line text-fg">{post.body}</p>

        {post.flagged && (
          <Alert tone="warning" className="mt-4" icon={<ShieldAlert className="size-4" aria-hidden />}>
            {t("Be careful: this mentions paying outside PetMate. Payments made off the platform are not protected.")}
          </Alert>
        )}

        <footer className="mt-4 flex flex-wrap items-center gap-5">
          <LikeButton targetType="POST" targetId={post.id} liked={post.liked} count={post.likeCount} />
          {auth && <ReportButton entityType="POST" entityId={post.id} label={t("Report")} />}
          {canRemove(post.authorId) && (
            <RemoveButton kind="post" id={post.id} redirectTo={post.group ? `/community/${post.group.slug}` : "/community"} />
          )}
        </footer>
      </article>

      <section aria-labelledby="comments-heading" className="mt-8">
        <h2 id="comments-heading" className="font-display text-lg font-semibold text-fg">
          {t.plural(post.commentCount, { one: "{count} comment", other: "{count} comments" })}
        </h2>

        <div className="mt-4">
          {auth ? (
            <CommentForm postId={post.id} />
          ) : (
            <ButtonLink href={`/login?next=/community/posts/${post.id}`} variant="outline" size="sm">
              {t("Sign in to comment")}
            </ButtonLink>
          )}
        </div>

        <ul className="mt-6 space-y-5">
          {post.threads.map((comment) => (
            <li key={comment.id} id={`comment-${comment.id}`}>
              <Comment comment={comment} i18n={i18n} canRemove={canRemove(comment.authorId)} signedIn={Boolean(auth)} />
              {comment.replies.length > 0 && (
                <ul className="mt-3 space-y-3 border-s-2 border-[var(--border)] ps-4">
                  {comment.replies.map((reply) => (
                    <li key={reply.id} id={`comment-${reply.id}`}>
                      <Comment comment={reply} i18n={i18n} canRemove={canRemove(reply.authorId)} signedIn={Boolean(auth)} />
                    </li>
                  ))}
                </ul>
              )}
              {auth && (
                <div className="mt-2 ps-11">
                  <ReplyToggle postId={post.id} parentId={comment.id} />
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Comment({
  comment,
  i18n,
  canRemove,
  signedIn,
}: {
  comment: {
    id: string;
    body: string;
    likeCount: number;
    liked: boolean;
    createdAt: Date;
    author: { name: string; handle: string; avatarUrl: string | null };
  };
  i18n: Awaited<ReturnType<typeof getI18n>>;
  canRemove: boolean;
  signedIn: boolean;
}) {
  const { t, fmt } = i18n;
  return (
    <div className="flex gap-3">
      <Avatar src={comment.author.avatarUrl} name={comment.author.name} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="text-sm">
          <Link href={`/u/${comment.author.handle}`} className="font-semibold text-fg hover:underline">
            {comment.author.name}
          </Link>{" "}
          <span className="text-xs text-fg-subtle">{fmt.relative(comment.createdAt)}</span>
        </p>
        <p className="mt-0.5 whitespace-pre-line text-sm text-fg">{comment.body}</p>
        <div className="mt-1.5 flex items-center gap-4">
          <LikeButton targetType="COMMENT" targetId={comment.id} liked={comment.liked} count={comment.likeCount} />
          {signedIn && <ReportButton entityType="COMMENT" entityId={comment.id} label={t("Report")} />}
          {canRemove && <RemoveButton kind="comment" id={comment.id} />}
        </div>
      </div>
    </div>
  );
}
