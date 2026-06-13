# Dynamic (dynamic.xyz) SDK Research

Research date: 2026-06-12. Context: Next.js App Router hackathon project (ETHGlobal NY 2026), target chain "Arc testnet" (custom EVM).

Every fact below is labeled **VERIFIED** (confirmed against a primary source — npm registry, docs page, or GitHub API) or **UNVERIFIED** (inferred / from secondary sources / could not directly load the page). Do not treat UNVERIFIED items as ground truth without checking the cited URL.

---

## 1. Packages, versions & Next.js App Router setup

### Package versions (VERIFIED via `npm view`, 2026-06-12)
All core `@dynamic-labs/*` packages are versioned in lockstep. Current latest: **`4.88.5`** (published 2026-06-12).

| Package | Version | Purpose |
|---|---|---|
| `@dynamic-labs/sdk-react-core` | 4.88.5 | Core React SDK (provider, widget, hooks) |
| `@dynamic-labs/ethereum` | 4.88.5 | EVM wallet connectors (`EthereumWalletConnectors`) |
| `@dynamic-labs/ethereum-aa` | 4.88.5 | Account-abstraction connectors (`ZeroDevSmartWalletConnectors`) |
| `@dynamic-labs/wagmi-connector` | 4.88.5 | wagmi bridge |
| `@dynamic-labs/solana` | 4.88.5 | SVM connectors |
| `@dynamic-labs/embedded-wallet-evm` | 4.88.5 | EVM embedded wallet support |
| `@dynamic-labs/global-wallet-client` | 4.88.5 | Global wallet client |
| `@dynamic-labs/ethers-v5` | 2.6.2 | ethers v5 helpers (separate version track) |
| `@dynamic-labs/ethers-v6` | 4.88.5 | ethers v6 helpers |

> NOTE: There is ALSO a newer, separately-scoped SDK line `@dynamic-labs-sdk/*` (e.g. `@dynamic-labs-sdk/client`, `@dynamic-labs-sdk/evm`, `@dynamic-labs-sdk/zerodev`), all at **`1.8.2`** (published 2026-06-10). This appears to be a next-gen / framework-agnostic client SDK distinct from the React `@dynamic-labs/*` line. **UNVERIFIED** which one the docs currently steer you toward; for React App Router the `@dynamic-labs/*` 4.88.x line is the documented one. Source: npm registry search (`npm search @dynamic-labs-sdk`).

- peerDependencies of `sdk-react-core` (VERIFIED): `react >=18 <20`, `react-dom >=18 <20`. So React 18 or 19 are both supported.

### Next.js App Router setup (VERIFIED pattern; secondary sources + npm page)
Source: https://www.npmjs.com/package/@dynamic-labs/sdk-react-core , https://developers.circle.com/wallets/modular/dynamic-integration

The provider must be a **client component** (`"use client"`). Create a wrapper, e.g. `app/providers.tsx`:

```tsx
"use client";

import {
  DynamicContextProvider,
  DynamicWidget,
} from "@dynamic-labs/sdk-react-core";
import { EthereumWalletConnectors } from "@dynamic-labs/ethereum";

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <DynamicContextProvider
      settings={{
        environmentId: process.env.NEXT_PUBLIC_DYNAMIC_ENV_ID!,
        walletConnectors: [EthereumWalletConnectors],
      }}
    >
      <DynamicWidget />
      {children}
    </DynamicContextProvider>
  );
}
```

Then import `Providers` into the root `app/layout.tsx` and wrap `{children}`.

**SSR caveats (UNVERIFIED in exact wording — could not load docs SSR page; standard Dynamic guidance):**
- The provider and any component using Dynamic hooks (`useDynamicContext`, etc.) must be client components (`"use client"`), because Dynamic relies on browser APIs (localStorage, window).
- `environmentId` is a public, client-side value — fine to expose via `NEXT_PUBLIC_`.
- Confirm against the official "Framework guides / Next.js" doc before finalizing: https://docs.dynamic.xyz (redirects to https://www.dynamic.xyz/docs).

