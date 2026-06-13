"use client";

/**
 * Compact wallet status in the top bar. Demo mode shows the simulated sender +
 * fixed balance; real mode shows the Dynamic identity + live USDC balance, with
 * a login affordance when signed out.
 */

import { useWallet } from "./WalletProvider";
import { formatAmount } from "@/lib/format";

export default function WalletPill() {
  const wallet = useWallet();

  if (!wallet.loggedIn) {
    return (
      <button
        onClick={wallet.login}
        className="focus-volt rounded-full bg-volt px-4 py-1.5 text-[13px] font-semibold text-ink-950 transition-opacity hover:opacity-90"
      >
        Sign in
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2.5 rounded-full border border-[var(--hair)] bg-ink-850 py-1.5 pl-2.5 pr-3">
      <span className="grid h-6 w-6 place-items-center rounded-full bg-ink-700 text-[11px] font-semibold text-volt">
        {wallet.name.slice(0, 1).toUpperCase()}
      </span>
      <div className="flex flex-col leading-tight">
        <span className="text-[11px] font-medium text-text">
          {wallet.balanceUsdc === null
            ? "—"
            : `$${formatAmount(wallet.balanceUsdc)}`}
        </span>
        <span className="text-[9px] uppercase tracking-wide text-text-faint">
          {wallet.demo ? "demo · usdc" : "usdc"}
        </span>
      </div>
    </div>
  );
}
