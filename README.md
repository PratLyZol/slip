# Slip

**Pay anyone, anywhere, in their own money. Private by default.**

Type someone's email or phone and an amount. They tap a link, log in with a one-time code,
and the money is there — having never made a wallet, held gas, or learned what a chain is.
In a batch, the amounts and the payer↔payee graph are unreadable on-chain.

> ETHGlobal New York 2026 · Arc testnet · Dynamic + Unlink + Arc (Circle)

---

## What Slip is

Two surfaces, **one engine**, split into two independently-retriable legs:

- **Send** (consumer) — add a recipient (email/phone) + amount, **Bridge** your USDC onto
  Arc, then **Send**. A claim link + QR is generated (and emailed if you used an email).
- **Batch** (B2B) — many recipients in one shielded run. Payees can't see each other and
  the treasury isn't doxxed — N unlinkable payouts from one public deposit.

The recipient opens the link on a fresh device, logs in with an OTP, and withdraws to a
wallet they now own — no seed phrase, no gas, no jargon.

## How a send actually works

The two-step `/send` screen maps onto the two engine legs:

**① Bridge to Arc** (`runBridge`)
1. **Resolve** each recipient → a Dynamic **pregen** payout address (email/phone), or an ENS read for `.eth`.
2. **Aggregate** via real Circle **CCTP**: the connected wallet burns Σ(amounts) USDC on its origin chain (Base Sepolia, etc.) and Circle's forwarder mints Σ on Arc.

**② Distribute** (`runDistribute`, all on Arc)
3. **Shield** Σ once into the sender's Unlink shielded balance — a wallet-funded `depositWithApproval`. This is the single public deposit edge the whole batch shares.
4. **Private fan-out** — N sequential Unlink `transfer()`s from the shielded balance to each recipient's claim account (each registered first). The amount and the sender→recipient edge vanish on-chain.
5. **Claim links** — one `/claim#<base64url(payload)>` per recipient; the secret rides the URL fragment.

**Claim** (recipient's browser)
6. OTP login (Dynamic) binds their pregen wallet; Unlink's relayer submits the **withdraw** to that address — recipient pays no gas.
7. **Local stablecoin** at claim — USDC for everyone today (EU→EURC is attempted via Circle Swap Kit but there is no USDC↔EURC route on Arc testnet, so it honestly delivers USDC; no fabricated rate).

The kill-shot is **/private**: a real batch on the block explorer with the amounts and the
graph unreadable. **/architecture** narrates the flow.

## Sponsor integrations

| Sponsor          | What it powers in Slip                                                              |
| ---------------- | ---------------------------------------------------------------------------------- |
| **Dynamic**      | Email/OTP login, embedded wallets, **pregenerated** recipient wallets (walletless). |
| **Unlink**       | The shielded balance — the private deposit + transfers with no readable amount or edge. |
| **Arc / Circle** | The chain, USDC + EURC, **CCTP** aggregation, and (optional) **Swap Kit** at claim. |
| **ENS** (read)   | A plain public-resolver read for `.eth` names — not a sponsor SDK.                  |

Three sponsor SDKs, max — no LI.FI, no Privy, no ENS SDK, no database.

## Run it

Slip runs against **real testnet integrations** only — there is no simulation mode. Missing a
key means that leg throws an honest error, not a fake success.

```bash
npm install
npm run dev          # http://localhost:3000
```

### Configuration

Copy `.env.example` to `.env.local` and fill in keys:

- `NEXT_PUBLIC_DYNAMIC_ENV_ID` — Dynamic wallet provider (client).
- `DYNAMIC_API_TOKEN` — server-side pregen wallet creation (`waas/create`).
- `UNLINK_API_KEY` — server-only admin key for the Unlink register/authorization routes.
- `RESEND_API_KEY` + `EMAIL_FROM` — claim-link email (`EMAIL_FROM` must be an address on a
  domain you've verified in Resend; the sandbox `onboarding@resend.dev` only delivers to your
  own account email).
- `CIRCLE_KIT_KEY` — *optional* Circle Swap Kit for a real USDC→EURC swap at claim.

The sender also needs **origin-chain gas** (e.g. Base Sepolia ETH) to sign the CCTP burn, plus
USDC to send (`faucet.circle.com`). Recipients need nothing — pregen + relayer cover them.

## What's real

Slip is a proof of concept, not a protocol — but the money path is real end-to-end. There is
**no simulation/demo fallback**; a failure surfaces as a visible error.

| Piece                       | Status                                                                                          |
| --------------------------- | ----------------------------------------------------------------------------------------------- |
| CCTP aggregation            | **Real** — `@circle-fin/bridge-kit`, wallet-signed burn on the origin chain, forwarder mint on Arc. |
| Unlink shielded path        | **Real** — `@unlink-xyz/sdk/browser` against `arc-testnet`: wallet-funded `depositWithApproval` shield, N private `transfer`s, relayer `withdraw`. |
| Recipient identity / claim  | **Real** — Dynamic pregen wallet; OTP login binds it; Unlink relayer withdraws to it (gasless). |
| Claim links (stateless)     | **Real** — `/claim#<base64url(payload)>`; the secret rides the URL fragment, never a server.    |
| ENS resolution (`.eth`)     | **Real** — viem public-resolver read, with a graceful error on RPC failure.                     |
| Local currency at claim     | **Real, USDC today** — EU→EURC attempts Circle Swap Kit; no route on Arc testnet → honest USDC delivery. No fabricated FX. |
| Multi-chain balances        | **Real** — USDC read across Base Sepolia + Arc (viem) on Home + Settings.                        |
| Claim-link email            | **Real** — Resend (requires a verified `EMAIL_FROM` domain to reach arbitrary recipients).       |
| Batch payout                | **Real** — engine fan-out, isolated per-recipient claim links. State is React + localStorage, no DB. |

## Out of scope

Mainnet / real money / KYC / compliance; expired or double-claimed links (per-browser only);
>2 destination stablecoins; native mobile / push / recovery; real persistence / analytics / a
security review of the shielded logic. See `docs/PRD.md` §7.