> Docs hosting note: `docs.dynamic.xyz` 301-redirects to `www.dynamic.xyz/docs`. WebFetch was blocked (403/404) on most docs pages during research, so several doc-sourced facts below are corroborated via secondary pages (Circle tutorial, search snippets) rather than a direct fetch. The Dynamic **docs MCP** (`https://www.dynamic.xyz/docs/mcp`, see §6) is the reliable way to pull exact current docs into an agent.

---

## 2. Adding a custom EVM network (for Arc testnet)

**VERIFIED** config shape (full working example from Circle's Dynamic integration tutorial, which mirrors Dynamic's `overrides.evmNetworks` docs):
Source: https://developers.circle.com/wallets/modular/dynamic-integration , https://www.dynamic.xyz/docs/chains/evmNetwork

```tsx
const evmNetworks = [
  {
    chainId: 1234,                 // number — EIP-155 chain id of Arc testnet
    networkId: 1234,               // number — usually same as chainId
    name: "Arc Testnet",
    nativeCurrency: {
      name: "Ether",
      symbol: "ETH",
      decimals: 18,
      // iconUrl?: string          // optional
    },
    rpcUrls: ["https://rpc.arc-testnet.example"],   // string[]
    blockExplorerUrls: ["https://explorer.arc-testnet.example"], // string[]
    iconUrls: [],                  // string[]
    // vanityName?: string         // optional friendly label
  },
];

<DynamicContextProvider
  settings={{
    environmentId,
    walletConnectors: [EthereumWalletConnectors],
    overrides: { evmNetworks },
  }}
>
```

Property list (VERIFIED from search of the `EvmNetwork` object doc + Circle example): `chainId` (number), `networkId` (number), `name` (string), `nativeCurrency` (`{ name, symbol, decimals, iconUrl? }`), `rpcUrls` (string[]), `blockExplorerUrls` (string[]), `iconUrls` (string[]), `vanityName?` (string). Source: https://www.dynamic.xyz/docs/react-sdk/objects/evmNetwork

> NOTE on `chainName`: secondary snippets mention `chainName`, but the actual working code examples use `name`, not `chainName`. **Use `name`.** `chainName` appears only in prose, not in the verified code samples.

### Two override forms (VERIFIED via docs search snippet)
Source: https://www.dynamic.xyz/docs/chains/evmNetwork
- **Replace:** `overrides: { evmNetworks: [...] }` — completely overrides dashboard-configured networks.
- **Callback / merge:** `overrides: { evmNetworks: (dashboardNetworks) => EvmNetwork[] }` — receive dashboard networks, return the list to use.
- **Merge helper:** `mergeNetworks` is exported from `@dynamic-labs/sdk-react-core`. Usage: `evmNetworks: (networks) => mergeNetworks(myEvmNetworks, networks)`. **First arg wins on conflict.** Source: https://docs.dynamic.xyz/react-sdk/utilities/mergenetworks

```tsx
import { mergeNetworks } from "@dynamic-labs/sdk-react-core";
// ...
overrides: { evmNetworks: (networks) => mergeNetworks(evmNetworks, networks) }
```

> Practical guidance for Arc: pass Arc via `overrides.evmNetworks` with the real chainId/RPC/explorer. This is independent of dashboard config and is the supported way to add a non-standard chain Dynamic doesn't list. (VERIFIED mechanism; Arc-specific values must be filled in by you.)

---

## 3. Embedded wallets (email / social login → wallet)

