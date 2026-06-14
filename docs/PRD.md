# PRD — "Slip"

**Pay anyone, anywhere, in their own money. Private by default. From anything, to anything.**

> One-liner: build a payments app where the sender types a name and an amount, and the recipient taps a link and has money in their local stablecoin — having never made a wallet, held gas, or learned what a chain is. The amount and the social graph are invisible on-chain by default.

> ⚠️ **Superseded in places by `docs/PLAN.md` (the source of truth).** This PRD's original
> design used ERC-4337 counterfactual accounts + a paymaster for the claim. **That was
> dropped:** recipient payout is a Dynamic **pregen** wallet (OTP-claimed) and the claim is
> gasless via **Unlink's relayer** (no AA/4337/CREATE2/paymaster). The send is split into a
> **CCTP bridge** leg + an **Unlink shield/fan-out** leg. See PLAN's "As-built" block.

---

## 0. Context

- **Event:** ETHGlobal New York 2026, 36-hour hackathon, Arc testnet. This is a **proof of concept**, not a protocol. Polish of the live flow > completeness.
- **Hard rule — 3 sponsor SDKs maximum per project.** Ours: **Dynamic + Unlink + Arc (Circle)**. No LI.FI, no Privy, no fourth sponsor SDK. ENS is used only as a plain public-resolver *read* (name → address), not an SDK integration.
- **This stack is a funded bounty.** Dynamic's NYC prize page has a track for combining **Dynamic + Unlink for private payments on Arc testnet**.
- **Everything is on Arc testnet.** Unlink shielding and Arc FX both live on Arc; no public bridge hop between the private leg and the FX leg. Never bridge shielded funds across a public hop.
- **Get the real APIs, don't guess.** If a real sponsor API is unavailable, stub it behind a clearly-named interface and flag it — never hallucinate signatures.

## 1. Product summary

Two surfaces, **one engine**: *resolve recipient → CCTP-bridge USDC onto Arc → shield Σ through an Unlink balance → privately fan out to each recipient's claim account → recipient claims walletlessly (OTP → pregen wallet), gasless via Unlink's relayer, delivered as their local stablecoin.*

- **Surface A — Single send (consumer):** type `alice`, enter `$50`, tap Send. "Sent $50 to alice." Claim link / QR generated.
- **Surface B — Batch payout (B2B):** paste a list of names, hit Pay. Each row runs the same engine. Payees can't see each other; the treasury isn't doxxed.

Build A's engine completely before touching B.

## 2. The flow of a send (as-built)

Two independently-retriable legs (the two-step `/send` screen), then the claim:

**① Bridge to Arc** (`runBridge`)
1. **Resolve** each recipient (email/phone) → a Dynamic **pregen** payout address; `.eth` → ENS read.
2. **Aggregate** via Circle **CCTP**: the connected wallet burns Σ USDC on its origin chain (Base Sepolia, etc.); Circle's forwarder mints Σ on Arc.

**② Distribute** (`runDistribute`, on Arc)
3. **Shield** Σ once into the sender's Unlink balance — a wallet-funded `depositWithApproval` (amount + edge hidden on-chain).
4. **Private fan-out** — N sequential Unlink `transfer()`s from the shielded balance to each recipient's (pre-registered) claim account.
5. **Claim links** — one `/claim#<base64url(payload)>` per recipient; the secret rides the URL fragment.

