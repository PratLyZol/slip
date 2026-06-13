"use client";

/**
 * Connect-wallet + CCTP bridge surface. Connects an injected wallet (EIP-1193,
 * e.g. MetaMask) directly — independent of the demo identity — then triggers a
 * REAL Circle CCTP bridge (Base Sepolia → Arc) via POST /api/bridge, which runs
 * bridge-kit server-side (it's Node-only) and mints USDC to the connected
 * address on Arc. Shows the live USDC balance and the burn/mint tx links.
 *
 * Why a server route: bridge-kit can't run in the browser and the burn is paid
 * by the server's CCTP_PRIVATE_KEY relayer, so the connected wallet here is the
 * MINT RECIPIENT (where aggregated USDC lands on Arc), not the burn signer.
 */

import { useCallback, useState } from "react";
import { createPublicClient, http, type Address } from "viem";
import { arcTestnet, USDC_ADDRESS, USDC_DECIMALS, txUrl } from "@/lib/adapters/arc";
import { isDemoMode } from "@/lib/config";

interface Eip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}
function injected(): Eip1193 | undefined {
  return (globalThis as { ethereum?: Eip1193 }).ethereum;
}

const BALANCE_ABI = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

interface TxRef { hash: string; explorerUrl: string; simulated: boolean }

export default function BridgePanel() {
  const [address, setAddress] = useState<Address | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [amount, setAmount] = useState("1");
  const [phase, setPhase] = useState<"idle" | "bridging" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ burnTx: TxRef; mintTx: TxRef } | null>(null);

  const readBalance = useCallback(async (addr: Address) => {
    try {
      const pub = createPublicClient({ chain: arcTestnet, transport: http() });
      const raw = (await pub.readContract({
        address: USDC_ADDRESS, abi: BALANCE_ABI, functionName: "balanceOf", args: [addr],
      })) as bigint;
      setBalance((Number(raw) / 10 ** USDC_DECIMALS).toLocaleString("en-US", { maximumFractionDigits: 2 }));
    } catch {
      setBalance(null);
    }
  }, []);

  async function connect() {
    setError(null);
    const eth = injected();
    if (!eth) {
      setError("No injected wallet found. Install MetaMask (or another EIP-1193 wallet).");
      return;
    }
    try {
      const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
      const addr = accounts?.[0] as Address | undefined;
      if (!addr) { setError("No account returned by the wallet."); return; }
      setAddress(addr);
      void readBalance(addr);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Wallet connection rejected.");
    }
  }

  async function bridge() {
    if (!address) return;
    setError(null);
    setResult(null);
    setPhase("bridging");
    try {
      const res = await fetch("/api/bridge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountUsdc: Number(amount).toFixed(2), recipientAddress: address }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? `Bridge failed (${res.status}).`);
      setResult({ burnTx: data.burnTx, mintTx: data.mintTx });
      setPhase("done");
      void readBalance(address);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bridge failed.");
      setPhase("idle");
    }
  }

  const short = address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "";
  const demo = isDemoMode();

  return (
    <div className="flex flex-1 flex-col">
      <header className="rise pb-5 pt-2">
        <span className="rounded-full border border-volt/30 bg-volt/[0.06] px-3 py-1 text-[10.5px] font-bold uppercase tracking-[0.14em] text-volt">
          CCTP · Circle
        </span>
        <h1 className="serif mt-3 text-[32px]">Bridge onto Arc</h1>
        <p className="mt-2 text-[14px] leading-snug text-text-dim">
          Connect a wallet and aggregate USDC onto Arc via a real Circle CCTP
          bridge — burn on Base Sepolia, mint on Arc, forwarder mode.
        </p>
      </header>

      {/* Connect */}
      {!address ? (
        <button onClick={connect} className="btn-volt focus-volt rise w-full rounded-2xl py-4 text-[16px] font-bold">
          Connect Wallet
        </button>
      ) : (
        <div className="card rise flex items-center justify-between p-4">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-volt/15 text-[13px] font-bold text-volt">
              {address.slice(2, 3).toUpperCase()}
            </span>
            <div className="flex flex-col leading-tight">
              <span className="hash text-[12px] text-text">{short}</span>
              <span className="text-[11px] text-text-faint">
                {balance === null ? "balance —" : `${balance} USDC on Arc`}
              </span>
            </div>
          </div>
          <button onClick={() => { setAddress(null); setResult(null); setPhase("idle"); }} className="text-[12px] font-semibold text-text-faint hover:text-text-dim">
            Disconnect
          </button>
        </div>
      )}

      {address && (
        <div className="card rise mt-4 p-4">
          <label className="kicker">Amount to bridge (USDC)</label>
          <input
            inputMode="decimal" value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            disabled={phase === "bridging"}
            className="amount-figure focus-volt mt-2 w-full rounded-xl border border-[var(--hair)] bg-ink-850 px-4 py-3 text-[22px] text-text outline-none disabled:opacity-60"
          />
          <button
            onClick={bridge}
            disabled={phase === "bridging" || !(Number(amount) > 0)}
            className="btn-volt focus-volt mt-4 w-full rounded-2xl py-3.5 text-[15px] font-bold disabled:opacity-40"
          >
            {phase === "bridging" ? "Bridging via CCTP…" : `Bridge ${amount || "0"} USDC onto Arc`}
          </button>
          {demo && (
            <p className="mt-3 text-[11px] leading-snug text-text-faint">
              Heads up: <span className="font-semibold text-text-dim">demo mode is on</span>, so
              /api/bridge will refuse. Set <span className="hash">NEXT_PUBLIC_DEMO_MODE=false</span> +
              a Dynamic env id and a funded <span className="hash">CCTP_PRIVATE_KEY</span> to run a real bridge.
            </p>
          )}
        </div>
      )}

      {error && (
        <p className="animate-slip-rise mt-4 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-[13px] text-danger">
          {error}
        </p>
      )}

      {result && (
        <div className="card-shielded rise mt-4 p-4">
          <p className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-[#16130a]/60">Bridged ✓</p>
          <Edge label="Burn · Base Sepolia" tx={result.burnTx} />
          <Edge label="Mint · Arc" tx={result.mintTx} />
        </div>
      )}
    </div>
  );
}

function Edge({ label, tx }: { label: string; tx: TxRef }) {
  return (
    <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-[#16130a]/15 bg-[#16130a]/[0.05] px-3 py-2">
      <div className="flex flex-col">
        <span className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-[#16130a]/55">{label}</span>
        <span className="hash text-[#16130a]/70">{tx.hash.slice(0, 14)}…{tx.simulated ? " (sim)" : ""}</span>
      </div>
      <a href={tx.explorerUrl || txUrl(tx.hash as `0x${string}`)} target="_blank" rel="noopener noreferrer" className="shrink-0 text-[11px] font-bold text-volt-deep underline-offset-2 hover:underline">
        explorer ↗
      </a>
    </div>
  );
}
