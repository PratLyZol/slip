# Arc Testnet Research (Circle's L1)

Research date: 2026-06-12. Arc is Circle's open Layer-1 blockchain, purpose-built
for stablecoin finance, with USDC as the native gas token. As of this date Arc is
**testnet only**; mainnet is planned for 2026.

> Note on domains: `docs.arc.network` 301-redirects to `docs.arc.io`. Both are the
> official Circle/Arc documentation host. Do not confuse with unrelated projects.
> Each fact below is labeled VERIFIED (confirmed against an official Circle/Arc
> source) or UNVERIFIED/ASSUMED, with the source URL.

---

## 1. Chain ID & RPC URLs

- **Chain ID: `5042002` (hex `0x4CEF52`)** — **VERIFIED**
  - Source: https://docs.arc.io/arc/references/connect-to-arc and
    https://github.com/circlefin/skills/blob/master/plugins/circle/skills/use-arc/SKILL.md
  - Caveat: one fetch of the connect-to-arc page rendered the hex as `0x4CF152`,
    but `5042002` decimal = `0x4CEF52`. **Trust the decimal `5042002`** and
    derive hex yourself; `0x4CF152` appears to be a transcription artifact.

- **Network name: `Arc Testnet`** — VERIFIED (connect-to-arc).
- **Native currency: USDC** — VERIFIED.

- **RPC URLs** — **VERIFIED** (https://docs.arc.io/arc/references/connect-to-arc):
  - Primary: `https://rpc.testnet.arc.network`
  - Blockdaemon: `https://rpc.blockdaemon.testnet.arc.network`
  - dRPC: `https://rpc.drpc.testnet.arc.network`
  - QuickNode: `https://rpc.quicknode.testnet.arc.network`

- **WebSocket URLs** — VERIFIED (same source):
  - Primary: `wss://rpc.testnet.arc.network`
  - Blockdaemon: `wss://rpc.blockdaemon.testnet.arc.network:443/websocket`
  - dRPC / QuickNode: `wss://rpc.drpc.testnet.arc.network`, `wss://rpc.quicknode.testnet.arc.network`

- **CCTP Domain: `26`** — VERIFIED (circlefin/skills SKILL.md + contract-addresses page).

---

## 2. Block Explorer

- **ArcScan: `https://testnet.arcscan.app`** — **VERIFIED**
  - Source: https://docs.arc.io/ and https://docs.arc.io/arc/references/connect-to-arc

---

## 3. Token Contract Addresses (Arc Testnet)

Source for all below: https://docs.arc.io/arc/references/contract-addresses — **VERIFIED**

- **USDC: `0x3600000000000000000000000000000000000000`** — VERIFIED.
  - This is the native gas token's *optional ERC-20 interface* (a system/precompile
    style address). ERC-20 USDC uses **6 decimals**.
- **EURC: `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a`** (6 decimals) — VERIFIED.
  EURC exists on Arc testnet.
- **USYC (yield token): `0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C`** — VERIFIED.
  - USYC Entitlements: `0xcc205224862c7641930c87679e98999d23c26113`
  - USYC Teller: `0x9fdF14c5B14173D74C08Af27AebFf39240dC105A`

Other useful infra contracts (VERIFIED, same page):
- CCTP v2 TokenMessengerV2: `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA`
- CCTP v2 MessageTransmitterV2: `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275`
- CCTP v2 TokenMinterV2: `0xb43db544E2c27092c107639Ad201b3dEfAbcF192`
- CCTP v2 MessageV2: `0xbaC0179bB358A8936169a63408C8481D582390C4`
- GatewayWallet: `0x0077777d7EBA4688BDeF3E311b846F25870A19B9`
- GatewayMinter: `0x0022222ABE238Cc2C7Bb1f21003F0a260052475B`
- CREATE2 Factory: `0x4e59b44847b379578588920cA78FbF26c0B4956C`
- Multicall3: `0xcA11bde05977b3631167028862bE2a173976CA11`
- Permit2: `0x000000000022D473030F116dDEE9F6B43aC78BA3`

---

## 4. Faucet

- **Circle Faucet: `https://faucet.circle.com`** (select Arc Testnet) — **VERIFIED**
  - Source: https://docs.arc.io/ and https://docs.arc.io/arc/references/connect-to-arc
