import { ImageResponse } from "next/og";
import { TerminalMark } from "@/lib/branding";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(<TerminalMark size={180} />, { ...size });
}