**Claim** (recipient's browser)
6. **OTP login** (Dynamic) binds their pregen wallet; **Unlink's relayer withdraws** to that address — recipient pays no gas. No account deploy, no paymaster.
7. **Local stablecoin** at claim — USDC today (EU→EURC attempts Circle Swap Kit, but no route on Arc testnet → honest USDC). No fabricated FX.

Kill-shot: judge does step 1 and gets a result; reveal the rest; open the block explorer and show **even the builder can't read the amount or the graph.**

## 3. Design decisions (made — do not relitigate)

- **FX at CLAIM time, not send time.** Counterfactual address holds USDC; conversion keyed off recipient's region on claim. Settle USDC, FX on withdraw.
- **Salt = claim secret.** The QR/link encodes the claim secret; it deterministically derives the counterfactual address. Holder of link can claim (hackathon-grade).
- **"Local stablecoin," not "native token."** Recipients receive EURC/USDC, never the gas coin. Use this terminology in UI and code.
- **No backend database unless forced.** Stateless: the claim link carries everything needed. If batch needs persistence, lightest possible store (in-memory / single JSON/kv).

## 4. Build order (STRICT — checkpoints)

> If time runs out, **ship through Phase 3.** Privacy is the differentiator and the bounty. Phases 5–7 are cuttable.

- **Phase 0 — Scaffold + wallet.** Next.js + Tailwind. Dynamic login + embedded smart wallet. Arc testnet. *Checkpoint:* logged-in user sees Arc-testnet USDC balance.
- **Phase 1 — Single send happy path (no privacy/FX).** Name + amount + Send → counterfactual address from fresh claim secret, USDC transfer to it, claim URL + QR. Aggregation via Dynamic. *Checkpoint:* funded counterfactual address + working claim link.
- **Phase 2 — Claim flow (walletless + gasless).** Claim page reads secret from URL, reconstructs address, runs batched deploy-and-withdraw UserOp with paymaster gas. *Checkpoint:* fresh browser session claims, gasless.
- **Phase 3 — Privacy (the bounty).** Route settlement through Unlink shielded balance. All on Arc. *Checkpoint:* explorer shows no readable amount / no traceable edge.
- **Phase 4 — FX at claim.** USDC → local stablecoin via Arc FX, keyed off region selector. *Checkpoint:* EU recipient gets EURC; US recipient gets USDC.
- **Phase 5 — Batch surface.** Paste `name, amount[, region]` rows → engine per row → one claim link each + status table. Payees isolated. *Checkpoint:* 5–25 rows → N independent links.
- **Phase 6 — ENS (optional).** Public-resolver read for `.eth` names. No ENS SDK.
- **Phase 7 — "You can't read it" view.** One-tap prove-it's-private view linking the on-chain txns.

## 5. Tech stack

- **Frontend:** Next.js (App Router) + Tailwind, mobile-first.
- **Auth + wallets + aggregation:** Dynamic SDK (React).
- **Chain:** Arc testnet (EVM); Circle primitives (USDC, EURC, Circle Wallets, CCTP/Gateway, FX).
- **AA:** ~~ERC-4337 / paymaster~~ **DROPPED** — claim is gasless via Unlink's relayer; payout is a Dynamic pregen wallet (no smart-account deploy).
- **Aggregation:** Circle CCTP (`@circle-fin/bridge-kit`) — wallet-signed burn, forwarder mint.
- **Privacy:** Unlink SDK (shielded balances on Arc testnet) — wallet-funded deposit + private transfers + relayer withdraw.
- **QR:** lightweight lib encoding the claim URL.
- **State:** stateless-by-link; minimal kv only if batch needs it.

Do not add: LI.FI, Privy, a database, a custom CREATE2 factory (unless SDKs genuinely can't), any auth besides Dynamic.

## 6. Acceptance criteria

- Judge types name + amount, taps Send, sees "Sent". ✅
- Recipient opens claim link on a fresh session and has the money — no seed phrase, no gas, no jargon. ✅
- Funds arrive as **local stablecoin** (EURC + USDC across two recipients). ✅
- Architecture view enumerates the seven steps. ✅
- Explorer view shows amount + graph unreadable. ✅
- Batch produces independent isolated claims. ✅ (cuttable)

## 7. Out of scope

Mainnet/real money/KYC/compliance; expired/double-claimed/lost links; >2 destination stablecoins; native mobile/push/recovery; real persistence/analytics/tests beyond smoke; security review of shielded/counterfactual logic.

## 8. Risks + fallbacks

- **Unlink stalls →** ship 0–2 + 4 fully; privacy behind a flag; ship shielding on whatever subset works.
- **Arc FX missing a pair →** settle USDC, hardcode one EURC recipient.
- **Counterfactual deploy-and-withdraw fails →** pre-deploy on claim; keep gasless via paymaster.
- **Paymaster broken →** funded relayer covers gas; user never sees a gas prompt.
- **Aggregation flaky →** sender already holds USDC; aggregation becomes a code-path talking point.

## 9. Walkthrough (2 minutes)

1. **It just works.** Name + amount + Send → "Sent." Second device taps link → money's there, in their currency.
2. **The reveal.** Architecture view, seven steps. Privacy was never a button.
3. **The kill-shot.** Block explorer: amount unreadable, edge untraceable — "even I, the builder, can't read this."
4. **The buyer.** Paste 20 names → 20 isolated claims in local currencies. "That's a global contractor payout."
