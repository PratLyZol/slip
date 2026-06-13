# Unlink Research — Private Payments on Circle Arc Testnet

Research date: 2026-06-12. Every fact below is labeled **VERIFIED** (with source URL) or **UNVERIFIED**.

> TL;DR: Unlink is a real, shipping privacy protocol + TypeScript SDK (`@unlink-xyz/sdk`).
> It **explicitly supports Arc testnet** (`environment: "arc-testnet"`, chain ID `5042002`),
> and the docs ship a tutorial for **Dynamic + Unlink + Circle Gateway nanopayments on Arc** —
> exactly the bounty track. Install with `npm install @unlink-xyz/sdk@canary`.

---

## 1. What Unlink is

- **VERIFIED** — Unlink ("Make Public Blockchains Private") is an SDK + smart-contract protocol that
  adds private accounts to EVM apps: users own accounts and send/receive tokens + interact with
  contracts without exposing balances or history. It settles on EVM networks teams already use
  (no separate private chain). Non-custodial by design. Source: <https://www.unlink.xyz/>
- **VERIFIED** — Website: <https://www.unlink.xyz/> · Docs: <https://docs.unlink.xyz/>
  · npm org: <https://www.npmjs.com/org/unlink-xyz> · X: @unlink_xyz · contact: hello@unlink.xyz
  · Telegram community linked from docs. Source: <https://docs.unlink.xyz/llms.txt>
- **VERIFIED** — Marketed use cases: neobank, payroll, treasury, stablecoin payments, OTC, donations,
  autonomous agents. Source: <https://www.unlink.xyz/>
- **VERIFIED** — Unlink also runs its own hackathon program (Monad track) at
  <https://hackathon.unlink.xyz/>. Source: search result, hackathon.unlink.xyz

## 2. The SDK — package, version, install

- **VERIFIED** — Package: **`@unlink-xyz/sdk`**. Registry description: "TypeScript SDK for Unlink
  account custody, private transfers, withdrawals, and engine API access." Source: npm registry
  `https://registry.npmjs.org/@unlink-xyz/sdk` (queried 2026-06-12).
- **VERIFIED** — dist-tags: `latest = 0.0.2-canary.0`, `canary = 0.3.0-canary.598` (26 versions total).
  **The actively maintained line is the `canary` tag** — the `latest` tag is a stale early stub.
  Docs/tutorials pin `@unlink-xyz/sdk@canary`. Source: same registry query.
- **VERIFIED** — Install: `npm install @unlink-xyz/sdk@canary` (also `pnpm add` / `yarn add` /
  `bun add`). Source: <https://docs.unlink.xyz/quickstart.md>
- **VERIFIED** — Subpath entry points: `@unlink-xyz/sdk/browser` (non-custodial browser client),
  `@unlink-xyz/sdk/client` (custodial server), `@unlink-xyz/sdk/admin` (backend).
  Source: <https://docs.unlink.xyz/quickstart.md>, <https://docs.unlink.xyz/llms.txt>

## 3. The actual API (function names quoted from docs)

### Account creation / key derivation — VERIFIED
Source: <https://docs.unlink.xyz/quickstart.md>, <https://docs.unlink.xyz/accounts-and-keys.md>

```ts
import { account, createUnlinkClient } from "@unlink-xyz/sdk/browser";

// Browser, non-custodial (derives identity from a wallet signature)
const { account: unlinkAccount } = await account.fromMetaMask({
  provider: window.ethereum,
  appId: "your-app-id",
  chainId: 84532,        // MUST match the target chain; wrong chainId => different account
});

// Server / custodial
import { account } from "@unlink-xyz/sdk/client";
const unlinkAccount = account.fromMnemonic({ mnemonic });
```

Five constructors exist (VERIFIED, accounts-and-keys.md):
- `fromMnemonic`, `fromSeed` — BIP-39 mnemonic / 64-byte seed; transfers + execute.
- `fromMetaMask`, `fromEthereumSignature` — derive from wallet signature (deterministic ECDSA);
  transfers + execute.
- `fromKeys` — raw keys; transfers + withdrawals only, **cannot** execute contracts.

