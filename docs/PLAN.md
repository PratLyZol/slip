# Slip — Verified Build Plan & Decisions (batch-first)

> Status: **architecture fully verified, all decisions locked, zero structural blockers.**
> Updated: 2026-06-13. Single source of truth for the real-integration build. Where it
> conflicts with `docs/research/*` or the PRD, **this doc wins** — it folds in seven deep
> verification passes against live APIs, on-chain probes, and the published SDK types.

---

## Bounty targeting

We submit across three sponsors (Dynamic + Unlink + Arc/Circle):

- **Arc — primary: "Best Chain Abstracted USDC Apps Using Arc as a Liquidity Hub" ($3,500).**
  Near-exact fit and already built: CCTP bridges USDC from another chain (Base Sepolia) onto
  Arc — multiple chains as one liquidity surface, Arc as the hub — with a seamless walletless
  payout UX. Lead with this. (Resources it lists: USDC, Gateway, Circle Wallets — our stack.)
- **Arc — secondary: "Advanced Stablecoin Logic" ($3,500)** via their listed example
  *"programmable payroll in USDC/EURC"* — our private batch payroll. Weaker fit (that track
  leans toward deploying your own contracts; we orchestrate Unlink/CCTP), submit as a second.
- **Unlink** (private payments) + **Dynamic** (walletless onboarding) — their own sponsor
  bounties, hit by the privacy fan-out + pregen/OTP claim.

**StableFX is dropped** (contact-a-rep gated; no track requires it). FX is a feature, not a
requirement — see decision #9. None of the above depend on it.

---

## 0. Decisions locked (do not relitigate)

1. **Batch is the hero; single-send is the on-ramp.** This is a CONSCIOUS REVERSAL of
   the PRD (which called batch "cuttable" / "build A before B"). Reason: the Unlink
   privacy property is **only self-contained at N>1** (see §1). A single send's privacy
   leans entirely on the shared pool's ambient traffic — which is thin on testnet. So
   batch *is* the product; single send is N=1, the trivial case of the same engine.
2. **Engine is `recipients[]`-first.** Data model everywhere is
   `recipients: { identifier, amount, region }[]`, N=1 falls out for free. One code path,
   never two. Add `senderLabel` to the v2 claim payload (for the "from who" claim card).
3. **Recipient identity = Dynamic pregenerated wallets.** Payout address derived from
   email/phone via `POST /waas/create` (idempotent, stable). Recipient claims by OTP
   login (auto-association; no seed, no gas).
4. **Aggregation = real Circle CCTP** (`@circle-fin/bridge-kit`, `Base_Sepolia →
   Arc_Testnet`, one call, no key, forwarder mode). Bridge **Σ(amounts) ONCE**, not
   per-recipient.
5. **Privacy = browser Unlink client + thin server routes.** `createUnlinkClient` +
   `account.fromSeed` run in the browser (secret/keys never leave the client); only
   `register` + `authorization-token` are server routes holding `UNLINK_API_KEY`.
6. **Shield = `faucet.requestPrivateTokens({ amount: ΣWei })`** (gasless, walletless) when
   Σ ≤ the faucet cap; else split into ⌈Σ/cap⌉ calls, or fall back to
   `depositWithApproval` (needs a gas-funded sender EOA — acceptable; see §1 walletless
   note). Shield **Σ once** into the sender's account.
7. **Fan-out = N SEQUENTIAL `transfer()` calls** (≤2 recipients each). The batch form
   caps at `MAX_TRANSFER_RECIPIENTS = 2` (`spend_10x4_v1` circuit) — there is NO single
   N-recipient transfer. Loop N (or ⌈N/2⌉ paired) heavy proving ops; honor `Retry-After`
   (SDK auto-retries 3×). Default to ~5 recipients for snappiness; scales to ~25
   sequentially.
8. **Claim = N independent withdrawals.** Each recipient's browser re-derives its account
   from its secret and `withdraw()`s to its pregen address (relayer-submitted, gasless).
