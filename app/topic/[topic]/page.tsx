import { notFound } from "next/navigation";
import Link from "next/link";
import { scenarios } from "@/lib/scenarios";
import { TOPICS, getTopic } from "@/lib/topics";
import { TopicSidebar } from "@/components/TopicSidebar";
import { ScenarioList } from "@/components/ScenarioList";

export function generateStaticParams() {
  return TOPICS.map((topic) => ({ topic: topic.id }));
}

export default function TopicPage({ params }: { params: { topic: string } }) {
  const topic = getTopic(params.topic);
  if (!topic) notFound();

  const filtered = scenarios.filter((s) => s.topic === topic.id);

  return (
    <main className="mx-auto max-w-6xl px-4 pb-16 pt-8">
      <nav className="flex items-center gap-1.5 text-sm text-dim" aria-label="Breadcrumb">
        <Link href="/" className="hover:text-neutral-200 transition-colors">
          Scenarios
        </Link>
        <span>/</span>
        <span className="text-neutral-200">{topic.label}</span>
      </nav>

      <header className="mt-3 mb-10">
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-100">{topic.label}</h1>
        <p className="text-dim mt-2">{topic.description}</p>
      </header>

      <div className="flex flex-col lg:flex-row gap-8 items-start">
        <TopicSidebar />
        <div className="flex-1 min-w-0">
          <ScenarioList scenarios={filtered} />
        </div>
      </div>
    </main>
  );
}