Address format: **Bech32m, `unlink1...` prefix**, retrieved via `await client.getAddress()`.
Signature-derived identity binds `appId` + `chainId` into an HKDF-SHA256 salt over the message
`"Unlink: derive identity\nTenant: <appId>\nChain: <chainId>\nVersion: 1"`. (VERIFIED, accounts-and-keys.md)

### Client init + registration — VERIFIED (quickstart.md)
```ts
const client = createUnlinkClient({
  environment: "arc-testnet",   // or "base-sepolia", etc.
  account: unlinkAccount,
});
await client.ensureRegistered();  // call once per client before any mutating op
```
`ensureRegistered()`: browser posts a public registration payload to backend route
`/api/unlink/register` by default; server side passes a register callback typically calling
`admin.users.register(payload)`. (VERIFIED, accounts-and-keys.md)

### Deposit (shield) — VERIFIED (deposit.md, quickstart.md)
```ts
const tx = await client.depositWithApproval({
  token,                 // ERC-20 address
  amount: "1000000000000000000",  // wei string
  // optional: deadline?, nonce?, evm?, waitForApproval?
});
const confirmed = await tx.wait();   // confirmed.status: "processed" | "failed"
```
- Optional params: `deadline` (Permit2 expiry, default +1h), `nonce`, `evm` (alt provider),
  `waitForApproval`.
- Lower-level `client.deposit({ token, amount })` when approval is pre-arranged.
- Helpers: `ensureErc20Approval()`, `getApprovalState()` → `{ isApproved }`,
  `buildApprovalTx()` → `{ to, data, value? }`.
- Returns a `TransactionHandle` (`.wait()`).

### Private transfer — VERIFIED (transfer.md, quickstart.md)
```ts
// single recipient
const tx = await client.transfer({
  recipientAddress: "unlink1recipient...",  // an unlink1 address
  token,
  amount: "250000000000000000",
});

// batch
await client.transfer({
  token,
  transfers: [{ recipientAddress: "unlink1...", amount: "..." }, /* ... */],
});
```
Signs with the spending key of the account bound to `createUnlinkClient`. Returns `TransactionHandle`.

### Withdraw (unshield to public EOA) — VERIFIED (withdraw.md)
```ts
const tx = await client.withdraw({
  recipientEvmAddress: "0xRecipient",  // public destination EOA
  token,
  amount: "500000000000000000",
});
const confirmed = await tx.wait();
```
Docs note: "The destination address and amount are public, but the source private account is not."

### Other — VERIFIED
- `client.getBalances()` → `{ balances }` (quickstart.md).
- `client.execute(...)` — interact with smart contracts using private funds (how-unlink-works.md).
- Admin: `createUnlinkAdmin()`, `admin.users.register()`, `admin.authorizationTokens.issue()`
  (quickstart.md / llms.txt).
- EVM provider helper: `evm.fromEip1193({ provider: window.ethereum })` (quickstart.md).

## 4. Arc testnet support — YES, VERIFIED

Source: <https://docs.unlink.xyz/supported-chains.md>

| environment string | network | chain ID |
|---|---|---|
| **`arc-testnet`** | **Arc Testnet** | **5042002** |
| `base-sepolia` | Base Sepolia | 84532 |
| `ethereum-sepolia` | Ethereum Sepolia | 11155111 |
| `monad-testnet` | Monad Testnet | 10143 |

- **VERIFIED** — Arc testnet uses **USDC as its native gas token**, funded via the Circle faucet
  <https://faucet.circle.com/>. Source: supported-chains.md.
- **UNVERIFIED** — Specific Unlink **contract addresses on Arc** are not published in the public
  docs pages fetched. Docs describe a single on-chain verifier contract per network but do not list
  the deployed address. (The SDK resolves contracts internally from the `environment` string.)
  Action: read it at runtime from the SDK or ask Unlink for the arc-testnet deployment address.

## 5. On-chain privacy guarantee — VERIFIED

Source: <https://docs.unlink.xyz/how-unlink-works.md>, <https://www.unlink.xyz/>

- Mechanism: **encrypted UTXO notes** + **Groth16 zero-knowledge proofs**, generated client-side
  by the SDK; the on-chain contract only verifies proof validity, "without learning the sender,
  recipient, or amount." A relayer submits private ops. No bridge/sidechain — a single contract on
  the chain itself.
