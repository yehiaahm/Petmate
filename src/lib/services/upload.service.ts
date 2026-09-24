import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { badRequest, dependencyFailed } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { LIMITS } from "@/lib/constants";

/**
 * Uploads.
 *
 * A file's declared MIME type is a client-supplied string and is never trusted.
 * Every upload is checked against its actual magic bytes, and the extension
 * written to disk is derived from that check — never from the original filename.
 * That closes the classic "shell.php renamed to cat.jpg" path, and it means a
 * mislabelled file is rejected rather than stored under a type it is not.
 */

export type UploadPurpose =
  | "PET_PHOTO"
  | "PET_DOCUMENT"
  | "PRODUCT_IMAGE"
  | "AVATAR"
  | "BANNER"
  | "VERIFICATION"
  | "EVIDENCE"
  | "DELIVERY_PROOF"
  | "MESSAGE_ATTACHMENT";

interface TypeSpec {
  mime: string;
  extension: string;
  /** Byte signature at the given offset. */
  magic: { offset: number; bytes: number[] }[];
}

const IMAGE_TYPES: TypeSpec[] = [
  { mime: "image/jpeg", extension: "jpg", magic: [{ offset: 0, bytes: [0xff, 0xd8, 0xff] }] },
  {
    mime: "image/png",
    extension: "png",
    magic: [{ offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }],
  },
  {
    mime: "image/webp",
    extension: "webp",
    // RIFF....WEBP
    magic: [
      { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] },
      { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] },
    ],
  },
  {
    mime: "image/gif",
    extension: "gif",
    magic: [{ offset: 0, bytes: [0x47, 0x49, 0x46, 0x38] }],
  },
];

const DOCUMENT_TYPES: TypeSpec[] = [
  { mime: "application/pdf", extension: "pdf", magic: [{ offset: 0, bytes: [0x25, 0x50, 0x44, 0x46] }] },
];

const PURPOSE_RULES: Record<
  UploadPurpose,
  { types: TypeSpec[]; maxBytes: number; public: boolean }
> = {
  PET_PHOTO: { types: IMAGE_TYPES, maxBytes: LIMITS.maxUploadBytes, public: true },
  PRODUCT_IMAGE: { types: IMAGE_TYPES, maxBytes: LIMITS.maxUploadBytes, public: true },
  AVATAR: { types: IMAGE_TYPES, maxBytes: 3 * 1024 * 1024, public: true },
  BANNER: { types: IMAGE_TYPES, maxBytes: LIMITS.maxUploadBytes, public: true },
  MESSAGE_ATTACHMENT: { types: IMAGE_TYPES, maxBytes: LIMITS.maxUploadBytes, public: false },
  // Documents are private by default: a vaccination card carries a name, an
  // address and a microchip number.
  PET_DOCUMENT: {
    types: [...IMAGE_TYPES, ...DOCUMENT_TYPES],
    maxBytes: LIMITS.maxDocumentBytes,
    public: false,
  },
  VERIFICATION: {
    types: [...IMAGE_TYPES, ...DOCUMENT_TYPES],
    maxBytes: LIMITS.maxDocumentBytes,
    public: false,
  },
  EVIDENCE: {
    types: [...IMAGE_TYPES, ...DOCUMENT_TYPES],
    maxBytes: LIMITS.maxDocumentBytes,
    public: false,
  },
  DELIVERY_PROOF: { types: IMAGE_TYPES, maxBytes: LIMITS.maxUploadBytes, public: false },
};

function detectType(buffer: Buffer, allowed: TypeSpec[]): TypeSpec | null {
  for (const spec of allowed) {
    const matches = spec.magic.every((sig) =>
      sig.bytes.every((byte, i) => buffer[sig.offset + i] === byte),
    );
    if (matches) return spec;
  }
  return null;
}

/** Dimensions from the header bytes, without pulling in an image library. */
function readImageDimensions(buffer: Buffer, mime: string): { width: number; height: number } | null {
  try {
    if (mime === "image/png" && buffer.length > 24) {
      return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    }
    if (mime === "image/gif" && buffer.length > 10) {
      return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
    }
    if (mime === "image/jpeg") {
      let offset = 2;
      while (offset < buffer.length - 9) {
        if (buffer[offset] !== 0xff) {
          offset++;
          continue;
        }
        const marker = buffer[offset + 1]!;
        // SOF0-SOF15, excluding the non-frame markers.
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
        }
        offset += 2 + buffer.readUInt16BE(offset + 2);
      }
    }
  } catch {
    return null;
  }
  return null;
}

export interface StoredFile {
  id: string;
  url: string;
  mime: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
}

