import "server-only";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { conflict, forbidden, notFound } from "@/lib/errors";
import type { AuthContext } from "@/lib/auth/session";
import { isStaff } from "@/lib/auth/rbac";
import { enforceRateLimit } from "@/lib/rate-limit";
import { slugify, truncate, generateToken } from "@/lib/utils";
import { SPECIES } from "@/lib/constants";
import { safeText, safeParagraph, optionalText, cuidSchema } from "@/lib/validation/common";
import { notify } from "./notification.service";
import { scoreMessageRisk, recordRiskEvent } from "./risk.service";

/**
 * Community: groups of owners, their posts and the conversations under them.
 *
 * Reading is public, because a breed group's accumulated answers are what a
 * new owner searches for. Writing needs a confirmed account, is rate limited,
 * and goes through the same scam patterns chat messages do; flagged posts stay
 * up with a warning (the reader is who needs it) and go to the risk queue.
 * Anything three people report is hidden until a moderator decides.
 */

export const POST_TYPES = ["DISCUSSION", "QUESTION", "PHOTO", "MILESTONE", "LOST_FOUND"] as const;
export type PostType = (typeof POST_TYPES)[number];

const REPORTS_TO_HIDE = 3;

export const groupSchema = z.object({
  name: safeText(60, 3),
  description: optionalText(500),
  species: z.enum(SPECIES).optional(),
  rules: optionalText(1500),
});

export const postSchema = z.object({
  groupId: cuidSchema,
  type: z.enum(POST_TYPES).default("DISCUSSION"),
  title: optionalText(120),
  body: safeParagraph(5000, 2),
  petId: cuidSchema.optional(),
});

export const commentSchema = z.object({
  postId: cuidSchema,
  parentId: cuidSchema.optional(),
  body: safeParagraph(2000, 1),
});

const AUTHOR = { select: { id: true, name: true, handle: true, avatarUrl: true, trustScore: true } } as const;

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

export async function createGroup(auth: AuthContext, raw: z.input<typeof groupSchema>) {
  await enforceRateLimit("groupCreate", auth.user.id);
  const input = groupSchema.parse(raw);

  const base = slugify(input.name, 50) || "group";
  const taken = await db.group.findUnique({ where: { slug: base }, select: { id: true } });
  const slug = taken ? `${base}-${generateToken(3).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5)}` : base;

  const group = await db.$transaction(async (tx) => {
    const created = await tx.group.create({
      data: {
        name: input.name,
        slug,
        description: input.description ?? null,
        species: input.species ?? null,
        rules: input.rules ?? null,
        visibility: "PUBLIC",
        ownerId: auth.user.id,
        memberCount: 1,
      },
      select: { id: true, slug: true, name: true },
    });
    await tx.groupMember.create({ data: { groupId: created.id, userId: auth.user.id, role: "OWNER" } });
    await audit(
      { action: "group.created", actorId: auth.user.id, entityType: "GROUP", entityId: created.id, summary: created.name },
      tx,
    );
    return created;
  });

  return group;
}

export async function listGroups(params: { q?: string; species?: string; viewerId?: string | null } = {}) {
  const q = params.q?.trim();
  const groups = await db.group.findMany({
    where: {
      visibility: "PUBLIC",
      ...(params.species ? { species: params.species } : {}),
      ...(q ? { OR: [{ name: { contains: q } }, { description: { contains: q } }] } : {}),
    },
    orderBy: [{ memberCount: "desc" }, { createdAt: "asc" }],
    take: 60,
    select: { id: true, slug: true, name: true, description: true, species: true, memberCount: true, postCount: true },
  });

  const joined = params.viewerId
    ? new Set(
        (
          await db.groupMember.findMany({
            where: { userId: params.viewerId, groupId: { in: groups.map((g) => g.id) } },
            select: { groupId: true },
          })
        ).map((m) => m.groupId),
      )
    : new Set<string>();

  return groups.map((g) => ({ ...g, joined: joined.has(g.id) }));
}

export async function getGroup(slug: string, viewerId?: string | null) {
  const group = await db.group.findUnique({
    where: { slug },
    select: {
      id: true,
      slug: true,
      name: true,
      description: true,
      species: true,
      rules: true,
      memberCount: true,
      postCount: true,
      ownerId: true,
      visibility: true,
      createdAt: true,
    },
  });
  if (!group || group.visibility !== "PUBLIC") throw notFound("That group");

  const membership = viewerId
    ? await db.groupMember.findUnique({
        where: { groupId_userId: { groupId: group.id, userId: viewerId } },
        select: { role: true },
      })
    : null;

  return { ...group, myRole: membership?.role ?? null };
}

