import { StatusPill } from "@/components/ui/primitives";
import { CARE_BOOKING_STATUS_LABEL, type CareBookingStatus } from "@/lib/constants";

const TONES: Record<CareBookingStatus, "neutral" | "brand" | "success" | "warning" | "danger" | "info"> = {
  PENDING_PAYMENT: "warning",
  CONFIRMED: "info",
  IN_CARE: "brand",
  COMPLETED: "success",
  CANCELLED: "neutral",
  NO_SHOW: "danger",
};

export function CareStatus({ status, kind }: { status: string; kind?: string }) {
  const s = status as CareBookingStatus;
  // "In our care" reads oddly for a course of weekly sessions.
  const label = s === "IN_CARE" && kind === "TRAINING" ? "In progress" : CARE_BOOKING_STATUS_LABEL[s] ?? status;
  return <StatusPill tone={TONES[s] ?? "neutral"}>{label}</StatusPill>;
}