- **Dispenses USDC** (used as gas on Arc) and **EURC** (select Arc Testnet as the
  network and the desired token) — VERIFIED.
  - Source: https://developers.circle.com/stablefx (notes testnet EURC via Circle Faucet)
    and multiple Arc guides. Because USDC is the gas token, USDC from the faucet
    is what funds transactions.

---

## 5. Native FX / Stablecoin Swap (StableFX)

- **Arc has a built-in FX capability: "Circle StableFX"** — **VERIFIED**
  - Sources: https://developers.circle.com/stablefx ,
    https://www.circle.com/blog/introducing-circle-stablefx-and-circle-partner-stablecoins
- **What it is:** an institutional-grade stablecoin FX engine combining
  **RFQ (Request-for-Quote)** off-chain execution with **on-chain PvP settlement**
  on Arc. Supports USDC<->EURC (expanding to more local-stablecoin pairs). — VERIFIED.
- **On-chain settlement contract — FxEscrow (StableFX): `0x867650F5eAe8df91445971f14d89fd84F0C9a9f8`**
  — **VERIFIED** (https://docs.arc.io/arc/references/contract-addresses, under
  "Payments & Settlement").
- **How it is invoked:** Primarily via the **StableFX API/SDK**, NOT by calling the
  contract directly. Circle's docs state "The StableFX API handles both off-chain
  and on-chain steps, so you don't need to interact with smart contracts directly."
  Flow: (1) request quote via API for a pair+amount; LPs compete, (2) accept quote /
  execute off-chain, (3) automatic on-chain PvP settlement via FxEscrow on Arc. — VERIFIED.
  - Source: https://developers.circle.com/stablefx
- **Access caveat — IMPORTANT for hackathon:** StableFX is live on Arc testnet but
  **requires a StableFX API key obtained by contacting a Circle representative**
  ("Reach out to your Circle representative to get an API key for StableFX"). It is
  **not a self-serve, permissionless on-chain swap**. — VERIFIED (developers.circle.com/stablefx).
  - Implication: you cannot necessarily just call FxEscrow on-chain like a Uniswap
    pool without going through the RFQ/API and having LP liquidity + access.

---

## 6. ERC-4337 / Account Abstraction

- **Arc supports ERC-4337** — **VERIFIED**
  - Source: https://docs.arc.io/arc/tools/account-abstraction — quote: "Arc supports
    the ERC-4337 standard, so you can use any compatible bundler, paymaster, or SDK
    from the providers below."
- **EntryPoint address / version: NOT PUBLISHED in Arc docs** — **UNVERIFIED**
  - The contract-addresses page and AA page do **not** list a canonical EntryPoint
    address or version (v0.6/0.7/0.8). Do NOT invent one. Because Arc supports the
    standard ERC-4337 stack via third-party providers, the canonical EntryPoint is
    expected to be present, but its address/version is **not officially documented**;
    obtain it from your chosen provider (e.g., Pimlico/ZeroDev) at integration time.
