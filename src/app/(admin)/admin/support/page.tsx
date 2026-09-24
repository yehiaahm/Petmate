import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/rbac";
import { listSupportQueue } from "@/lib/services/support.service";
import { SupportQueue } from "@/components/admin/support-queue";
import { PageHeader } from "@/components/ui/primitives";

export const metadata: Metadata = {
  title: "Support queue",
  robots: { index: false, follow: false },
};

export default async function AdminSupportPage() {
  await requirePermission("admin:moderation");
  const tickets = await listSupportQueue();

  return (
    <>
      <PageHeader
        title="Support"
        description="Highest priority first, then oldest reply. Safety and payment tickets arrive marked high on their own."
      />
      <div className="mt-6">
        <SupportQueue
          tickets={tickets.map((t) => ({
            id: t.id,
            reference: t.reference,
            subject: t.subject,
            topic: t.topic,
            status: t.status,
            priority: t.priority,
            name: t.name,
            email: t.email,
            hasAccount: t.userId !== null,
            messageCount: t._count.messages,
            createdAt: t.createdAt.toISOString(),
            lastReplyAt: t.lastReplyAt.toISOString(),
          }))}
        />
      </div>
    </>
  );
}
