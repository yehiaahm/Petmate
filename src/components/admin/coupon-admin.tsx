"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Checkbox } from "@/components/ui/field";
import { Card, CardHeader, Badge, Alert, EmptyState } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api-client";
import { formatMoney, parseMoneyToCents } from "@/lib/money";
import { formatDate } from "@/lib/utils";

export interface CouponRow {
  id: string;
  code: string;
  description: string | null;
  kind: string;
  percentBps: number;
  amountCents: number;
  maxDiscountCents: number | null;
  minOrderCents: number;
  endsAt: string | null;
  maxRedemptions: number | null;
  redemptionCount: number;
  perUserLimit: number;
  firstOrderOnly: boolean;
  active: boolean;
  spentCents: number;
  currency: string;
}

/**
 * Store-wide discount codes. PetMate pays for every discount from the
 * promotions account; shops are always paid in full.
 */
export function CouponAdmin({ coupons, currency }: { coupons: CouponRow[]; currency: string }) {
  const router = useRouter();
  const toast = useToast();
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<"PERCENT" | "FIXED">("PERCENT");
  const [percent, setPercent] = useState("10");
  const [amount, setAmount] = useState("");
  const [cap, setCap] = useState("");
  const [minOrder, setMinOrder] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [firstOrderOnly, setFirstOrderOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/admin", {
        action: "create-coupon",
        coupon: {
          code,
          description: description || undefined,
          kind,
          percentBps: kind === "PERCENT" ? Math.round(Number(percent) * 100) : undefined,
          amountCents: kind === "FIXED" ? (parseMoneyToCents(amount) ?? undefined) : undefined,
          maxDiscountCents: kind === "PERCENT" && cap ? (parseMoneyToCents(cap) ?? undefined) : undefined,
          minOrderCents: minOrder ? (parseMoneyToCents(minOrder) ?? 0) : 0,
          endsAt: endsAt ? new Date(`${endsAt}T23:59:59`).toISOString() : undefined,
          maxRedemptions: maxUses ? Number(maxUses) : undefined,
          firstOrderOnly,
        },
      });
      toast.success("Coupon created");
      setCode("");
      setDescription("");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(row: CouponRow) {
    try {
      await api.post("/api/admin", { action: "set-coupon-active", couponId: row.id, active: !row.active });
      router.refresh();
    } catch (err) {
      toast.error("That did not work", err instanceof ApiError ? err.message : "Please try again.");
    }
  }

  const value = (c: CouponRow) =>
    c.kind === "PERCENT"
      ? `${c.percentBps / 100}%${c.maxDiscountCents ? ` (max ${formatMoney(c.maxDiscountCents, c.currency)})` : ""}`
      : formatMoney(c.amountCents, c.currency);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="New coupon" description="Applies to store goods, never to shipping." />
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          {error && <Alert tone="danger" className="sm:col-span-2">{error}</Alert>}
          <Field label="Code" required>
            {({ id }) => <Input id={id} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="RAMADAN25" dir="ltr" />}
          </Field>
          <Field label="Description (shown to buyers)">
            {({ id }) => <Input id={id} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} />}
          </Field>
          <Field label="Type">
            {({ id }) => (
              <Select id={id} value={kind} onChange={(e) => setKind(e.target.value as "PERCENT" | "FIXED")}>
                <option value="PERCENT">Percentage off</option>
                <option value="FIXED">Fixed amount off</option>
              </Select>
            )}
          </Field>
          {kind === "PERCENT" ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Percent">
                {({ id }) => <Input id={id} inputMode="decimal" value={percent} onChange={(e) => setPercent(e.target.value)} />}
              </Field>
              <Field label="Cap (optional)">
                {({ id }) => <Input id={id} inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} leading={<span className="text-sm">{currency}</span>} />}
              </Field>
            </div>
          ) : (
            <Field label="Amount">
              {({ id }) => <Input id={id} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} leading={<span className="text-sm">{currency}</span>} />}
            </Field>
          )}
          <Field label="Minimum basket (optional)">
            {({ id }) => <Input id={id} inputMode="decimal" value={minOrder} onChange={(e) => setMinOrder(e.target.value)} leading={<span className="text-sm">{currency}</span>} />}
          </Field>
          <Field label="Ends (optional)">
            {({ id }) => <Input id={id} type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />}
          </Field>
          <Field label="Total uses (optional)">
            {({ id }) => <Input id={id} inputMode="numeric" value={maxUses} onChange={(e) => setMaxUses(e.target.value.replace(/\D/g, ""))} />}
          </Field>
          <div className="flex items-end">
            <Checkbox label="First order only" checked={firstOrderOnly} onChange={(e) => setFirstOrderOnly(e.target.checked)} />
          </div>
          <div className="sm:col-span-2">
            <Button loading={busy} disabled={code.length < 3} onClick={() => void create()}>
              <Plus className="size-4" aria-hidden />
              Create coupon
            </Button>
          </div>
        </div>
      </Card>

      {coupons.length === 0 ? (
        <EmptyState title="No coupons yet" description="Codes you create appear here with how often they were used and what they cost." />
      ) : (
        <Card>
          <ul className="divide-y divide-[var(--border)]">
            {coupons.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-mono font-semibold text-fg">{c.code}</span>
                    <Badge tone={c.active ? "success" : "neutral"} size="sm">{c.active ? "active" : "off"}</Badge>
                    {c.firstOrderOnly && <Badge size="sm">first order</Badge>}
                  </p>
                  <p className="mt-0.5 text-xs text-fg-subtle">
                    {value(c)}
                    {c.minOrderCents > 0 ? ` · min ${formatMoney(c.minOrderCents, c.currency)}` : ""}
                    {c.endsAt ? ` · until ${formatDate(c.endsAt)}` : ""} · used {c.redemptionCount}
                    {c.maxRedemptions ? `/${c.maxRedemptions}` : ""} · cost {formatMoney(c.spentCents, c.currency)}
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={() => void toggle(c)}>
                  {c.active ? "Turn off" : "Turn on"}
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
