import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "On-Call Horror",
  description: "Deductive ArgoCD/Kubernetes on-call incident scenarios, played entirely in your browser.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-bg text-neutral-100 antialiased">{children}</body>
    </html>
  );
}
