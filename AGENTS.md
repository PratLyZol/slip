<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

# Slip — build conventions

**`docs/PLAN.md` is the source of truth for architecture; this file is the quick build
reference.** Verified SDK APIs live in `docs/research/` (arc.md, dynamic.md, unlink.md) —
**use those, never invent SDK signatures.**

The app is **real-only**: there is no demo/simulation mode and no `isDemoMode()`. Every leg
either executes a real on-chain/relayer operation or throws an **honest error** that surfaces
in the UI. Nothing ever reports success without funds moving.

## What Slip does

Pay anyone by email/phone. The sender bridges USDC onto Arc, shields it through Unlink, and
fans it out privately; each recipient gets a claim link, logs in with an OTP (Dynamic
pregen wallet), and withdraws — never having held gas or made a wallet. In a batch the
payer↔payee mapping and per-recipient amounts are unlinkable on-chain.

## Architecture — two legs, four screens

The money path is split into two independently-retriable legs so a failure in one never
wedges the other:

- **`runBridge`** — CCTP aggregation: burn Σ on the sender's origin chain (Base Sepolia, etc.),
  mint Σ on Arc (forwarder mode). Wallet-signed by the connected Dynamic wallet.
- **`runDistribute`** — over funds already on Arc: shield Σ once (Unlink wallet-funded
  deposit), then N sequential private transfers to each recipient's claim account, then N
  claim links. `runBatchSend`/`runSend` are thin wrappers (`runBridge` then `runDistribute`).

```
src/
  app/                  # App Router pages:
                        #   /          Home — wallet + USDC across all chains
                        #   /send      two-step: (1) Bridge to Arc  (2) Distribute
                        #   /settings  switch active network (Base Sepolia <-> Arc) + balances
                        #   /claim     recipient OTP login -> withdraw
                        #   /batch /private /architecture  (secondary: proof + explainer views)
  components/           # UI (SendScreen, HomeScreen, SettingsScreen, ClaimScreen, WalletProvider, ...)
  app/api/              # server routes (hold secrets): pregen, unlink/register,
                        #   unlink/authorization-token, fx, bridge, notify (Resend email)
  lib/
    engine/             # the pipeline (recipients[]-first; N=1 = single send)
      types.ts          # SendRequest(recipients[]), BridgeRequest, DistributeRequest, ClaimPayload v2
      bridge.ts         # runBridge — CCTP aggregation leg
      distribute.ts     # runDistribute — shield + private fan-out + claim links (privacy-only path)
      index.ts          # runBatchSend/runSend wrappers + re-exports
      claim.ts          # Unlink relayer withdraw + FX at claim (NO AA/deploy/paymaster)
      resolve.ts        # email/phone -> Dynamic pregen; .eth -> ENS read (raw viem)
      aggregate.ts      # USDC sufficiency check + bridgeToArc (used by runBridge)
      fx.ts             # FX at claim: EU -> EURC (via Swap Kit, see below), else USDC
      counterfactual.ts # derives the Unlink claim account from a secret (NOT a 4337 account)
      claimLink.ts      # /claim#<base64url(ClaimPayload)> encode/decode
    adapters/           # SDK wiring lives ONLY here, behind interfaces
      arc.ts            # Arc + Base Sepolia chain config, token addresses, explorer, Dynamic networks
      cctp-chains.ts    # CCTP source registry (burnable origins) + BALANCE_CHAINS (balance reads)
      bridge.ts         # Circle CCTP (@circle-fin/bridge-kit) — wallet-signed burn, forwarder mint
      unlink.ts         # @unlink-xyz/sdk/browser client + /admin auth routes; getShieldOps() is real-only
      pregen.ts         # Dynamic pregenerated wallets (waas/create) — server-only, real-only
      swap.ts           # OPTIONAL Circle Swap Kit USDC->EURC (no route on Arc testnet -> USDC fallback)
      balance.ts        # USDC balance reads (viem): getUsdcBalance + getAllUsdcBalances (multi-chain)
    (no demo/sim.ts, no settle.ts, no simulated-adapter — the real path is the only path)
```

## Verified chain facts (from docs/research/arc.md — do not re-research)

- Arc testnet chain ID **5042002**, RPC `https://rpc.testnet.arc.network`, explorer `https://testnet.arcscan.app`, faucet `https://faucet.circle.com` (dispenses USDC + EURC).
- USDC `0x3600000000000000000000000000000000000000` (native gas; 6 decimals as ERC-20, 18 in native gas accounting). EURC `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a` (6 decimals).
- **Account abstraction is DROPPED.** The claim is gasless via Unlink's relayer (recipient pays nothing), so no paymaster/4337/ZeroDev/CREATE2 deploy. The recipient's *payout* address is a Dynamic **pregen** wallet (OTP-claimed); the Unlink *claim account* is derived from the claim secret via `account.fromSeed`.
- **StableFX is DROPPED.** FX at claim is a destination-token choice: non-EU → USDC (true no-op, the withdrawn coin); EU → attempt a real Circle **Swap Kit** USDC→EURC. There is **no USDC↔EURC route on Arc testnet**, so the swap honestly falls back to USDC — in practice every recipient currently receives USDC. No fabricated rate, ever.

## Hard rules

- **Real or honest error — never simulate.** Each integration (Dynamic pregen, Unlink shielded, Circle/CCTP/Arc, Resend email) activates from its own env credential. When a required key is absent, the adapter/route surfaces an **honest error** (e.g. server route 501 → client throw) that the UI shows. There is no fake/simulated fallback and no stub that fabricates data — that infrastructure was removed.
- **The privacy path is the ONLY send path.** If the Unlink shield/transfer fails, the send emits a FAILED step and throws — it does NOT fall back to a public direct transfer (that stranded funds at a keyless address the claim could never reach). No claim link is ever produced without a real shielded transfer.
- **The recipient's Unlink claim account must be registered before the sender transfers to it** (else the relayer rejects with `transfer.prepare failed: user not found`). `privateTransfer` registers it at send time from the claimSecret; idempotent (the recipient re-registers at claim).
- **3 sponsor SDKs max:** Dynamic, Unlink, Arc/Circle (all `@circle-fin/*` count as one). No LI.FI, no Privy, no ENS SDK (resolver read via raw `eth_call`/viem only), no database.
- **Claim links carry everything.** Format: `/claim#<base64url(JSON ClaimPayload v2)>` — the secret lives in the URL **fragment** (never query string, never server logs). No server state for a send.
- **Terminology:** "local stablecoin", never "native token". Recipients see money words, not chain words.
- **Arc is where privacy + FX live.** Shield, private transfer, withdraw, and FX all stay on Arc. The ONE cross-chain hop is **aggregation**: CCTP bridges USDC from the origin chain → Arc *before* shielding, so shielded funds never cross a public hop.

## Wallet / gas

- The **sender** connects a Dynamic embedded wallet. It signs the CCTP burn on the **origin
  chain** (needs origin-chain native gas, e.g. Base Sepolia ETH) and the Unlink deposit on
  **Arc** (Arc uses USDC as native gas). `getWalletClient(chainId)` switches the embedded
  wallet's active network before each leg; `WalletProvider` tracks `chainId`/`balances` and
  exposes `refreshBalances()`.
- **Recipients are always walletless** — Dynamic pregen wallet + Unlink relayer withdraw.

## Style

- TypeScript strict, App Router, Tailwind v4 (already configured). Mobile-first.
- `npm run build` must pass before every commit.
- Keep components small; no state libraries — React state + URL state (+ localStorage receipts) only.
