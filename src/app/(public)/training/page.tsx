import type { Metadata } from "next";
import { CareSearch, type SearchParams } from "../_care/care-search";

export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  const raw = await searchParams;
  const city = typeof raw.city === "string" ? raw.city : undefined;
  return {
    title: `Dog training${city ? ` in ${city}` : ""} — puppy school, obedience and behaviour`,
    description: `Book a structured dog training programme${city ? ` in ${city}` : ""}, at a training centre or at your home, with notes after every session.`,
    alternates: { canonical: city ? `/training?city=${encodeURIComponent(city)}` : "/training" },
  };
}

export default function TrainingPage({ searchParams }: { searchParams: SearchParams }) {
  return <CareSearch kind="TRAINING" searchParams={searchParams} />;
}
