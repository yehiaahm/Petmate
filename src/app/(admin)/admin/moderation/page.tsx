import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { parseJsonArray, parseJsonRecord } from "@/lib/json";
import { ModerationQueues } from "@/components/admin/moderation-queues";
import { PageHeader } from "@/components/ui/primitives";

export const metadata: Metadata = {
  title: "Moderation",
  robots: { index: false, follow: false },
};

export default async function ModerationPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  await requirePermission("admin:moderation");
  const { tab } = await searchParams;

  // Read once here rather than per row during render: "new account" is a
  // property of this request, not of whenever React got round to rendering.
  // A server component renders once per request, so this is the request's
  // timestamp rather than a value that can change between renders.
  // eslint-disable-next-line react-hooks/purity -- server render, once per request
  const newAccountCutoff = new Date(Date.now() - 14 * 86_400_000);

  const [reports, listings, verifications, disputes, risks] = await Promise.all([
    db.report.findMany({
      where: { status: { in: ["OPEN", "IN_REVIEW"] } },
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
      take: 50,
      select: {
        id: true,
        entityType: true,
        entityId: true,
        reason: true,
        details: true,
        priority: true,
        createdAt: true,
        reporter: { select: { name: true, handle: true, trustScore: true } },
      },
    }),
    db.listing.findMany({
      where: { status: "PENDING_REVIEW", deletedAt: null },
      orderBy: { createdAt: "asc" },
      take: 50,
      select: {
        id: true,
        title: true,
        slug: true,
        description: true,
        priceCents: true,
        currency: true,
        intent: true,
        moderationNote: true,
        createdAt: true,
        seller: {
          select: { name: true, handle: true, trustScore: true, createdAt: true },
        },
        pet: {
          select: {
            name: true,
            species: true,
            healthScore: true,
            verificationLevel: true,
            photos: { where: { isPrimary: true }, take: 1, select: { url: true } },
          },
        },
      },
    }),
    db.verification.findMany({
      where: { status: { in: ["PENDING", "IN_REVIEW"] } },
      orderBy: { createdAt: "asc" },
      take: 50,
      select: {
        id: true,
        subjectType: true,
        subjectId: true,
        type: true,
        documents: true,
        notes: true,
        createdAt: true,
        user: { select: { name: true, handle: true, email: true, trustScore: true } },
      },
    }),
    db.dispute.findMany({
      where: { status: { in: ["OPEN", "AWAITING_RESPONSE", "IN_REVIEW"] } },
      orderBy: { createdAt: "asc" },
      take: 50,
      select: {
        id: true,
        reference: true,
        reason: true,
        status: true,
        details: true,
        amountCents: true,
        createdAt: true,
        responseDueAt: true,
        raisedBy: { select: { name: true, handle: true } },
        against: { select: { name: true, handle: true } },
        petOrder: { select: { currency: true, listing: { select: { title: true } } } },
        order: { select: { currency: true, orderNumber: true } },
        _count: { select: { messages: true } },
      },
    }),
    db.riskEvent.findMany({
      where: { handled: false, score: { gte: 40 } },
      orderBy: [{ score: "desc" }, { createdAt: "desc" }],
      take: 30,
      select: {
        id: true,
        type: true,
        score: true,
        entityType: true,
        entityId: true,
        details: true,
        createdAt: true,
        user: { select: { name: true, handle: true } },
      },
    }),
  ]);

  // Risk is recorded as events against the entity, not as a column on it, so
  // the score shown next to a listing is looked up here rather than joined.
  const listingRisk = new Map<string, { score: number; reasons: string[] }>();
  if (listings.length > 0) {
    const events = await db.riskEvent.findMany({
      where: { entityType: "LISTING", entityId: { in: listings.map((l) => l.id) } },
      orderBy: { createdAt: "desc" },
      select: { entityId: true, score: true, details: true },
    });
    for (const event of events) {
      if (!event.entityId || listingRisk.has(event.entityId)) continue;
      const parsed = parseJsonRecord(event.details);
      const reasons = Array.isArray(parsed.reasons)
        ? parsed.reasons.filter((r): r is string => typeof r === "string")
        : [];
      listingRisk.set(event.entityId, { score: event.score, reasons });
    }
  }

  return (
    <>
      <PageHeader
        title="Moderation"
        description="Oldest first inside each queue, except reports, where priority wins. Animal-welfare reports are filed as urgent on arrival."
      />

      <div className="mt-6">
        <ModerationQueues
          initialTab={tab ?? "reports"}
          reports={reports.map((r) => ({
            ...r,
            createdAt: r.createdAt.toISOString(),
          }))}
          listings={listings.map((l) => ({
            id: l.id,
            title: l.title,
            slug: l.slug,
            description: l.description,
            priceCents: l.priceCents,
            currency: l.currency,
            intent: l.intent,
            riskScore: listingRisk.get(l.id)?.score ?? 0,
            riskFlags: listingRisk.get(l.id)?.reasons ?? [],
            createdAt: l.createdAt.toISOString(),
            sellerName: l.seller.name,
            sellerHandle: l.seller.handle,
            sellerTrust: l.seller.trustScore,
            sellerJoined: l.seller.createdAt.toISOString(),
            sellerIsNew: l.seller.createdAt > newAccountCutoff,
            petName: l.pet.name,
            petSpecies: l.pet.species,
            petHealthScore: l.pet.healthScore,
            petVerification: l.pet.verificationLevel,
            photoUrl: l.pet.photos[0]?.url ?? null,
          }))}
          verifications={verifications.map((v) => ({
            id: v.id,
            subjectType: v.subjectType,
            subjectId: v.subjectId,
            type: v.type,
            notes: v.notes,
            documentCount: parseJsonArray<string>(v.documents).length,
            createdAt: v.createdAt.toISOString(),
            userName: v.user?.name ?? "Unknown",
            userHandle: v.user?.handle ?? "",
            userTrust: v.user?.trustScore ?? 0,
          }))}
          disputes={disputes.map((d) => ({
            id: d.id,
            reference: d.reference,
            reason: d.reason,
            status: d.status,
            details: d.details,
            amountCents: d.amountCents,
            currency: d.petOrder?.currency ?? d.order?.currency ?? "USD",
            createdAt: d.createdAt.toISOString(),
            responseDueAt: d.responseDueAt?.toISOString() ?? null,
            raisedByName: d.raisedBy.name,
            againstName: d.against.name,
            subject: d.petOrder?.listing.title ?? d.order?.orderNumber ?? "Order",
            messageCount: d._count.messages,
          }))}
          risks={risks.map((r) => ({
            ...r,
            createdAt: r.createdAt.toISOString(),
            userName: r.user?.name ?? null,
            userHandle: r.user?.handle ?? null,
          }))}
        />
      </div>
    </>
  );
}
