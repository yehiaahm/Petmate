import "server-only";
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { env } from "@/lib/env";

/**
 * Encryption for secrets the server has to read back (a two-factor seed),
 * as opposed to ones it only compares (passwords, tokens), which are hashed.
 *
 * AES-256-GCM with a key derived from AUTH_SECRET for one purpose, so a
 * database dump alone does not hand over anyone's authenticator. The output is
 * versioned so the key can be rotated later without guessing formats.
 */

function key(purpose: string): Buffer {
  return Buffer.from(hkdfSync("sha256", env().AUTH_SECRET, Buffer.alloc(0), `petmate:${purpose}`, 32));
}

export function seal(plaintext: string, purpose: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(purpose), iv);
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}

export function open(sealed: string, purpose: string): string {
  const [version, iv, tag, body] = sealed.split(".");
  if (version !== "v1" || !iv || !tag || !body) throw new Error("unrecognised sealed value");
  const decipher = createDecipheriv("aes-256-gcm", key(purpose), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
}
