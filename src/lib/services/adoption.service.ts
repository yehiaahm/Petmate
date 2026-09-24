import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { badRequest, conflict, notFound } from "@/lib/errors";
import type { AuthContext } from "@/lib/auth/session";
import { enforceRateLimit } from "@/lib/rate-limit";
import { stringifyJson, parseJsonRecord } from "@/lib/json";
import { clamp } from "@/lib/utils";
import { notify } from "./notification.service";
import { emailTemplates } from "@/lib/email";
import { clientEnv } from "@/lib/env";
import { getOrCreateConversation, postSystemMessage } from "./chat.service";
import { safeParagraph, optionalText, cuidSchema } from "@/lib/validation/common";
import { HOME_TYPE, EXPERIENCE_LEVEL } from "@/lib/constants";

/**
 * Adoption.
 *
 * Rescues reject most applications on a handful of concrete facts: the home,
 * the hours the animal would be alone, existing pets, prior experience. So
 * those are structured columns an owner can filter and sort on, not a free-text
 * paragraph they have to read a hundred times.
 *
 * The fit score below is arithmetic on those answers. It orders a queue; it
 * never decides anything. The human decides, and the reason they give is sent
 * to the applicant, because a silent rejection is what makes people give up on
 * adopting and buy from a backyard breeder instead.
 */

export const adoptionApplicationSchema = z.object({
  listingId: cuidSchema,
  homeType: z.enum(HOME_TYPE),
  hasYard: z.boolean().default(false),
  hasOtherPets: z.boolean().default(false),
  otherPetsInfo: optionalText(500),
  hasChildren: z.boolean().default(false),
  childrenAges: optionalText(100),
  hoursAloneDaily: z.number().int().min(0).max(24),
  experienceLevel: z.enum(EXPERIENCE_LEVEL),
  previousPets: optionalText(1000),
  motivation: safeParagraph(2000, 50),
  answers: z.record(z.string(), z.string().max(1000)).optional(),
  agreedToTerms: z.boolean(),
});

export type AdoptionApplicationInput = z.infer<typeof adoptionApplicationSchema>;

export async function submitApplication(auth: AuthContext, input: AdoptionApplicationInput) {
  await enforceRateLimit("adoptionApply", auth.user.id);

  if (!input.agreedToTerms) {
    throw badRequest("Please confirm you understand the adoption commitment.");
  }

  const listing = await db.listing.findFirst({
    where: { id: input.listingId, deletedAt: null },
    select: {
      id: true,
      intent: true,
      status: true,
      sellerId: true,
      title: true,
      petId: true,
      pet: { select: { name: true, species: true } },
      questions: { select: { id: true, prompt: true, required: true } },
    },
  });

  if (!listing) throw notFound("That listing");
  if (listing.intent !== "ADOPTION") throw badRequest("This listing is not an adoption listing.");
  if (listing.status !== "ACTIVE") throw conflict("This listing is no longer accepting applications.");
  if (listing.sellerId === auth.user.id) throw badRequest("This is your own listing.");

  for (const question of listing.questions.filter((q) => q.required)) {
    const answer = input.answers?.[question.id];
    if (!answer || !answer.trim()) {
      throw badRequest(`Please answer: ${question.prompt}`);
    }
  }

  const existing = await db.adoptionApplication.findUnique({
    where: { listingId_applicantId: { listingId: input.listingId, applicantId: auth.user.id } },
    select: { id: true, status: true },
  });
  if (existing) {
    throw conflict(
      existing.status === "WITHDRAWN"
        ? "You withdrew an application for this pet. Contact the owner to reopen it."
        : "You have already applied for this pet.",
    );
  }

  const score = scoreApplication(input, listing.pet.species);

  const conversation = await getOrCreateConversation({
    type: "ADOPTION",
    participantIds: [auth.user.id, listing.sellerId],
    contextType: "LISTING",
    contextId: listing.id,
    listingId: listing.id,
    subject: `Adoption: ${listing.pet.name}`,
    createdById: auth.user.id,
  });

  const application = await db.$transaction(async (tx) => {
    const created = await tx.adoptionApplication.create({
      data: {
        listingId: input.listingId,
        applicantId: auth.user.id,
        homeType: input.homeType,
        hasYard: input.hasYard,
        hasOtherPets: input.hasOtherPets,
        otherPetsInfo: input.otherPetsInfo ?? null,
        hasChildren: input.hasChildren,
        childrenAges: input.childrenAges ?? null,
        hoursAloneDaily: input.hoursAloneDaily,
        experienceLevel: input.experienceLevel,
        previousPets: input.previousPets ?? null,
        motivation: input.motivation,
        answers: input.answers ? stringifyJson(input.answers) : null,
        agreedToTerms: true,
        score,
        conversationId: conversation.id,
      },
      select: { id: true, score: true },
    });

    await tx.listing.update({
      where: { id: input.listingId },
      data: { inquiryCount: { increment: 1 } },
    });

    await audit(
      {
        action: "adoption.applied",
        actorId: auth.user.id,
        entityType: "ADOPTION_APPLICATION",
        entityId: created.id,
        summary: `Applied for ${listing.pet.name} (fit ${score})`,
      },
      tx,
    );

    return created;
  });

  await postSystemMessage({
    conversationId: conversation.id,
    systemType: "adoption.applied",
    body: `${auth.user.name} applied to adopt ${listing.pet.name}.`,
    data: { applicationId: application.id },
  });

  await notify({
    userId: listing.sellerId,
    category: "ADOPTION",
    type: "adoption.application",
    title: `New application for ${listing.pet.name}`,
    body: `${auth.user.name} applied. Household fit ${score}/100.`,
    url: `/dashboard/listings/${listing.id}/applications`,
    entityType: "ADOPTION_APPLICATION",
    entityId: application.id,
  });

  return application;
}

