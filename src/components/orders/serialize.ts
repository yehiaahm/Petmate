import type { getPetOrder } from "@/lib/services/petorder.service";
import type { PetOrderView } from "./pet-order-detail";

type ServerPetOrder = Awaited<ReturnType<typeof getPetOrder>>;

/**
 * Server shape → client shape.
 *
 * Dates become ISO strings and the counterparty is resolved once here, so the
 * client component never has to work out which side of the transaction the
 * viewer is on a second time.
 */
export function toPetOrderView(order: ServerPetOrder): PetOrderView {
  const seller = order.listing.seller;

  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    amountCents: order.amountCents,
    currency: order.currency,
    platformFeeCents: order.platformFeeCents,
    sellerPayoutCents: order.sellerPayoutCents,
    buyerConfirmedAt: order.buyerConfirmedAt?.toISOString() ?? null,
    sellerConfirmedAt: order.sellerConfirmedAt?.toISOString() ?? null,
    autoReleaseAt: order.autoReleaseAt?.toISOString() ?? null,
    escrowReleasedAt: order.escrowReleasedAt?.toISOString() ?? null,
    createdAt: order.createdAt.toISOString(),
    meetingNote: order.meetingNote,
    isBuyer: order.isBuyer,
    iConfirmed: order.iConfirmed,
    theyConfirmed: order.theyConfirmed,
    escrowWindowHours: order.escrowWindowHours,
    listing: {
      slug: order.listing.slug,
      title: order.listing.title,
      city: order.listing.city,
      country: order.listing.country,
      pet: {
        id: order.listing.pet.id,
        name: order.listing.pet.name,
        passportNo: order.listing.pet.passportNo,
        breedName: order.listing.pet.breed?.name ?? null,
        photoUrl: order.listing.pet.photos[0]?.url ?? null,
      },
      seller: {
        id: seller.id,
        name: seller.name,
        handle: seller.handle,
        avatarUrl: seller.avatarUrl,
        trustScore: seller.trustScore,
      },
    },
    counterparty: {
      name: order.counterparty.name,
      handle: order.counterparty.handle,
      avatarUrl: order.counterparty.avatarUrl,
      trustScore: order.counterparty.trustScore,
    },
  };
}
