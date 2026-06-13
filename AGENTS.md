<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

# Slip — build conventions

**`docs/PLAN.md` is the current source of truth** — it folds in verified findings + locked
decisions and **supersedes the PRD and this file's specifics where they conflict** (key
deltas: pregen identity wallets replace the counterfactual payout; CCTP for aggregation;
account abstraction dropped; **batch-first**; StableFX dropped — local currency at claim
is a direct destination-token choice, EU→EURC else USDC).
Read `docs/PLAN.md` first, then `docs/PRD.md` for product context. Verified SDK APIs live in
`docs/research/` (arc.md, dynamic.md, unlink.md) — **use those, never invent SDK signatures**.

## Architecture

One engine, two surfaces. The engine is the seven-step send pipeline (PRD §2).

```
src/
  app/                  # App Router pages: / (send), /claim, /batch, /private (proof view), /architecture
  components/           # UI components
  app/api/              # server routes (hold secrets): pregen, unlink/register,
                        #   unlink/authorization-token, fx
  lib/
    engine/             # the send/claim pipeline (batch-first; N=1 = single send)
      types.ts          # shared types: SendRequest(recipients[]), ClaimPayload v2, Region...
      resolve.ts        # name/.eth -> address (ENS read); email/phone -> pregen via /api/pregen
      aggregate.ts      # bridge sender USDC onto Arc via Circle CCTP (Dynamic has NO swap)
      counterfactual.ts # LEGACY — payout address now comes from Dynamic pregen
      shield.ts         # Unlink shielded leg (browser client + gasless faucet shield)
      claim.ts          # relayer-submitted Unlink withdraw + FX at claim (NO AA/deploy)
    adapters/           # SDK wiring lives ONLY here, behind interfaces
      arc.ts            # Arc + Base Sepolia chain config, token/CCTP addresses, explorer
      unlink.ts         # @unlink-xyz/sdk@canary — /browser client + /admin (server routes)
      pregen.ts         # Dynamic pregenerated wallets (waas/create) — server-only
      bridge.ts         # Circle CCTP aggregation (@circle-fin/bridge-kit)
      balance.ts        # USDC balance reads (viem)
    (no simulated-adapter directory — real adapters are the only path)
```

## Verified chain facts (from docs/research/arc.md — do not re-research)

- Arc testnet chain ID **5042002**, RPC `https://rpc.testnet.arc.network`, explorer `https://testnet.arcscan.app`, faucet `https://faucet.circle.com` (dispenses USDC + EURC).
- USDC `0x3600000000000000000000000000000000000000` (native gas; 6 decimals as ERC-20, 18 in native gas accounting). EURC `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a` (6 decimals).
- **StableFX is DROPPED** (it required a contact-a-rep Circle API key with no bounty payoff). Local currency at claim is now a direct **destination-token choice — EU → EURC, else USDC** — delivered directly with no swap and no key (EURC is faucet-fundable). Optional stretch: real USDC→EURC via Circle Swap Kit (free self-serve key).
- **Account abstraction is DROPPED.** The claim is gasless via Unlink's relayer (recipient pays nothing), so no paymaster/4337/ZeroDev. (FYI EntryPoint v0.6/v0.7 *are* deployed on Arc, but we don't use them; ZeroDev's hosted bundler does not serve Arc anyway.)

## Hard rules

- **Real adapters are the only path.** Each integration (Dynamic pregen, Unlink shielded, Circle/CCTP/Arc) activates from its own env key/credential (`NEXT_PUBLIC_DYNAMIC_ENV_ID` etc.). When a required key or credential is absent, the adapter must surface an **honest error** — never silently simulate a result. There is no fake/simulated fallback; never fake a real integration.
- **3 sponsor SDKs max:** Dynamic, Unlink, Arc/Circle. No LI.FI, no Privy, no ENS SDK (resolver read via raw `eth_call`/viem only), no database.
- **Claim links carry everything.** Format: `/claim#<base64url(JSON ClaimPayload)>` — the secret lives in the URL **fragment** (never query string, never server logs). No server state for single sends.
- **Terminology:** "local stablecoin", never "native token". Recipients see money words, not chain words.
- **Stub honestly.** If a real API can't be wired yet (missing key, missing testnet pair), implement the interface as a clearly named stub (`// NOT YET WIRED` + console.warn) that surfaces the gap instead of returning fabricated data. Never fake a "real" integration.
- **Arc is where privacy + FX live.** Shield, private transfer, withdraw, and FX all stay on Arc. The ONE cross-chain hop is **aggregation**: CCTP bridges USDC from Base Sepolia → Arc *before* shielding, so shielded funds never cross a public hop.

## Build order

**Batch-first** (supersedes the PRD's "build A before B"): batch payout is the hero because the privacy property is only self-contained at N>1; single send is the N=1 case of the same engine. Tracks are sliced along adapter-interface seams and parallelized — see `docs/TICKETS.md`. The real path must compile and `npm run build` must pass at every step, even when some credentials are absent (those adapters surface honest errors rather than simulating).

## Style

- TypeScript strict, App Router, Tailwind v4 (already configured). Mobile-first.
- `npm run build` must pass before every commit.
- Keep components small; no state libraries — React state + URL state only.
