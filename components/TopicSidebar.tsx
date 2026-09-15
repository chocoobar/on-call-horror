"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { TOPICS } from "@/lib/topics";
import { scenarios } from "@/lib/scenarios";

function NavLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={`block rounded px-3 py-2 text-sm transition-colors ${
        active ? "bg-panel text-accent font-semibold" : "text-dim hover:bg-panel hover:text-neutral-200"
      }`}
    >
      {children}
    </Link>
  );
}

export function TopicSidebar() {
  const pathname = usePathname();

  return (
    <nav className="lg:w-56 shrink-0" aria-label="Topics">
      <h2 className="text-xs uppercase tracking-wide text-dim mb-2 px-3">Topics</h2>
      <ul className="space-y-1">
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
                  <span className="text-dim text-xs">{count}</span>
                </span>
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
