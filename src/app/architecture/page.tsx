import EngineSteps from "@/components/EngineSteps";

export default function ArchitecturePage() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="rise pb-6 pt-2">
        <span className="rounded-full border border-[var(--hair)] bg-ink-850 px-3 py-1 text-[10.5px] font-bold uppercase tracking-[0.14em] text-text-faint">
          One engine
        </span>
        <h1 className="serif mt-3 text-[32px]">Seven steps, one tap</h1>
        <p className="mt-2 text-[14px] leading-snug text-text-dim">
          The sender types a name and an amount. Everything below happens so the
          recipient never makes a wallet, holds gas, or learns what a chain is.
          Both surfaces — single send and batch payout — run this exact pipeline.
        </p>
      </header>

      {/* The privacy claim — the bounty, stated once and clearly. */}
      <div className="card rise mb-5 border-volt/30 bg-volt/[0.05] p-4">
        <p className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-volt">
          The privacy claim
        </p>
        <p className="mt-1.5 text-[13.5px] leading-snug text-text-dim">
          The money enters and exits through public edges, but the transfer in
          the middle is an Unlink shielded move — the amount and the
          sender→recipient link are never readable on-chain. Privacy is never a
          button; it&apos;s the default path of every send.
        </p>
      </div>

      <div className="card rise p-5">
        <EngineSteps showcase />
      </div>

      {/* The FX-at-claim decision. */}
      <div className="card rise mt-4 p-4">
        <p className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-cool">
          FX at claim time
        </p>
        <p className="mt-1.5 text-[13.5px] leading-snug text-text-dim">
          The counterfactual account holds USDC; the conversion to the
          recipient&apos;s local stablecoin happens at CLAIM time, keyed off
          their region — not at send time. The sender settles dollars; the
          recipient decides the currency by tapping the link from where they are.
        </p>
      </div>

      {/* Sponsor legend. */}
      <div className="card rise mt-4 p-4">
        <p className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-text-faint">
          Who powers what
        </p>
        <ul className="mt-2 flex flex-col gap-1.5 text-[12.5px] text-text-dim">
          <li>
            <span className="font-medium text-text">Dynamic</span> — login,
            embedded smart wallets, aggregation, gas sponsorship.
          </li>
          <li>
            <span className="font-medium text-text">Unlink</span> — the shielded
            balance: the private transfer with no readable amount or edge.
          </li>
          <li>
            <span className="font-medium text-text">Arc / Circle</span> — the
            chain, USDC + EURC, and StableFX at claim time.
          </li>
          <li>
            <span className="font-medium text-text">ENS</span> — a plain
            public-resolver read for <span className="font-mono">.eth</span>{" "}
            names (not a sponsor SDK).
          </li>
        </ul>
      </div>

      <p className="mt-5 text-[11px] leading-snug text-text-faint">
        Demo mode runs every step deterministically with no credentials. Real
        adapters activate when their keys are present — the seven-step shape
        never changes.
      </p>
    </div>
  );
}
