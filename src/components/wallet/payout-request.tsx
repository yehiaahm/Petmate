"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Landmark } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { Alert } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api-client";
import { useI18n } from "@/components/i18n/i18n-provider";

interface PayoutAccount {
  ownerType: "USER" | "SHOP" | "CLINIC";
  ownerId: string;
  label: string;
}

export function PayoutRequest({
  availableCents,
  currency,
  minCents,
  accounts,
}: {
  availableCents: number;
  currency: string;
  minCents: number;
  accounts: PayoutAccount[];
}) {
  const { t, fmt } = useI18n();
  const router = useRouter();
  const toast = useToast();

  const [accountIndex, setAccountIndex] = useState(0);
  const [amount, setAmount] = useState((availableCents / 100).toFixed(2));
  const [destination, setDestination] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const account = accounts[accountIndex]!;
  const amountCents = Math.round(Number(amount) * 100);
  const valid =
    Number.isFinite(amountCents) &&
    amountCents >= minCents &&
    amountCents <= availableCents &&
    destination.trim().length >= 2;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.post("/api/payments", {
        action: "request-payout",
        payout: {
          ownerType: account.ownerType,
          ownerId: account.ownerId,
          // Sent in cents. The server re-reads the balance and refuses
          // anything it cannot cover, so this number is a request, not a fact.
          amountCents,
          currency,
          destination: destination.trim(),
        },
      });
      toast.success(t("Payout requested"), t("We will confirm once the transfer is sent."));
      setDestination("");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not request that payout.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {error && <Alert tone="danger">{error}</Alert>}

      {accounts.length > 1 && (
        <Field label={t("From")}>
          {({ id }) => (
            <Select
              id={id}
              value={String(accountIndex)}
              onChange={(e) => setAccountIndex(Number(e.target.value))}
            >
              {accounts.map((a, i) => (
                <option key={`${a.ownerType}:${a.ownerId}`} value={i}>
                  {a.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}

      <Field
        label={t("Amount")}
        required
        hint={t("Between {amount} and {amount2}", { amount: fmt.money(minCents, currency), amount2: fmt.money(availableCents, currency) })}
      >
        {({ id, invalid }) => (
          <Input
            id={id}
            invalid={invalid}
            type="number"
            inputMode="decimal"
            step="0.01"
            min={minCents / 100}
            max={availableCents / 100}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="tabular"
          />
        )}
      </Field>

      <Field
        label={t("Which account?")}
        required
        hint={t("A label you will recognise, such as “HSBC ••4417”. Never enter full account or card numbers — we do not store them and will never ask.")}
      >
        {({ id, invalid }) => (
          <Input
            id={id}
            invalid={invalid}
            maxLength={60}
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            placeholder={t("HSBC current account")}
          />
        )}
      </Field>

      <Button type="submit" fullWidth loading={submitting} loadingText={t("Requesting…")} disabled={!valid}>
        <Landmark className="size-4" aria-hidden />
        {t("Request payout")}
      </Button>
    </form>
  );
}
