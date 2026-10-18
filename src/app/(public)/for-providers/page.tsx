import type { Metadata } from "next";
import { BedDouble, CalendarCheck, Camera, GraduationCap, KeyRound, ShieldCheck, Truck, Wallet } from "lucide-react";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { bpsToPercent } from "@/lib/money";
import { getAuth } from "@/lib/auth/session";
import { compactNumber } from "@/lib/utils";
import { Badge, Card } from "@/components/ui/primitives";
import { ButtonLink } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "PetMate for pet hotels and dog trainers",
  description:
    "List your pet hotel or training school, take bookings into a calendar that cannot be oversold, run pickup and drop-off with handover codes, and get paid without chasing.",
  alternates: { canonical: "/for-providers" },
};

export const revalidate = 3600;

export default async function ForProvidersPage() {
  const [settings, auth, providers, completed] = await Promise.all([
    getSettings(),
    getAuth(),
    db.careProvider.count({ where: { status: "ACTIVE", deletedAt: null } }),
    db.careBooking.count({ where: { status: "COMPLETED" } }),
  ]);

  const commission = bpsToPercent(settings.commissionCareBps);
  const start = auth ? "/provider/new" : "/register?next=/provider/new";

  return (
    <div className="container-page py-12 lg:py-16">
      <div className="mx-auto max-w-2xl text-center">
        <Badge tone="brand">For pet hotels and trainers</Badge>
        <h1 className="mt-4 font-display text-4xl font-semibold tracking-tight text-fg sm:text-5xl">
          Fill your rooms and your diary
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-fg-muted">
          Owners book a real room or a real training slot, pay up front, and PetMate holds the money until the job is
          done. You run the day from your phone — check-ins, pickups, photo updates — and withdraw when you like.
        </p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <ButtonLink href={start} size="lg">
            List your business
          </ButtonLink>
          <ButtonLink href="/boarding" variant="outline" size="lg">
            See who is listed
          </ButtonLink>
        </div>
      </div>

      <dl className="mx-auto mt-14 grid max-w-2xl grid-cols-3 gap-px overflow-hidden rounded-[var(--radius-panel)] border border-[var(--border)] bg-[var(--border)]">
        {[
          { label: "Live businesses", value: compactNumber(providers) },
          { label: "Completed bookings", value: compactNumber(completed) },
          { label: "Commission, completed jobs only", value: commission },
        ].map((stat) => (
          <div key={stat.label} className="bg-bg-elevated px-4 py-5 text-center">
            <dd className="font-display text-2xl font-semibold tabular text-fg">{stat.value}</dd>
            <dt className="mt-0.5 text-xs text-fg-muted">{stat.label}</dt>
          </div>
        ))}
      </dl>

      <section className="mx-auto mt-16 max-w-4xl">
        <h2 className="font-display text-2xl font-semibold tracking-tight text-fg">What you get</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {[
            {
              icon: BedDouble,
              title: "Rooms that cannot be oversold",
              body: "List each room type with how many you have. Every night of every stay claims a room in the database itself, so two owners booking your last suite at the same moment get one booking and one honest \"full\".",
            },
            {
              icon: GraduationCap,
              title: "Programmes, not single lessons",
              body: "Sell a six-week course as one price. Owners only see start times where every session fits your trainers' hours, and your notes after each session go straight to them.",
            },
            {
              icon: Truck,
              title: "Pickup and drop-off, priced for you",
              body: "Set a coverage radius, a base fee and a per-kilometre rate. The trip is priced from the owner's pinned location and paid with the booking.",
            },
            {
              icon: KeyRound,
              title: "Handover you can prove",
              body: "When your driver sets off, the owner gets a six-digit code. The trip only completes when your driver enters it — so there is never a question of who took the dog.",
            },
            {
              icon: Camera,
              title: "Updates owners love",
              body: "Post meals, walks, medication and photos in a few taps. Owners who hear from you during a stay are the ones who book again and leave the reviews.",
            },
            {
              icon: Wallet,
              title: "Paid without chasing",
              body: `Payment is collected at booking. When the stay or programme is complete, your earnings move to your balance, less ${commission} commission. Cancellations follow the policy you chose.`,
            },
          ].map((item) => (
            <Card key={item.title} className="p-5">
              <item.icon className="size-5 text-brand" aria-hidden />
              <h3 className="mt-3 font-semibold text-fg">{item.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-fg-muted">{item.body}</p>
            </Card>
          ))}
        </div>
      </section>

      <section className="mx-auto mt-16 max-w-4xl">
        <h2 className="font-display text-2xl font-semibold tracking-tight text-fg">How it works</h2>
        <ol className="mt-6 grid gap-4 sm:grid-cols-4">
          {[
            { icon: ShieldCheck, title: "Register", body: "Tell us about the business. A person checks your registration." },
            { icon: BedDouble, title: "Set up", body: "Add rooms, programmes, hours and your team while you wait." },
            { icon: CalendarCheck, title: "Go live", body: "Once approved you appear in search and take paid bookings." },
            { icon: Wallet, title: "Get paid", body: "Earnings clear when each job is done. Withdraw any time." },
          ].map((step, i) => (
            <li key={step.title}>
              <Card className="h-full p-4">
                <step.icon className="size-5 text-brand" aria-hidden />
                <p className="mt-2 text-sm font-semibold text-fg">
                  {i + 1}. {step.title}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-fg-muted">{step.body}</p>
              </Card>
            </li>
          ))}
        </ol>
        <div className="mt-10 text-center">
          <ButtonLink href={start} size="lg">
            List your business — free
          </ButtonLink>
        </div>
      </section>
    </div>
  );
}
