"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "./Logo";
import { scenarios } from "@/lib/scenarios";
import { solvedCount } from "@/lib/progress";

function GitHubIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.64 0 8.13c0 3.6 2.29 6.65 5.47 7.72.4.08.55-.17.55-.39 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.5-2.69-.95-.09-.23-.48-.95-.82-1.14-.28-.15-.68-.53-.01-.54.63-.01 1.08.59 1.23.83.72 1.23 1.87.88 2.33.67.07-.53.28-.88.51-1.08-1.78-.2-3.64-.91-3.64-4.02 0-.89.31-1.61.82-2.18-.08-.2-.36-1.03.08-2.14 0 0 .67-.22 2.2.83a7.4 7.4 0 0 1 4 0c1.53-1.06 2.2-.83 2.2-.83.44 1.11.16 1.94.08 2.14.51.57.82 1.28.82 2.18 0 3.12-1.87 3.81-3.65 4.02.29.25.54.75.54 1.51 0 1.09-.01 1.97-.01 2.24 0 .22.15.48.55.39A8.14 8.14 0 0 0 16 8.13C16 3.64 12.42 0 8 0Z" />
    </svg>
  );
}

const NAV_LINKS = [{ href: "/", label: "Scenarios" }];

export function NavBar() {
  const pathname = usePathname();
  const [solved, setSolved] = useState<number | null>(null);

  useEffect(() => {
    setSolved(solvedCount());
  }, [pathname]);

  return (
    <header className="sticky top-0 z-20 border-b border-border bg-bg/85 backdrop-blur supports-[backdrop-filter]:bg-bg/70">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4">
        <Link href="/" className="flex items-center gap-2.5 shrink-0">
          <Logo size={28} />
          <span className="font-semibold tracking-tight text-neutral-100">On-Call Horror</span>
        </Link>

        <nav className="flex items-center gap-1" aria-label="Primary">
          {NAV_LINKS.map((link) => {
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                  active ? "bg-panel text-neutral-100" : "text-dim hover:bg-panel/60 hover:text-neutral-200"
                }`}
              >
                {link.label}
              </Link>
            );
          })}

          {solved !== null && (
            <span className="ml-1 hidden items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs text-dim sm:inline-flex">
              <span className="h-1.5 w-1.5 rounded-full bg-easy" />
              {solved} / {scenarios.length} solved
            </span>
          )}

          <a
            href="https://github.com/chocoobar/on-call-horror"
            target="_blank"
            rel="noreferrer"
            className="ml-1 flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-dim transition-colors hover:bg-panel/60 hover:text-neutral-200"
          >
            <GitHubIcon />
            <span className="hidden sm:inline">GitHub</span>
          </a>
        </nav>
      </div>
    </header>
  );
}
