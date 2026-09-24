import { z } from "zod";
import { route } from "@/lib/api";
import { requireActive } from "@/lib/auth/rbac";
import {
  getAvailability,
  bookAppointment,
  bookingSchema,
  cancelAppointment,
  completeAppointment,
  listMyAppointments,
  listClinicAppointments,
} from "@/lib/services/vet.service";
import { createPayment } from "@/lib/payments/service";
import { clientEnv } from "@/lib/env";
import { cuidSchema, optionalText, safeParagraph } from "@/lib/validation/common";

export const GET = route({
  query: z.object({
    mode: z.enum(["availability", "mine", "clinic"]).default("mine"),
    clinicId: cuidSchema.optional(),
    serviceId: cuidSchema.optional(),
    vetId: cuidSchema.optional(),
    from: z.string().datetime({ offset: true }).optional(),
    days: z.coerce.number().int().min(1).max(60).default(14),
    upcoming: z.coerce.boolean().optional(),
  }),
  async handler({ query }) {
    // Availability is public: people compare clinics before creating an account.
    if (query.mode === "availability") {
      if (!query.clinicId || !query.serviceId) return { slots: [] };
      const slots = await getAvailability({
        clinicId: query.clinicId,
        serviceId: query.serviceId,
        vetId: query.vetId,
        from: query.from ? new Date(query.from) : new Date(),
        days: query.days,
      });
      return { slots };
    }

    const auth = await requireActive();

    if (query.mode === "clinic") {
      if (!query.clinicId) return { appointments: [] };
      const appointments = await listClinicAppointments(auth, query.clinicId, {
        from: query.from ? new Date(query.from) : undefined,
      });
      return { appointments };
    }

    const appointments = await listMyAppointments(auth, { upcoming: query.upcoming });
    return { appointments };
  },
});

export const POST = route({
  auth: true,
  verifiedEmail: true,
  body: z.discriminatedUnion("action", [
    z.object({
      action: z.literal("book"),
      booking: bookingSchema,
      idempotencyKey: z.string().min(8).max(64),
    }),
    z.object({
      action: z.literal("cancel"),
      appointmentId: cuidSchema,
      reason: optionalText(300),
    }),
    z.object({
      action: z.literal("complete"),
      appointmentId: cuidSchema,
      outcome: safeParagraph(1000, 0).optional(),
      clinicNotes: safeParagraph(2000, 0).optional(),
    }),
  ]),
  async handler({ body }) {
    const auth = await requireActive();

    switch (body.action) {
      case "book": {
        const appointment = await bookAppointment(auth, body.booking);

        // The price comes from the appointment row, which came from the service
        // row. The client never states an amount.
        const payment = await createPayment({
          userId: auth.user.id,
          purpose: "APPOINTMENT",
          referenceType: "APPOINTMENT",
          referenceId: appointment.id,
          amountCents: appointment.priceCents,
          currency: appointment.currency,
          description: `${appointment.serviceName} at ${appointment.clinicName}`,
          idempotencyKey: `appointment:${appointment.id}:${body.idempotencyKey}`,
          returnUrl: `${clientEnv.NEXT_PUBLIC_APP_URL}/dashboard/appointments/${appointment.id}`,
          customerEmail: auth.user.email,
        });

        return { appointment, payment };
      }

      case "cancel":
        return cancelAppointment(auth, body.appointmentId, body.reason);

      case "complete":
        await completeAppointment(auth, body.appointmentId, {
          outcome: body.outcome,
          clinicNotes: body.clinicNotes,
        });
        return { ok: true };
    }
  },
});
