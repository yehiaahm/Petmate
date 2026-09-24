import { ImageResponse } from "next/og";

/** Home-screen icon for iOS. Generated so there is one source of brand truth. */
export const runtime = "nodejs";
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default async function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#1f4d3a",
          color: "#fbf9f5",
          fontSize: 110,
          fontWeight: 700,
          fontFamily: "Georgia, serif",
        }}
      >
        P
      </div>
    ),
    size,
  );
}
