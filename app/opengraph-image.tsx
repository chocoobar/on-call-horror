import { ImageResponse } from "next/og";
import { BRAND, TerminalMark } from "@/lib/branding";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: BRAND.bg,
          padding: 64,
          position: "relative",
        }}
      >
        <div style={{ position: "absolute", top: 0, left: 0, width: "100%", height: 6, display: "flex", background: BRAND.accent }} />

        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", width: 620 }}>
          <div style={{ display: "flex", color: BRAND.accent, fontSize: 20, letterSpacing: 4, fontWeight: 700 }}>
            ARGOCD · KUBERNETES · GITOPS
          </div>
          <div style={{ display: "flex", color: BRAND.text, fontSize: 80, fontWeight: 800, marginTop: 16, lineHeight: 1.05 }}>
            On-Call Horror
          </div>
          <div style={{ display: "flex", color: BRAND.dim, fontSize: 28, marginTop: 20, lineHeight: 1.4 }}>
            Deductive incident scenarios for on-call engineers - played entirely in your browser.
          </div>
          <div style={{ display: "flex", alignItems: "center", marginTop: 48 }}>
            <TerminalMark size={56} />
            <div style={{ display: "flex", color: BRAND.dim, fontSize: 22, marginLeft: 16 }}>
              investigate. deduce. resolve.
            </div>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            width: 460,
            marginLeft: "auto",
            alignSelf: "center",
            background: BRAND.panel,
            border: `1px solid ${BRAND.border}`,
            borderRadius: 12,
            overflow: "hidden",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", padding: "12px 16px", background: "#1b1e25", gap: 8 }}>
            <div style={{ display: "flex", width: 12, height: 12, borderRadius: 999, background: "#ff4d4d99" }} />
            <div style={{ display: "flex", width: 12, height: 12, borderRadius: 999, background: "#e0a83e99" }} />
            <div style={{ display: "flex", width: 12, height: 12, borderRadius: 999, background: "#4caf7d99" }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", padding: 20, gap: 6 }}>
            <div style={{ display: "flex", color: "#4caf7d", fontSize: 17 }}>$ kubectl get pods -n workers</div>
            <div style={{ display: "flex", color: BRAND.dim, fontSize: 15 }}>NAME                    READY  STATUS</div>
            <div style={{ display: "flex", color: BRAND.accent, fontSize: 15 }}>queue-worker-7d9f..     0/1    CrashLoopBackOff</div>
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}
