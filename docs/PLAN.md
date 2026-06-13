# Slip — Verified Build Plan & Decisions

> Status: **architecture fully verified, all decisions locked, zero unresolved blockers.**
> Date: 2026-06-12. This doc is the single source of truth for the real-integration
> build. Where it conflicts with `docs/research/*`, **this doc wins** (it folds in
> six deep verification passes against live APIs, on-chain probes, and the published
> SDK type definitions).

---

## 0. Decisions locked (do not relitigate)

1. **Recipient identity model = Dynamic pregenerated wallets.** Address is derived
   from the recipient's email/phone via `POST /waas/create` (idempotent, stable
   address). Recipient claims by OTP login (auto-association, no seed, no gas).
   Replaces the old random-secret counterfactual as the *payout* address.
2. **Aggregation = real Circle CCTP** via `@circle-fin/bridge-kit`
   (`Base_Sepolia → Arc_Testnet`, one call, no key, forwarder mode). Arbitrary
   non-USDC swap stays a flag-gated stub (no Arc testnet liquidity except
   EURC/cirBTC).
3. **Privacy = browser Unlink client + thin server routes.** `createUnlinkClient` +
   `account.fromSeed` run in the browser (secret/keys never leave the client); only
   `register` + `authorization-token` are server routes holding `UNLINK_API_KEY`.
4. **Shield = `faucet.requestPrivateTokens`** (gasless, no EOA — fits walletless).
   Real `depositWithApproval` kept behind a flag.