**VERIFIED (mechanism, secondary sources):**
- Embedded wallets use **TSS-MPC** (threshold signature, key never reconstructed) + TEEs. Source: https://www.dynamic.xyz/blog/introducing-dynamic-embedded-wallets-with-tss-mpc
- Auth methods: email, SMS, and social (Apple, Discord, Facebook, Farcaster, Github, Google, Telegram, Twitch, Twitter). After auth, user is prompted to create a passkey → grants a wallet + enables signing. Source: https://docs.dynamic.xyz/authentication-methods/email-social-sms
- Packages: core is still `@dynamic-labs/sdk-react-core` + a chain package (`@dynamic-labs/ethereum`); EVM embedded support package `@dynamic-labs/embedded-wallet-evm` (4.88.5) exists. The `useEmbeddedReveal` hook (export private key) is in `@dynamic-labs/sdk-react-core`. Source: search snippet / https://docs.dynamic.xyz/wallets/embedded-wallets/mpc/setup
- **Most embedded-wallet behavior is toggled in the Dynamic dashboard** (enable email/social, enable embedded wallets, choose auto-create on signup). Config is largely dashboard-side, not code-side. (UNVERIFIED exact dashboard toggle names — confirm in dashboard or via docs MCP.)

Minimal code is the same provider as §1; enabling email/social embedded wallets is primarily a dashboard setting. The `DynamicWidget` renders the login modal that handles email/social → wallet creation.

---

## 4. Smart wallets / ERC-4337 / account abstraction

**VERIFIED — YES, Dynamic provides smart accounts via ZeroDev.**
Source: https://docs.dynamic.xyz/smart-wallets/add-smart-wallets , https://docs.dynamic.xyz/chains/smart-wallet-chains , npm

- Provider: **ZeroDev is the only AA provider integrated natively into Dynamic** (Kernel accounts, ERC-4337; also EIP-7702 support). Source: docs overview + https://www.dynamic.xyz/blog/what-eip-7702-means-for-you
- Package: **`@dynamic-labs/ethereum-aa`** (4.88.5). Also a separate extension package **`@dynamic-labs/zerodev-extension`** (4.88.4) and the new-line **`@dynamic-labs-sdk/zerodev`** (1.8.2). For the React 4.88.x line, use `@dynamic-labs/ethereum-aa`. (VERIFIED via npm.)
- Features (VERIFIED): **gas sponsorship / paymaster** ("gasless" txns sponsored by you) and **transaction batching** (one signature for a bundle of UserOps). Source: https://docs.dynamic.xyz/smart-wallets/add-smart-wallets

### Config (VERIFIED code from docs/search)
```tsx
import { DynamicContextProvider } from "@dynamic-labs/sdk-react-core";
import { EthereumWalletConnectors } from "@dynamic-labs/ethereum";
import { ZeroDevSmartWalletConnectors } from "@dynamic-labs/ethereum-aa";

<DynamicContextProvider
  settings={{
    environmentId: "XXXXX",
    walletConnectors: [EthereumWalletConnectors, ZeroDevSmartWalletConnectors],
  }}
>
```

Advanced (custom bundler/paymaster RPCs) — `ZeroDevSmartWalletConnectorsWithConfig`:
```tsx
import { ZeroDevSmartWalletConnectorsWithConfig } from "@dynamic-labs/ethereum-aa";

walletConnectors: [
  ZeroDevSmartWalletConnectorsWithConfig({
    bundlerRpc: "CUSTOM_BUNDLER_RPC",
    paymasterRpc: "CUSTOM_PAYMASTER_RPC",
    // bundlerProvider?: "STACKUP" | ...
  }),
],
```
Source: https://www.dynamic.xyz/docs/smart-wallets/advanced

