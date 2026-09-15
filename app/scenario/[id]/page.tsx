import { notFound } from "next/navigation";
import Link from "next/link";
import { scenarios, getScenario } from "@/lib/scenarios";
import { DifficultyBadge, TypeBadge, Tag } from "@/components/Badges";
import { Prose } from "@/components/Prose";
import { Terminal } from "@/components/Terminal";
import { HintPanel } from "@/components/HintPanel";
import { DiagnosisPanel } from "@/components/DiagnosisPanel";

export function generateStaticParams() {
  return scenarios.map((s) => ({ id: s.id }));
}

export default function ScenarioPage({ params }: { params: { id: string } }) {
  const scenario = getScenario(params.id);
  if (!scenario) notFound();

  return (
    <main className="mx-auto max-w-5xl px-4 pb-16 pt-8">
      <Link href="/" className="text-dim text-sm hover:text-accent transition-colors">
        &larr; All scenarios
      </Link>

      <header className="mt-3 mb-6">
        <h1 className="text-3xl font-bold">&ldquo;{scenario.title}&rdquo;</h1>
        <p className="text-dim mt-1">{scenario.subtitle}</p>
        <div className="flex items-center gap-2 mt-3">
          <DifficultyBadge difficulty={scenario.difficulty} />
          <TypeBadge type={scenario.type} />
          <span className="text-dim text-xs">{scenario.timeMinutes} minutes</span>
        </div>
        <div className="mt-2">
          {scenario.tags.map((t) => (
            <Tag key={t}>{t}</Tag>
          ))}
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-6">
        <div className="space-y-6 min-w-0">
          <div className="rounded-lg border border-border bg-panel p-4">
            <h2 className="text-xs uppercase tracking-wide text-dim mb-2">Briefing</h2>
            <Prose>{scenario.briefing}</Prose>
            {scenario.constraints.length > 0 && (
              <>
                <h2 className="text-xs uppercase tracking-wide text-dim mt-4 mb-2">Constraints</h2>
                <ul className="list-disc list-inside text-sm text-neutral-300 space-y-1">
                  {scenario.constraints.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </>
            )}
          </div>

          <Terminal world={scenario.world} scenarioId={scenario.id} />
        </div>

        <div className="space-y-6 min-w-0">
          <HintPanel hints={scenario.hints} />
          <DiagnosisPanel scenario={scenario} />
        </div>
      </div>
    </main>
  );
}
