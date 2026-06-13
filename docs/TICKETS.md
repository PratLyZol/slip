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

**Done & on `main`:** Wave 0 (T0.1–T0.3 — types frozen, config gates, route stubs) ·
Track C (CCTP bridge wired into engine) · Track D1 (StableFX adapter, sim in demo) · design
system + Railway deploy. Screens already pass `recipients[]`.

**Critical path remaining:** **B** (Unlink still the OLD custodial path — privacy rewrite
not done) · **E** (engine still single-recipient shim) · **A1** (pregen route returns a demo
address) · **F2** (full multi-row batch UI).

**Lower priority:** D2/D3 (Swap fallback — StableFX D1 already covers FX) · Wave 2 (live tests).

**Deviation to note:** config uses `CIRCLE_STABLEFX_API_KEY` (not `STABLEFX_API_KEY`).

**Parallel set to run now (4 agents, disjoint files):** B · A1 · E · F2. Prompts in
`docs/prompts/`. Rule: only the **E** agent edits `engine/index.ts`+`claim.ts`; A/B deliver
adapter+route files; F edits screens.

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
- [ ] **A1 — Pregen adapter** 🔑(`DYNAMIC_API_TOKEN`): real `waas/create` + lookup behind
  `/api/pregen`; demo impl. *Files:* `src/lib/adapters/pregen.ts`, `api/pregen/route.ts`.
- [ ] **A2 — Sender login/balance** in real mode. *Files:* `src/components/WalletProvider.tsx`.
- [ ] **A3 — Claim OTP login + "claim your wallet" UI.** *Files:* `src/components/ClaimScreen.tsx`.

### Track B — Privacy (Unlink) — hardest; give to strongest
- [ ] **B1 — Real Unlink rewrite:** `@unlink-xyz/sdk/browser` client + `account.fromSeed` +
  faucet shield + **N sequential `transfer()`** (≤2 recipients each); status assert
  `=== "processed"`; remove the browser-throw guard. *Files:* `src/lib/adapters/unlink.ts`.
- [ ] **B2 — Auth routes** 🔑(`UNLINK_API_KEY`): `createUnlinkAuthRoutes` for register +
  authorization-token. *Files:* `api/unlink/register/route.ts`, `api/unlink/authorization-token/route.ts`.

### Track C — Aggregation (CCTP)
- [x] **C1 — Bridge adapter** 🔑(`CCTP_PRIVATE_KEY` for live): `bridge-kit`, bridge **Σ once**
  (Base Sepolia → Arc, forwarder); demo sim. *Files:* `src/lib/adapters/bridge.ts`;
  add CCTP addrs + chain ids to `src/lib/adapters/arc.ts`.
- [x] **C2 — Wire bridge into engine:** bridge before shield, await mint, keep gas buffer.
  *Files:* `src/lib/engine/aggregate.ts`, `src/lib/engine/shield.ts`.

### Track D — FX (build last; lower priority than batch/privacy)
- [x] **D1 — StableFX adapter** 🔑(`STABLEFX_API_KEY`): real REST quote→sign→trade→presign→
  sign→fund→poll; **read domain/spender/typedData from the API response**. *Files:*
  `src/lib/adapters/fx-stablefx.ts`, `api/fx/route.ts`.
- [ ] **D2 — Swap Kit fallback** 🔑(`CIRCLE_KIT_KEY`): USDC→EURC server route. *Files:*
  `src/lib/adapters/swap.ts`.
- [ ] **D3 — Cascade selector** (StableFX → Swap → sim). *Files:* `src/lib/engine/fx.ts`.

### Track E — Engine orchestration 🔥 — uses demo adapters; not blocked on A–D real code
- [ ] **E1 — `runSend` batch loop:** loop resolve→pregen over `recipients[]`; bridge + shield
  Σ; fan-out N transfers; emit N claim links. *Files:* `src/lib/engine/index.ts` 🔥.
- [ ] **E2 — `runClaim`:** payout = pregen address (drop `recipientAddressFromSecret`);
  relabel claim steps as relayer-submitted. *Files:* `src/lib/engine/claim.ts` 🔥.
- [ ] **E3 — `resolve.ts`:** email/phone → pregen path. *Files:* `src/lib/engine/resolve.ts`.

### Track F — UI / Surfaces — uses demo engine
- [ ] **F1 — Send screen → `recipients[]`** (single + add-row). *Files:* `src/app/page.tsx`.
- [ ] **F2 — Batch screen:** paste rows → N links + status table; payees isolated.
  *Files:* `src/app/batch/page.tsx`.
- [ ] **F3 — Claim screen wiring** (with A3/E2). *Files:* `src/app/claim/page.tsx`.
- [ ] **F4 — Proof views for batch:** the two-tier privacy story. *Files:*
  `src/app/architecture/page.tsx`, `src/app/private/page.tsx`.

---

## Wave 2 — Integration & live tests (after tracks land; coordinate)
- [ ] **I1 — Flip demo→real** with keys; run the 3 live checks: faucet per-call cap,
  StableFX maker completion (`taker_funded`→`complete`), Swap USDC→EURC liquidity.
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

**Day-0 action:** email Circle (`sales@circle.com`) for the StableFX key — it's the only
contact-a-rep credential. Keep building D1 in demo meanwhile; flip live when it arrives.

**Demo-stays-green rule:** every real adapter falls back to its demo/sim impl when its key
is absent. `npm run build` must pass before each commit.
