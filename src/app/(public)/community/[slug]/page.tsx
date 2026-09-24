import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Users, MessagesSquare } from "lucide-react";
import { getAuth } from "@/lib/auth/session";
import { getGroup, listPosts } from "@/lib/services/community.service";
import { isAppError } from "@/lib/errors";
import { getI18n } from "@/lib/i18n/server";
import { PageHeader, Breadcrumbs, EmptyState, Card } from "@/components/ui/primitives";
import { ButtonLink } from "@/components/ui/button";
import { JoinButton, PostComposer } from "@/components/community/community-actions";
import { PostCard } from "@/components/community/post-card";

async function load(slug: string, viewerId: string | null) {
  return getGroup(slug, viewerId).catch((error) => {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  });
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const group = await load(slug, null);
  return { title: group.name, description: group.description ?? undefined };
}

export default async function GroupPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [auth, i18n] = await Promise.all([getAuth(), getI18n()]);
  const { t } = i18n;
  const viewerId = auth?.user.id ?? null;
  const group = await load(slug, viewerId);
  const feed = await listPosts({ groupId: group.id, viewerId, limit: 30 });
  const member = Boolean(group.myRole);

  return (
    <div className="container-page max-w-3xl py-8 lg:py-10">
      <Breadcrumbs items={[{ label: t("Community"), href: "/community" }, { label: group.name }]} />
      <PageHeader
        title={group.name}
        description={group.description ?? undefined}
        action={
          auth ? (
            <JoinButton groupId={group.id} joined={member} owner={group.myRole === "OWNER"} />
          ) : (
            <ButtonLink href={`/login?next=/community/${group.slug}`} size="sm">
              {t("Sign in to join")}
            </ButtonLink>
          )
        }
      />
      <p className="mt-2 flex items-center gap-1.5 text-sm text-fg-subtle">
        <Users className="size-4" aria-hidden />
        {t.plural(group.memberCount, { one: "{count} member", other: "{count} members" })}
      </p>

      {group.rules && (
        <Card className="mt-6 p-4">
          <p className="text-xs font-medium text-fg-subtle">{t("Group rules")}</p>
          <p className="mt-1 whitespace-pre-line text-sm text-fg">{group.rules}</p>
        </Card>
      )}

      <div className="mt-6">
        {member ? (
          <PostComposer groupId={group.id} />
        ) : (
          auth && <p className="text-sm text-fg-muted">{t("Join the group to post in it.")}</p>
        )}
      </div>

      {feed.posts.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            icon={<MessagesSquare className="size-6" aria-hidden />}
            title={t("No posts yet")}
            description={t("Be the first to start a conversation here.")}
          />
        </div>
      ) : (
        <ul className="mt-6 space-y-3">
          {feed.posts.map((post) => (
            <li key={post.id}>
              <PostCard post={post} i18n={i18n} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