export async function joinGroup(auth: AuthContext, groupId: string) {
  const group = await db.group.findUnique({ where: { id: groupId }, select: { id: true, visibility: true } });
  if (!group || group.visibility !== "PUBLIC") throw notFound("That group");

  try {
    await db.$transaction([
      db.groupMember.create({ data: { groupId, userId: auth.user.id, role: "MEMBER" } }),
      db.group.update({ where: { id: groupId }, data: { memberCount: { increment: 1 } } }),
    ]);
  } catch (e) {
    // Already a member: joining twice is a no-op, not an error.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { joined: true };
    throw e;
  }
  return { joined: true };
}

export async function leaveGroup(auth: AuthContext, groupId: string) {
  const membership = await db.groupMember.findUnique({
    where: { groupId_userId: { groupId, userId: auth.user.id } },
    select: { id: true, role: true },
  });
  if (!membership) return { joined: false };
  if (membership.role === "OWNER") throw conflict("The group's creator cannot leave it.");

  await db.$transaction(async (tx) => {
    const { count } = await tx.groupMember.deleteMany({ where: { id: membership.id } });
    if (count) await tx.group.update({ where: { id: groupId }, data: { memberCount: { decrement: 1 } } });
  });
  return { joined: false };
}

// ---------------------------------------------------------------------------
// Posts
// ---------------------------------------------------------------------------

export async function createPost(auth: AuthContext, raw: z.input<typeof postSchema>) {
  await enforceRateLimit("post", auth.user.id);
  const input = postSchema.parse(raw);

  const membership = await db.groupMember.findUnique({
    where: { groupId_userId: { groupId: input.groupId, userId: auth.user.id } },
    select: { id: true },
  });
  if (!membership) throw forbidden("Join the group to post in it.");

  if (input.petId) {
    const pet = await db.pet.findFirst({ where: { id: input.petId, ownerId: auth.user.id, deletedAt: null }, select: { id: true } });
    if (!pet) throw notFound("That pet");
  }

  const risk = scoreMessageRisk(`${input.title ?? ""}\n${input.body}`);

  const post = await db.$transaction(async (tx) => {
    const created = await tx.post.create({
      data: {
        groupId: input.groupId,
        authorId: auth.user.id,
        type: input.type,
        title: input.title ?? null,
        body: input.body,
        petId: input.petId ?? null,
      },
      select: { id: true },
    });
    await tx.group.update({ where: { id: input.groupId }, data: { postCount: { increment: 1 } } });
    return created;
  });

  if (risk.flagged) {
    await recordRiskEvent({
      userId: auth.user.id,
      type: "POST_SCAM_PATTERN",
      score: 60,
      entityType: "POST",
      entityId: post.id,
      details: { reason: risk.reason },
    });
  }

  await audit({ action: "post.created", actorId: auth.user.id, entityType: "POST", entityId: post.id });
  return post;
}

export interface FeedPost {
  id: string;
  type: string;
  title: string | null;
  body: string;
  likeCount: number;
  commentCount: number;
  createdAt: Date;
  author: { id: string; name: string; handle: string; avatarUrl: string | null; trustScore: number };
  group: { slug: string; name: string } | null;
  liked: boolean;
  flagged: boolean;
}

async function decorate<T extends { id: string }>(
  posts: T[],
  viewerId: string | null | undefined,
): Promise<(T & { liked: boolean; flagged: boolean })[]> {
  const ids = posts.map((p) => p.id);
  const [likes, flags] = await Promise.all([
    viewerId
      ? db.reaction.findMany({ where: { userId: viewerId, targetType: "POST", targetId: { in: ids } }, select: { targetId: true } })
      : Promise.resolve([]),
    db.riskEvent.findMany({ where: { entityType: "POST", entityId: { in: ids } }, select: { entityId: true } }),
  ]);
  const liked = new Set(likes.map((l) => l.targetId));
  const flagged = new Set(flags.map((f) => f.entityId));
  return posts.map((p) => ({ ...p, liked: liked.has(p.id), flagged: flagged.has(p.id) }));
}

