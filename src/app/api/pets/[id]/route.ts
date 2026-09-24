import { route, idParam } from "@/lib/api";
import { requireActive } from "@/lib/auth/rbac";
import { getAuth } from "@/lib/auth/session";
import {
  deletePet,
  getPetDetail,
  updatePet,
  updatePetSchema,
} from "@/lib/services/pet.service";

export const GET = route({
  params: idParam,
  async handler({ params }) {
    const auth = await getAuth();
    const pet = await getPetDetail(params.id, auth);
    return { pet };
  },
});

export const PATCH = route({
  auth: true,
  params: idParam,
  body: updatePetSchema,
  async handler({ params, body }) {
    const auth = await requireActive();
    const pet = await updatePet(auth, params.id, body);
    return { pet };
  },
});

export const DELETE = route({
  auth: true,
  params: idParam,
  async handler({ params }) {
    const auth = await requireActive();
    await deletePet(auth, params.id);
    return { ok: true };
  },
});
