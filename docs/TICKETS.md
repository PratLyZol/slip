# Slip — Build Tickets (parallelized)

> Companion to `docs/PLAN.md`. Tickets are sliced along the repo's **adapter-interface
> seams** so they parallelize cleanly: once Wave 0 freezes the types/interfaces, each real
> adapter is built independently behind its interface and activated by its own key/credential.

Legend: ⭐ keystone · 🔑 needs a credential for LIVE (builds with stub first) · 🔥 shared
hot-spot file (coordinate / single owner).

---

## Status (updated 2026-06-14) — shipped, real-only

**Bounty target:** primary = Arc **"Chain-Abstracted USDC / Arc as Liquidity Hub" ($3,500)**
(our CCTP bridge = multi-chain → one Arc liquidity surface); secondary = Arc **"Advanced
Stablecoin Logic"** (programmable payroll); plus Dynamic + Unlink sponsor bounties.

**Shipped & on `main`:** the full real money path — Dynamic pregen, CCTP aggregation
(wallet-signed burn → forwarder mint), Unlink wallet-funded shield + private fan-out + relayer
withdraw, OTP claim, batch + proof views, Resend claim-link email, Railway auto-deploy.

**App restructure (PR #20):** split the monolithic send into two independently-retriable
legs — `runBridge` + `runDistribute` — surfaced as the two-step `/send`. New IA: `/` Home
(multi-chain USDC balances), `/send`, `/settings` (network switch), `/claim`. Fixed the
post-bridge Arc balance refresh so step ② un-gates.

**Real-only lock-in (PR #21):** removed ALL stubs/simulation. Root cause of "funds didn't
move": `getShieldOps()` ran client-side but gated on the server-only `UNLINK_API_KEY`
(undefined in the browser) → always picked the sim. Fix: `getShieldOps()` is always real (the
server routes 501 are the honest gate). Deleted `demo/sim.ts`, `isDemoMode`, `demoShieldOps`;
deleted `engine/settle.ts` and the degraded direct-settle fallback (it stranded funds);
`claim.ts`/`distribute.ts`/`fx.ts` are real-only with honest throws.

**Recipient registration fix (PR #22):** register each recipient's Unlink claim account at
send time before transferring (else `transfer.prepare failed: user not found`).

**FX:** **StableFX dropped.** FX at claim = USDC for everyone today — EU→EURC is attempted via
Circle Swap Kit but there is **no USDC↔EURC route on Arc testnet**, so it honestly falls back
to USDC. No fabricated rate. (`fx-stablefx.ts` gone; `swap.ts` is the optional Swap Kit path.)

**Deploy:** Railway auto-deploys on push to `main`.

**Known limits:** EURC undeliverable on Arc testnet (USDC fallback); claim-link email needs a
verified Resend `EMAIL_FROM` domain; sender needs origin-chain gas for the burn.

---

## Wave 0 — Foundation (blocks everything; ~half a day; 1 owner)

### T0.1 — Bootstrap & config
- `npm install`; add `@circle-fin/bridge-kit`, `@circle-fin/adapter-viem-v2`, `@circle-fin/swap-kit`.
- `config.ts`: add `DYNAMIC_API_TOKEN`, `CIRCLE_KIT_KEY`, `STABLEFX_API_KEY`, Base Sepolia
  config; add gates `isPregenConfigured()`, `isBridgeConfigured()`, `isFxConfigured()`.
- Update `.env.example`. Establish `import "server-only"` in server modules.
- **Files:** `package.json`, `src/lib/config.ts`, `.env.example`
- **Depends on:** nothing.

### T0.2 — Types & contracts ⭐ 🔥
- `SendRequest` → `recipients: { identifier, amount, region }[]`.
- `ClaimPayload` v2: add `recipientAddress`, `senderLabel`; bump `CLAIM_PAYLOAD_VERSION` to 2.
- Define new adapter interfaces `PregenOps`, `BridgeOps`, `FxOps` (next to existing `ShieldOps`).
- Update claim-link validation for v2.
- **Files:** `src/lib/engine/types.ts` 🔥, `src/lib/engine/claimLink.ts`
- **Depends on:** nothing. **Freeze early — everyone imports this.**

### T0.3 — API route skeletons
- Create `src/app/api/{pregen, unlink/register, unlink/authorization-token, fx}/route.ts`
  returning typed stub responses so frontend + adapters develop against real endpoints.
- **Files:** the four `route.ts` files
- **Depends on:** T0.2.

---

## Wave 1 — Parallel tracks (all independent after Wave 0)

### Track A — Identity (Dynamic)
- [x] **A1 — Pregen adapter** 🔑(`DYNAMIC_API_TOKEN`): real `waas/create` + lookup behind
  `/api/pregen`. *Files:* `src/lib/adapters/pregen.ts`, `api/pregen/route.ts`.
- [x] **A2 — Sender login/balance** (real): Dynamic embedded wallet; `WalletProvider` exposes
  multi-chain `balances`, `chainId`, `switchNetwork`, `getWalletClient`, `refreshBalances`.
  *Files:* `src/components/WalletProvider.tsx`.
- [x] **A3 — Claim OTP login + "claim your wallet" UI.** *Files:* `src/components/ClaimScreen.tsx`.

### Track B — Privacy (Unlink) — hardest; give to strongest
- [x] **B1 — Real Unlink rewrite:** `@unlink-xyz/sdk/browser` client + `account.fromSeed` +
  faucet shield + **N sequential `transfer()`** (≤2 recipients each); status assert
  `=== "processed"`; remove the browser-throw guard. *Files:* `src/lib/adapters/unlink.ts`.
- [x] **B2 — Auth routes** 🔑(`UNLINK_API_KEY`): `createUnlinkAuthRoutes` for register +
  authorization-token. *Files:* `api/unlink/register/route.ts`, `api/unlink/authorization-token/route.ts`.

### Track C — Aggregation (CCTP)
- [x] **C1 — Bridge adapter** 🔑(`CCTP_PRIVATE_KEY` for live): `bridge-kit`, bridge **Σ once**
  (Base Sepolia → Arc, forwarder). *Files:* `src/lib/adapters/bridge.ts`;
  add CCTP addrs + chain ids to `src/lib/adapters/arc.ts`.
- [x] **C2 — Wire bridge into engine:** `runBridge` (engine/bridge.ts) burns Σ on the origin
  chain (wallet-signed) + awaits the forwarder mint on Arc, then `runDistribute` shields.
  *Files:* `src/lib/engine/bridge.ts`, `src/lib/engine/distribute.ts`, `src/lib/engine/aggregate.ts`.

### Track D — Local currency at claim (StableFX DROPPED) — done
- [x] ~~**D1 — StableFX adapter**~~ — REMOVED (`fx-stablefx.ts` deleted; contact-a-rep key, no bounty needs it).
- [x] **D-fix — `fxAtClaim` is real-only:** non-EU → USDC no-op; EU → `/api/fx` → Swap Kit.
  *Files:* `src/lib/engine/fx.ts`, `src/app/api/fx/route.ts`.
- [x] **D2 — Swap Kit wired** 🔑(`CIRCLE_KIT_KEY`, optional): `swap.ts` runs the real
  USDC→EURC swap server-side. **No route exists on Arc testnet**, so it honestly falls back to
  USDC — every recipient gets USDC today. *Files:* `src/lib/adapters/swap.ts`.

### Track E — Engine orchestration 🔥 — develops against the adapter interfaces; not blocked on A–D landing
- [x] **E1 — `runSend` batch loop:** loop resolve→pregen over `recipients[]`; bridge + shield
  Σ; fan-out N transfers; emit N claim links. *Files:* `src/lib/engine/index.ts` 🔥.
- [x] **E2 — `runClaim`:** payout = pregen address (drop `recipientAddressFromSecret`);
  relabel claim steps as relayer-submitted. *Files:* `src/lib/engine/claim.ts` 🔥.
- [x] **E3 — `resolve.ts`:** email/phone → pregen path. *Files:* `src/lib/engine/resolve.ts`.

### Track F — UI / Surfaces — develops against the engine interface
- [x] **F1 — Send screen → `recipients[]`** (single + add-row). *Files:* `src/app/page.tsx`.
- [x] **F2 — Batch screen:** paste rows → N links + status table; payees isolated.
  *Files:* `src/app/batch/page.tsx`.
- [x] **F3 — Claim screen wiring** (with A3/E2). *Files:* `src/app/claim/page.tsx`.
- [x] **F4 — Proof views for batch:** the two-tier privacy story. *Files:*
  `src/app/architecture/page.tsx`, `src/app/private/page.tsx`.

---

## Wave 2 — Integration & live tests (after tracks land; coordinate)
- [ ] **I1 — Wire keys**; live checks: faucet per-call cap, CCTP bridge
  Base Sepolia → Arc, EURC delivery to EU recipient (+ optional Swap USDC→EURC if wired).
- [ ] **I2 — Full batch run** (5 recipients) end-to-end on testnet.
- [ ] **I3 — Walkthrough + honesty labels + polish.**

---

## Run plan

**Critical path:** `T0.2` (keystone) → fan-out → integration. Wave 0 ≈ half a day; then wide open.

**3–4 people:**
- **P1:** Wave 0 → Track E (engine spine).
- **P2:** Track B (Unlink) — hardest, most isolated.
- **P3:** Tracks A + C (Dynamic + CCTP).
- **P4:** Track F (UI) + Track D (FX).

**Coordination (shared hot-spots 🔥):**
- `types.ts` — freeze in T0.2; everyone depends on it.
- `engine/index.ts`, `engine/claim.ts` — Track E owner only; others touch adapters.

**Keys:** all self-serve now (StableFX dropped). Grab Dynamic env id + `dyn_` token, Unlink
admin key (dashboard.unlink.xyz), a funded Base Sepolia wallet for CCTP, and (optional) a free
Circle kit key for the Swap stretch.

**Real-only rule:** when a key/credential is absent the adapter surfaces an honest error (no
silent simulation). `npm run build` must pass before each commit.
