import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 28,
          backgroundColor: "#0a0a0a",
          backgroundImage: "radial-gradient(circle at 50% 30%, rgba(74,109,255,0.35), transparent 60%)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 96,
            height: 96,
            borderRadius: 20,
            backgroundColor: "#2b58f2",
          }}
        >
          <div style={{ width: 44, height: 44, backgroundColor: "#f5f5f5", borderRadius: 10 }} />
        </div>
        <div style={{ display: "flex", fontSize: 72, fontWeight: 600, color: "#fafafa" }}>
          DevPilot AI
        </div>
        <div style={{ display: "flex", fontSize: 28, color: "#a1a1aa" }}>
          The project workspace with an AI teammate
        </div>
      </div>
    ),
    { ...size },
  );
}
