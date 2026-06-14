"use client";

/**
 * UnifyBalance — the sender's "move money onto Arc" control, living on Home next
 * to the per-chain balances. A clean button opens a modal: type an amount, and
 * it runs the CCTP bridge ({@link runBridge}) — burn USDC on the connected
 * origin chain (Base Sepolia, etc.), mint it as Arc-testnet USDC. This is the
 * ONLY bridge surface in the app; the Send screen assumes funds are already on
 * Arc.
 *
 * Real-only: the burn is signed by the connected Dynamic wallet on its active
 * network, so we gate on being on a CCTP-supported origin chain and offer a
 * one-tap switch to Base Sepolia when the wallet is elsewhere. On success we
 * poll balances so the Arc row updates without a manual refresh.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { runBridge } from "@/lib/engine";
import { EngineStep } from "@/lib/engine/types";
import {
  cctpSourceByChainId,
  supportedOriginChainNames,
} from "@/lib/adapters/cctp-chains";
import { ARC_CHAIN_ID } from "@/lib/adapters/arc";
import { formatAmount, formatUsd } from "@/lib/format";
import { useWallet } from "./WalletProvider";

type Phase = "idle" | "running" | "done";

export default function UnifyBalance() {
  const wallet = useWallet();
  const [open, setOpen] = useState(false);

  if (!wallet.address) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn-volt focus-volt mt-3 flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-[15px] font-bold"
      >
        <ArcArrow />
        Move funds to Arc
      </button>

      {open && <UnifyModal onClose={() => setOpen(false)} />}
    </>
  );
}

function UnifyModal({ onClose }: { onClose: () => void }) {
  const wallet = useWallet();
  const [amount, setAmount] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [detail, setDetail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The wallet's connected ORIGIN chain — the chain the CCTP burn signs on.
  const [netChainId, setNetChainId] = useState<number | undefined>(
    wallet.chainId,
  );
  const [switching, setSwitching] = useState(false);

  // Portal target — only available on the client. Gate the portal on mount so
  // SSR/prerender doesn't touch document.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    let cancelled = false;
    wallet
      .getNetwork()
      .then((id) => !cancelled && setNetChainId(id))
      .catch(() => !cancelled && setNetChainId(undefined));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet.address, wallet.chainId]);

  const originSource = cctpSourceByChainId(netChainId);
  const onSupportedNetwork = Boolean(originSource);
  const wrongNetwork = netChainId !== undefined && !onSupportedNetwork;

  // USDC available to bridge: what the wallet holds on the connected origin
  // chain (the chain the burn signs on).
  const originBalance = useMemo(
    () => wallet.balances.find((b) => b.chainId === netChainId)?.usdc ?? null,
    [wallet.balances, netChainId],
  );
  const arcBalance =
    wallet.balances.find((b) => b.chainId === ARC_CHAIN_ID)?.usdc ?? null;

  const value = Number(amount);
  const amountValid = value > 0 && Number.isFinite(value);
  const overBalance =
    amountValid && originBalance !== null && value > originBalance;

  const running = phase === "running";
  const canBridge =
    onSupportedNetwork && amountValid && !overBalance && !running;

  async function switchToBaseSepolia() {
    setSwitching(true);
    setError(null);
    try {
      await wallet.switchNetwork(84532);
      setNetChainId(84532);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Couldn't switch network. Try again.",
      );
    } finally {
      setSwitching(false);
    }
  }

  // After the mint lands there's no chain switch to trigger a re-read, so poll
  // a few times (3s apart) to absorb CCTP mint / Arc-RPC read-after-write lag.
  const pollBalances = useCallback(() => {
    void (async () => {
      for (let i = 0; i < 4; i++) {
        await wallet.refreshBalances();
        await new Promise((r) => setTimeout(r, 3000));
      }
    })();
  }, [wallet]);

  async function handleBridge() {
    if (!canBridge) return;
    setError(null);
    setDetail(null);
    setPhase("running");
    try {
      await runBridge(
        {
          amountUsd: value,
          senderAddress: wallet.address,
          originChainId: netChainId,
          getWalletClient: wallet.getWalletClient,
        },
        (s) => {
          if (s.step === EngineStep.Aggregate && s.detail) setDetail(s.detail);
        },
      );
      setPhase("done");
      setDetail(`${formatUsd(value)} is on its way to Arc.`);
      pollBalances();
    } catch (e) {
      setPhase("idle");
      setError(e instanceof Error ? e.message : "Bridge failed. Try again.");
    }
  }

  if (!mounted) return null;

  // Portal to <body> so the modal escapes the transformed `rise` ancestors on
  // Home (a CSS transform makes an element the containing block for fixed
  // descendants and traps their z-index) — without this it renders BEHIND the
  // nav and action cards.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/60 py-6 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      onClick={running ? undefined : onClose}
    >
      <div
        className="animate-slip-rise card card-pop m-3 w-full max-w-[416px] rounded-3xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div>
            <span className="kicker">Move to Arc</span>
            <h2 className="mt-1 text-[18px] font-bold text-text">
              Unify your balance
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={running}
            aria-label="Close"
            className="focus-volt grid h-8 w-8 place-items-center rounded-lg border border-[var(--hair)] text-text-faint transition-colors hover:text-text disabled:opacity-40"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path
                d="M6 6l12 12M18 6 6 18"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        {phase === "done" ? (
          <div className="mt-6 flex flex-col items-center text-center">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-volt/15 text-volt">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <path
                  d="m5 13 4 4L19 7"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <p className="mt-4 text-[15px] font-semibold text-text">
              {detail}
            </p>
            <p className="mt-1.5 text-[12px] text-text-faint">
              Your Arc balance updates in a moment.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="btn-volt focus-volt mt-6 w-full rounded-2xl py-3.5 text-[15px] font-bold"
            >
              Done
            </button>
          </div>
        ) : (
          <>
            {/* Amount entry */}
            <div className="mt-5 flex flex-col items-center">
              <label className="kicker" htmlFor="unify-amount">
                Amount
              </label>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="amount-figure text-[26px] text-text-faint">
                  $
                </span>
                <input
                  id="unify-amount"
                  value={amount}
                  onChange={(e) =>
                    setAmount(e.target.value.replace(/[^0-9.]/g, ""))
                  }
                  disabled={running}
                  inputMode="decimal"
                  autoFocus
                  placeholder="0"
                  className="amount-figure w-[6ch] bg-transparent text-center text-[44px] font-medium leading-none text-text outline-none placeholder:text-text-faint disabled:opacity-60"
                />
              </div>
              <p className="amount-figure mt-3 text-[12px] text-text-faint">
                {originSource && originBalance !== null
                  ? `${formatUsd(originBalance)} available on ${originSource.name}`
                  : arcBalance !== null
                    ? `${formatUsd(arcBalance)} already on Arc`
                    : "Bridges to Arc-testnet USDC via CCTP"}
              </p>
            </div>

            {/* Max shortcut */}
            {originSource && originBalance !== null && originBalance > 0 && (
              <button
                type="button"
                onClick={() => setAmount(String(originBalance))}
                disabled={running}
                className="focus-volt mx-auto mt-2 block rounded-lg border border-[var(--hair)] px-3 py-1 text-[11px] font-semibold text-text-dim transition-colors hover:text-text disabled:opacity-40"
              >
                Move all {formatUsd(originBalance)}
              </button>
            )}

            {/* Wrong-network guard — the burn signs on the origin chain. */}
            {wrongNetwork ? (
              <div className="mt-5 rounded-2xl border border-danger/40 bg-danger/[0.06] p-4 text-left">
                <p className="text-[13px] font-semibold text-danger">
                  Switch network to bridge
                </p>
                <p className="mt-1 text-[12px] text-text-dim">
                  Your wallet is on a chain we can&apos;t bridge from. Move to a
                  supported network ({supportedOriginChainNames()}).
                </p>
                <button
                  type="button"
                  onClick={switchToBaseSepolia}
                  disabled={switching}
                  className="focus-volt mt-3 w-full rounded-xl bg-volt px-3 py-2.5 text-[13px] font-bold text-ink-950 transition-opacity hover:opacity-90 disabled:opacity-60"
                >
                  {switching ? "Switching…" : "Switch to Base Sepolia"}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleBridge}
                disabled={!canBridge}
                className="btn-volt focus-volt mt-6 w-full rounded-2xl py-4 text-[16px] font-bold disabled:cursor-not-allowed disabled:opacity-30"
              >
                {running
                  ? "Bridging…"
                  : overBalance
                    ? "Amount exceeds balance"
                    : !amountValid
                      ? "Enter an amount"
                      : `Move ${formatUsd(value)} to Arc`}
              </button>
            )}

            {detail && phase === "running" && (
              <p className="mt-3 text-center text-[12px] text-text-dim">
                {detail}
              </p>
            )}
            {error && (
              <p className="mt-3 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] text-danger">
                {error}
              </p>
            )}
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** Small inward-arrow glyph — "bring funds in to Arc". */
function ArcArrow() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 4v12m0 0 5-5m-5 5-5-5M5 20h14"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
