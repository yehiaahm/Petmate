import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

/**
 * The default social card.
 *
 * Generated rather than shipped as a static PNG so it stays in step with the
 * brand and needs no design tooling in the repo. Individual listings and
 * clinics override it with their own photo through `openGraph.images`.
 */
export const runtime = "nodejs";
export const alt = "PetMate — verified pets, verified people, one lifelong record";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpengraphImage() {
  // The app icon is rendered from the same vector mark the UI uses.
  const icon = await readFile(join(process.cwd(), "public", "icon-512.png"));
  const iconSrc = `data:image/png;base64,${icon.toString("base64")}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background:
            "radial-gradient(60% 70% at 0% 0%, rgba(54,183,180,0.35), transparent 70%), radial-gradient(50% 60% at 100% 100%, rgba(63,159,214,0.3), transparent 70%), #0b161c",
          padding: 72,
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- satori renders plain img only */}
          <img src={iconSrc} width={84} height={84} alt="" style={{ borderRadius: 20 }} />
          <div style={{ fontSize: 40, color: "#e9f4f5", fontWeight: 600, letterSpacing: 12 }}>
            PETMATE
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              fontSize: 76,
              lineHeight: 1.05,
              color: "#e9f4f5",
              fontWeight: 700,
              letterSpacing: -2,
              maxWidth: 980,
            }}
          >
            <span>Find your pet&rsquo;s&nbsp;</span>
            <span style={{ color: "#5ccfc8" }}>perfect mate</span>
          </div>
          <div
            style={{
              fontSize: 32,
              lineHeight: 1.4,
              color: "rgba(233,244,245,0.72)",
              maxWidth: 860,
            }}
          >
            Verified health records, escrow-protected payments, and a passport that follows the
            animal for life.
          </div>
        </div>

        <div
          style={{
            display: "flex",
            gap: 14,
            fontSize: 24,
            color: "rgba(233,244,245,0.6)",
          }}
        >
          <span>Buy &amp; adopt</span>
          <span>·</span>
          <span>Breeding</span>
          <span>·</span>
          <span>Pet hotels & training</span>
          <span>·</span>
          <span>Pet store</span>
        </div>
      </div>
    ),
    size,
  );
}
