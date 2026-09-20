"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils/cn";

export interface NavItem {
  label: string;
  href: string;
  disabled?: boolean;
}

export function SidebarNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Primary" className="flex flex-col gap-0.5">
      {items.map((item) => {
        const active =
          item.href === pathname ||
          (item.href !== "/" && pathname.startsWith(item.href + "/"));

        if (item.disabled) {
          return (
            <span
              key={item.href}
              className="relative px-3 py-2 text-sm text-muted/60 cursor-not-allowed select-none"
              aria-disabled="true"
            >
              {item.label}
            </span>
          );
        }

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative px-3 py-2 text-sm rounded-md transition-colors duration-[180ms] ease-out",
              active
                ? "text-ink font-medium"
                : "text-muted hover:text-text hover:bg-black/[0.03]",
            )}
          >
            {active && (
              <span
                aria-hidden
                className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-[2px] -ml-3 bg-azure rounded-full"
              />
            )}
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
