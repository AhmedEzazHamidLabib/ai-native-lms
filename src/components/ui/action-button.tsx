import type { ReactNode } from "react";
import { Button } from "./button";

/** A <form> wrapping a single server-action button — no client JS needed. */
export function ActionButton({
  action,
  children,
  variant,
}: {
  action: () => void | Promise<void>;
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "destructive";
}) {
  return (
    <form action={action}>
      <Button type="submit" variant={variant}>
        {children}
      </Button>
    </form>
  );
}
