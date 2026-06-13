import EngineSteps from "@/components/EngineSteps";

export default function ArchitecturePage() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="pb-6 pt-2">
        <span className="rounded-full border border-[var(--hair)] bg-ink-850 px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-text-faint">
          One engine
        </span>
        <h1 className="mt-3 text-[24px] font-semibold tracking-tight">
          Seven steps, one tap
        </h1>
        <p className="mt-2 text-[14px] leading-snug text-text-dim">
          The sender types a name and an amount. Everything below happens so the
          recipient never makes a wallet, holds gas, or learns what a chain is.
        </p>
      </header>

      <div className="rounded-2xl border border-[var(--hair)] bg-ink-900/60 p-5">
        <EngineSteps showcase />
      </div>

      <p className="mt-5 text-[12px] leading-snug text-text-faint">
        Privacy and FX legs are queued here — they wire in later phases. The
        shape never changes: the recipient just taps a link.
      </p>
    </div>
  );
}