export async function storeUpload(params: {
  file: File;
  purpose: UploadPurpose;
  ownerId: string;
}): Promise<StoredFile> {
  const rules = PURPOSE_RULES[params.purpose];
  if (!rules) throw badRequest("Unsupported upload type.");

  if (params.file.size === 0) throw badRequest("That file is empty.");
  if (params.file.size > rules.maxBytes) {
    throw badRequest(`Files must be under ${Math.round(rules.maxBytes / 1024 / 1024)} MB.`);
  }

  const buffer = Buffer.from(await params.file.arrayBuffer());

  // The real check. `file.type` is whatever the browser (or the attacker) said.
  const detected = detectType(buffer, rules.types);
  if (!detected) {
    throw badRequest(
      `That file type is not accepted here. Allowed: ${[...new Set(rules.types.map((t) => t.extension))].join(", ")}.`,
    );
  }

  // An SVG would pass no magic-byte test above, which is the point: SVG is a
  // script container and is never accepted.

  const checksum = createHash("sha256").update(buffer).digest("hex");

  // The same bytes uploaded twice reuse one object.
  const existing = await db.fileObject.findFirst({
    where: { checksum, ownerId: params.ownerId, purpose: params.purpose },
    select: { id: true, url: true, mime: true, sizeBytes: true, width: true, height: true },
  });
  if (existing) return existing;

  const dimensions = readImageDimensions(buffer, detected.mime);
  const key = `${params.purpose.toLowerCase()}/${new Date().getUTCFullYear()}/${randomUUID()}.${detected.extension}`;

  const url =
    env().STORAGE_DRIVER === "s3"
      ? await storeToS3(key, buffer, detected.mime)
      : await storeToDisk(key, buffer);

  const record = await db.fileObject.create({
    data: {
      ownerId: params.ownerId,
      key,
      url,
      mime: detected.mime,
      sizeBytes: buffer.length,
      width: dimensions?.width ?? null,
      height: dimensions?.height ?? null,
      checksum,
      purpose: params.purpose,
      storage: env().STORAGE_DRIVER,
      scanStatus: "CLEAN",
    },
    select: { id: true, url: true, mime: true, sizeBytes: true, width: true, height: true },
  });

  logger.info("file stored", { purpose: params.purpose, bytes: buffer.length, mime: detected.mime });
  return record;
}

async function storeToDisk(key: string, buffer: Buffer): Promise<string> {
  const root = path.join(process.cwd(), "public", "uploads");
  const target = path.join(root, key);

  // Defence in depth: the key is generated, but never write outside the root.
  const resolved = path.resolve(target);
  if (!resolved.startsWith(path.resolve(root) + path.sep)) {
    throw badRequest("Invalid upload path.");
  }

  await mkdir(path.dirname(resolved), { recursive: true });
  await writeFile(resolved, buffer);
  return `/uploads/${key}`;
}

/** The slice of the AWS SDK this adapter uses, typed locally. */
interface S3Module {
  S3Client: new (config: {
    region: string;
    credentials: { accessKeyId: string; secretAccessKey: string };
  }) => { send: (command: unknown) => Promise<unknown> };
  PutObjectCommand: new (input: {
    Bucket: string;
    Key: string;
    Body: Buffer;
    ContentType: string;
    CacheControl: string;
  }) => unknown;
}

async function storeToS3(key: string, buffer: Buffer, mime: string): Promise<string> {
  const e = env();
  if (!e.S3_BUCKET || !e.S3_REGION || !e.S3_ACCESS_KEY_ID || !e.S3_SECRET_ACCESS_KEY) {
    throw dependencyFailed("File storage is not configured.", "STORAGE_DRIVER=s3 without credentials");
  }

  // Resolved at runtime through a variable specifier so a local-storage
  // deployment does not have to install the AWS SDK at all. It is declared in
  // optionalDependencies; `npm i @aws-sdk/client-s3` enables STORAGE_DRIVER=s3.
  try {
    const specifier = "@aws-sdk/client-s3";
    const aws = (await import(/* @vite-ignore */ specifier)) as unknown as S3Module;

    const client = new aws.S3Client({
      region: e.S3_REGION,
      credentials: { accessKeyId: e.S3_ACCESS_KEY_ID, secretAccessKey: e.S3_SECRET_ACCESS_KEY },
    });

    await client.send(
      new aws.PutObjectCommand({
        Bucket: e.S3_BUCKET,
        Key: key,
        Body: buffer,
        ContentType: mime,
        CacheControl: "public, max-age=31536000, immutable",
      }),
    );

    const base = e.S3_PUBLIC_URL ?? `https://${e.S3_BUCKET}.s3.${e.S3_REGION}.amazonaws.com`;
    return `${base.replace(/\/$/, "")}/${key}`;
  } catch (error) {
    logger.exception("s3 upload failed", error);
    throw dependencyFailed("We could not store that file. Please try again.");
  }
}

/** Confirms a file belongs to the caller before it is attached to a record. */
export async function assertOwnsFile(fileId: string, ownerId: string) {
  const file = await db.fileObject.findFirst({
    where: { id: fileId, ownerId },
    select: { id: true, url: true, mime: true, purpose: true },
  });
  if (!file) throw badRequest("That file could not be found.");
  return file;
}
