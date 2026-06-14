"use client";

/**
 * Settings — the wallet's home base. Shows the connected address, its USDC on
 * every chain it can hold money on (Base Sepolia + Arc Testnet), and lets the
 * user switch the wallet's ACTIVE network between the two. The active chain is
 * the one a send signs on, so reflecting + switching it here keeps the send
 * flow honest about where the money is.
 *
 * Real-only: reads come from WalletProvider (live `balanceOf`); switching calls
 * wallet.switchNetwork. When no wallet is connected we prompt to connect.
 */

import { useState } from "react";
import { useWallet } from "./WalletProvider";
import { BALANCE_CHAINS } from "@/lib/adapters/cctp-chains";
import { formatAmount } from "@/lib/format";

export default function SettingsScreen() {
  const wallet = useWallet();
  const [switching, setSwitching] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function switchTo(chainId: number) {
    if (switching !== null || chainId === wallet.chainId) return;
    setSwitching(chainId);
    setError(null);
    try {
      await wallet.switchNetwork(chainId);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Couldn't switch network. Try again.",
      );
    } finally {
      setSwitching(null);
    }
  }

  // Per-chain holdings keyed off the provider's live balances; fall back to a
  // null row per known chain so the list renders before the first read lands.
  const balances = wallet.balances.length
    ? wallet.balances
    : BALANCE_CHAINS.map((c) => ({
        chainId: c.chainId,
        name: c.name,
        usdc: null as number | null,
      }));

  return (
    <div className="flex flex-1 flex-col">
      <div className="rise mt-2">
        <span className="kicker">Settings</span>
        <h1 className="mt-1 text-[22px] font-semibold tracking-tight text-text">
          Wallet
        </h1>
      </div>

      {!wallet.address ? (
        <div className="rise card mt-6 flex flex-col items-center gap-3 p-6 text-center">
          <p className="text-[14px] text-text-dim">
            Connect a wallet to view your balances and network.
          </p>
          <button
            type="button"
            onClick={wallet.login}
            className="focus-volt rounded-xl bg-volt px-4 py-2 text-[13px] font-semibold text-ink-950 transition-opacity hover:opacity-90"
          >
            Connect Wallet
          </button>
        </div>
      ) : (
        <>
          {/* Connected address */}
          <div className="rise card mt-6 p-4">
            <p className="kicker mb-1.5">Connected address</p>
            <p className="select-all break-all font-mono text-[12.5px] leading-relaxed text-text">
              {wallet.address}
            </p>
          </div>

          {/* Per-chain USDC balances */}
          <div className="rise mt-6">
            <span className="kicker">Balances</span>
            <ul className="mt-2.5 flex flex-col gap-2">
              {balances.map((b) => (
                <li
                  key={b.chainId}
                  className="card flex items-center justify-between p-3.5"
                >
                  <div className="flex flex-col">
                    <span className="text-[14px] font-semibold text-text">
                      {b.name}
                    </span>
                    <span className="text-[11px] text-text-faint">
                      {b.chainId === wallet.chainId ? "Active network" : "USDC"}
                    </span>
                  </div>
                  <span className="amount-figure text-[15px] text-text">
                    {b.usdc === null ? "—" : `$${formatAmount(b.usdc)}`}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/* Network switch */}
          <div className="rise mt-6">
            <span className="kicker">Active network</span>
            <p className="mt-1 text-[12px] leading-snug text-text-faint">
              The network your sends sign on. Switch it to move between chains.
            </p>
            <div className="mt-2.5 flex flex-col gap-2">
              {BALANCE_CHAINS.map((c) => {
                const active = c.chainId === wallet.chainId;
                const isSwitching = switching === c.chainId;
                return (
                  <button
                    key={c.chainId}
                    type="button"
                    onClick={() => switchTo(c.chainId)}
                    disabled={active || switching !== null}
                    aria-pressed={active}
                    className={`focus-volt flex items-center justify-between rounded-xl border px-4 py-3 text-left transition-colors disabled:cursor-default ${
                      active
                        ? "border-volt/50 bg-volt/[0.07]"
                        : "border-[var(--hair)] bg-ink-850 hover:border-[var(--hair-strong)] disabled:opacity-60"
                    }`}
                  >
                    <span className="text-[14px] font-semibold text-text">
                      {c.name}
                    </span>
                    <span
                      className={`text-[12px] font-semibold ${
                        active ? "text-volt" : "text-text-faint"
                      }`}
                    >
                      {isSwitching ? "Switching…" : active ? "Active" : "Switch"}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {error && (
            <p className="animate-slip-rise mt-4 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-[13px] text-danger">
              {error}
            </p>
          )}
        </>
      )}
    </div>
  );
}
