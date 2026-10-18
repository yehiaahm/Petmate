import Image from "next/image";
import { Activity, Bone, CircleDot, Footprints, GraduationCap, Pill, Truck, MessageCircle } from "lucide-react";
import { relativeTime } from "@/lib/utils";
import { CARE_UPDATE_TYPE_LABEL, type CareUpdateType } from "@/lib/constants";

const ICONS: Record<string, typeof Activity> = {
  STATUS: CircleDot,
  TRANSPORT: Truck,
  UPDATE: MessageCircle,
  MEAL: Bone,
  WALK: Footprints,
  MEDICATION: Pill,
  TRAINING: GraduationCap,
};

/** The booking's story, newest first: status, trips and the team's updates. */
export function CareTimeline({
  events,
}: {
  events: { id: string; type: string; title: string; body: string | null; photoUrl: string | null; createdAt: Date }[];
}) {
  if (!events.length) return <p className="text-sm text-fg-muted">Nothing here yet.</p>;

  return (
    <ol className="relative space-y-5 border-l border-[var(--border)] pl-5">
      {events.map((event) => {
        const Icon = ICONS[event.type] ?? Activity;
        const title =
          event.title in CARE_UPDATE_TYPE_LABEL ? CARE_UPDATE_TYPE_LABEL[event.title as CareUpdateType] : event.title;
        return (
          <li key={event.id} className="relative">
            <span className="absolute -left-[1.95rem] top-0.5 flex size-6 items-center justify-center rounded-full bg-bg-elevated text-brand ring-1 ring-[var(--border)]">
              <Icon className="size-3.5" aria-hidden />
            </span>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-semibold text-fg">{title}</p>
              <time className="text-xs text-fg-subtle" dateTime={event.createdAt.toISOString()}>
                {relativeTime(event.createdAt)}
              </time>
            </div>
            {event.body && <p className="mt-1 whitespace-pre-wrap text-sm text-fg-muted">{event.body}</p>}
            {event.photoUrl && (
              <div className="relative mt-2 aspect-[4/3] w-full max-w-sm overflow-hidden rounded-[var(--radius-field)] bg-bg-sunken">
                <Image src={event.photoUrl} alt="" fill sizes="384px" className="object-cover" />
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
