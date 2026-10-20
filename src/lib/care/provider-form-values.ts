import type { CancellationPolicy } from "@/lib/constants";

/**
 * The provider form's values, and the blank form a new business starts from.
 *
 * Kept out of the form component on purpose: the registration page is a
 * server component and builds the initial values itself, and a server
 * component cannot call a function exported from a "use client" module.
 */
export interface ProviderFormValues {
  name: string;
  tagline: string;
  description: string;
  email: string;
  phone: string;
  website: string;
  addressLine: string;
  city: string;
  region: string;
  country: string;
  postalCode: string;
  coords: { lat: number; lng: number } | null;
  /** Empty means "use the browser's own zone", which only the browser knows. */
  timezone: string;
  licenseNumber: string;
  offersBoarding: boolean;
  offersTraining: boolean;
  checkInMinute: number;
  checkOutMinute: number;
  offersTransport: boolean;
  transportRadiusKm: string;
  transportBase: string;
  transportPerKm: string;
  trainerCount: string;
  amenities: string[];
  requiresVaccination: boolean;
  cancellationPolicy: CancellationPolicy;
  bookingLeadHours: string;
  currency: string;
  official: boolean;
}

export function emptyProviderValues(defaults: {
  email: string;
  city: string | null;
  country: string | null;
  currency: string;
}): ProviderFormValues {
  return {
    name: "",
    tagline: "",
    description: "",
    email: defaults.email,
    phone: "",
    website: "",
    addressLine: "",
    city: defaults.city ?? "",
    region: "",
    country: defaults.country ?? "",
    postalCode: "",
    coords: null,
    timezone: "",
    licenseNumber: "",
    offersBoarding: true,
    offersTraining: false,
    checkInMinute: 540,
    checkOutMinute: 1080,
    offersTransport: false,
    transportRadiusKm: "15",
    transportBase: "",
    transportPerKm: "",
    trainerCount: "1",
    amenities: [],
    requiresVaccination: true,
    cancellationPolicy: "MODERATE",
    bookingLeadHours: "12",
    currency: defaults.currency,
    official: false,
  };
}