### Chains supported / custom chain for AA — IMPORTANT CAVEAT
- AA chains are listed at https://docs.dynamic.xyz/chains/smart-wallet-chains (could not load directly — certificate/403 issues on mirrors). **UNVERIFIED exact list.**
- **Key constraint (VERIFIED reasoning, not a quote):** ZeroDev AA requires ZeroDev's infra (Kernel factory contracts deployed on-chain, plus a bundler + paymaster) for that specific chain. A brand-new custom chain like **Arc testnet will NOT get smart-wallet/paymaster support automatically** just by adding it via `overrides.evmNetworks`. You can add Arc as a plain EVM network for EOA/embedded wallets, but ERC-4337 smart accounts + gas sponsorship on Arc depend on whether ZeroDev (or you, via `...WithConfig` with self-hosted bundler/paymaster + deployed Kernel contracts) supports Arc.
- EIP-7702 path: ZeroDev/Dynamic support 7702 (EOA→smart account upgrade) on chains where 7702 + ZeroDev are live (e.g. Sepolia, MegaETH). Source: https://docs.dynamic.xyz/guides/integrations/megaEth , https://x.com/zerodev_app/status/1897674756608172458
- **ACTION:** Verify Arc testnet against ZeroDev's supported-chains list before promising smart-wallet/paymaster on Arc. If ZeroDev hasn't deployed there, use embedded/EOA wallets on Arc and reserve AA for a supported chain. Confirm via the docs MCP or https://docs.zerodev.app/sdk/faqs/chains.

---

## 5. Chain abstraction / asset aggregation ("swap+bridge to USDC")

