<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

# Slip — build conventions

Read `docs/PRD.md` first. Research findings with verified APIs live in `docs/research/` (arc.md, dynamic.md, unlink.md) — **use those, never invent SDK signatures**.

## Architecture

One engine, two surfaces. The engine is the seven-step send pipeline (PRD §2).

```
src/
  app/                  # App Router pages: / (send), /claim, /batch, /private (proof view), /architecture
  components/           # UI components
  lib/
    engine/             # the seven steps, each a typed module
      types.ts          # shared types: SendRequest, ClaimPayload, EngineResult, Region...
      resolve.ts        # step 1: name -> address (ENS public-resolver read, no SDK)
      aggregate.ts      # step 2: sender assets -> USDC (Dynamic)
      counterfactual.ts # step 3: claim secret -> deterministic recipient account
      shield.ts         # step 4: Unlink shielded leg
      settle.ts         # step 5: settle USDC for the claim
      claim.ts          # step 7: deploy/withdraw + FX at claim
    adapters/           # SDK wiring lives ONLY here, behind interfaces
      arc.ts            # chain config, token addresses, explorer URLs
      unlink.ts         # @unlink-xyz/sdk@canary wrapper
      fx.ts             # Arc StableFX / fallback
    demo/               # demo-mode implementations of the same interfaces
```

## Verified chain facts (from docs/research/arc.md — do not re-research)

- Arc testnet chain ID **5042002**, RPC `https://rpc.testnet.arc.network`, explorer `https://testnet.arcscan.app`, faucet `https://faucet.circle.com` (dispenses USDC + EURC).
- USDC `0x3600000000000000000000000000000000000000` (native gas; 6 decimals as ERC-20, 18 in native gas accounting). EURC `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a` (6 decimals).
- **StableFX requires a Circle-issued API key** (not permissionless) — the real FX adapter must be a flag-gated stub unless a key is provided; demo mode simulates the quote+settle.
- ERC-4337 supported but no canonical EntryPoint published — comes from the AA provider (Dynamic/ZeroDev/Pimlico).

## Hard rules

- **Demo mode is first-class.** `NEXT_PUBLIC_DEMO_MODE=true` (and auto-on when env keys are missing) swaps every adapter for a deterministic simulated implementation with realistic latency, fake tx hashes, and explorer-style data. The full demo (send → claim → FX → privacy proof → batch) must work with zero credentials. Real adapters activate when `NEXT_PUBLIC_DYNAMIC_ENV_ID` etc. are present. Never let real-SDK breakage break the demo path.
- **3 sponsor SDKs max:** Dynamic, Unlink, Arc/Circle. No LI.FI, no Privy, no ENS SDK (resolver read via raw `eth_call`/viem only), no database.
- **Claim links carry everything.** Format: `/claim#<base64url(JSON ClaimPayload)>` — the secret lives in the URL **fragment** (never query string, never server logs). No server state for single sends.
- **Terminology:** "local stablecoin", never "native token". Recipients see money words, not chain words.
- **Stub honestly.** If a real API can't be wired (missing key, missing testnet pair), implement the interface as a clearly named stub (`// NOT YET WIRED` + console.warn) and keep demo mode working. Never fake a "real" integration.
- **Arc testnet only.** All legs (shield, settle, FX) stay on Arc.

## Build phases

Strict order per PRD §4 — Phase N's checkpoint must pass before N+1. If a real-chain checkpoint can't pass for lack of credentials/funds, the demo-mode checkpoint must pass and the real path must compile and be flag-gated.

## Style

- TypeScript strict, App Router, Tailwind v4 (already configured). Mobile-first.
- `npm run build` must pass before every commit.
- Keep components small; no state libraries — React state + URL state only.
