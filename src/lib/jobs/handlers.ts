import "server-only";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { processEmailQueue, emailTemplates } from "@/lib/email";
import { pruneRateLimits } from "@/lib/rate-limit";
import { notify } from "@/lib/services/notification.service";
import { sendDueHealthReminders } from "@/lib/services/health.service";
import { expireStaleListings } from "@/lib/services/listing.service";
import { runSavedSearches } from "@/lib/services/search.service";
import { refreshStaleMatches } from "@/lib/services/breeding.service";
import { awardAccountAgeSignals } from "@/lib/services/trust.service";
import { pruneAuthArtifacts } from "@/lib/services/auth.service";
import { pruneAnalytics } from "@/lib/services/analytics.service";
import { autoReleaseEscrow } from "@/lib/services/petorder.service";
import { autoReleaseBreedingFee } from "@/lib/services/breeding-fee.service";
import { settleFinishedCampaigns } from "@/lib/services/ad.service";
import { processMessageQueue } from "@/lib/messaging";
import { cancelOrder } from "@/lib/services/commerce.service";
import { expireSubscription } from "@/lib/services/subscription.service";
import { releaseSellerHold, releaseClinicHold } from "@/lib/payments/settlement";
import { clientEnv } from "@/lib/env";
import type { ClaimedJob, JobType } from "./queue";

/**
 * Job handlers.
 *
 * Each one must be idempotent: the queue guarantees at-least-once, not
 * exactly-once, so a handler that runs twice has to be harmless. Every one of
 * these either performs a conditional state transition or is naturally
 * repeatable.
 */

type Handler = (payload: Record<string, unknown>) => Promise<string | void>;

