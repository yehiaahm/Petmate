import type { Metadata } from "next";
import Link from "next/link";
import { Star, PenLine } from "lucide-react";
import { requireAuth } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { getPendingReviews } from "@/lib/services/review.service";
import { ReviewComposer } from "@/components/reviews/review-composer";
import { Stars } from "@/components/reviews/review-list";
import { PageHeader, Card, EmptyState, Badge } from "@/components/ui/primitives";
import { formatDate } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Reviews",
  robots: { index: false, follow: false },
};

export default async function ReviewsPage() {
  const auth = await requireAuth();

  const [pending, written, received] = await Promise.all([
    getPendingReviews(auth),
    db.review.findMany({
      where: { authorId: auth.user.id },
      orderBy: { createdAt: "desc" },
      take: 25,
      select: {
        id: true,
        rating: true,
        title: true,
        body: true,
        targetType: true,
        status: true,
        sellerResponse: true,
        createdAt: true,
      },
    }),
    db.review.findMany({
      where: { targetType: "SELLER", targetId: auth.user.id, status: "PUBLISHED" },
      orderBy: { createdAt: "desc" },
      take: 25,
      select: {
        id: true,
        rating: true,
        title: true,
        body: true,
        isVerified: true,
        sellerResponse: true,
        createdAt: true,
        author: { select: { name: true, handle: true } },
      },
    }),
  ]);

  return (
    <div className="container-page max-w-3xl py-8 lg:py-10">
      <PageHeader
        title="Reviews"
        description="You can only review a transaction that actually completed on PetMate. That constraint is the whole reason these are worth reading."
      />

      <div className="mt-8 space-y-8">
        {pending.length > 0 && (
          <section>
            <h2 className="flex items-center gap-2 font-display text-xl font-semibold text-fg">
              <PenLine className="size-4.5 text-accent" aria-hidden />
              Waiting on you
            </h2>
            <ul className="mt-4 space-y-3">
              {pending.map((item) => (
                <li key={`${item.targetType}:${item.targetId}:${item.refId}`}>
                  <Card className="p-5">
                    <p className="text-[15px] font-medium text-fg">{item.label}</p>
                    <p className="mt-0.5 text-sm text-fg-muted">{item.context}</p>
                    <div className="mt-4">
                      <ReviewComposer
                        targetType={item.targetType}
                        targetId={item.targetId}
                        refType={item.type}
                        refId={item.refId}
                        label={item.label}
                      />
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <h2 className="font-display text-xl font-semibold text-fg">Reviews about you</h2>
          {received.length === 0 ? (
            <EmptyState
              className="mt-4"
              icon={<Star className="size-5" aria-hidden />}
              title="No reviews yet"
              description="Sell or rehome an animal through PetMate and the buyer can review you. Reviews are tied to the transaction, so nobody can post one without buying from you."
            />
          ) : (
            <ul className="mt-4 space-y-3">
              {received.map((review) => (
                <li key={review.id}>
                  <Card className="p-5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Stars rating={review.rating} />
                      {review.isVerified && (
                        <Badge tone="success" size="sm">
                          Verified purchase
                        </Badge>
                      )}
                      <span className="text-xs text-fg-subtle">
                        {formatDate(review.createdAt)}
                      </span>
                    </div>
                    {review.title && (
                      <h3 className="mt-2 text-sm font-semibold text-fg">{review.title}</h3>
                    )}
                    {review.body && (
                      <p className="mt-1 text-sm leading-relaxed text-fg-muted">{review.body}</p>
                    )}
                    <p className="mt-2 text-xs text-fg-subtle">
                      by{" "}
                      <Link href={`/u/${review.author.handle}`} className="hover:underline">
                        {review.author.name}
                      </Link>
                    </p>
                    {review.sellerResponse && (
                      <div className="mt-3 rounded-[var(--radius-field)] border-s-2 border-brand bg-bg-sunken px-3.5 py-2.5">
                        <p className="text-xs font-semibold text-fg">Your reply</p>
                        <p className="mt-1 text-sm leading-relaxed text-fg-muted">
                          {review.sellerResponse}
                        </p>
                      </div>
                    )}
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </section>

        {written.length > 0 && (
          <section>
            <h2 className="font-display text-xl font-semibold text-fg">Reviews you wrote</h2>
            <ul className="mt-4 space-y-2">
              {written.map((review) => (
                <li key={review.id}>
                  <Card className="p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Stars rating={review.rating} />
                      <span className="text-xs text-fg-subtle">
                        {formatDate(review.createdAt)}
                      </span>
                      {review.status !== "PUBLISHED" && (
                        <Badge tone="warning" size="sm">
                          {review.status.toLowerCase()}
                        </Badge>
                      )}
                    </div>
                    {review.title && (
                      <p className="mt-1.5 text-sm font-medium text-fg">{review.title}</p>
                    )}
                    {review.body && (
                      <p className="mt-1 line-clamp-3 text-sm text-fg-muted">{review.body}</p>
                    )}
                  </Card>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
