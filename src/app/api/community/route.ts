import { z } from "zod";
import { route } from "@/lib/api";
import { requireActive } from "@/lib/auth/rbac";
import {
  groupSchema,
  postSchema,
  commentSchema,
  createGroup,
  joinGroup,
  leaveGroup,
  createPost,
  removePost,
  createComment,
  removeComment,
  toggleLike,
  listPosts,
} from "@/lib/services/community.service";
import { cuidSchema } from "@/lib/validation/common";

export const GET = route({
  query: z.object({
    groupId: cuidSchema.optional(),
    before: z.string().datetime().optional(),
  }),
  async handler({ query, auth }) {
    return listPosts({
      groupId: query.groupId,
      before: query.before ? new Date(query.before) : undefined,
      viewerId: auth?.user.id ?? null,
    });
  },
});

export const POST = route({
  auth: true,
  verifiedEmail: true,
  body: z.discriminatedUnion("action", [
    z.object({ action: z.literal("create-group"), group: groupSchema }),
    z.object({ action: z.literal("join"), groupId: cuidSchema }),
    z.object({ action: z.literal("leave"), groupId: cuidSchema }),
    z.object({ action: z.literal("post"), post: postSchema }),
    z.object({ action: z.literal("remove-post"), postId: cuidSchema }),
    z.object({ action: z.literal("comment"), comment: commentSchema }),
    z.object({ action: z.literal("remove-comment"), commentId: cuidSchema }),
    z.object({ action: z.literal("like"), targetType: z.enum(["POST", "COMMENT"]), targetId: cuidSchema }),
  ]),
  async handler({ body }) {
    const auth = await requireActive();
    switch (body.action) {
      case "create-group":
        return { group: await createGroup(auth, body.group) };
      case "join":
        return joinGroup(auth, body.groupId);
      case "leave":
        return leaveGroup(auth, body.groupId);
      case "post":
        return { post: await createPost(auth, body.post) };
      case "remove-post":
        return removePost(auth, body.postId);
      case "comment":
        return { comment: await createComment(auth, body.comment) };
      case "remove-comment":
        return removeComment(auth, body.commentId);
      case "like":
        return toggleLike(auth, body.targetType, body.targetId);
    }
  },
});
