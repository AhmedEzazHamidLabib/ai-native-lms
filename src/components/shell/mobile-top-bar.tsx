"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { SidebarNav, type NavItem } from "./sidebar-nav";
import { logout } from "@/lib/supabase/actions";

/**
 * Phone-width replacement for the permanent sidebar: a sticky top bar
 * (course name + menu button) plus a slide-over drawer holding the same
 * nav/role/sign-out content the desktop sidebar shows. Hidden entirely
 * at `sm` and up (the real sidebar takes over there), and the drawer's
 * backdrop/panel are only in the DOM while open — closed, there is
 * nothing here to intercept a tap on the page underneath.
 */
export function MobileTopBar({
  roleLabel,
  courseCode,
  userEmail,
  displayName,
  navItems,
}: {
  roleLabel: string;
  courseCode: string | null;
  userEmail: string | null;
  displayName?: string | null;
  navItems: NavItem[];
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <div className="sm:hidden">
      <div className="sticky top-0 z-20 h-14 flex items-center justify-between px-4 bg-warm-paper border-b border-border">
        <Link href="/" className="font-display text-lg tracking-tight text-ink">
          {courseCode ?? "Coursework"}
        </Link>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          aria-expanded={open}
          className="-mr-2 p-2.5 text-ink"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 z-30">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/30"
          />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85%] bg-warm-paper border-r border-border flex flex-col">
            <div className="h-14 flex items-center justify-between px-4 border-b border-border shrink-0">
              <span className="font-display text-lg tracking-tight text-ink">
                {courseCode ?? "Coursework"}
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="-mr-2 p-2.5 text-ink"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <div className="flex-1 px-2 py-4 overflow-y-auto" onClick={() => setOpen(false)}>
              <SidebarNav items={navItems} />
            </div>
            <div className="px-5 py-4 border-t border-border text-xs text-muted shrink-0">
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
          </div>
        </div>
      )}
    </div>
  );
}
