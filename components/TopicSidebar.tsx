"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { TOPICS } from "@/lib/topics";
import { scenarios } from "@/lib/scenarios";

function NavLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={`block rounded-md border-l-2 py-2 pl-3 pr-2.5 text-sm transition-colors ${
        active
          ? "border-accent bg-panel text-neutral-100 font-medium"
          : "border-transparent text-dim hover:border-border hover:bg-panel/50 hover:text-neutral-200"
      }`}
    >
      {children}
    </Link>
  );
}

export function TopicSidebar() {
  const pathname = usePathname();

  return (
    <nav className="w-full lg:w-56 shrink-0" aria-label="Topics">
      <h2 className="mb-2 px-3 text-xs font-medium uppercase tracking-wide text-dim">Topics</h2>
      <ul className="space-y-0.5">
        <li>
          <NavLink href="/" active={pathname === "/"}>
            All scenarios
          </NavLink>
        </li>
        {TOPICS.map((topic) => {
          const href = `/topic/${topic.id}/`;
          const count = scenarios.filter((s) => s.topic === topic.id).length;
          return (
            <li key={topic.id}>
              <NavLink href={href} active={pathname === href || pathname === `/topic/${topic.id}`}>
                <span className="flex items-center justify-between">
                  <span>{topic.label}</span>
                  <span className="text-dim text-xs tabular-nums">{count}</span>
                </span>
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
