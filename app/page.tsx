"use client";

import { useEffect, useState } from "react";
import { scenarios } from "@/lib/scenarios";
import { solvedCount } from "@/lib/progress";
import { TopicSidebar } from "@/components/TopicSidebar";
import { ScenarioList } from "@/components/ScenarioList";

export default function CatalogPage() {
  const [total, setTotal] = useState(0);

  useEffect(() => {
    setTotal(solvedCount());
  }, []);

  return (
    <main className="mx-auto max-w-6xl px-4 pb-16 pt-10">
      <header className="text-center mb-10">
        <h1 className="text-4xl font-bold tracking-tight" style={{ textShadow: "0 0 18px #7a1f1f" }}>
          On-Call Horror
        </h1>
        <p className="text-dim mt-2">
          Real ArgoCD &amp; Kubernetes incidents. Investigate a mocked cluster in your browser, deduce the root
          cause, no infra required.
        </p>
        <p className="text-dim text-sm mt-3">
          {total} / {scenarios.length} solved
        </p>
      </header>

      <div className="flex flex-col lg:flex-row gap-8 items-start">
        <TopicSidebar />
        <div className="flex-1 min-w-0">
          <ScenarioList scenarios={scenarios} />
        </div>
      </div>

      <footer className="text-center text-dim text-sm mt-12 pt-6 border-t border-border">
        No sign-up, no servers, no real Kubernetes cluster - every scenario is a mocked kubectl/argocd console
        running entirely in your browser.
      </footer>
    </main>
  );
}
