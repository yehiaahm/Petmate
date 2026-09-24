import type { Metadata } from "next";
import {
  CalendarCheck,
  Stethoscope,
  FileSignature,
  Wallet,
  Users,
  ShieldCheck,
  ArrowRight,
} from "lucide-react";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { bpsToPercent } from "@/lib/money";
import { getAuth } from "@/lib/auth/session";
import { Card, Badge, Alert } from "@/components/ui/primitives";
import { ButtonLink } from "@/components/ui/button";
import { compactNumber } from "@/lib/utils";

export const metadata: Metadata = {
  title: "PetMate for clinics",
  description:
    "Take bookings, write health records that carry a verified badge, and get paid without chasing. What a veterinary clinic gets from PetMate, and what it costs.",
  alternates: { canonical: "/for-clinics" },
};

export const revalidate = 3600;

export default async function ForClinicsPage() {
  const [settings, auth, clinics, appointments, records] = await Promise.all([
    getSettings(),
    getAuth(),
    db.clinic.count({ where: { status: "ACTIVE", deletedAt: null } }),
    db.appointment.count({ where: { status: "COMPLETED" } }),
    db.healthRecord.count({ where: { source: "CLINIC", deletedAt: null } }),
  ]);

  const commission = bpsToPercent(settings.commissionAppointmentBps);

  return (
    <div className="container-page py-12 lg:py-16">
      <div className="mx-auto max-w-2xl text-center">
        <Badge tone="brand">For veterinary clinics</Badge>
        <h1 className="mt-4 font-display text-4xl font-semibold tracking-tight text-fg sm:text-5xl">
          Your notes become the animal&rsquo;s record
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-fg-muted">
          A clinic on PetMate gets a bookable calendar, a patient record that follows the animal to
          its next owner, and payment settled before the consultation ends. No per-seat licence, no
          setup fee.
        </p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <ButtonLink href={auth ? "/clinic/new" : "/register?next=/clinic/new"} size="lg">
            Register your clinic
          </ButtonLink>
          <ButtonLink href="/clinics" variant="outline" size="lg">
            See clinics already listed
          </ButtonLink>
        </div>
      </div>

      <dl className="mx-auto mt-14 grid max-w-3xl grid-cols-3 gap-px overflow-hidden rounded-[var(--radius-panel)] border border-[var(--border)] bg-[var(--border)]">
        {[
          { label: "Verified clinics", value: clinics },
          { label: "Appointments completed", value: appointments },
          { label: "Clinic-written records", value: records },
        ].map((stat) => (
          <div key={stat.label} className="bg-bg-elevated px-4 py-5 text-center">
            <dd className="font-display text-2xl font-semibold tabular text-fg">
              {compactNumber(stat.value)}
            </dd>
            <dt className="mt-0.5 text-xs text-fg-muted">{stat.label}</dt>
          </div>
        ))}
      </dl>

      <section className="mx-auto mt-16 max-w-4xl">
        <h2 className="font-display text-2xl font-semibold tracking-tight text-fg">
          What you actually get
        </h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {[
            {
              icon: CalendarCheck,
              title: "A calendar that cannot double-book",
              body: "Set hours per vet, per service, with your own lead time and cancellation window. Two people tapping the same slot at the same instant is settled by a database constraint, not by hoping.",
            },
            {
              icon: FileSignature,
              title: "Records that carry your signature",
              body: "Anything your team writes is marked clinic verified and cannot be edited or deleted by the owner. That badge is the reason a buyer trusts the record — and the reason owners bring their animals to a clinic that is on PetMate.",
            },
            {
              icon: Wallet,
              title: "Paid at the point of booking",
              body: `The consultation fee is taken when the appointment is booked and credited to your balance on completion. We keep ${commission}; the rest is yours, itemised, with an invoice per transaction.`,
            },
            {
              icon: Users,
              title: "Patients who find you",
              body: "Owners search by species, service, distance and availability. A verified clinic with real reviews ranks on evidence, not on how much it paid.",
            },
            {
              icon: Stethoscope,
              title: "One record per animal, not per visit",
              body: "Vaccination history, chronic conditions, allergies, medication and weight over time — from every clinic the animal has been to, not only yours.",
            },
            {
              icon: ShieldCheck,
              title: "Access that is actually scoped",
              body: "Your team can open the record of an animal your clinic has treated, and only that one. Every read is attributable. Nobody browses the database.",
            },
          ].map((item) => (
            <Card key={item.title} className="p-5">
              <span className="flex size-9 items-center justify-center rounded-xl bg-brand-soft text-brand-soft-fg">
                <item.icon className="size-4.5" aria-hidden />
              </span>
              <h3 className="mt-3 font-display text-lg font-semibold text-fg">{item.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-fg-muted">{item.body}</p>
            </Card>
          ))}
        </div>
      </section>

      <section className="mx-auto mt-16 max-w-3xl">
        <h2 className="font-display text-2xl font-semibold tracking-tight text-fg">
          What it costs
        </h2>
        <Card className="mt-5 p-6">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-display text-4xl font-semibold text-fg">{commission}</span>
            <span className="text-fg-muted">of each completed booking</span>
          </div>
          <ul className="mt-5 space-y-2 text-[15px] text-fg-muted">
            {[
              "No monthly fee, no per-seat licence, no setup cost.",
              "Nothing is charged on an appointment that is cancelled inside your cancellation window.",
              "Writing health records is free and always will be — the records are what makes the platform worth using.",
              "Rates are set in the admin console and shown here live, so this page cannot go stale.",
            ].map((line) => (
              <li key={line} className="flex items-start gap-2.5">
                <ArrowRight className="rtl:-scale-x-100 mt-1 size-3.5 shrink-0 text-brand" aria-hidden />
                {line}
              </li>
            ))}
          </ul>
        </Card>
      </section>

      <section className="mx-auto mt-16 max-w-3xl">
        <h2 className="font-display text-2xl font-semibold tracking-tight text-fg">
          Getting listed
        </h2>
        <ol className="mt-5 space-y-3">
          {[
            {
              title: "Create an account and register the clinic",
              body: "Name, address, contact details and your veterinary registration or licence number.",
            },
            {
              title: "We verify the licence",
              body: "A person checks the number against the register before your profile goes live. This is the step that makes the clinic-verified badge mean something, so we do not skip it.",
            },
            {
              title: "Add your vets, services and hours",
              body: "Each vet gets their own calendar. Services carry their own duration and price. Default weekday hours are created for you so the calendar is never empty.",
            },
            {
              title: "Take bookings",
              body: "You appear in search the moment verification clears. Payment for each booking settles to your balance when the appointment is marked complete.",
            },
          ].map((step, i) => (
            <li key={step.title}>
              <Card className="flex gap-4 p-5">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-semibold text-brand-fg tabular">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <h3 className="text-[15px] font-semibold text-fg">{step.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-fg-muted">{step.body}</p>
                </div>
              </Card>
            </li>
          ))}
        </ol>
      </section>

      <section className="mx-auto mt-16 max-w-3xl">
        <Alert tone="info" title="What PetMate is not">
          <p className="mt-1 leading-relaxed">
            It is not a practice management system. It does not do stock, payroll, rostering,
            in-house lab results or clinical charting, and it will not replace the software you run
            the surgery on. It handles the part that faces the animal&rsquo;s owner: being found,
            being booked, being paid, and leaving behind a record the next vet can read.
          </p>
        </Alert>
      </section>

      <section className="mx-auto mt-16 max-w-2xl text-center">
        <h2 className="font-display text-2xl font-semibold tracking-tight text-fg">
          Questions before you commit?
        </h2>
        <p className="mt-2 text-[15px] text-fg-muted">
          Ask us anything about verification, payouts or how records are scoped. A person answers.
        </p>
        <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
          <ButtonLink href="/support?topic=CLINIC">Talk to us</ButtonLink>
          <ButtonLink href={auth ? "/clinic/new" : "/register?next=/clinic/new"} variant="outline">
            Register your clinic
          </ButtonLink>
        </div>
      </section>
    </div>
  );
}
