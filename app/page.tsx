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
    <main className="mx-auto max-w-6xl px-4 pb-16 pt-8">
      <header className="mb-10">
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-100">Scenarios</h1>
        <p className="text-dim mt-2 max-w-2xl">
          Real ArgoCD, Kubernetes, and Spring Boot incidents. Investigate a mocked cluster in your browser, deduce
          the root cause, no infra required.
        </p>
        <div className="mt-3 inline-flex items-center gap-2 text-sm text-dim">
          <span className="h-1.5 w-1.5 rounded-full bg-easy" />
          {total} / {scenarios.length} solved
        </div>
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
