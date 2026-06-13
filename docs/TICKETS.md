# Slip — Build Tickets (parallelized)

> Companion to `docs/PLAN.md`. Tickets are sliced along the repo's **adapter-interface
> seams** so they parallelize cleanly: once Wave 0 freezes the types/interfaces, the engine
> and UI run on *demo* adapters while each *real* adapter is built independently and swapped
> in behind its interface. **Keys never block coding** — every real adapter is built/tested
> in demo mode first; the key just flips it live.

Legend: ⭐ keystone · 🔑 needs a credential for LIVE (builds with stub first) · 🔥 shared
hot-spot file (coordinate / single owner).

---

## Status (updated 2026-06-13)

**Bounty target:** primary = Arc **"Chain-Abstracted USDC / Arc as Liquidity Hub" ($3,500)**
(our CCTP bridge = multi-chain → one Arc liquidity surface); secondary = Arc **"Advanced
Stablecoin Logic"** (programmable payroll); plus Dynamic + Unlink sponsor bounties. See
`docs/PLAN.md` "Bounty targeting".

**Done & on `main`:** Wave 0 · A1 (pregen) · Track B (Unlink browser rewrite + auth routes,
PR #3) · Track C (CCTP) · Track E (batch fan-out, PR #3) + batch surface wired to
`runBatchSend` (PR #4) · Track F (batch + claim OTP + proof views, PR #2) · design + Railway
config. **Full demo runs green end-to-end (single + 6-row batch, single Σ-shield, no
cross-leakage).** Note: D1 StableFX shipped but is now being **REMOVED** (see below).

**FX change:** **StableFX is DROPPED** (contact-a-rep key; no bounty needs it). Local currency
is now a destination-token choice — EU → **EURC** (faucet-fundable), else **USDC** — delivered
directly, no swap, no key. Optional stretch: real USDC→EURC via Swap Kit (free self-serve key).

**Remaining:** **D-fix** (remove `fx-stablefx.ts`; `fxAtClaim` → token-selector) · **A2**
(real-mode sender login/balance — minor) · optional Swap Kit stretch · **Wave 2** (gather keys
→ flip demo→real → one live testnet batch → deploy + domain).

**Deploy:** Railway is set up + auto-deploys on push to `main`. Earlier deploys failed on a
stale lockfile; that's fixed (`npm ci` + build green on HEAD). Next push deploys clean; then
`railway domain` for a public URL.

**Deviation:** config uses `CIRCLE_STABLEFX_API_KEY` (not `STABLEFX_API_KEY`).

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
  `/api/pregen`; demo impl. *Files:* `src/lib/adapters/pregen.ts`, `api/pregen/route.ts`.
- [ ] **A2 — Sender login/balance** in real mode. *Files:* `src/components/WalletProvider.tsx`.
- [x] **A3 — Claim OTP login + "claim your wallet" UI.** *Files:* `src/components/ClaimScreen.tsx`.

### Track B — Privacy (Unlink) — hardest; give to strongest
- [x] **B1 — Real Unlink rewrite:** `@unlink-xyz/sdk/browser` client + `account.fromSeed` +
  faucet shield + **N sequential `transfer()`** (≤2 recipients each); status assert
  `=== "processed"`; remove the browser-throw guard. *Files:* `src/lib/adapters/unlink.ts`.
- [x] **B2 — Auth routes** 🔑(`UNLINK_API_KEY`): `createUnlinkAuthRoutes` for register +
  authorization-token. *Files:* `api/unlink/register/route.ts`, `api/unlink/authorization-token/route.ts`.

### Track C — Aggregation (CCTP)
- [x] **C1 — Bridge adapter** 🔑(`CCTP_PRIVATE_KEY` for live): `bridge-kit`, bridge **Σ once**
  (Base Sepolia → Arc, forwarder); demo sim. *Files:* `src/lib/adapters/bridge.ts`;
  add CCTP addrs + chain ids to `src/lib/adapters/arc.ts`.
- [x] **C2 — Wire bridge into engine:** bridge before shield, await mint, keep gas buffer.
  *Files:* `src/lib/engine/aggregate.ts`, `src/lib/engine/shield.ts`.

### Track D — Local currency at claim (StableFX DROPPED)
- [x] ~~**D1 — StableFX adapter**~~ — shipped, now **being removed** (contact-a-rep key; no
  bounty needs it). See D-fix.
- [ ] **D-fix — Remove StableFX, deliver coin directly:** delete `src/lib/adapters/fx-stablefx.ts`
  + the StableFX path in `api/fx/route.ts`; make `fxAtClaim` a token-selector (EU → EURC,
  else USDC — EURC is faucet-fundable, no swap, no key). *Files:* `src/lib/engine/fx.ts`,
  `src/lib/adapters/fx-stablefx.ts` (delete), `src/app/api/fx/route.ts`.
- [ ] **D2 — (OPTIONAL stretch) Swap Kit** 🔑(`CIRCLE_KIT_KEY`, free self-serve): real
  on-chain USDC→EURC; confirm one live swap. *Files:* `src/lib/adapters/swap.ts`. Only if we
  want a live FX leg on top of direct delivery.

### Track E — Engine orchestration 🔥 — uses demo adapters; not blocked on A–D real code
- [x] **E1 — `runSend` batch loop:** loop resolve→pregen over `recipients[]`; bridge + shield
  Σ; fan-out N transfers; emit N claim links. *Files:* `src/lib/engine/index.ts` 🔥.
- [x] **E2 — `runClaim`:** payout = pregen address (drop `recipientAddressFromSecret`);
  relabel claim steps as relayer-submitted. *Files:* `src/lib/engine/claim.ts` 🔥.
- [x] **E3 — `resolve.ts`:** email/phone → pregen path. *Files:* `src/lib/engine/resolve.ts`.

### Track F — UI / Surfaces — uses demo engine
- [x] **F1 — Send screen → `recipients[]`** (single + add-row). *Files:* `src/app/page.tsx`.
- [x] **F2 — Batch screen:** paste rows → N links + status table; payees isolated.
  *Files:* `src/app/batch/page.tsx`.
- [x] **F3 — Claim screen wiring** (with A3/E2). *Files:* `src/app/claim/page.tsx`.
- [x] **F4 — Proof views for batch:** the two-tier privacy story. *Files:*
  `src/app/architecture/page.tsx`, `src/app/private/page.tsx`.

---

## Wave 2 — Integration & live tests (after tracks land; coordinate)
- [ ] **I1 — Flip demo→real** with keys; live checks: faucet per-call cap, CCTP bridge
  Base Sepolia → Arc, EURC delivery to EU recipient (+ optional Swap USDC→EURC if wired).
- [ ] **I2 — Full batch run** (5 recipients) end-to-end on testnet.
- [ ] **I3 — Demo script + honesty labels + polish.**

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

**Demo-stays-green rule:** every real adapter falls back to its demo/sim impl when its key
is absent. `npm run build` must pass before each commit.