- **AA / paymaster / bundler providers on Arc** — **VERIFIED**
  (https://docs.arc.io/arc/tools/account-abstraction): Biconomy, Blockradar,
  Circle Wallets, Crossmint, Dynamic, Para, Pimlico, Privy, Thirdweb, Turnkey, ZeroDev.
  - Press release also names Pimlico and ZeroDev as launch partners:
    https://www.circle.com/pressroom/circle-launches-arc-public-testnet
- **EIP-7702: likely supported, but UNVERIFIED from official docs.** Third-party
  blog (arc.io blog) claims "ERC-4337 & EIP-7702 native support"; the official
  gas-and-fees and AA docs pages I read did not explicitly confirm EIP-7702.
  Treat as UNVERIFIED until confirmed on an official page.
- **Circle Paymaster:** Circle offers an ERC-4337 paymaster product that lets users
  pay gas in USDC on other EVM chains. On Arc, USDC is *already* the native gas
  token, so a USDC paymaster is less needed; the paymaster concept on Arc would be
  for sponsoring gas or paying in tokens other than USDC. — partially VERIFIED
  (concept), provider-specific details UNVERIFIED.

---

## 7. How Gas Works on Arc

Source: https://docs.arc.io/arc/references/gas-and-fees — **VERIFIED**

- **USDC is the native gas token.** Fees are USD-denominated and predictable. — VERIFIED.
- **Decimals — dual representation (IMPORTANT):** — VERIFIED.
  - **Native gas accounting uses 18 decimals** (like ETH/wei on other EVM chains).
  - **The ERC-20 USDC interface uses 6 decimals.**
  - Same underlying balance, two representations — they are NOT separate tokens.
    Some wallets may even display the balance labeled "ETH" though it is USDC.
  - WARNING: A few third-party blogs incorrectly state native gas is "6 decimals."
    The official docs say 18-decimal precision for gas accounting / 6 for ERC-20.
- **Fee market: EIP-1559 + EWMA smoothing.** Base fee adjusts via an exponentially
  weighted moving average of recent block utilization (bounded), so short spikes
  don't cause sudden fee jumps. — VERIFIED.
- **Minimum base fee (testnet): 20 Gwei.** Target ~$0.01 per transaction.
  Max base fee ~`1e-3 USDC` per gas unit. Throughput target ~20M gas/sec. — VERIFIED.
  - Note: an arc.io blog cited "160 Gwei minimum"; the official gas-and-fees page
    says **20 Gwei**. Trust the official **20 Gwei**, and recommend setting
    `maxFeePerGas >= 20 Gwei`.

---

## 8. Circle Wallets / Circle SDK Support

- **Circle Programmable Wallets support Arc Testnet** — **VERIFIED**
  - Developer-Controlled Wallets, User-Controlled Wallets, and Modular Wallets are
    available; the blockchain identifier is **`ARC-TESTNET`**.
  - Sources: https://developers.circle.com/wallets/dev-controlled/create-your-first-wallet
    (uses `ARC-TESTNET` in examples) and
    https://www.circle.com/pressroom/circle-launches-arc-public-testnet
- **Circle Node.js SDK** can create wallets programmatically on Arc and is the
  recommended path for StableFX integration. — VERIFIED (developers.circle.com/stablefx).
- **Circle "App Kit"** wraps CCTP and provides Bridge, Swap, Send, and Unified
  Balance capabilities. — VERIFIED (docs.arc.io/llms.txt).
- **Circle Skills** (agent/dev skills) include a `use-arc` skill:
  https://github.com/circlefin/skills/blob/master/plugins/circle/skills/use-arc/SKILL.md — VERIFIED.

---

## Quick-reference summary (all VERIFIED unless noted)

| Item | Value |
|---|---|
| Chain ID | `5042002` (decimal; trust this over rendered hex) |
| RPC | `https://rpc.testnet.arc.network` |
| WS | `wss://rpc.testnet.arc.network` |
| Explorer | `https://testnet.arcscan.app` |
| Faucet | `https://faucet.circle.com` (USDC + EURC, Arc Testnet) |
| USDC (ERC-20 iface) | `0x3600000000000000000000000000000000000000` (6 dec) |
| EURC | `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a` (6 dec) |
| StableFX FxEscrow | `0x867650F5eAe8df91445971f14d89fd84F0C9a9f8` (API-gated) |
| Gas token | USDC (native 18 dec / ERC-20 6 dec) |
| Min base fee | 20 Gwei (testnet), ~$0.01/tx |
| ERC-4337 | Supported; EntryPoint address NOT published (use provider) |
| EIP-7702 | Likely (UNVERIFIED in official docs) |
| Circle Wallets | Supported, id `ARC-TESTNET` |
| CCTP domain | 26 |

## Sources
- https://docs.arc.io/ (== docs.arc.network)
- https://docs.arc.io/arc/references/connect-to-arc
- https://docs.arc.io/arc/references/contract-addresses
- https://docs.arc.io/arc/references/gas-and-fees
- https://docs.arc.io/arc/tools/account-abstraction
- https://docs.arc.io/llms.txt
- https://developers.circle.com/stablefx
- https://developers.circle.com/wallets/dev-controlled/create-your-first-wallet
- https://www.circle.com/pressroom/circle-launches-arc-public-testnet
- https://www.circle.com/blog/introducing-circle-stablefx-and-circle-partner-stablecoins
- https://github.com/circlefin/skills/blob/master/plugins/circle/skills/use-arc/SKILL.md
