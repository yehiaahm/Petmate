import "server-only";
import { db, type DbClient } from "@/lib/db";
import { stringifyJson } from "@/lib/json";
import { readableCode } from "@/lib/utils";

export interface InvoiceLine {
  description: string;
  amountCents: number;
  quantity?: number;
}

/** Issues the invoice row for a settled payment. Called from settlement. */
export async function createInvoice(
  params: {
    paymentIntentId: string;
    userId: string;
    totalCents: number;
    taxCents?: number;
    currency: string;
    lines: InvoiceLine[];
    billingName: string;
    billingAddress?: string;
  },
  client: DbClient = db,
): Promise<void> {
  const year = new Date().getUTCFullYear();

  await client.invoice.create({
    data: {
      number: `INV-${year}-${readableCode(8)}`,
      userId: params.userId,
      paymentIntentId: params.paymentIntentId,
      totalCents: params.totalCents,
      taxCents: params.taxCents ?? 0,
      currency: params.currency,
      lines: stringifyJson(params.lines),
      billingName: params.billingName,
      billingAddress: params.billingAddress ?? null,
    },
  });
}
