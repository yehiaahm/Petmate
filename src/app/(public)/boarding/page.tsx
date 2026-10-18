import type { Metadata } from "next";
import { CareSearch, type SearchParams } from "../_care/care-search";

export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  const raw = await searchParams;
  const city = typeof raw.city === "string" ? raw.city : undefined;
  return {
    title: `Pet hotels${city ? ` in ${city}` : ""} — boarding for dogs and cats`,
    description: `Book a verified pet hotel${city ? ` in ${city}` : ""}. Real availability, daily photo updates, pickup and drop-off, and payment held until the stay is done.`,
    alternates: { canonical: city ? `/boarding?city=${encodeURIComponent(city)}` : "/boarding" },
  };
}

export default function BoardingPage({ searchParams }: { searchParams: SearchParams }) {
  return <CareSearch kind="BOARDING" searchParams={searchParams} />;
}