9. **Local currency at claim = deliver the right stablecoin directly; NO StableFX.** EU
   recipient → **EURC**, everyone else → **USDC** — settle/withdraw the destination coin the
   recipient should receive (EURC is faucet-fundable on Arc), rather than converting. This is
   real, trivial, needs no key, and keeps the "pay anyone in their local money" story. The
   "FX" is a destination-token choice, not a swap.
   - **Optional upgrade (stretch):** a real on-chain USDC→EURC swap via **Circle Swap Kit**
     (`@circle-fin/swap-kit`, **free self-serve** kit key) — gate behind one confirmed live
     swap; if the swap is unavailable, fall back to direct-EURC delivery. Adds a genuine FX
     leg if we want it; not required.
10. **StableFX is DROPPED.** Its key is contact-a-rep only and **no bounty track requires it**
    — keeping it added a human-gated dependency for zero bounty value. Remove the
    `fx-stablefx.ts` adapter; replace with the direct-EURC delivery above (+ optional Swap
    Kit). FX is post-withdraw on the recipient's OWN funds — **not private**.

3-SDK rule holds: **Dynamic + Unlink + Circle/Arc** only. All `@circle-fin/*` (bridge-kit,
swap-kit) count as the one Circle sponsor. (Swap Kit is LI.FI-backed *internally* but is
Circle's SDK — compliant.) viem = plumbing; ENS = raw resolver read.

---

## 1. The privacy property (your Q&A armor — say this out loud)

**The claim:** in a batch payout, the on-chain record shows ONE public deposit of the
total Σ and N public withdrawals of varying amounts to N unrelated addresses — but the
**payer↔payee mapping and the per-recipient amount breakdown are unlinkable.** That's the
property. (Total outflow Σ is public; conversion is post-withdraw and public.)

**Two tiers, stated honestly:**
- **Batch (N>1) — self-contained unlinkability.** The anonymity comes from your *own*
  transaction set (N hidden transfers, N unrelated payouts). Independent of strangers.
  **This is the hero flow.**
- **Single (N=1) — pool-inherited.** A lone deposit→withdraw of equal size is the classic
  mixer tell; its privacy depends entirely on the shared Unlink pool's ambient traffic,
  which on **Arc testnet is thin/near-zero right now**. Architecturally real, but weak in
  practice. So single-send is the UX on-ramp, **not** a privacy claim.

Do not let "inherits the pool's set" quietly become "is private on testnet right now."

---

## 2. End-to-end flow (batch; who runs each call, who pays gas)

```
EMPLOYER / SENDER (browser, Dynamic wallet)        SERVER routes (secrets)        RELAYERS / EXTERNAL
1. login (Dynamic widget)                  [client]
2. paste recipients[] (email/phone, amount, region) [client]
3. for each: POST /api/pregen {identifier} ──────▶ Dynamic waas/create (dyn_ token) ─▶ Dynamic → EVM EOA addr
   ◀──────────── { pregenAddress } ──────────────                                      gas: none (off-chain)
4. CCTP bridge Σ(amounts) Base Sepolia → Arc  [client, bridge-kit]
   - burn Σ on Base Sepolia                                          gas: SENDER, Base Sepolia ETH
   - attestation + mint Σ on Arc ──────────────────────────────────────────────────▶ Circle Orbit forwarder
                                                                                       gas: relayer; fee netted
5. per recipient: generate claim secret (CSPRNG) [client] — secrets NEVER leave browser
6. shield Σ once: client.faucet.requestPrivateTokens({token, amount: ΣWei}) [client]
        register/authorize ─────────────────────▶ /api/unlink/register, /authorization-token (admin key)
        (if Σ > faucet cap: split, or depositWithApproval)            gas: none (faucet) / sender USDC (deposit)
7. fan-out: for r in recipients → client.transfer({recipientAddress: r.claimUnlinkAddr, amount: r.amtWei})
   [client→relayer]  N SEQUENTIAL proofs (≤2 recipients/call)        gas: relayer (per transfer)
8. build N links /claim#base64url({v:2, secret, amountUsdc, pregenAddress, region, senderLabel, ...})  [client]
   distribute one link per recipient

EACH RECIPIENT (browser)
9.  open /claim#...   decode fragment       [client] — secret stays client-side
10. OTP login (Dynamic) → auto-claims pregen wallet  [client]        gas: none (off-chain bind)
11. withdraw: client.withdraw({recipientEvmAddress: pregenAddress, token, amount}) [client→relayer]
        re-derive claim acct = account.fromSeed({seed: keccak(secret), accountIndex})
                                                                     gas: relayer (recipient pays nothing)
12. Local coin: EU → withdraw EURC, else USDC (destination-token choice, no swap).
        Optional stretch: real USDC→EURC via Swap Kit. On the recipient's OWN funds — public.
13. done — recipient holds local stablecoin in a wallet they own
```

**Walletless status:** recipients are **always** walletless (pregen + relayer withdraw —
untouched by any branch). The *sender* is walletless too **iff** Σ shields via the faucet;
if Σ exceeds the faucet cap and we use `depositWithApproval`, the sender (the employer)
connects a funded wallet — natural for a payroll payer, and it does not touch recipient
walletlessness.

**Manual prereqs for the real path (faucet items — document them):** sender needs Base
Sepolia ETH (burn) + USDC (`faucet.circle.com`); recipients/sender need nothing on Arc
(forwarder + relayer cover gas) unless using the deposit shield fallback.

---

## 3. Exact call patterns (verified @unlink-xyz/sdk@0.3.0-canary.598)

**Client — shield Σ once, then N sequential transfers:**
```ts
import { account, createUnlinkClient } from "@unlink-xyz/sdk/browser";

const senderAcct = account.fromSeed({ seed: senderSeed, accountIndex: 0 });
const client = createUnlinkClient({
  environment: "arc-testnet",
  account: senderAcct,
  registerUrl: "/api/unlink/register",
  authorizationToken: { url: "/api/unlink/authorization-token" },
});
await client.ensureRegistered();

// SHIELD Σ once (gasless). On cap rejection: split calls, or depositWithApproval fallback.
await client.faucet.requestPrivateTokens({ token: USDC, amount: sumWei });

// FAN-OUT: N sequential single-recipient transfers (batch form caps at 2 recipients).
for (const r of recipients) {
  const claimAddr = await account
    .fromSeed({ seed: keccakBytes(r.secret), accountIndex: 1 })
    .getAddress();
  const res = await (await client.transfer({
    recipientAddress: claimAddr, token: USDC, amount: r.amountWei,
  })).wait();
  if (res.status !== "processed") throw new Error(`transfer ${res.status}`);
  // optional: small delay; SDK auto-retries 3x on 429 / honors Retry-After
}
```

**Each claim (recipient browser):**
```ts
const claimAcct = account.fromSeed({ seed: keccakBytes(secret), accountIndex: 1 });
const client = createUnlinkClient({ environment: "arc-testnet", account: claimAcct,
  registerUrl: "/api/unlink/register", authorizationToken: { url: "/api/unlink/authorization-token" } });
await client.ensureRegistered();
const res = await (await client.withdraw({
  recipientEvmAddress: pregenAddress, token: USDC, amount: amountWei,
})).wait();                              // relayer-submitted; recipient pays no gas
if (res.status !== "processed") throw new Error(`withdraw ${res.status}`);
```

**Server — two route handlers (admin key only):**
```ts
import { createUnlinkAdmin, createUnlinkAuthRoutes } from "@unlink-xyz/sdk/admin";
const admin = createUnlinkAdmin({ environment: "arc-testnet", apiKey: process.env.UNLINK_API_KEY! });
const routes = createUnlinkAuthRoutes({ admin, authenticate: async (req) => /* session */,
  authorizeUnlinkAddress: async () => true });   // tighten for prod
// app/api/unlink/register/route.ts            -> export const POST = (req) => routes.register(req);
// app/api/unlink/authorization-token/route.ts -> export const POST = (req) => routes.authorizationToken(req);
```

**CCTP — bridge Σ once:**
```ts
import { BridgeKit } from "@circle-fin/bridge-kit";
import { createViemAdapterFromPrivateKey } from "@circle-fin/adapter-viem-v2";
const result = await new BridgeKit().bridge({
  from: { adapter, chain: "Base_Sepolia" },
  to:   { adapter, chain: "Arc_Testnet", recipientAddress: senderArcAddr, useForwarder: true },
  amount: sumUsdc, config: { transferSpeed: "FAST" },
});
```

---

## 4. Credentials checklist

| Credential | Env var | How to get | Self-serve? | Needed for |
|---|---|---|---|---|
| Dynamic env id | `NEXT_PUBLIC_DYNAMIC_ENV_ID` | app.dynamic.xyz | ✅ free | login + pregen |
| Dynamic API token | `DYNAMIC_API_TOKEN` (`dyn_…`) | dashboard → Developer → API Token | ✅ free | server pregen/lookup |
| Unlink admin key | `UNLINK_API_KEY` | dashboard.unlink.xyz (project → Arc testnet) | ✅ free | register/authorize routes |
| Circle kit key | `CIRCLE_KIT_KEY` | console.circle.com → Keys → Kit Key | ✅ free | OPTIONAL — real USDC→EURC Swap Kit (stretch) |
| CCTP source funds | `CCTP_PRIVATE_KEY` (funded EOA) | faucet.circle.com (Base Sepolia USDC) + Base Sepolia ETH faucet | ✅ | real bridge |

Everything is now self-serve — StableFX (the only contact-a-rep key) is dropped. The
direct-EURC delivery needs no FX key at all; the Swap Kit key is optional (free) only if we
want a live USDC→EURC swap.

---

## 5. Corrections to prior research (deltas that matter)

- **Batch transfer caps at 2 recipients** (`MAX_TRANSFER_RECIPIENTS = 2`, `spend_10x4_v1`).
  Fan-out is N sequential transfers, not one op.
- **Faucet shields an arbitrary exact amount up to an undisclosed cap** (`amount` param);
  good for modest Σ, else split / deposit fallback.
- **Unlink admin key is self-serve** (dashboard.unlink.xyz); Arc engine is **LIVE**
  (`/health` ok; `/info/environment` returns pool + Permit2 + EntryPoint v0.7).
- **Unlink status success = `"processed"`** — assert it (don't use `!== "failed"`).
- **`account.fromSeed` is browser-safe**; only `/admin` is `browser:null`.
- **ZeroDev hosted bundler does NOT serve Arc** — and AA is dropped anyway (Unlink relayer
  makes the claim gasless).
- **Dynamic has NO aggregate-to-USDC product** — CCTP fills that role.
- **CCTP `Arc_Testnet`/`Base_Sepolia` first-class in bridge-kit**, no key, forwarder = no
  recipient Arc gas, mint = standard ERC-20 at `0x3600…`.
- **StableFX dropped** (contact-a-rep key, no bounty needs it). FYI it *does* settle real
  on-chain in TEST (FxEscrow live; only pricing is sandbox) — but not worth the human-gated
  dependency. Local currency is now a destination-token choice: deliver EURC (faucet-fundable)
  to EU recipients, USDC otherwise.
- **Swap Kit** (optional stretch) real on Arc testnet for {USDC,EURC,cirBTC} only, **free
  self-serve key**, but direction USDC→EURC + liquidity unverified by us → gate on one live swap.

---

## 6. Build order (each phase compiles + the real path stays working)

> Each real adapter is wired against its live SDK and gated on its key being present.
> Each phase compiles and `npm run build` passes; the real path must stay working.

**P0 — Foundations:** `npm install`; add `@circle-fin/bridge-kit @circle-fin/adapter-viem-v2`
(`@circle-fin/swap-kit` only if doing the optional Swap FX stretch). `import "server-only"` in
server modules. Create `src/app/api/`.

**P1 — Server boundary (the #1 structural fix):** `src/app/api/pregen/route.ts`,
`src/app/api/unlink/register/route.ts`, `src/app/api/unlink/authorization-token/route.ts`,
`src/app/api/fx/route.ts`. `config.ts` gets `DYNAMIC_API_TOKEN`, `CIRCLE_KIT_KEY`, Base
Sepolia config + `isBridgeConfigured()`/`isPregenConfigured()`/`isFxConfigured()`. Update
`.env.example`.

**P2 — `recipients[]` data model (batch-first):**
- `types.ts` — `ClaimPayload` v2 adds `recipientAddress`, `senderLabel` (bump
  `CLAIM_PAYLOAD_VERSION` to 2). `SendRequest` becomes `recipients[]`.
- `claimLink.ts` — validate v2 fields.
- `index.ts` (`runSend`) — loop resolve→pregen over recipients; bridge+shield **Σ**;
  fan-out N transfers; emit N claim links. N=1 is the trivial case.
- `resolve.ts` — email/phone → pregen address.
- `claim.ts` — payout = pregen address (drop `recipientAddressFromSecret`); relabel
  SponsorGas/Withdraw as relayer steps.
- `counterfactual.ts` — demote/remove `recipientAddressFromSecret` (legacy).

**P3 — Real Unlink (browser client + faucet shield + sequential fan-out):** rewrite
`adapters/unlink.ts` real path to `@unlink-xyz/sdk/browser` (`account.fromSeed` +
`createUnlinkClient` with `registerUrl`/`authorizationToken.url`). Shield Σ via
`faucet.requestPrivateTokens` (cap-aware: split or deposit fallback). Fan-out = N
sequential `transfer()` (≤2 each), `Retry-After`-aware. Fix status asserts to
`=== "processed"`. Remove the browser-throw (client now legitimately runs client-side).

**P4 — Real CCTP aggregation (Σ once):** new `adapters/bridge.ts` (bridge-kit) + sim.
`arc.ts` += CCTP addrs + chain ids (`Arc_Testnet`,`Base_Sepolia`). `aggregate.ts`/`shield.ts`
bridge **Σ** before shield; await mint.

**P5 — Batch UI + claim UI:** batch screen (paste rows → N links + status table, payees
isolated). `ClaimScreen.tsx` OTP-login gate → withdraw.

**P6 — Local currency at claim (simple; StableFX REMOVED):**
- **Delete `adapters/fx-stablefx.ts`** and the StableFX path in `engine/fx.ts` / `/api/fx`.
- Deliver the destination coin directly: EU recipient → withdraw **EURC**, else **USDC**
  (`fxAtClaim` becomes a token-selector, not a swap; EURC is faucet-fundable on Arc). No key.
- **Optional stretch:** `adapters/swap.ts` — real USDC→EURC via Swap Kit behind the free
  `CIRCLE_KIT_KEY`; confirm one live swap (direction + liquidity) before relying on it; sim
  fallback. Only do this if you want a live FX leg on top of direct delivery.

---

## 7. Honesty (say it before a judge finds it)

- **Real:** CCTP bridge (Σ onto Arc — the chain-abstraction story), shielded batch transfers
  + withdrawals (the privacy property), Dynamic pregen + OTP claim, and **local-currency
  delivery** (EU recipients receive real testnet EURC, others USDC — delivered directly).
- **Optional real FX:** if the Swap Kit stretch is wired, a live on-chain USDC→EURC swap;
  otherwise EURC is delivered directly (still real money, real coin) — no fabricated rates.
- **Privacy is self-contained at N>1**; single-send is the on-ramp, not a privacy
  claim (§1).

---

## 8. Residual items (only a live key + one run can settle — NOT design risk)

1. **Faucet per-call max + cooldown** — determines whether Σ shields in one faucet call vs
   split vs deposit fallback. Discover empirically with the key.
2. **Proving (`heavy`) rate-limit numbers** — whether ~25 sequential transfers throttle.
   Mitigated by SDK 3× retry + `Retry-After` + inter-call delay; ~5 recipients.
3. **(Only if doing the optional Swap stretch)** Swap Kit USDC→EURC direction + liquidity
   depth on Arc testnet — one live swap. Not needed for the default direct-EURC delivery.
4. **Pregen address stability across pregen→claim** — 1-min test (strongly implied by MPC).
5. **CCTP FAST latency** Base Sepolia → Arc (docs ~8–20s); UI must handle the await.
6. **Exact pregen response field** (parse both `accountAddress` and `wallets[].publicKey`).
7. **`npm install` transitive viem pin** (top-level peers clean; `--legacy-peer-deps` only
   if ERESOLVE).

## 9. Remaining blockers

**None.** With StableFX dropped, there are no human-gated dependencies left — every
credential is self-serve, and local-currency delivery (EURC direct) needs no FX key at all.
Everything on the critical path is verified.
