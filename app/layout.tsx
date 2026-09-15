import type { Metadata } from "next";
import "./globals.css";
import { NavBar } from "@/components/NavBar";

export const metadata: Metadata = {
  // Origin only - Next's `basePath` config already prefixes "/on-call-horror"
  // onto relative metadata URLs (icon, opengraph-image, etc.); including it
  // here too would double it up.
  metadataBase: new URL("https://narenviswanath.com"),
  title: "On-Call Horror",
  description: "Deductive ArgoCD/Kubernetes on-call incident scenarios, played entirely in your browser.",
  twitter: {
    card: "summary_large_image",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-bg text-neutral-100 antialiased">
        <NavBar />
        {children}
      </body>
    </html>
  );
}
