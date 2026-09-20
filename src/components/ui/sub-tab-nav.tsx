"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils/cn";

export function SubTabNav({ tabs }: { tabs: { label: string; href: string }[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Sections" className="flex gap-1 overflow-x-auto pb-1 -mb-px border-b border-border mb-8">
      {tabs.map((tab) => {
        const active = tab.href === pathname || pathname.startsWith(tab.href + "/");
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "shrink-0 px-3 py-2 text-sm rounded-t-md border-b-2 transition-colors duration-[180ms] whitespace-nowrap",
              active ? "border-azure text-ink font-medium" : "border-transparent text-muted hover:text-text",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