const handlers: Record<JobType, Handler> = {
  async "email.process"() {
    const { sent, failed } = await processEmailQueue(50);
    return `sent ${sent}, failed ${failed}`;
  },

  async "appointment.remind"(payload) {
    const appointmentId = String(payload.appointmentId ?? "");
    const window = String(payload.window ?? "24h");
    if (!appointmentId) return "missing appointmentId";

    const appointment = await db.appointment.findUnique({
      where: { id: appointmentId },
      select: {
        id: true,
        status: true,
        startAt: true,
        userId: true,
        reminder24hSentAt: true,
        reminder2hSentAt: true,
        clinic: { select: { name: true } },
        pet: { select: { name: true } },
      },
    });
    if (!appointment) return "appointment gone";
    if (appointment.status !== "CONFIRMED") return `skipped (${appointment.status})`;

    // Idempotency: the sent-at column is the guard.
    if (window === "24h" && appointment.reminder24hSentAt) return "already sent";
    if (window === "2h" && appointment.reminder2hSentAt) return "already sent";

    const when = appointment.startAt.toLocaleString("en-US", {
      weekday: "long",
      hour: "numeric",
      minute: "2-digit",
    });

    await notify({
      userId: appointment.userId,
      category: "APPOINTMENT",
      type: "appointment.reminder",
      title: `Reminder: ${appointment.pet.name} at ${appointment.clinic.name}`,
      body: when,
      url: `/dashboard/appointments/${appointment.id}`,
      entityType: "APPOINTMENT",
      entityId: appointment.id,
      email: () =>
        emailTemplates.appointmentReminder({
          petName: appointment.pet.name,
          clinicName: appointment.clinic.name,
          when,
          url: `${clientEnv.NEXT_PUBLIC_APP_URL}/dashboard/appointments/${appointment.id}`,
        }),
    });

    await db.appointment.update({
      where: { id: appointmentId },
      data: window === "24h" ? { reminder24hSentAt: new Date() } : { reminder2hSentAt: new Date() },
    });

    return `reminded (${window})`;
  },

  async "appointment.complete"(payload) {
    const appointmentId = String(payload.appointmentId ?? "");
    if (!appointmentId) return "missing appointmentId";

    // Appointments that came and went without being marked are no-shows, which
    // is a real state a clinic needs for its numbers.
    const { count } = await db.appointment.updateMany({
      where: { id: appointmentId, status: "CONFIRMED", endAt: { lt: new Date() } },
      data: { status: "NO_SHOW" },
    });
    return count ? "marked no-show" : "no change";
  },

  async "escrow.autoRelease"(payload) {
    const petOrderId = String(payload.petOrderId ?? "");
    if (!petOrderId) return "missing petOrderId";
    await autoReleaseEscrow(petOrderId);
    return "checked";
  },

  async "breeding.releaseFee"(payload) {
    const requestId = String(payload.requestId ?? "");
    if (!requestId) return "missing requestId";
    return autoReleaseBreedingFee(requestId);
  },

  async "messages.process"() {
    const { sent, failed } = await processMessageQueue();
    return `${sent} sent, ${failed} failed`;
  },

  async "ads.settle"() {
    const closed = await settleFinishedCampaigns();
    return `${closed} campaigns closed`;
  },

  async "payouts.release"(payload) {
    const orderId = String(payload.orderId ?? "");
    if (!orderId) return "missing orderId";
    await releaseSellerHold(orderId);
    return "released";
  },

  async "clinic.releaseHold"(payload) {
    const appointmentId = String(payload.appointmentId ?? "");
    if (!appointmentId) return "missing appointmentId";
    await releaseClinicHold(appointmentId);
    return "released";
  },

  async "subscription.expire"(payload) {
    const subscriptionId = String(payload.subscriptionId ?? "");
    if (!subscriptionId) return "missing subscriptionId";
    await expireSubscription(subscriptionId);
    return "checked";
  },

  async "listing.expire"(payload) {
    // The same job type also handles abandoned-checkout cleanup, because both
    // are "release something reserved that nobody completed".
    if (payload.expireOrderId) {
      const orderId = String(payload.expireOrderId);
      const order = await db.order.findUnique({
        where: { id: orderId },
        select: { status: true },
      });
      if (order?.status === "PENDING_PAYMENT") {
        await cancelOrder({
          orderId,
          reason: "Payment not completed in time",
          actorId: "system",
        });
        return "expired unpaid order";
      }
      return "order already progressed";
    }

    const count = await expireStaleListings();
    return `expired ${count} listings`;
  },

  async "health.reminders"() {
    const sent = await sendDueHealthReminders();
    return `sent ${sent}`;
  },

  async "breeding.refreshMatches"() {
    const refreshed = await refreshStaleMatches(100);
    return `refreshed ${refreshed}`;
  },

  async "savedSearch.run"() {
    const alerted = await runSavedSearches(50);
    return `alerted ${alerted}`;
  },

  async "trust.accountAge"() {
    const awarded = await awardAccountAgeSignals();
    return `awarded ${awarded}`;
  },

  async "prune.rateLimits"() {
    const removed = await pruneRateLimits();
    return `removed ${removed}`;
  },

  async "prune.auth"() {
    const result = await pruneAuthArtifacts();
    return `sessions ${result.sessions}, tokens ${result.tokens}, attempts ${result.attempts}`;
  },

  async "analytics.rollup"() {
    const removed = await pruneAnalytics(180);
    // Completed jobs are not a log; they are debris after a week.
    const jobs = await db.job.deleteMany({
      where: {
        status: "COMPLETED",
        completedAt: { lt: new Date(Date.now() - 7 * 86_400_000) },
      },
    });
    return `events ${removed}, jobs ${jobs.count}`;
  },
};

export async function runJob(job: ClaimedJob): Promise<string | void> {
  const handler = handlers[job.type];
  if (!handler) {
    logger.error("no handler for job type", { type: job.type, jobId: job.id });
    throw new Error(`No handler registered for job type "${job.type}"`);
  }
  return handler(job.payload);
}

export const registeredJobTypes = Object.keys(handlers) as JobType[];