/**
 * Household fit, 0-100. Purely arithmetic on the structured answers, and shown
 * to the owner with its reasoning so it is never a black box.
 */
export function scoreApplication(
  input: Pick<
    AdoptionApplicationInput,
    "homeType" | "hasYard" | "hoursAloneDaily" | "experienceLevel" | "hasOtherPets" | "motivation" | "previousPets"
  >,
  species: string,
): number {
  let score = 40; // A complete, honest application starts from a fair baseline.

  // Time alone is the single strongest welfare predictor for dogs.
  if (input.hoursAloneDaily <= 4) score += 20;
  else if (input.hoursAloneDaily <= 6) score += 12;
  else if (input.hoursAloneDaily <= 8) score += 4;
  else score -= 10;

  if (input.experienceLevel === "EXPERIENCED") score += 15;
  else if (input.experienceLevel === "SOME") score += 8;

  if (species === "DOG") {
    if (input.hasYard) score += 10;
    if (input.homeType === "HOUSE" || input.homeType === "FARM") score += 5;
    if (input.homeType === "APARTMENT" && !input.hasYard) score -= 5;
  }
  if (species === "HORSE" && input.homeType !== "FARM") score -= 25;

  if (input.hasOtherPets) score += 5;
  if (input.previousPets && input.previousPets.length > 40) score += 5;
  if (input.motivation.length > 250) score += 5;

  return clamp(Math.round(score), 0, 100);
}

export function explainScore(
  app: {
    hoursAloneDaily: number | null;
    experienceLevel: string | null;
    hasYard: boolean;
    homeType: string | null;
    hasOtherPets: boolean;
  },
  species: string,
): { label: string; positive: boolean }[] {
  const out: { label: string; positive: boolean }[] = [];

  if (app.hoursAloneDaily != null) {
    if (app.hoursAloneDaily <= 4) out.push({ label: `Home most of the day (${app.hoursAloneDaily}h alone)`, positive: true });
    else if (app.hoursAloneDaily > 8) out.push({ label: `Pet alone ${app.hoursAloneDaily}h a day`, positive: false });
  }
  if (app.experienceLevel === "EXPERIENCED") out.push({ label: "Experienced owner", positive: true });
  if (app.experienceLevel === "FIRST_TIME") out.push({ label: "First-time owner", positive: false });
  if (species === "DOG" && app.hasYard) out.push({ label: "Has a yard", positive: true });
  if (species === "DOG" && !app.hasYard && app.homeType === "APARTMENT") {
    out.push({ label: "Apartment without a yard", positive: false });
  }
  if (app.hasOtherPets) out.push({ label: "Already has pets", positive: true });

  return out;
}

