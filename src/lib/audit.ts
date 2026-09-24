import "server-only";
import { db, type DbClient } from "@/lib/db";
import { stringifyJson, redact } from "@/lib/json";
import { logger } from "@/lib/logger";

/**
 * Audit log.
 *
 * Written for anything that changes money, permissions, account state or
 * published content. When a dispute or an incident happens six months from now,
 * this table is the only record of who did what.
 *
 * Accepts a transaction client, so the audit entry commits or rolls back with
 * the change it describes. An audit row for an action that never happened is
 * worse than no row at all.
 */

export type AuditAction =
  | "auth.register"
  | "auth.login"
  | "auth.login_failed"
  | "auth.logout"
  | "auth.password_reset_requested"
  | "auth.password_reset_completed"
  | "auth.password_changed"
  | "auth.email_verified"
  | "auth.sessions_revoked"
  | "user.updated"
  | "user.role_granted"
  | "user.role_revoked"
  | "user.suspended"
  | "user.reinstated"
  | "user.deleted"
  | "pet.created"
  | "pet.updated"
  | "pet.deleted"
  | "pet.transferred"
  | "listing.created"
  | "listing.published"
  | "listing.updated"
  | "listing.paused"
  | "listing.completed"
  | "listing.moderated"
  | "listing.removed"
  | "adoption.applied"
  | "adoption.decided"
  | "breeding.requested"
  | "breeding.responded"
  | "breeding.agreed"
  | "breeding.completed"
  | "breeding.fee_paid"
  | "breeding.fee_released"
  | "breeding.fee_refunded"
  | "breeding.fee_disputed"
  | "ad.created"
  | "ad.reviewed"
  | "ad.completed"
  | "group.created"
  | "post.created"
  | "post.removed"
  | "comment.removed"
  | "health.record_created"
  | "health.record_updated"
  | "appointment.booked"
  | "appointment.cancelled"
  | "appointment.completed"
  | "product.archived"
  | "product.imported"
  | "order.placed"
  | "order.cancelled"
  | "order.fulfilled"
  | "petorder.created"
  | "petorder.escrow_released"
  | "payment.created"
  | "payment.succeeded"
  | "payment.failed"
  | "payment.refunded"
  | "payout.requested"
  | "payout.approved"
  | "payout.rejected"
  | "subscription.started"
  | "subscription.cancelled"
  | "dispute.opened"
  | "dispute.resolved"
  | "report.filed"
  | "support.ticket_opened"
  | "support.status_changed"
  | "report.resolved"
  | "verification.submitted"
  | "verification.decided"
  | "admin.setting_changed"
  | "admin.impersonation_denied";

export interface AuditInput {
  action: AuditAction;
  actorId?: string | null;
  actorRole?: string | null;
  entityType?: string;
  entityId?: string;
  summary?: string;
  metadata?: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
}

export async function audit(input: AuditInput, client: DbClient = db): Promise<void> {
  try {
    await client.auditLog.create({
      data: {
        action: input.action,
        actorId: input.actorId ?? null,
        actorRole: input.actorRole ?? null,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        summary: input.summary?.slice(0, 500) ?? null,
        metadata: input.metadata ? stringifyJson(redact(input.metadata)) : null,
        ip: input.ip ?? null,
        userAgent: input.userAgent?.slice(0, 300) ?? null,
      },
    });
  } catch (e) {
    // An audit failure must never break the operation it describes, but it is
    // a real incident: a gap in the log is exactly what an attacker wants.
    logger.exception("AUDIT WRITE FAILED", e, { action: input.action, entityId: input.entityId });
  }
}