- **Private transfer (`unlink1` → `unlink1`): nothing about the tx is visible on-chain** — sender,
  recipient, amount, and token are all concealed. This is the strongest guarantee.
- **Deposit (shield): the funding source + amount ARE public** (you publicly send ERC-20 in).
- **Withdraw (unshield): the destination address + amount ARE public**, but the source private
  account is NOT linkable.
- Implication for design: deposit and withdraw are the public "edges." Privacy hygiene from the
  partner tutorial (VERIFIED, partner-integrations.md): avoid same-size deposit+withdraw in one flow;
  keep a larger balance in the private pool; optionally do an internal private transfer; withdraw
  smaller payer amounts later to an EOA that is unlinkable from the funding wallet.

## 6. ETHGlobal bounty: Dynamic + Unlink + Arc track

- **VERIFIED** — Event: **ETHGlobal Cannes 2026** (Apr 3–5, 2026, France). Sources:
  <https://ethglobal.com/events/cannes2026>, <https://events.coinpedia.org/ethglobal-cannes-2026-7996/>
- **VERIFIED** — There is a combined **Dynamic + Unlink** prize to "build an app that combines both
  platforms to enable **private nanopayments on Arc testnet**," with stated amounts ~$2,000 and
  $1,000. Standalone pools mentioned: Unlink $5,000, Dynamic $5,000, Arc $12,000. Source: web search
  result (ethglobal.com/events/cannes2026 prize pages). *(Exact line-item splits should be
  re-confirmed on the live Unlink prize page; the JS-rendered ethglobal pages were not fully
  fetchable.)*
- **VERIFIED** — The Arc prize track page (<https://ethglobal.com/events/cannes2026/prizes/arc>)
  lists $15,000 across 4 categories incl. **"Best Agentic Economy with Nanopayments" ($3,750)** —
  the natural fit for an Unlink + Dynamic private-nanopayments build. The Arc page itself does not
  name Unlink/Dynamic; that combined bounty lives on the Unlink/Dynamic prize pages.
- **VERIFIED** — Unlink's own docs ship the matching reference tutorial:
  **"Private nanopayments — Dynamic sign-in + x402 resources + Circle Gateway on Arc Testnet."**
  Sources: <https://docs.unlink.xyz/llms.txt>, <https://docs.unlink.xyz/partner-integrations.md>
- **VERIFIED** — Prior art: ETHGlobal Cannes project **SubLink** (private subscriptions) is built on
  Unlink Protocol using `@unlink-xyz/sdk`. Sources: <https://ethglobal.com/showcase/sublink-xhemc>,
  <https://github.com/chebykin/SubLink>

### Reference tutorial shape (VERIFIED, partner-integrations.md)
- Dynamic handles sign-in/wallet; the **Dynamic user ID (JWT `sub`)** becomes the Unlink user ID.
- Recover-or-create the encrypted recovery envelope, create the client, and `ensureRegistered()`
  the private account on **`arc-testnet`**.
- Fund the private account with **Arc testnet USDC** from the Circle faucet.
- Optionally do internal private transfers to strengthen unlinkability, then `withdraw()` to a plain
  EOA.
- **Circle Gateway** executes **x402** nanopayments using the withdrawn USDC. The **Gateway payer
  must be a plain EOA** — NOT an Unlink execution/smart account.
- Extra dependency named: **`@circle-fin/x402-batching`** (alongside `@unlink-xyz/sdk@canary`).

---

## Open items / things to confirm at build time
- **UNVERIFIED** — Exact Unlink contract address(es) deployed on `arc-testnet` (not in public docs).
- **UNVERIFIED** — Exact ETHGlobal Cannes Unlink/Dynamic prize line-item amounts (JS-rendered page
  not fully fetchable; cross-checked only via search snippet).
- **VERIFIED-but-watch** — SDK is pre-1.0 and ships on the `canary` tag (`0.3.0-canary.598`); the
  `latest` npm tag (`0.0.2-canary.0`) is stale — always pin `@canary`.
- Browser non-custodial flow expects a backend `/api/unlink/register` route; budget for a small
  backend (the SubLink reference used Bun + Hono).
