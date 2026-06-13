# Slip

**Pay anyone, anywhere, in their own money. Private by default. From anything, to anything.**

Type a name and an amount. The recipient taps a link and has money in their local
stablecoin — having never made a wallet, held gas, or learned what a chain is. The
amount and the social graph are invisible on-chain by default.

> ETHGlobal New York 2026 · Arc testnet · Dynamic + Unlink + Arc (Circle)

---

## What Slip is

Two surfaces, **one engine**:

- **Send** (consumer) — type `alice`, enter `$50`, tap Send. "Sent $50 to alice." A
  claim link + QR is generated.
- **Batch** (B2B) — paste a list of names + amounts, hit Pay. Each row runs the same
  engine. Payees can't see each other; the treasury isn't doxxed. Export a CSV of
  claim links — that's a global contractor payout.

The recipient opens the link on a fresh device and the money is there, in their
currency — no seed phrase, no gas, no jargon.

## The seven steps of a send

1. **Resolve** the recipient name → identity/address (real ENS read for `.eth`).
2. **Aggregate** the sender's holdings → USDC (Dynamic chain abstraction).
3. **Derive** the recipient's counterfactual account from a per-claim secret (the
   link's secret is the CREATE2 salt).
4. **Shield** the transfer through an Unlink shielded balance — the amount and the
   sender→recipient edge vanish on-chain.
5. **Settle** the value into the claim's shielded balance (no public transfer to the
   claim account ever happens).
6. **Sponsor gas** via a paymaster — neither party touches a gas token.
7. **Claim** — tapping the link deploys the account, withdraws, and **FX's USDC into
   the recipient's local stablecoin** (EURC in the EU, USDC elsewhere) at claim time.

See it live at **/architecture**. The kill-shot is **/private**: a real send shown
on the block explorer with the amount and the graph unreadable — "even the builder
can't read this."

## Sponsor integrations

| Sponsor          | What it powers in Slip                                                        |
| ---------------- | ---------------------------------------------------------------------------- |
| **Dynamic**      | Email login, embedded smart wallets, asset aggregation, gas sponsorship.     |
| **Unlink**       | The shielded balance — the private transfer with no readable amount or edge. |
| **Arc / Circle** | The chain, USDC + EURC, and StableFX for FX-at-claim.                         |
| **ENS** (read)   | A plain public-resolver read for `.eth` names — not a sponsor SDK.           |

Three sponsor SDKs, max — no LI.FI, no Privy, no ENS SDK, no database.

## Run it

Works **credential-free in demo mode** — zero keys required.

```bash
npm install
npm run dev          # http://localhost:3000
```

Headless engine smoke test (send → claim → FX → batch → ENS):

```bash
npm run smoke
```

### Real mode (optional)

Copy `.env.example` to `.env.local` and fill in keys. With **none** set, the app runs
fully in deterministic demo mode. Real adapters activate when their keys are present:

- `NEXT_PUBLIC_DYNAMIC_ENV_ID` — turns on the real Dynamic wallet provider (and turns
  demo mode off unless `NEXT_PUBLIC_DEMO_MODE=true`).
- `UNLINK_API_KEY` — server-only admin key for the real Unlink shielded path.

The privacy guarantee and the seven-step shape are identical in demo and real mode.

## What's real vs simulated

Honest accounting — Slip is a proof of concept, not a protocol.

| Piece                        | Status                                                                                                                 |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Seven-step engine            | **Real** — runs end-to-end; deterministic simulation when no chain creds.                                              |
| Claim links (stateless)      | **Real** — `/claim#<base64url(payload)>`; the secret rides the URL fragment, never a server.                          |
| ENS resolution (`.eth`)      | **Real** — viem public-resolver read on Ethereum mainnet, with graceful fallback to a demo address on RPC failure.    |
| Unlink shielded path         | **Wired + degradable** — real `@unlink-xyz/sdk/client` against `arc-testnet` behind a server-only key; demo simulates the shield/transfer/unshield legs deterministically. |
| Arc StableFX (USDC→EURC)     | **Stubbed pending a Circle key** — StableFX is not permissionless; demo simulates the RFQ quote + settle at a realistic EUR/USD rate. |
| Paymaster / gas sponsorship  | **Simulated** — no canonical ERC-4337 EntryPoint is published on Arc; per PRD §8 a funded relayer would cover gas. Labeled honestly.    |
| Counterfactual account       | **Real derivation** — secret → deterministic account address (viem). A true 4337 CREATE2 `initCode` is a drop-in later. |
| Batch payout                 | **Real** — engine per row, independent isolated claim links, client-side CSV export. State is React + localStorage, no DB. |

Simulated transactions use real Arc-style hashes pointing at the real ArcScan host —
they will **404** on the live explorer. The `/private` view labels this explicitly.

## Demo script (2 min)

1. **It just works.** Name + amount + Send → "Sent." Second device taps the link →
   money's there, in their currency.
2. **The reveal.** `/architecture` — seven steps. Privacy was never a button.
3. **The kill-shot.** `/private` — block explorer: amount unreadable, edge
   untraceable. "Even I, the builder, can't read this."
4. **The buyer.** `/batch` — paste a list → N isolated claims in local currencies,
   download the links CSV. "That's a global contractor payout."

## Out of scope

Mainnet / real money / KYC / compliance; expired or double-claimed links
(per-browser only); >2 destination stablecoins; native mobile / push / recovery;
real persistence / analytics / a security review of the shielded + counterfactual
logic. See `docs/PRD.md` §7.
