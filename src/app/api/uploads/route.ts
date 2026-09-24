import { NextResponse } from "next/server";
import { route } from "@/lib/api";
import { requireActive } from "@/lib/auth/rbac";
import { badRequest } from "@/lib/errors";
import { storeUpload, type UploadPurpose } from "@/lib/services/upload.service";
import { LIMITS } from "@/lib/constants";

const ALLOWED_PURPOSES: UploadPurpose[] = [
  "PET_PHOTO",
  "PET_DOCUMENT",
  "PRODUCT_IMAGE",
  "AVATAR",
  "BANNER",
  "VERIFICATION",
  "EVIDENCE",
  "DELIVERY_PROOF",
  "MESSAGE_ATTACHMENT",
];

/**
 * File upload.
 *
 * Reads the multipart body directly rather than going through `route()`'s JSON
 * parser, but still runs inside the wrapper so CSRF, auth and rate limiting are
 * applied the same way as everywhere else.
 */
export const POST = route({
  auth: true,
  rateLimit: "upload",
  async handler({ request }) {
    const auth = await requireActive();

    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.includes("multipart/form-data")) {
      throw badRequest("Send the file as multipart form data.");
    }

    const declaredLength = Number(request.headers.get("content-length") ?? 0);
    if (declaredLength > LIMITS.maxDocumentBytes + 1024 * 64) {
      throw badRequest("That file is too large.");
    }

    const form = await request.formData();
    const purpose = String(form.get("purpose") ?? "");
    const file = form.get("file");

    if (!ALLOWED_PURPOSES.includes(purpose as UploadPurpose)) {
      throw badRequest("Unknown upload purpose.");
    }
    if (!(file instanceof File)) throw badRequest("No file was attached.");

    const stored = await storeUpload({
      file,
      purpose: purpose as UploadPurpose,
      ownerId: auth.user.id,
    });

    return NextResponse.json({ file: stored });
  },
});
