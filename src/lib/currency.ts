import { clientEnv } from "@/lib/env";
import type { Currency } from "@/lib/constants";

/**
 * The platform currency.
 *
 * PetMate runs one currency per deployment — EGP for Egypt — because there is
 * no exchange-rate engine and the ledger keeps a separate balance per
 * currency. A second currency would not be "converted"; it would be a second,
 * disconnected set of books. So prices are accepted only in this currency, and
 * every balance, payout and report is read in it.
 *
 * Client-safe: the value is inlined into the browser bundle at build time.
 */
export const PLATFORM_CURRENCY: Currency = clientEnv.NEXT_PUBLIC_CURRENCY;
