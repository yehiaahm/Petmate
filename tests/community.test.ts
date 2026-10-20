import { describe, it, expect, beforeEach } from "vitest";
import { db, makeUser, resetDatabase } from "./helpers";
import {
  createGroup,
  joinGroup,
  leaveGroup,
  getGroup,
  listGroups,
  createPost,
  listPosts,
  getPost,
  createComment,
  removeComment,
  removePost,
  toggleLike,
} from "@/lib/services/community.service";
import { fileReport, resolveReport } from "@/lib/services/safety.service";

/**
 * The community's counters (members, posts, comments, likes) are shown on
 * every page, so each test checks them against the rows they summarise.
 */

beforeEach(async () => {
  await resetDatabase();
});

async function groupWithMember() {
  const owner = await makeUser({ name: "Owner" });
  const member = await makeUser({ name: "Member" });
  const group = await createGroup(owner.auth, { name: "Golden Retrievers Cairo", species: "DOG" });
  await joinGroup(member.auth, (await getGroup(group.slug)).id);
  return { owner, member, group: await getGroup(group.slug) };
}

describe("groups", () => {
  it("makes the creator its owner and counts members once", async () => {
    const { group, member } = await groupWithMember();
    expect(group.memberCount).toBe(2);
    await joinGroup(member.auth, group.id);
    expect((await getGroup(group.slug)).memberCount).toBe(2);

    const listed = await listGroups({ viewerId: member.id });
    expect(listed[0]?.joined).toBe(true);

    await leaveGroup(member.auth, group.id);
    expect((await getGroup(group.slug)).memberCount).toBe(1);
    expect(await db.groupMember.count({ where: { groupId: group.id } })).toBe(1);
  });

  it("gives two groups with the same name different addresses", async () => {
    const a = await makeUser();
    const first = await createGroup(a.auth, { name: "Cat lovers" });
    const b = await makeUser();
    const second = await createGroup(b.auth, { name: "Cat lovers" });
    expect(first.slug).not.toBe(second.slug);
  });

  it("does not let the owner leave their own group", async () => {
    const { owner, group } = await groupWithMember();
    await expect(leaveGroup(owner.auth, group.id)).rejects.toThrow(/cannot leave/);
  });
});

describe("posts and comments", () => {
  it("lets only members post", async () => {
    const { group, member } = await groupWithMember();
    const outsider = await makeUser();
    await expect(createPost(outsider.auth, { groupId: group.id, body: "Hello everyone" })).rejects.toThrow(/Join the group/);

    const post = await createPost(member.auth, { groupId: group.id, type: "QUESTION", title: "Best food?", body: "What do you feed a 6 month old?" });
    expect((await getGroup(group.slug)).postCount).toBe(1);
    const feed = await listPosts({ groupId: group.id });
    expect(feed.posts.map((p) => p.id)).toEqual([post.id]);
  });

  it("flags scam patterns but keeps the post up with a warning", async () => {
    const { group, member } = await groupWithMember();
    const post = await createPost(member.auth, {
      groupId: group.id,
      body: "Puppies available, send the deposit first by western union",
    });
    const view = await getPost(post.id);
    expect(view.flagged).toBe(true);
    expect(await db.riskEvent.count({ where: { entityType: "POST", entityId: post.id } })).toBe(1);
  });

  it("threads replies one level deep and notifies the people involved", async () => {
    const { group, member, owner } = await groupWithMember();
    const post = await createPost(member.auth, { groupId: group.id, body: "Our boy turned one today!" });
    const comment = await createComment(owner.auth, { postId: post.id, body: "Happy birthday!" });
    const reply = await createComment(member.auth, { postId: post.id, parentId: comment.id, body: "Thank you!" });
    // A reply to a reply joins the same thread.
    const deeper = await createComment(owner.auth, { postId: post.id, parentId: reply.id, body: "🎂" });

    const view = await getPost(post.id);
    expect(view.commentCount).toBe(3);
    expect(view.threads).toHaveLength(1);
    expect(view.threads[0]!.replies.map((r) => r.id)).toEqual([reply.id, deeper.id]);

    expect(await db.notification.count({ where: { userId: member.id, type: "community.comment" } })).toBe(2);
    expect(await db.notification.count({ where: { userId: owner.id, type: "community.reply" } })).toBe(1);
  });

  it("lets the author or a group owner remove, and nobody else", async () => {
    const { group, member, owner } = await groupWithMember();
    const post = await createPost(member.auth, { groupId: group.id, body: "A post to remove" });
    const comment = await createComment(member.auth, { postId: post.id, body: "and a comment" });
    const stranger = await makeUser();

    await expect(removeComment(stranger.auth, comment.id)).rejects.toThrow(/could not be found/);
    await removeComment(owner.auth, comment.id);
    expect((await getPost(post.id)).commentCount).toBe(0);

    await removePost(member.auth, post.id);
    await expect(getPost(post.id)).rejects.toThrow(/could not be found/);
    expect((await getGroup(group.slug)).postCount).toBe(0);
  });
});

describe("likes", () => {
  it("toggles, and the count always matches the reactions", async () => {
    const { group, member, owner } = await groupWithMember();
    const post = await createPost(member.auth, { groupId: group.id, body: "Like me" });

    expect(await toggleLike(owner.auth, "POST", post.id)).toEqual({ liked: true, likeCount: 1 });
    expect(await toggleLike(member.auth, "POST", post.id)).toEqual({ liked: true, likeCount: 2 });
    expect(await toggleLike(owner.auth, "POST", post.id)).toEqual({ liked: false, likeCount: 1 });

    const reactions = await db.reaction.count({ where: { targetType: "POST", targetId: post.id } });
    expect(reactions).toBe(1);
    expect((await getPost(post.id, member.id)).liked).toBe(true);
    expect((await getPost(post.id, owner.id)).liked).toBe(false);
  });
});

describe("reports", () => {
  it("hides a post after three reports and brings it back when dismissed", async () => {
    const { group, member } = await groupWithMember();
    const post = await createPost(member.auth, { groupId: group.id, body: "Something people dislike" });

    const reports = [];
    for (let i = 0; i < 3; i++) {
      const reporter = await makeUser();
      reports.push(await fileReport(reporter.auth, { entityType: "POST", entityId: post.id, reason: "SPAM" }));
    }
    await expect(getPost(post.id)).rejects.toThrow(/could not be found/);

    const moderator = await makeUser({ roles: ["MODERATOR"] });
    await resolveReport(moderator.auth, reports[0]!.id, { status: "DISMISSED", resolution: "Not spam." });
    expect((await getPost(post.id)).id).toBe(post.id);
  });

  it("removes a reported comment and corrects the count", async () => {
    const { group, member, owner } = await groupWithMember();
    const post = await createPost(member.auth, { groupId: group.id, body: "Post" });
    const comment = await createComment(owner.auth, { postId: post.id, body: "Rude comment" });
    const reporter = await makeUser();
    const report = await fileReport(reporter.auth, { entityType: "COMMENT", entityId: comment.id, reason: "HARASSMENT" });

    const moderator = await makeUser({ roles: ["MODERATOR"] });
    await resolveReport(moderator.auth, report.id, { status: "UPHELD", resolution: "Abusive.", action: "REMOVE" });
    const view = await getPost(post.id);
    expect(view.commentCount).toBe(0);
    expect(view.threads).toHaveLength(0);
  });
});
