import { BadgeCheck, Star } from "lucide-react";
import { Avatar, Card, Badge } from "@/components/ui/primitives";
import { relativeTime } from "@/lib/utils";
import { cn } from "@/lib/utils";

interface Review {
  id: string;
  rating: number;
  title: string | null;
  body: string | null;
  isVerified: boolean;
  sellerResponse: string | null;
  sellerRespondedAt: Date | null;
  helpfulCount: number;
  createdAt: Date;
  author: {
    id: string;
    name: string;
    handle: string;
    avatarUrl: string | null;
    trustScore: number;
  };
}

export function Stars({ rating, size = 14 }: { rating: number; size?: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" role="img" aria-label={`${rating} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          style={{ width: size, height: size }}
          className={cn(
            star <= rating
              ? "fill-[var(--warning)] text-[var(--warning)]"
              : "fill-transparent text-[var(--border-strong)]",
          )}
          aria-hidden
        />
      ))}
    </span>
  );
}

export function ReviewList({ reviews }: { reviews: Review[] }) {
  if (!reviews.length) {
    return (
      <p className="rounded-[var(--radius-card)] border border-dashed border-[var(--border-strong)] px-5 py-8 text-center text-sm text-fg-muted">
        No reviews yet.
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {reviews.map((review) => (
        <li key={review.id}>
          <Card as="article" className="p-5">
            <div className="flex items-start gap-3">
              <Avatar src={review.author.avatarUrl} name={review.author.name} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-sm font-semibold text-fg">{review.author.name}</span>
                  {review.isVerified && (
                    <Badge tone="success" size="sm" icon={<BadgeCheck className="size-3" aria-hidden />}>
                      Verified purchase
                    </Badge>
                  )}
                  <span className="text-xs text-fg-subtle">{relativeTime(review.createdAt)}</span>
                </div>

                <div className="mt-1.5">
                  <Stars rating={review.rating} />
                </div>

                {review.title && (
                  <h3 className="mt-2 text-sm font-semibold text-fg">{review.title}</h3>
                )}
                {review.body && (
                  <p className="mt-1 text-sm leading-relaxed text-fg-muted">{review.body}</p>
                )}

                {review.sellerResponse && (
                  <div className="mt-3 rounded-[var(--radius-field)] border-l-2 border-brand bg-bg-sunken px-3.5 py-2.5">
                    <p className="text-xs font-semibold text-fg">Seller replied</p>
                    <p className="mt-1 text-sm leading-relaxed text-fg-muted">
                      {review.sellerResponse}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </Card>
        </li>
      ))}
    </ul>
  );
}

export function RatingSummary({
  average,
  count,
  distribution,
}: {
  average: number;
  count: number;
  distribution: { star: number; count: number }[];
}) {
  return (
    <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
      <div className="text-center sm:text-left">
        <p className="font-display text-4xl font-semibold tabular text-fg">
          {average.toFixed(1)}
        </p>
        <div className="mt-1 flex justify-center sm:justify-start">
          <Stars rating={Math.round(average)} size={16} />
        </div>
        <p className="mt-1 text-xs text-fg-muted tabular">
          {count} {count === 1 ? "review" : "reviews"}
        </p>
      </div>

      <div className="min-w-0 flex-1 space-y-1.5">
        {distribution.map((row) => {
          const percent = count ? Math.round((row.count / count) * 100) : 0;
          return (
            <div key={row.star} className="flex items-center gap-2.5 text-xs">
              <span className="w-3 shrink-0 tabular text-fg-muted">{row.star}</span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-bg-inset">
                <div
                  className="h-full rounded-full bg-[var(--warning)]"
                  style={{ width: `${percent}%` }}
                />
              </div>
              <span className="w-8 shrink-0 text-right tabular text-fg-subtle">{row.count}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
