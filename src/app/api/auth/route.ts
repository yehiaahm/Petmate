import { z } from "zod";
import { NextResponse } from "next/server";
import { route } from "@/lib/api";
import { badRequest } from "@/lib/errors";
import {
  register,
  login,
  verifyEmail,
  resendVerification,
  requestPasswordReset,
  resetPassword,
} from "@/lib/services/auth.service";
import { destroySession, getAuth } from "@/lib/auth/session";
import { emailSchema, passwordSchema, safeText } from "@/lib/validation/common";

/**
 * Authentication endpoints.
 *
 * Collected behind one route with an `action` discriminator so the CSRF, rate
 * limiting and error shaping are identical across every auth operation, and so
 * there is exactly one file to audit for the most security-sensitive surface in
 * the product.
 */

const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("register"),
    email: emailSchema,
    password: passwordSchema,
    name: safeText(80, 2),
    role: z.enum(["USER", "BREEDER", "SELLER", "CLINIC_ADMIN"]).optional(),
    acceptedTerms: z.boolean(),
  }),
  z.object({
    action: z.literal("login"),
    email: emailSchema,
    password: z.string().min(1).max(200),
  }),
  z.object({ action: z.literal("logout") }),
  z.object({ action: z.literal("verify-email"), token: z.string().min(10).max(200) }),
  z.object({ action: z.literal("resend-verification") }),
  z.object({ action: z.literal("forgot-password"), email: emailSchema }),
  z.object({
    action: z.literal("reset-password"),
    token: z.string().min(10).max(200),
    password: passwordSchema,
  }),
]);

export const POST = route({
  body: bodySchema,
  async handler({ body, ip, userAgent }) {
    switch (body.action) {
      case "register": {
        await register({
          email: body.email,
          password: body.password,
          name: body.name,
          role: body.role,
          acceptedTerms: body.acceptedTerms,
          ip,
          userAgent,
        });
        // Registration never signs the account in: confirming the email is the
        // first step, and it is also what proves the address is real.
        return {
          ok: true,
          message: "Check your inbox to confirm your email address.",
        };
      }

      case "login": {
        const user = await login({
          email: body.email,
          password: body.password,
          ip,
          userAgent,
        });
        return { ok: true, user };
      }

      case "logout": {
        await destroySession();
        return { ok: true };
      }

      case "verify-email": {
        await verifyEmail(body.token);
        return { ok: true, message: "Your email address is confirmed." };
      }

      case "resend-verification": {
        const auth = await getAuth();
        if (!auth) throw badRequest("Sign in first.");
        await resendVerification(auth.user.id);
        return { ok: true, message: "We sent a new confirmation link." };
      }

      case "forgot-password": {
        await requestPasswordReset({ email: body.email, ip });
        // Deliberately identical whether or not the address exists.
        return {
          ok: true,
          message: "If that address has an account, a reset link is on its way.",
        };
      }

      case "reset-password": {
        await resetPassword({ token: body.token, password: body.password, ip });
        return { ok: true, message: "Your password has been changed. Sign in to continue." };
      }
    }
  },
});

/** Current session, used by client components that need the viewer. */
export const GET = route({
  async handler() {
    const auth = await getAuth();
    return NextResponse.json({ user: auth?.user ?? null });
  },
});
