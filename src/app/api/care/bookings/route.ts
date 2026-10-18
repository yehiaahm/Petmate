import { z } from "zod";
import { route } from "@/lib/api";
import { requireActive } from "@/lib/auth/rbac";
import {
  bookCare,
  cancelCareBooking,
  careBookingSchema,
  careUpdateSchema,
  checkInBooking,
  completeCareBooking,
  completeTransport,
  getCareBookingForCustomer,
  getCareBookingForProvider,
  listMyCareBookings,
  listProviderBookings,
  markCareNoShow,
  postCareUpdate,
  quoteCareBooking,
  recordTrainingSession,
  startTransport,
} from "@/lib/services/care-booking.service";
import { createPayment } from "@/lib/payments/service";
import { clientEnv } from "@/lib/env";
import { enforceRateLimit } from "@/lib/rate-limit";
import { cuidSchema, optionalText, safeParagraph } from "@/lib/validation/common";

export const GET = route({
  auth: true,
  query: z.object({
    mode: z.enum(["mine", "one", "provider", "provider-one"]).default("mine"),
    id: cuidSchema.optional(),
    providerId: cuidSchema.optional(),
    scope: z.enum(["active", "past"]).default("active"),
  }),
  async handler({ query }) {
    const auth = await requireActive();

    switch (query.mode) {
      case "one":
        if (!query.id) return { booking: null };
        return { booking: await getCareBookingForCustomer(auth, query.id) };
      case "provider":
        if (!query.providerId) return { bookings: [] };
        return { bookings: await listProviderBookings(auth, query.providerId, { scope: query.scope }) };
      case "provider-one":
        if (!query.id) return { booking: null };
        return { booking: await getCareBookingForProvider(auth, query.id) };
      default:
        return { bookings: await listMyCareBookings(auth) };
    }
  },
});

export const POST = route({
  auth: true,
  verifiedEmail: true,
  body: z.discriminatedUnion("action", [
    z.object({ action: z.literal("quote"), booking: careBookingSchema }),
    z.object({
      action: z.literal("book"),
      booking: careBookingSchema,
      idempotencyKey: z.string().min(8).max(64),
    }),
    z.object({ action: z.literal("cancel"), bookingId: cuidSchema, reason: optionalText(300) }),
    z.object({ action: z.literal("check-in"), bookingId: cuidSchema }),
    z.object({ action: z.literal("complete"), bookingId: cuidSchema }),
    z.object({ action: z.literal("no-show"), bookingId: cuidSchema }),
    z.object({ action: z.literal("start-transport"), transportId: cuidSchema, driverName: optionalText(80) }),
    z.object({
      action: z.literal("complete-transport"),
      transportId: cuidSchema,
      code: z.string().regex(/^\s*\d{6}\s*$/, "Enter the six-digit code."),
    }),
    z.object({
      action: z.literal("record-session"),
      sessionId: cuidSchema,
      outcome: z.enum(["COMPLETED", "MISSED"]),
      notes: safeParagraph(2000, 0).optional(),
    }),
    z.object({ action: z.literal("post-update"), update: careUpdateSchema }),
  ]),
  async handler({ body }) {
    const auth = await requireActive();

    switch (body.action) {
      case "quote":
        return { quote: await quoteCareBooking(auth, body.booking) };

      case "book": {
        // Booking holds real capacity for half an hour, so it is limited like
        // a checkout; the team's day-to-day actions are not.
        await enforceRateLimit("checkout", auth.user.id);
        const booking = await bookCare(auth, body.booking);

        // The amount comes from the booking row, which the service computed
        // from the provider's own prices. The client never states one.
        const payment = await createPayment({
          userId: auth.user.id,
          purpose: "CARE_BOOKING",
          referenceType: "CARE_BOOKING",
          referenceId: booking.id,
          amountCents: booking.totalCents,
          currency: booking.currency,
          description: `${booking.serviceLabel} at ${booking.providerName}`,
          idempotencyKey: `care:${booking.id}:${body.idempotencyKey}`,
          returnUrl: `${clientEnv.NEXT_PUBLIC_APP_URL}/dashboard/bookings/${booking.id}`,
          customerEmail: auth.user.email,
        });

        return { booking, payment };
      }

      case "cancel":
        return cancelCareBooking(auth, body.bookingId, body.reason);
      case "check-in":
        await checkInBooking(auth, body.bookingId);
        return { ok: true };
      case "complete":
        await completeCareBooking(auth, body.bookingId);
        return { ok: true };
      case "no-show":
        await markCareNoShow(auth, body.bookingId);
        return { ok: true };
      case "start-transport":
        await startTransport(auth, body.transportId, body.driverName);
        return { ok: true };
      case "complete-transport":
        await completeTransport(auth, body.transportId, body.code.trim());
        return { ok: true };
      case "record-session":
        await recordTrainingSession(auth, body.sessionId, { outcome: body.outcome, notes: body.notes });
        return { ok: true };
      case "post-update":
        return { event: await postCareUpdate(auth, body.update) };
    }
  },
});