export async function decideApplication(
  auth: AuthContext,
  applicationId: string,
  decision: "APPROVED" | "REJECTED" | "IN_REVIEW",
  note?: string,
) {
  const application = await db.adoptionApplication.findUnique({
    where: { id: applicationId },
    select: {
      id: true,
      status: true,
      applicantId: true,
      listingId: true,
      conversationId: true,
      listing: {
        select: { id: true, sellerId: true, petId: true, pet: { select: { name: true } } },
      },
    },
  });
  if (!application) throw notFound("That application");
  // Only the listing owner decides. Checked against the row, not the request.
  if (application.listing.sellerId !== auth.user.id) throw notFound("That application");

  if (["APPROVED", "REJECTED", "COMPLETED", "WITHDRAWN"].includes(application.status)) {
    throw conflict("This application has already been decided.");
  }

  await db.$transaction(async (tx) => {
    await tx.adoptionApplication.update({
      where: { id: applicationId },
      data: {
        status: decision,
        decisionNote: note?.slice(0, 1000) ?? null,
        decidedAt: decision === "IN_REVIEW" ? null : new Date(),
        decidedById: auth.user.id,
      },
    });

    // Approving one applicant puts the rest on hold rather than leaving them
    // waiting indefinitely with no word.
    if (decision === "APPROVED") {
      await tx.listing.update({
        where: { id: application.listingId },
        data: { status: "RESERVED" },
      });
      await tx.pet.update({
        where: { id: application.listing.petId },
        data: { status: "RESERVED" },
      });
    }

    await audit(
      {
        action: "adoption.decided",
        actorId: auth.user.id,
        entityType: "ADOPTION_APPLICATION",
        entityId: applicationId,
        summary: decision,
      },
      tx,
    );
  });

  if (decision !== "IN_REVIEW") {
    if (application.conversationId) {
      await postSystemMessage({
        conversationId: application.conversationId,
        systemType: `adoption.${decision.toLowerCase()}`,
        body:
          decision === "APPROVED"
            ? `The application to adopt ${application.listing.pet.name} was approved.`
            : `The application to adopt ${application.listing.pet.name} was not taken forward.${note ? ` "${note}"` : ""}`,
        data: { applicationId },
      });
    }

    await notify({
      userId: application.applicantId,
      category: "ADOPTION",
      type: `adoption.${decision.toLowerCase()}`,
      title:
        decision === "APPROVED"
          ? `Your application for ${application.listing.pet.name} was approved`
          : `Update on your application for ${application.listing.pet.name}`,
      body: note ?? (decision === "APPROVED" ? "Message the owner to arrange next steps." : ""),
      url: application.conversationId ? `/messages/${application.conversationId}` : "/dashboard/applications",
      entityType: "ADOPTION_APPLICATION",
      entityId: applicationId,
      email: () =>
        emailTemplates.adoptionDecision({
          name: "",
          petName: application.listing.pet.name,
          approved: decision === "APPROVED",
          note,
          url:
            decision === "APPROVED" && application.conversationId
              ? `${clientEnv.NEXT_PUBLIC_APP_URL}/messages/${application.conversationId}`
              : `${clientEnv.NEXT_PUBLIC_APP_URL}/pets?intent=ADOPTION`,
        }),
    });
  }
}

export async function withdrawApplication(auth: AuthContext, applicationId: string) {
  const application = await db.adoptionApplication.findFirst({
    where: { id: applicationId, applicantId: auth.user.id },
    select: { id: true, status: true, listingId: true },
  });
  if (!application) throw notFound("That application");
  if (["COMPLETED", "WITHDRAWN"].includes(application.status)) {
    throw conflict("This application is already closed.");
  }

  await db.adoptionApplication.update({
    where: { id: applicationId },
    data: { status: "WITHDRAWN", withdrawnAt: new Date() },
  });
}

