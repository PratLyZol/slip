/** Minimal honest stub for pages later agents will build out. */

export default function StubPage({
  title,
  blurb,
}: {
  title: string;
  blurb: string;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center text-center">
      <span className="rounded-full border border-[var(--hair)] bg-ink-850 px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-text-faint">
        Coming up
      </span>
      <h1 className="mt-4 text-[22px] font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 max-w-[280px] text-[14px] leading-snug text-text-dim">
        {blurb}
      </p>
    </div>
  );
}
