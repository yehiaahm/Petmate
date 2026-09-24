import { z } from "zod";
import { route, idParam } from "@/lib/api";
import { requireActive } from "@/lib/auth/rbac";
import { addPetPhoto, deletePetPhoto, setPrimaryPhoto } from "@/lib/services/pet.service";
import { assertOwnsFile } from "@/lib/services/upload.service";
import { cuidSchema, optionalText } from "@/lib/validation/common";

export const POST = route({
  auth: true,
  params: idParam,
  rateLimit: "upload",
  body: z.object({
    fileId: cuidSchema,
    alt: optionalText(160),
  }),
  async handler({ params, body }) {
    const auth = await requireActive();
    // The file must be one this user uploaded; a stranger's id resolves to nothing.
    const file = await assertOwnsFile(body.fileId, auth.user.id);

    const photo = await addPetPhoto(auth, params.id, {
      url: file.url,
      fileId: file.id,
      alt: body.alt,
    });
    return { photo };
  },
});

export const PATCH = route({
  auth: true,
  params: idParam,
  body: z.object({ photoId: cuidSchema, action: z.literal("make-primary") }),
  async handler({ params, body }) {
    const auth = await requireActive();
    await setPrimaryPhoto(auth, params.id, body.photoId);
    return { ok: true };
  },
});

export const DELETE = route({
  auth: true,
  params: idParam,
  body: z.object({ photoId: cuidSchema }),
  async handler({ params, body }) {
    const auth = await requireActive();
    await deletePetPhoto(auth, params.id, body.photoId);
    return { ok: true };
  },
});