5. **Drop ERC-4337 / paymaster from the claim.** Unlink's relayer already makes the
   withdraw gasless. (ZeroDev hosted bundler does NOT serve Arc; Pimlico does, but
   we don't need it.) Re-label claim steps as "relayer-submitted withdraw".
6. **FX = StableFX, simulated by default.** Real adapter flag-gated; StableFX keys
   are contact-a-rep only and TEST mode returns mock data. Demo simulation stays
   the default (current `fx.ts` approach is correct).
7. **Bonus real leg (optional): Circle Swap EURC→USDC** on Arc testnet (free
   self-serve kit key). Same-chain, real liquidity. Nice-to-have, not required.

3-SDK rule holds: **Dynamic + Unlink + Circle/Arc** only. All `@circle-fin/*`
(bridge-kit, swap-kit, StableFX) count as the one Circle sponsor. viem = plumbing.

---

## 1. End-to-end flow (who runs each call, who pays gas)

```
SENDER (browser, Dynamic embedded wallet)        SERVER routes (secrets)      RELAYERS / EXTERNAL
1. login (Dynamic widget)                [client]
2. enter recipient email/phone + amount  [client]
3. POST /api/pregen {identifier} ──────────────▶ Dynamic waas/create
   ◀──────────── { pregenAddress } ─────────────  (dyn_ token)  ───────────▶ Dynamic → EVM EOA addr
                                                                              gas: none (off-chain)
4. CCTP bridge Base Sepolia → Arc        [client, bridge-kit browser adapter]
   - burn on Base Sepolia                                       gas: SENDER, Base Sepolia ETH
   - attestation + mint on Arc ─────────────────────────────────────────▶ Circle Orbit forwarder
                                                                              gas: relayer; fee netted from USDC
5. generate claim secret (CSPRNG)        [client]  — secret NEVER leaves browser
6. shield: client.faucet.requestPrivateTokens({USDC})  [client]
        register/authorize ─────────────▶ /api/unlink/register, /authorization-token (admin key)
                                                                              gas: none (gasless faucet shield)
7. private transfer  unlink(sender,idx0) → unlink(claim,idx1)  [client→relayer]  ▶ Unlink relayer (ZK proof)
                                                                              gas: relayer
8. build link /claim#base64url({v:2, secret, amountUsdc, pregenAddress, region, ...})  [client]; share

RECIPIENT (browser)
9.  open /claim#...   decode fragment     [client] — secret stays client-side
10. OTP login (Dynamic) → auto-claims pregen wallet  [client]  gas: none (off-chain bind)
11. withdraw: client.withdraw({recipientEvmAddress: pregenAddress, USDC, amount})  [client→relayer]
        re-derive claim acct = account.fromSeed({seed:keccak(secret), accountIndex:1})
                                                                              gas: relayer (recipient pays nothing)
12. FX (EU only): POST /api/fx  [STUB unless StableFX key] ─────▶ StableFX API → FxEscrow on Arc
13. done — recipient holds local stablecoin in a wallet they own
```

Manual prerequisites for the real path (both faucet items, document them):
- Sender needs **Base Sepolia ETH** (to burn) + **Base Sepolia USDC** (`faucet.circle.com`).
- Bridge **amount + small Arc-USDC buffer** is NOT needed for the faucet-shield path
  (faucet shield is gasless); the buffer only matters if using real `depositWithApproval`.

---

## 2. Exact import map (verified against @unlink-xyz/sdk@0.3.0-canary.598)

**Client (browser):**
```ts
import { account, createUnlinkClient } from "@unlink-xyz/sdk/browser";
const seed = bytesOf(keccak256(secret));            // 32 bytes
const acct = account.fromSeed({ seed, accountIndex }); // 0 = sender, 1 = claim
const client = createUnlinkClient({
  environment: "arc-testnet",
  account: acct,
  registerUrl: "/api/unlink/register",
  authorizationToken: { url: "/api/unlink/authorization-token" },
});
await client.ensureRegistered();
await client.faucet.requestPrivateTokens({ token: USDC });          // shield (gasless)
await (await client.transfer({ recipientAddress: claimAddr, token: USDC, amount })).wait();
await (await client.withdraw({ recipientEvmAddress: pregenAddr, token: USDC, amount })).wait();
// assert result.status === "processed" on every leg
```

**Server (two route handlers, admin key only):**
```ts
import { createUnlinkAdmin, createUnlinkAuthRoutes } from "@unlink-xyz/sdk/admin";
const admin = createUnlinkAdmin({ environment: "arc-testnet", apiKey: process.env.UNLINK_API_KEY! });
const routes = createUnlinkAuthRoutes({
  admin,
  authenticate: async (req) => /* session */,
  authorizeUnlinkAddress: async () => true,   // tighten for prod; fine for demo
});
// app/api/unlink/register/route.ts             -> export const POST = (req) => routes.register(req);
// app/api/unlink/authorization-token/route.ts  -> export const POST = (req) => routes.authorizationToken(req);
```

CCTP (server or browser adapter):
```ts
import { BridgeKit } from "@circle-fin/bridge-kit";
import { createViemAdapterFromPrivateKey } from "@circle-fin/adapter-viem-v2";
const result = await new BridgeKit().bridge({
  from: { adapter, chain: "Base_Sepolia" },
  to:   { adapter, chain: "Arc_Testnet", recipientAddress, useForwarder: true },
  amount: amountUsdc, config: { transferSpeed: "FAST" },
});
```

---

## 3. Credentials checklist

| Credential | Env var | How to get | Self-serve? | Needed for |
|---|---|---|---|---|
| Dynamic env id | `NEXT_PUBLIC_DYNAMIC_ENV_ID` | app.dynamic.xyz | ✅ free | login + pregen |
| Dynamic API token | `DYNAMIC_API_TOKEN` (`dyn_…`) | dashboard → Developer → API Token | ✅ free | server pregen/lookup |
| Unlink admin key | `UNLINK_API_KEY` | dashboard.unlink.xyz (project → Arc testnet) | ✅ free | register/authorize routes |
| Circle kit key (optional) | `CIRCLE_KIT_KEY` | console.circle.com → Keys → Kit Key | ✅ free | bonus EURC→USDC swap |
| CCTP source funds | `CCTP_PRIVATE_KEY` (funded EOA) | faucet.circle.com (Base Sepolia USDC) + a Base Sepolia ETH faucet | ✅ | real bridge |
| StableFX key | `STABLEFX_API_KEY` | sales@circle.com (contact-a-rep) | ❌ | real FX (else stub) |

Everything self-serve **except StableFX** — and FX stays simulated by default, so
StableFX is not a blocker.

---

## 4. Corrections to prior research (the deltas that matter)

- **Unlink admin key is self-serve** (dashboard.unlink.xyz), not contact-only.
- **Unlink Arc engine is LIVE** (`/health` ok; `/info/environment` returns pool
  `0x075b8D…dCdA`, Permit2, EntryPoint v0.7).
- **Unlink status success = `"processed"`** — fix the brittle `!== "failed"` checks.
- **ZeroDev hosted bundler does NOT serve Arc 5042002** ("No API provider supports
  the requested chainId"). Pimlico does. But AA is being dropped anyway.
- **Dynamic has NO aggregate-to-USDC product** — CCTP fills that role.
- **CCTP `Arc_Testnet`/`Base_Sepolia` are first-class in bridge-kit**, no key,
  forwarder mode = recipient needs no Arc gas. Minted USDC = standard ERC-20 at
  `0x3600…`.
- **StableFX TEST mode returns mock data** even with a key → real FX never truly
  demoable on testnet; stub is correct.
- **Circle Swap is LI.FI-backed internally** but is Circle's own SDK (still within
  the 3-SDK rule). Real only for EURC/cirBTC→USDC on Arc testnet.
- **`account.fromSeed` is browser-safe** (`/browser` re-exports it); only `/admin`
  is `browser:null`.

---

## 5. Build order (each phase compiles + demo stays green)

> Rule: demo mode must never break. Every real adapter is flag-gated; absent its
> key it falls back to the existing simulation.

**P0 — Foundations**
- `npm install`; add `@circle-fin/bridge-kit @circle-fin/adapter-viem-v2`
  (+ optional `@circle-fin/swap-kit`, `@dynamic-labs/ethereum-aa` only if used).
- Add `import "server-only"` to server modules. Create `src/app/api/` tree.

**P1 — Server boundary (the #1 structural fix)**
- `src/app/api/pregen/route.ts` — Dynamic `waas/create` (dyn_ token).
- `src/app/api/unlink/register/route.ts` + `authorization-token/route.ts` —
  `createUnlinkAuthRoutes`.
- (optional) `src/app/api/fx/route.ts` — StableFX stub.
- `src/lib/config.ts` — add `DYNAMIC_API_TOKEN`, `CIRCLE_KIT_KEY`,
  `STABLEFX_API_KEY`, Base Sepolia config; `isBridgeConfigured()`,
  `isPregenConfigured()` gates. Update `.env.example`.

**P2 — Identity model (secret gates Unlink acct; pregen gates payout)**
- `src/lib/engine/types.ts` — add `recipientAddress` (+ optional `recipientIdentifier`)
  to `ClaimPayload`; bump `CLAIM_PAYLOAD_VERSION` to 2.
- `src/lib/engine/claimLink.ts` — validate new field + version 2.
- `src/lib/engine/resolve.ts` — email/phone → pregen address (calls /api/pregen).
- `src/lib/engine/index.ts` (`runSend`) — resolve/pregenerate recipient, embed
  pregen address in payload.
- `src/lib/engine/claim.ts` (`runClaim`) — payout = pregen address (drop
  `recipientAddressFromSecret`); re-label SponsorGas/Withdraw as relayer steps.
- `src/lib/engine/counterfactual.ts` — demote `recipientAddressFromSecret` to demo-only.

**P3 — Real Unlink (browser client + faucet shield)**
- Rewrite `src/lib/adapters/unlink.ts` real path to `@unlink-xyz/sdk/browser`
  (`account.fromSeed` + `createUnlinkClient` with `registerUrl`/`authorizationToken.url`).
- Shield via `faucet.requestPrivateTokens`; `depositWithApproval` behind a flag.
- Fix status assertions to `=== "processed"`. Remove the browser-throw guard
  (client now legitimately runs in the browser; only admin stays server-side).

**P4 — Real CCTP aggregation**
- New `src/lib/adapters/bridge.ts` (bridge-kit) + demo sim.
- `src/lib/adapters/arc.ts` — add CCTP addrs + bridge-kit chain ids
  (`Arc_Testnet`, `Base_Sepolia`).
- `src/lib/engine/aggregate.ts` / `shield.ts` — wire bridge step before shield;
  await mint confirmation.

**P5 — Claim UI (OTP-then-withdraw)**
- `src/components/ClaimScreen.tsx` — Dynamic OTP login gate → then withdraw.

**P6 — Optional bonus**
- Real StableFX adapter behind `STABLEFX_API_KEY` (read domain/spender/typedData
  from the API response — never hardcode).
- Real Swap EURC→USDC behind `CIRCLE_KIT_KEY` (server route).

---

## 6. Residual items (only a live key + one live run can confirm — NOT design risk)

1. Exact JSON key for the pregen address in the `/waas/create` response (parse both
   `accountAddress` and `wallets[].publicKey`).
2. Pregen address stability across pregen→claim (strongly implied by MPC; 1-min test).
3. CCTP testnet FAST latency for Base Sepolia → Arc (docs say ~8–20s).
4. Unlink proving rate-limits per key (`X-RateLimit-Policy: heavy`).
5. `npm install` transitive viem pin (top-level peers are clean; retry with
   `--legacy-peer-deps` only if ERESOLVE).

## 7. Remaining true blocker

- **StableFX live FX** — contact-a-rep key + TEST returns mock data. Mitigated by
  design: FX stays simulated by default. Not on the critical path.
