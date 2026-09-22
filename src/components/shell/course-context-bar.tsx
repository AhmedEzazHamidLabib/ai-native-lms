"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils/cn";

export interface CourseNavItem {
  label: string;
  href: string;
}

export interface CourseNavSection {
  label: string;
  /** Where the top-level tab itself links (usually its first sub-tab). */
  href: string;
  /** Extra route prefixes besides `href` that belong to this section. */
  matchPrefixes?: string[];
  /** Only Overview should set this — it must never prefix-match every nested course page. */
  exactOnly?: boolean;
  /** Rendered as a second row only while this section is active. */
  subTabs?: CourseNavItem[];
  /** Small subtle marker next to the label, e.g. "New". */
  badge?: string;
}

function matchLength(pathname: string, candidate: string, exactOnly?: boolean): number {
  if (pathname === candidate) return candidate.length + 1; // exact match always wins ties
  if (!exactOnly && pathname.startsWith(candidate + "/")) return candidate.length;
  return 0;
}

function sectionMatchLength(pathname: string, section: CourseNavSection): number {
  const candidates = [section.href, ...(section.matchPrefixes ?? [])];
  return Math.max(0, ...candidates.map((c) => matchLength(pathname, c, section.exactOnly)));
}

/**
 * Sits at the top of every course-scoped page. Two tiers instead of one
 * long scrolling strip: a fixed set of top-level sections (never more
 * than a handful, so it never needs horizontal scroll at normal desktop
 * width), and — only for the active section — a second row of that
 * section's own local pages. Purely presentational: every href here is
 * an existing route, nothing moved or renamed underneath it.
 */
export function CourseContextBar({
  backHref,
  backLabel = "My Courses",
  courseCode,
  courseTitle,
  sections,
}: {
  backHref: string;
  backLabel?: string;
  courseCode: string;
  courseTitle: string;
  sections: CourseNavSection[];
}) {
  const pathname = usePathname();

  let active = sections[0];
  let bestLength = -1;
  for (const section of sections) {
    const length = sectionMatchLength(pathname, section);
    if (length > bestLength) {
      bestLength = length;
      active = section;
    }
  }

  return (
    <div className="-mx-4 sm:mx-0 mb-8">
      <div className="flex items-baseline justify-between gap-4 px-4 sm:px-0 mb-4">
        <div className="min-w-0">
          <Link
            href={backHref}
            className="text-xs text-azure hover:underline underline-offset-2"
          >
            ← {backLabel}
          </Link>
          <p className="font-display text-lg text-ink truncate">
            {courseCode} <span className="text-muted font-sans text-sm">· {courseTitle}</span>
          </p>
        </div>
      </div>
      <nav
        aria-label="Course sections"
        className="flex gap-1 overflow-x-auto px-4 sm:px-0 pb-1 -mb-px border-b border-border"
      >
        {sections.map((section) => {
          const isActive = section === active;
          return (
            <Link
              key={section.label}
              href={section.href}
              // This bar renders up to 13 links on every course page, all
              // dynamic (auth-gated) routes — Next.js's default viewport
              // prefetch was silently re-running the auth/layout chain for
              // every one of them in the background (measured: 31 vs 2
              // auth.getUser() calls per pageview with prefetch on vs off,
              // docs/PERFORMANCE_OPTIMIZATION_2026-09-22.md Phase 2A).
              // false disables viewport AND hover prefetch in the App
              // Router (unlike the Pages Router) — fetches only on click.
              prefetch={false}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "shrink-0 px-3 py-2 text-sm rounded-t-md border-b-2 transition-colors duration-[180ms] whitespace-nowrap font-medium tracking-wide",
                isActive
                  ? "border-azure text-ink"
                  : "border-transparent text-muted hover:text-text",
              )}
            >
              {section.label}
              {section.badge && (
                <span className="ml-1.5 align-middle rounded-full bg-azure-soft text-azure px-1.5 py-0.5 text-[9px] font-semibold tracking-wide normal-case">
                  {section.badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
      {active.subTabs && active.subTabs.length > 1 && (
        <nav
          aria-label={`${active.label} sections`}
          className="flex gap-4 overflow-x-auto px-4 sm:px-0 pt-3"
        >
          {active.subTabs.map((tab) => {
            const isActive = pathname === tab.href || pathname.startsWith(tab.href + "/");
            return (
              <Link
                key={tab.href}
                href={tab.href}
                prefetch={false}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "shrink-0 text-sm pb-1 border-b-2 transition-colors duration-[180ms] whitespace-nowrap",
                  isActive
                    ? "border-ink text-ink font-medium"
                    : "border-transparent text-muted hover:text-text",
                )}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
      )}
    </div>
  );
}
