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
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#173c2d",
          padding: 72,
          fontFamily: "Georgia, serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 14,
              background: "#fbf9f5",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 34,
              color: "#173c2d",
              fontWeight: 700,
            }}
          >
            P
          </div>
          <div style={{ fontSize: 40, color: "#fbf9f5", fontWeight: 600, letterSpacing: -1 }}>
            PetMate
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div
            style={{
              fontSize: 76,
              lineHeight: 1.05,
              color: "#fbf9f5",
              fontWeight: 600,
              letterSpacing: -2,
              maxWidth: 940,
            }}
          >
            Know exactly who you are buying from
          </div>
          <div
            style={{
              fontSize: 32,
              lineHeight: 1.4,
              color: "rgba(251,249,245,0.72)",
              maxWidth: 860,
              fontFamily: "system-ui, sans-serif",
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
            color: "rgba(251,249,245,0.62)",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          <span>Buy &amp; adopt</span>
          <span>·</span>
          <span>Breeding</span>
          <span>·</span>
          <span>Vet booking</span>
          <span>·</span>
          <span>Pet store</span>
        </div>
      </div>
    ),
    size,
  );
}
