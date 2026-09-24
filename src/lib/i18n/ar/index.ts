import type { Messages } from "../translate";
import { common } from "./common";
import { shell } from "./shell";
import { sell } from "./sell";
import { errors } from "./errors";
import { commerce } from "./commerce";
import { breeding } from "./breeding";
import { community } from "./community";
import { account } from "./account";

/**
 * The Arabic dictionary, assembled from one module per product area so that
 * no single file becomes unreviewable. A sentence defined in two modules is a
 * mistake — the second would silently win — so assembly refuses it.
 */
const modules: Record<string, Messages> = { common, shell, sell, errors, commerce, breeding, community, account };

function assemble(parts: Record<string, Messages>): Messages {
  const out: Record<string, Messages[string]> = {};
  const origin: Record<string, string> = {};
  for (const [name, messages] of Object.entries(parts)) {
    for (const [key, value] of Object.entries(messages)) {
      if (key in out) {
        throw new Error(`Arabic dictionary: "${key}" is defined in both ${origin[key]} and ${name}.`);
      }
      out[key] = value;
      origin[key] = name;
    }
  }
  return Object.freeze(out);
}

export const ar: Messages = assemble(modules);
