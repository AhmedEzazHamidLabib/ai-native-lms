import Link from "next/link";
import type { ReactNode } from "react";
import { SidebarNav, type NavItem } from "./sidebar-nav";
import { MobileTopBar } from "./mobile-top-bar";
import { logout } from "@/lib/supabase/actions";

/**
 * One shell, two presentations of the same navigation model — not two
 * apps. Below `sm`, the permanent sidebar (previously rendered
 * unconditionally at all widths, which is what crushed the main column
 * into a sliver on a phone) is replaced by a top bar + slide-over
 * drawer (`MobileTopBar`); at `sm` and up, the drawer's trigger is
 * hidden and the original sidebar takes over exactly as before.
 */
export function AppShell({
  roleLabel,
  courseCode,
  userEmail,
  displayName,
  navItems,
  children,
}: {
  roleLabel: string;
  courseCode: string | null;
  userEmail: string | null;
  /** Prefer this over email as the primary human identity (Part 7) — never inferred, only what the student set. */
  displayName?: string | null;
  navItems: NavItem[];
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen w-full">
      <aside className="hidden sm:flex w-60 shrink-0 border-r border-border flex-col">
        <div className="h-16 flex items-center px-5 border-b border-border">
          <Link href="/" className="font-display text-lg tracking-tight text-ink">
            {courseCode ?? "Coursework"}
          </Link>
        </div>
        <div className="flex-1 px-2 py-4">
          <SidebarNav items={navItems} />
        </div>
        <div className="px-5 py-4 border-t border-border text-xs text-muted">
          <p className="truncate">{roleLabel}</p>
          <p className="mb-0.5 truncate">
            <span className="text-text font-medium">{displayName || userEmail || " "}</span>
          </p>
          <p className="truncate mb-2">{displayName ? userEmail : " "}</p>
          <form action={logout}>
            <button
              type="submit"
              className="text-azure hover:underline underline-offset-2"
            >
              Sign out
            </button>
          </form>
        </div>
      </aside>
      <div className="flex-1 flex flex-col min-w-0">
        <MobileTopBar
          roleLabel={roleLabel}
          courseCode={courseCode}
          userEmail={userEmail}
          displayName={displayName}
          navItems={navItems}
        />
        <main className="flex-1 w-full max-w-5xl px-4 py-6 sm:px-10 sm:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
