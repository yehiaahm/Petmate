import "server-only";
import type { DeliveryStatus } from "@/lib/constants";
import { env } from "@/lib/env";

/**
 * Bosta (bosta.co), Egypt's largest last-mile courier, via its v2 business
 * API. Each shop uses its own Bosta account and API key, because Bosta pays
 * cash-on-delivery money to the account that booked the parcel.
 */

export function bostaBaseUrl(): string {
  return env().BOSTA_BASE_URL.replace(/\/+$/, "");
}

/** A public tracking page for a Bosta tracking number. */
export const bostaTrackingUrl = (tracking: string) =>
  `https://bosta.co/tracking-shipments?shipment-number=${encodeURIComponent(tracking)}`;

/**
 * Bosta state codes, as sent in webhooks and returned by the API, mapped to
 * our delivery states. Codes we do not know map to null and are recorded
 * without moving the parcel, rather than guessed at.
 */
const STATE_MAP: Record<number, DeliveryStatus> = {
  10: "PENDING", // pickup requested
  11: "PENDING", // waiting for route
  20: "ASSIGNED", // route assigned
  21: "PICKED_UP", // picked up from the business
  22: "PICKED_UP", // picking up from consignee (exchange)
  23: "IN_TRANSIT", // picked up from consignee
  24: "IN_TRANSIT", // received at warehouse
  25: "IN_TRANSIT", // fulfilled
  30: "IN_TRANSIT", // in transit between hubs
  40: "IN_TRANSIT", // picking up
  41: "OUT_FOR_DELIVERY", // picked up, on its way to the customer
  45: "DELIVERED",
  46: "RETURNED", // returned to business
  47: "FAILED", // exception (customer unavailable, refused, wrong address)
  48: "CANCELLED", // terminated
  49: "CANCELLED", // canceled
  60: "RETURNED", // returned to stock
  100: "FAILED", // lost
  101: "FAILED", // damaged
};

export function mapBostaState(code: number | string | null | undefined): DeliveryStatus | null {
  const n = typeof code === "string" ? Number(code) : code;
  return n != null && Number.isFinite(n) ? (STATE_MAP[n as number] ?? null) : null;
}

/**
 * Bosta's city names. Addresses on PetMate use everyday spellings (and Arabic
 * ones); Bosta needs its own. Anything not listed is sent as typed.
 */
const BOSTA_CITIES: Record<string, string> = {
  cairo: "Cairo",
  "new cairo": "Cairo",
  "nasr city": "Cairo",
  maadi: "Cairo",
  heliopolis: "Cairo",
  giza: "Giza",
  "6th of october": "Giza",
  "sheikh zayed": "Giza",
  alexandria: "Alexandria",
  mansoura: "Dakahlia",
  tanta: "Gharbia",
  zagazig: "Sharqia",
  ismailia: "Ismailia",
  suez: "Suez",
  "port said": "Port Said",
  damietta: "Damietta",
  fayoum: "Fayoum",
  "beni suef": "Beni Suef",
  minya: "Minya",
  asyut: "Assiut",
  assiut: "Assiut",
  sohag: "Sohag",
  qena: "Qena",
  luxor: "Luxor",
  aswan: "Aswan",
  hurghada: "Red Sea",
  "sharm el sheikh": "South Sinai",
  "القاهرة": "Cairo",
  "الجيزة": "Giza",
  "الإسكندرية": "Alexandria",
  "الاسكندرية": "Alexandria",
  "المنصورة": "Dakahlia",
  "طنطا": "Gharbia",
  "الزقازيق": "Sharqia",
  "أسيوط": "Assiut",
  "اسيوط": "Assiut",
  "الأقصر": "Luxor",
  "أسوان": "Aswan",
  "الغردقة": "Red Sea",
};

export function bostaCity(city: string): string {
  return BOSTA_CITIES[city.trim().toLowerCase()] ?? city.trim();
}

export class BostaError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** 4xx: our request is wrong (address, phone), retrying will not help. */
    readonly permanent: boolean,
  ) {
    super(message);
  }
}

async function call<T>(apiKey: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${bostaBaseUrl()}${path}`, {
    ...init,
    headers: { authorization: apiKey, "content-type": "application/json", accept: "application/json", ...init.headers },
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await response.json().catch(() => ({}))) as { success?: boolean; message?: string; data?: unknown };
  if (!response.ok || body.success === false) {
    throw new BostaError(`bosta ${response.status}: ${body.message ?? "unknown error"}`, response.status, response.status >= 400 && response.status < 500);
  }
  return body.data as T;
}

export interface BostaShipmentInput {
  businessReference: string;
  receiver: { name: string; phone: string; email?: string | null };
  address: { city: string; line1: string; line2?: string | null };
  /** Cash to collect, in piastres. 0 for a prepaid parcel. */
  codCents: number;
  itemsCount: number;
  description: string;
  notes?: string | null;
}

/** Books a delivery. Returns Bosta's id and tracking number. */
export async function createBostaDelivery(apiKey: string, input: BostaShipmentInput) {
  const [firstName, ...rest] = input.receiver.name.trim().split(/\s+/);
  const data = await call<{ _id: string; trackingNumber: string | number }>(apiKey, "/deliveries", {
    method: "POST",
    body: JSON.stringify({
      type: 10, // package delivery
      businessReference: input.businessReference,
      specs: {
        packageType: "Parcel",
        size: "SMALL",
        packageDetails: { itemsCount: input.itemsCount, description: input.description.slice(0, 200) },
      },
      // Bosta takes pounds, with piastres as decimals.
      cod: Math.round(input.codCents) / 100,
      allowToOpenPackage: false,
      notes: input.notes?.slice(0, 250) ?? undefined,
      dropOffAddress: {
        city: bostaCity(input.address.city),
        firstLine: input.address.line1.slice(0, 250),
        secondLine: input.address.line2?.slice(0, 250) ?? undefined,
      },
      receiver: {
        firstName: firstName || input.receiver.name,
        lastName: rest.join(" ") || "-",
        phone: input.receiver.phone,
        email: input.receiver.email ?? undefined,
      },
    }),
  });
  return { id: String(data._id), trackingNumber: String(data.trackingNumber) };
}

/** Current state of one delivery, for reconciling a missed webhook. */
export async function fetchBostaDelivery(apiKey: string, trackingNumber: string) {
  const data = await call<{ state?: { code?: number; value?: string }; trackingNumber?: string | number }>(
    apiKey,
    `/deliveries/business/${encodeURIComponent(trackingNumber)}`,
  );
  return { code: data.state?.code ?? null, label: data.state?.value ?? null };
}

/** A cheap authenticated call, used to check a key when a shop connects it. */
export async function verifyBostaKey(apiKey: string): Promise<boolean> {
  try {
    await call(apiKey, "/cities");
    return true;
  } catch (e) {
    if (e instanceof BostaError && (e.status === 401 || e.status === 403)) return false;
    throw e;
  }
}