export async function listPosts(params: { groupId?: string; viewerId?: string | null; before?: Date; limit?: number }) {
  const limit = Math.min(params.limit ?? 20, 50);
  const posts = await db.post.findMany({
    where: {
      status: "PUBLISHED",
      ...(params.groupId ? { groupId: params.groupId } : { group: { visibility: "PUBLIC" } }),
      ...(params.before ? { createdAt: { lt: params.before } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    select: {
      id: true,
      type: true,
      title: true,
      body: true,
      likeCount: true,
      commentCount: true,
      createdAt: true,
      author: AUTHOR,
      group: { select: { slug: true, name: true } },
    },
  });
  const page = posts.slice(0, limit);
  return {
    posts: (await decorate(page, params.viewerId)).map((p) => ({ ...p, body: truncate(p.body, 600) })),
    nextBefore: posts.length > limit ? page[page.length - 1]!.createdAt.toISOString() : null,
  };
}

export async function getPost(postId: string, viewerId?: string | null) {
  const post = await db.post.findUnique({
    where: { id: postId },
    select: {
      id: true,
      type: true,
      title: true,
      body: true,
      status: true,
      likeCount: true,
      commentCount: true,
      createdAt: true,
      authorId: true,
      author: AUTHOR,
      group: { select: { id: true, slug: true, name: true, visibility: true } },
      comments: {
        where: { status: "PUBLISHED" },
        orderBy: { createdAt: "asc" },
        take: 300,
        select: { id: true, parentId: true, body: true, likeCount: true, createdAt: true, authorId: true, author: AUTHOR },
      },
    },
  });
  if (!post || post.status !== "PUBLISHED" || (post.group && post.group.visibility !== "PUBLIC")) {
    throw notFound("That post");
  }

  const [decorated] = await decorate([post], viewerId);
  const commentLikes = viewerId
    ? new Set(
        (
          await db.reaction.findMany({
            where: { userId: viewerId, targetType: "COMMENT", targetId: { in: post.comments.map((c) => c.id) } },
            select: { targetId: true },
          })
        ).map((r) => r.targetId),
      )
    : new Set<string>();

  const membership =
    viewerId && post.group
      ? await db.groupMember.findUnique({
          where: { groupId_userId: { groupId: post.group.id, userId: viewerId } },
          select: { role: true },
        })
      : null;

  // One level of replies: a reply to a reply joins its thread.
  const top = post.comments.filter((c) => !c.parentId);
  const threads = top.map((c) => ({
    ...c,
    liked: commentLikes.has(c.id),
    replies: post.comments.filter((r) => r.parentId === c.id).map((r) => ({ ...r, liked: commentLikes.has(r.id) })),
  }));

  return { ...decorated!, threads, myRole: membership?.role ?? null };
}

/** Whether someone may take down a post or comment in a group. */
async function canModerate(auth: AuthContext, groupId: string | null, authorId: string): Promise<boolean> {
  if (authorId === auth.user.id || isStaff(auth.user)) return true;
  if (!groupId) return false;
  const membership = await db.groupMember.findUnique({
    where: { groupId_userId: { groupId, userId: auth.user.id } },
    select: { role: true },
  });
  return membership?.role === "OWNER" || membership?.role === "MODERATOR";
}

export async function removePost(auth: AuthContext, postId: string) {
  const post = await db.post.findUnique({ where: { id: postId }, select: { id: true, groupId: true, authorId: true, status: true } });
  if (!post || post.status === "REMOVED") throw notFound("That post");
  if (!(await canModerate(auth, post.groupId, post.authorId))) throw notFound("That post");

  await db.$transaction(async (tx) => {
    const { count } = await tx.post.updateMany({ where: { id: postId, status: { not: "REMOVED" } }, data: { status: "REMOVED" } });
    if (count && post.groupId) await tx.group.update({ where: { id: post.groupId }, data: { postCount: { decrement: 1 } } });
  });
  await audit({ action: "post.removed", actorId: auth.user.id, entityType: "POST", entityId: postId });
  return { removed: true };
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

export async function createComment(auth: AuthContext, raw: z.input<typeof commentSchema>) {
  await enforceRateLimit("comment", auth.user.id);
  const input = commentSchema.parse(raw);

  const post = await db.post.findUnique({
    where: { id: input.postId },
    select: { id: true, status: true, authorId: true, title: true, body: true, group: { select: { visibility: true } } },
  });
  if (!post || post.status !== "PUBLISHED" || post.group?.visibility !== "PUBLIC") throw notFound("That post");

  let parentId: string | null = null;
  let parentAuthorId: string | null = null;
  if (input.parentId) {
    const parent = await db.comment.findFirst({
      where: { id: input.parentId, postId: post.id, status: "PUBLISHED" },
      select: { id: true, parentId: true, authorId: true },
    });
    if (!parent) throw notFound("That comment");
    parentId = parent.parentId ?? parent.id;
    parentAuthorId = parent.authorId;
  }

  const comment = await db.$transaction(async (tx) => {
    const created = await tx.comment.create({
      data: { postId: post.id, authorId: auth.user.id, parentId, body: input.body },
      select: { id: true },
    });
    await tx.post.update({ where: { id: post.id }, data: { commentCount: { increment: 1 } } });
    return created;
  });

  const risk = scoreMessageRisk(input.body);
  if (risk.flagged) {
    await recordRiskEvent({
      userId: auth.user.id,
      type: "COMMENT_SCAM_PATTERN",
      score: 60,
      entityType: "COMMENT",
      entityId: comment.id,
      details: { reason: risk.reason, postId: post.id },
    });
  }

  const subject = truncate(post.title ?? post.body, 60);
  const recipients = new Set([post.authorId, parentAuthorId].filter((id): id is string => Boolean(id) && id !== auth.user.id));
  for (const userId of recipients) {
    await notify({
      userId,
      category: "COMMUNITY",
      type: userId === post.authorId ? "community.comment" : "community.reply",
      title: userId === post.authorId ? `${auth.user.name} commented on your post` : `${auth.user.name} replied to you`,
      body: subject,
      url: `/community/posts/${post.id}#comment-${comment.id}`,
      entityType: "POST",
      entityId: post.id,
    });
  }

  return comment;
}

export async function removeComment(auth: AuthContext, commentId: string) {
  const comment = await db.comment.findUnique({
    where: { id: commentId },
    select: { id: true, postId: true, authorId: true, status: true, post: { select: { groupId: true } } },
  });
  if (!comment || comment.status === "REMOVED") throw notFound("That comment");
  if (!(await canModerate(auth, comment.post.groupId, comment.authorId))) throw notFound("That comment");

  await db.$transaction(async (tx) => {
    const { count } = await tx.comment.updateMany({
      where: { id: commentId, status: { not: "REMOVED" } },
      data: { status: "REMOVED" },
    });
    if (count) await tx.post.update({ where: { id: comment.postId }, data: { commentCount: { decrement: 1 } } });
  });
  await audit({ action: "comment.removed", actorId: auth.user.id, entityType: "COMMENT", entityId: commentId });
  return { removed: true };
}

// ---------------------------------------------------------------------------
// Reactions
// ---------------------------------------------------------------------------

/** Likes or unlikes. The unique index makes a double click one like. */
export async function toggleLike(auth: AuthContext, targetType: "POST" | "COMMENT", targetId: string) {
  const exists =
    targetType === "POST"
      ? await db.post.findFirst({ where: { id: targetId, status: "PUBLISHED" }, select: { id: true } })
      : await db.comment.findFirst({ where: { id: targetId, status: "PUBLISHED" }, select: { id: true } });
  if (!exists) throw notFound(targetType === "POST" ? "That post" : "That comment");

  const bump = (by: number) =>
    targetType === "POST"
      ? db.post.update({ where: { id: targetId }, data: { likeCount: { increment: by } }, select: { likeCount: true } })
      : db.comment.update({ where: { id: targetId }, data: { likeCount: { increment: by } }, select: { likeCount: true } });

  const removed = await db.reaction.deleteMany({ where: { userId: auth.user.id, targetType, targetId } });
  if (removed.count > 0) {
    const { likeCount } = await bump(-removed.count);
    return { liked: false, likeCount };
  }

  try {
    await db.reaction.create({ data: { userId: auth.user.id, targetType, targetId, kind: "LIKE" } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const current = targetType === "POST"
        ? await db.post.findUniqueOrThrow({ where: { id: targetId }, select: { likeCount: true } })
        : await db.comment.findUniqueOrThrow({ where: { id: targetId }, select: { likeCount: true } });
      return { liked: true, likeCount: current.likeCount };
    }
    throw e;
  }
  const { likeCount } = await bump(1);
  return { liked: true, likeCount };
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

/**
 * Called after a report is filed: enough independent reports take a post or
 * comment down until a moderator looks. The count is never shown to anyone.
 */
export async function hideIfReportedEnough(entityType: string, entityId: string, openReports: number) {
  if (openReports < REPORTS_TO_HIDE) return;
  if (entityType === "POST") {
    await db.post.updateMany({ where: { id: entityId, status: "PUBLISHED" }, data: { status: "HIDDEN" } });
  } else if (entityType === "COMMENT") {
    await db.comment.updateMany({ where: { id: entityId, status: "PUBLISHED" }, data: { status: "HIDDEN" } });
  }
}

/** A moderator dismissed the reports: bring hidden content back. */
export async function restoreIfHidden(entityType: string, entityId: string) {
  if (entityType === "POST") {
    await db.post.updateMany({ where: { id: entityId, status: "HIDDEN" }, data: { status: "PUBLISHED" } });
  } else if (entityType === "COMMENT") {
    await db.comment.updateMany({ where: { id: entityId, status: "HIDDEN" }, data: { status: "PUBLISHED" } });
  }
}
