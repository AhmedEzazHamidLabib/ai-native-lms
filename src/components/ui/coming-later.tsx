import { PageHeader } from "./page-header";
import { EmptyState } from "./empty-state";

/**
 * Placeholder for sections not yet built. Establishes information
 * architecture without faking functionality — ordinary product copy,
 * no internal development-phase language.
 */
export function ComingLater({
  title,
  note,
}: {
  title: string;
  note: string;
}) {
  return (
    <>
      <PageHeader title={title} />
      <EmptyState title="Coming soon" description={note} />
    </>
  );
}