**Status: LIKELY REAL but UNVERIFIED for the React SDK surface.**
- A GitHub repo named **`dynamic-labs/dynamic-swaps`** surfaced in search, but `https://github.com/dynamic-labs/dynamic-swaps` returned **404** when checked directly (VERIFIED 404 — repo is private, renamed, or the search result was stale). So I could not confirm a public "dynamic-swaps" package/repo.
- No verified `@dynamic-labs/*` npm package for swap/bridge aggregation was found in the npm scope listing.
- ZeroDev (Dynamic's AA provider) advertises **"chain abstraction" / cross-chain txns** as a 7702/AA feature — that is ZeroDev's capability, surfaced through Dynamic's AA integration, not a standalone Dynamic "aggregate to USDC" product. Source: https://x.com/zerodev_app/status/1897674756608172458
- **CONCLUSION:** There is no clearly-verified first-class Dynamic "swap+bridge everything into USDC" aggregation SDK feature. Treat any such capability as **UNVERIFIED** until confirmed via the docs MCP (search "swap", "bridge", "fund", "onramp"). Dynamic does have funding/onramp features and possibly a swaps surface, but the exact name/package could not be verified here. Do not build core flow assuming it exists without checking.

---

## 6. Dynamic MCP server + `npx skills add ethglobal-skills/repo`

### Dynamic docs MCP — **VERIFIED, REAL**
Source: https://www.dynamic.xyz/docs/overview/ethglobal-new-york-2026
- Endpoint: **`https://www.dynamic.xyz/docs/mcp`** (remote HTTP MCP — live docs access for agents).
- Install commands (quoted):
  - Claude Code: `claude mcp add --transport http dynamic https://www.dynamic.xyz/docs/mcp`
  - Codex: `codex mcp add dynamic --url https://www.dynamic.xyz/docs/mcp`
  - Cursor: "Click here to add the MCP to Cursor" (UI install).
- This is the most reliable way to pull EXACT current Dynamic docs/API signatures (WebFetch was blocked on the HTML docs).

> NOTE: Generic web search also returns unrelated "dynamic MCP server" projects (e.g. `scitara-cto/dynamic-mcp`, `asyrjasalo/dynamic-mcp`). Those are NOT dynamic.xyz. The real one is the `/docs/mcp` endpoint above.

### `npx skills add ethglobal-skills/repo` — **VERIFIED, REAL**
- `npx skills` is the open agent-skills CLI (`vercel-labs/skills`). Source: https://github.com/vercel-labs/skills
- The GitHub org **`ethglobal-skills`** exists (GitHub API returned 200) and contains a repo literally named **`repo`**:
  - `full_name: ethglobal-skills/repo`
  - description: *"npx skills add ethglobal-skills/repo - 17,180 projects, sponsor/bounty docs, and all Finalist/bounty winners"*
  - Source: `https://api.github.com/orgs/ethglobal-skills/repos` (VERIFIED 200 + JSON).
- So the literal command `npx skills add ethglobal-skills/repo` is correct and installs a skill bundle of ~6 years of ETHGlobal hackathon projects + sponsor docs into your coding agent. Quoted by Dynamic's ETHGlobal page too. (VERIFIED)

### Optional Dynamic CLI (VERIFIED from ETHGlobal page)
- `npm install -g @dynamic-labs/dynamic-console-cli` then `dyn auth login`.

---

## 7. Environment ID — how to get one / sandbox

- **VERIFIED:** You get an `environmentId` by creating an account in the **Dynamic dashboard** (`app.dynamic.xyz`) and copying the environment ID for SDK init. Quoted from ETHGlobal page: *"Create an account in the Dynamic dashboard and grab your environment ID for SDK initialization."* Source: https://www.dynamic.xyz/docs/overview/ethglobal-new-york-2026
- `environmentId` is a public client-side identifier (safe in `NEXT_PUBLIC_`). (VERIFIED — it's passed into a client component / browser bundle.)
- **Public sandbox environment ID usable without signup: NOT FOUND / UNVERIFIED.** No official no-signup sandbox environment ID was located. Dynamic docs sometimes use placeholder IDs (`"XXXXX"`, `"YOUR_ENV_ID"`) in examples, but those are placeholders, not working sandbox IDs. **Plan to sign up (free) and create an environment.** Signup is quick and the dashboard provides a default/sandbox environment per project.

---

## Quick-reference summary

- Install: `npm i @dynamic-labs/sdk-react-core @dynamic-labs/ethereum` (+ `@dynamic-labs/ethereum-aa` for smart wallets). All at **4.88.5**.
- Provider: client component wrapping `DynamicContextProvider` with `settings={{ environmentId, walletConnectors: [EthereumWalletConnectors] }}` + `<DynamicWidget />` (see §1).
- Custom chain (Arc): `settings.overrides.evmNetworks` array of `{ chainId, networkId, name, nativeCurrency{name,symbol,decimals}, rpcUrls[], blockExplorerUrls[], iconUrls[] }`; use `mergeNetworks` (from `@dynamic-labs/sdk-react-core`) to keep dashboard networks (see §2).
- Smart wallets: `ZeroDevSmartWalletConnectors` (or `...WithConfig({bundlerRpc,paymasterRpc})`) from `@dynamic-labs/ethereum-aa`. Supports gas sponsorship/paymaster + batched UserOps. **Caveat:** AA on a brand-new custom chain (Arc) requires ZeroDev infra on that chain — not guaranteed; verify (see §4).
- Aggregation/swap-to-USDC: **not verified as a first-class Dynamic SDK feature.** ZeroDev offers cross-chain "chain abstraction"; a public Dynamic swaps package was NOT confirmed (`dynamic-swaps` repo 404). Treat as UNVERIFIED (see §5).
- MCP: real — `https://www.dynamic.xyz/docs/mcp` (`claude mcp add --transport http dynamic https://www.dynamic.xyz/docs/mcp`). `npx skills add ethglobal-skills/repo` is real (org + repo verified). Use the MCP to confirm any UNVERIFIED item above.
- Env ID: sign up at `app.dynamic.xyz` (free). No public no-signup sandbox ID found.

## Open items to confirm via the docs MCP
1. Exact smart-wallet (ZeroDev) supported chain list and whether Arc testnet qualifies.
2. Whether a Dynamic swap/bridge/"to USDC" aggregation feature exists and its package name.
3. Exact Next.js App Router SSR doc guidance (cookie/initial state hydration helpers, if any).
4. Dashboard toggles for auto-creating embedded wallets on email/social signup.
