import { route } from "@/lib/api";
import { requireActive } from "@/lib/auth/rbac";
import {
  createPet,
  createPetSchema,
  listPetsForOwner,
} from "@/lib/services/pet.service";

export const GET = route({
  auth: true,
  async handler({ auth }) {
    const pets = await listPetsForOwner(auth!.user.id);
    return { pets };
  },
});

export const POST = route({
  auth: true,
  rateLimit: "petCreate",
  body: createPetSchema,
  async handler({ body }) {
    const auth = await requireActive();
    const pet = await createPet(auth, body);
    return { pet };
  },
});
