# PRD — "Slip"

**Pay anyone, anywhere, in their own money. Private by default. From anything, to anything.**

> One-liner: build a payments app where the sender types a name and an amount, and the recipient taps a link and has money in their local stablecoin — having never made a wallet, held gas, or learned what a chain is. The amount and the social graph are invisible on-chain by default.

---

## 0. Context

- **Event:** ETHGlobal New York 2026, 36-hour hackathon, Arc testnet. This is a **proof of concept**, not a protocol. Demo quality > completeness.
- **Hard rule — 3 sponsor SDKs maximum per project.** Ours: **Dynamic + Unlink + Arc (Circle)**. No LI.FI, no Privy, no fourth sponsor SDK. ENS is used only as a plain public-resolver *read* (name → address), not an SDK integration.
- **This stack is a funded bounty.** Dynamic's NYC prize page has a track for combining **Dynamic + Unlink for private payments on Arc testnet**.
- **Everything is on Arc testnet.** Unlink shielding and Arc FX both live on Arc; no public bridge hop between the private leg and the FX leg. Never bridge shielded funds across a public hop.
- **Get the real APIs, don't guess.** If a real sponsor API is unavailable, stub it behind a clearly-named interface and flag it — never hallucinate signatures.

## 1. Product summary

Two surfaces, **one engine**: *resolve recipient → aggregate sender's assets to USDC → settle to a counterfactual account through a shielded balance → recipient claims walletlessly, gas sponsored, FX'd into their local stablecoin at claim time.*

- **Surface A — Single send (consumer):** type `alice`, enter `$50`, tap Send. "Sent $50 to alice." Claim link / QR generated.
- **Surface B — Batch payout (B2B):** paste a list of names, hit Pay. Each row runs the same engine. Payees can't see each other; the treasury isn't doxxed.

Build A's engine completely before touching B.

## 2. The seven steps of a send

1. **Resolve** recipient name (ENS/username) → identity/address.
2. **Aggregate** sender's holdings → USDC (Dynamic chain abstraction).
3. **Derive** the recipient's **counterfactual account address** (CREATE2 / ERC-4337 `initCode`), salt derived from a per-claim secret.
4. **Shield** the transfer through an **Unlink** balance — amount and sender↔recipient link not visible on-chain.
5. **Settle** USDC to the counterfactual address (account not yet deployed).
6. **Sponsor gas** via paymaster — neither party needs the native token.
7. **Claim:** link/QR → first transaction **deploys the account and withdraws in one batched UserOp** → **Arc FX** converts USDC → recipient's **local stablecoin** (EURC in EU, USDC elsewhere) at claim time.

Demo kill-shot: judge does step 1 and gets a result; reveal steps 2–7; open the block explorer and show **even the builder can't read the amount or the graph.**

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
- **AA:** ERC-4337 smart accounts, counterfactual deploy (`initCode` + paymaster). Use Dynamic/Circle-native before custom factories.
- **Privacy:** Unlink SDK (shielded balances on Arc testnet).
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

- **Unlink stalls →** ship 0–2 + 4 fully; privacy behind a flag; demo shielding on whatever subset works.
- **Arc FX missing a pair →** settle USDC, hardcode one EURC recipient.
- **Counterfactual deploy-and-withdraw fails →** pre-deploy on claim; keep gasless via paymaster.
- **Paymaster broken →** funded relayer covers gas; user never sees a gas prompt.
- **Aggregation flaky →** sender already holds USDC; aggregation becomes a code-path talking point.

## 9. Demo script (2 minutes)

1. **It just works.** Name + amount + Send → "Sent." Second device taps link → money's there, in their currency.
2. **The reveal.** Architecture view, seven steps. Privacy was never a button.
3. **The kill-shot.** Block explorer: amount unreadable, edge untraceable — "even I, the builder, can't read this."
4. **The buyer.** Paste 20 names → 20 isolated claims in local currencies. "That's a global contractor payout."
