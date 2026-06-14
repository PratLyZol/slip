"use client";

/**
 * Home — the dashboard. Shows the connected wallet (address + connect flow) and
 * the sender's USDC across ALL chains (wallet.balances), then routes to the
 * three things you actually do: Send, Claim, Settings.
 *
 * Recipients never see chain words; this is the SENDER's home, so showing the
 * per-chain USDC split here is fine — it's the sender's own funding picture.
 *
 * The per-chain list + the headline total both read `wallet.balances` (the
 * frozen multi-chain contract from Wallet-Settings).
 */

import Link from "next/link";
import { useWallet } from "./WalletProvider";
import { formatAmount } from "@/lib/format";
import UnifyBalance from "./UnifyBalance";

export default function HomeScreen() {
  const wallet = useWallet();
  const connected = Boolean(wallet.address);

  // Σ USDC across every chain we read — the headline total. null entries (a
  // chain still loading / read failed) count as 0 here; the per-chain rows
  // still render "—" for those individually.
  const totalUsdc = wallet.balances.reduce((sum, b) => sum + (b.usdc ?? 0), 0);
  const anyLoaded = wallet.balances.some((b) => b.usdc !== null);

  return (
    <div className="flex flex-1 flex-col">
      {/* Total balance across chains — the hero. */}
      <section className="rise relative mt-2 flex flex-col items-center pt-7">
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-0 h-44 w-72 -translate-x-1/2 rounded-full bg-volt/[0.06] blur-3xl"
        />
        <span className="kicker">Your balance</span>
        <div className="mt-3 flex items-baseline gap-1">
          <span className="amount-figure text-[34px] text-text-faint">$</span>
          <span className="amount-figure text-[60px] font-medium leading-none text-text">
            {connected && anyLoaded ? formatAmount(totalUsdc) : connected ? "—" : "0"}
          </span>
        </div>
        <p className="amount-figure mt-3 text-[12px] text-text-faint">
          {connected
            ? "USDC across your chains"
            : "Connect a wallet to load your balance"}
        </p>
      </section>

      {/* Connected wallet card. */}
      <section className="rise mt-7">
        <span className="kicker">Wallet</span>
        {connected ? (
          <div className="card mt-2.5 flex items-center gap-3 p-3.5">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ink-700 text-[11px] font-semibold text-volt">
              {wallet.address!.slice(2, 4).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-mono text-[13px] text-text">
                {wallet.name}
              </p>
              <p className="text-[11px] text-text-faint">Connected</p>
            </div>
            <button
              type="button"
              onClick={wallet.logout}
              className="focus-volt shrink-0 rounded-xl border border-[var(--hair)] bg-ink-850 px-3 py-2 text-[12px] font-semibold text-text-dim transition-opacity hover:opacity-90"
            >
              Disconnect
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={wallet.login}
            className="btn-volt focus-volt mt-2.5 w-full rounded-2xl py-3.5 text-[15px] font-bold"
          >
            Connect Wallet
          </button>
        )}
      </section>

      {/* Per-chain USDC breakdown. */}
      {connected && wallet.balances.length > 0 && (
        <section className="rise mt-7">
          <span className="kicker">Across chains</span>
          <div className="card mt-2.5 p-3.5">
            {wallet.balances.map((b, i) => (
              <div
                key={b.chainId}
                className={`flex items-center justify-between py-2 ${
                  i > 0 ? "border-t border-[var(--hair)]" : ""
                }`}
              >
                <span className="text-[13px] text-text-dim">{b.name}</span>
                <span className="amount-figure text-[13px] text-text">
                  {b.usdc !== null ? `$${formatAmount(b.usdc)}` : "—"}
                </span>
              </div>
            ))}
          </div>
          <UnifyBalance />
        </section>
      )}

      {/* When balances haven't loaded yet, still surface the bridge action. */}
      {connected && wallet.balances.length === 0 && (
        <section className="rise mt-7">
          <UnifyBalance />
        </section>
      )}

      <div className="flex-1" />

      {/* Actions — the things you do. */}
      <section className="rise mt-8 grid grid-cols-2 gap-2.5">
        <ActionCard
          href="/send"
          title="Send"
          subtitle="Pay anyone a link"
          accent
        />
        <ActionCard href="/claim" title="Claim" subtitle="Open a slip" />
        <ActionCard href="/settings" title="Settings" subtitle="Wallet & network" />
        <ActionCard
          href="/architecture"
          title="How it works"
          subtitle="Under the hood"
        />
      </section>
    </div>
  );
}

function ActionCard({
  href,
  title,
  subtitle,
  accent,
}: {
  href: string;
  title: string;
  subtitle: string;
  accent?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`card focus-volt flex flex-col gap-1 rounded-2xl p-4 transition-colors hover:border-[var(--hair-strong)] ${
        accent ? "border-volt/40" : ""
      }`}
    >
      <span className="text-[15px] font-bold text-text">{title}</span>
      <span className="text-[11.5px] text-text-faint">{subtitle}</span>
    </Link>
  );
}
