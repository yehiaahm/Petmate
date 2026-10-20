import type { Metadata } from "next";
import Link from "next/link";
import { Users, MessagesSquare } from "lucide-react";
import { getAuth } from "@/lib/auth/session";
import { listGroups, listPosts } from "@/lib/services/community.service";
import { getI18n } from "@/lib/i18n/server";
import { PageHeader, EmptyState, Badge } from "@/components/ui/primitives";
import { CreateGroupButton, JoinButton } from "@/components/community/community-actions";
import { PostCard } from "@/components/community/post-card";
import { SPECIES_LABEL, type Species } from "@/lib/constants";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
    title: t("Community"),
    description: t("Groups where pet owners in Egypt ask questions, share tips and help find lost pets."),
  };
}

export default async function CommunityPage() {
  const [auth, i18n] = await Promise.all([getAuth(), getI18n()]);
  const { t } = i18n;
  const viewerId = auth?.user.id ?? null;
  const [groups, feed] = await Promise.all([listGroups({ viewerId }), listPosts({ viewerId, limit: 20 })]);

  return (
    <div className="container-page py-8 lg:py-10">
      <PageHeader
        eyebrow={t("Community")}
        title={t("Pet owners helping each other")}
        description={t("Ask the people who have the same breed, share what worked, and help find lost pets nearby.")}
        action={<CreateGroupButton signedIn={Boolean(auth)} />}
      />

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_20rem]">
        <section aria-labelledby="feed-heading" className="min-w-0">
          <h2 id="feed-heading" className="font-display text-lg font-semibold text-fg">
            {t("Latest posts")}
          </h2>
          {feed.posts.length === 0 ? (
            <div className="mt-4">
              <EmptyState
                icon={<MessagesSquare className="size-6" aria-hidden />}
                title={t("No posts yet")}
                description={t("Join a group and start the first conversation.")}
              />
            </div>
          ) : (
            <ul className="mt-4 space-y-3">
              {feed.posts.map((post) => (
                <li key={post.id}>
                  <PostCard post={post} i18n={i18n} showGroup />
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside aria-labelledby="groups-heading">
          <h2 id="groups-heading" className="font-display text-lg font-semibold text-fg">
            {t("Groups")}
          </h2>
          {groups.length === 0 ? (
            <p className="mt-4 text-sm text-fg-muted">{t("No groups yet. Start the first one.")}</p>
          ) : (
            <ul className="mt-4 space-y-2">
              {groups.map((group) => (
                <li
                  key={group.id}
                  className="flex items-start justify-between gap-3 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--bg-elevated)] p-3"
                >
                  <div className="min-w-0">
                    <Link href={`/community/${group.slug}`} className="font-semibold text-fg hover:underline">
                      {group.name}
                    </Link>
                    <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-fg-subtle">
                      <span className="inline-flex items-center gap-1">
                        <Users className="size-3" aria-hidden />
                        {t.plural(group.memberCount, { one: "{count} member", other: "{count} members" })}
                      </span>
                      {group.species && <Badge size="sm">{t(SPECIES_LABEL[group.species as Species] ?? group.species)}</Badge>}
                      <span>{t.plural(group.postCount, { one: "{count} post", other: "{count} posts" })}</span>
                    </p>
                  </div>
                  {auth && <JoinButton groupId={group.id} joined={group.joined} />}
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </div>
  );
}