export async function completeAdoption(auth: AuthContext, applicationId: string) {
  const application = await db.adoptionApplication.findUnique({
    where: { id: applicationId },
    select: {
      id: true,
      status: true,
      applicantId: true,
      listingId: true,
      listing: { select: { sellerId: true, petId: true, id: true, pet: { select: { name: true } } } },
    },
  });
  if (!application) throw notFound("That application");
  if (application.listing.sellerId !== auth.user.id) throw notFound("That application");
  if (application.status !== "APPROVED") throw conflict("Approve the application first.");

  await db.$transaction(async (tx) => {
    await tx.adoptionApplication.update({
      where: { id: applicationId },
      data: { status: "COMPLETED" },
    });

    await tx.listing.update({
      where: { id: application.listingId },
      data: { status: "COMPLETED", completedAt: new Date() },
    });

    // The pet's passport and full history move to the adopter.
    const transfer = await tx.petTransfer.create({
      data: {
        petId: application.listing.petId,
        fromUserId: auth.user.id,
        toUserId: application.applicantId,
        reason: "ADOPTION",
        listingId: application.listingId,
        status: "ACCEPTED",
        respondedAt: new Date(),
      },
      select: { id: true },
    });

    await tx.pet.update({
      where: { id: application.listing.petId },
      data: {
        ownerId: application.applicantId,
        status: "ACTIVE",
        availability: "NOT_AVAILABLE",
      },
    });

    // Everyone else who applied gets a real answer rather than silence.
    await tx.adoptionApplication.updateMany({
      where: {
        listingId: application.listingId,
        id: { not: applicationId },
        status: { in: ["SUBMITTED", "IN_REVIEW"] },
      },
      data: {
        status: "REJECTED",
        decisionNote: "This pet has been adopted.",
        decidedAt: new Date(),
        decidedById: auth.user.id,
      },
    });

    await audit(
      {
        action: "pet.transferred",
        actorId: auth.user.id,
        entityType: "PET",
        entityId: application.listing.petId,
        summary: `Adopted via application ${applicationId}`,
        metadata: { transferId: transfer.id },
      },
      tx,
    );
  });

  const { awardTrustSignal } = await import("./trust.service");
  await awardTrustSignal(auth.user.id, "SALE_COMPLETED", { reference: applicationId });

  await notify({
    userId: application.applicantId,
    category: "ADOPTION",
    type: "adoption.completed",
    title: `${application.listing.pet.name} is yours`,
    body: "Their full health record and passport are now in your account.",
    url: "/dashboard/pets",
    entityType: "PET",
    entityId: application.listing.petId,
  });

  // Tell the others the outcome, so nobody is left refreshing a dead page.
  const others = await db.adoptionApplication.findMany({
    where: { listingId: application.listingId, id: { not: applicationId }, status: "REJECTED" },
    select: { applicantId: true },
  });

  for (const other of others) {
    await notify({
      userId: other.applicantId,
      category: "ADOPTION",
      type: "adoption.closed",
      title: `${application.listing.pet.name} has found a home`,
      body: "There are other pets looking for one. Your saved answers make the next application quick.",
      url: "/pets?intent=ADOPTION",
    });
  }
}

export async function listApplicationsForListing(auth: AuthContext, listingId: string) {
  const listing = await db.listing.findFirst({
    where: { id: listingId, deletedAt: null },
    select: { id: true, sellerId: true, pet: { select: { species: true, name: true } } },
  });
  if (!listing || listing.sellerId !== auth.user.id) throw notFound("That listing");

  const applications = await db.adoptionApplication.findMany({
    where: { listingId },
    orderBy: [{ status: "asc" }, { score: "desc" }],
    select: {
      id: true,
      status: true,
      score: true,
      homeType: true,
      hasYard: true,
      hasOtherPets: true,
      otherPetsInfo: true,
      hasChildren: true,
      childrenAges: true,
      hoursAloneDaily: true,
      experienceLevel: true,
      previousPets: true,
      motivation: true,
      answers: true,
      createdAt: true,
      decisionNote: true,
      conversationId: true,
      applicant: {
        select: {
          id: true,
          name: true,
          handle: true,
          avatarUrl: true,
          trustScore: true,
          city: true,
          country: true,
          createdAt: true,
          emailVerifiedAt: true,
          _count: { select: { pets: true } },
        },
      },
    },
  });

  return applications.map((a) => ({
    ...a,
    parsedAnswers: parseJsonRecord(a.answers),
    reasons: explainScore(a, listing.pet.species),
  }));
}

export async function listMyApplications(auth: AuthContext) {
  return db.adoptionApplication.findMany({
    where: { applicantId: auth.user.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      score: true,
      createdAt: true,
      decisionNote: true,
      conversationId: true,
      listing: {
        select: {
          id: true,
          slug: true,
          title: true,
          status: true,
          city: true,
          country: true,
          pet: {
            select: {
              id: true,
              name: true,
              species: true,
              breed: { select: { name: true } },
              photos: { where: { isPrimary: true }, take: 1, select: { url: true } },
            },
          },
          seller: { select: { id: true, name: true, handle: true, avatarUrl: true } },
        },
      },
    },
  });
}
