import type { Metadata } from "next";
import { Sparkles, AlertTriangle } from "lucide-react";
import { requireAuth } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { aiAvailable } from "@/lib/ai/client";
import { CareAssistant } from "@/components/ai/care-assistant";
import { PageHeader, Alert } from "@/components/ui/primitives";

export const metadata: Metadata = {
  title: "Care assistant",
  robots: { index: false, follow: false },
};

export default async function AssistantPage() {
  const auth = await requireAuth();

  const pets = await db.pet.findMany({
    where: { ownerId: auth.user.id, deletedAt: null },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      species: true,
      breed: { select: { name: true } },
      breedText: true,
    },
  });

  const available = aiAvailable();

  return (
    <div className="container-page max-w-3xl py-8 lg:py-10">
      <PageHeader
        eyebrow="Care assistant"
        title="Ask about your pet"
        description="Grounded in the records of the animal you pick, so the answer is about yours rather than about dogs in general."
      />

      <Alert
        tone="warning"
        className="mt-6"
        title="This is not veterinary advice"
        icon={<AlertTriangle className="size-4" aria-hidden />}
      >
        <p className="mt-1 leading-relaxed">
          It cannot examine your animal and it will get things wrong. Anything urgent — bleeding,
          seizures, collapse, suspected poisoning, difficulty breathing — goes to a vet now, not
          here.
        </p>
      </Alert>

      {!available && (
        <Alert tone="info" className="mt-3" icon={<Sparkles className="size-4" aria-hidden />}>
          <p>
            No AI provider is configured on this deployment, so the assistant runs its
            deterministic path: it reads your question and points you at the part of PetMate that
            answers it. Every reply is labelled with which engine produced it.
          </p>
        </Alert>
      )}

      <div className="mt-6">
        <CareAssistant
          aiAvailable={available}
          pets={pets.map((p) => ({
            id: p.id,
            name: p.name,
            species: p.species,
            breed: p.breed?.name ?? p.breedText ?? null,
          }))}
        />
      </div>
    </div>
  );
}
