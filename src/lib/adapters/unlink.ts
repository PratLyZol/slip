/**
 * Unlink adapter — the privacy seam (PLAN.md §1/§3, the bounty).
 *
 * Wraps `@unlink-xyz/sdk` behind a small {@link ShieldOps} interface so the rest
 * of the engine never imports the SDK directly (AGENTS.md: "SDK wiring lives
 * ONLY in adapters"). There is exactly ONE implementation — the REAL one. There
 * is NO simulated fallback (AGENTS.md hard rule: "Real adapters are the only
 * path"). When Unlink is not configured the adapter surfaces an HONEST error
 * instead of fabricating a money movement.
 *
 *  - REAL ({@link realShieldOps}): the NON-CUSTODIAL `@unlink-xyz/sdk/browser`
 *    client against `arc-testnet`. The account is DETERMINISTICALLY derived from
 *    a secret (secret → keccak seed → `account.fromSeed`), so the same shielded
 *    note is reachable from the same secret. The secret never leaves the client;
 *    only `register` + `authorization-token` are thin server routes holding the
 *    admin key. See PLAN.md §0.5 + §3 and docs/research/unlink.md.
 *
 * NO CLIENT-SIDE CONFIG GATE (the bug this file used to have): `getShieldOps()`
 * runs in the BROWSER (distribute.ts / claim.ts are pulled in by "use client"
 * screens). The Unlink admin key `UNLINK_API_KEY` is SERVER-ONLY — Next.js does
 * NOT inline it into the client bundle, so `process.env.UNLINK_API_KEY` is
 * ALWAYS `undefined` in the browser. Gating the real path on it (the old
 * `isUnlinkConfigured()`) therefore ALWAYS fell through to the simulation, even
 * with the key set in prod — the shield never debited and the claim withdrew
 * nothing while the UI showed success.
 *
 * The fix is to ALWAYS take the real path and let the two server auth routes be
 * the single source of truth: `/api/unlink/register` + `/api/unlink/
 * authorization-token` already return an honest 501 when `UNLINK_API_KEY` is
 * absent server-side, so `ensureRegistered()` (called in {@link buildClient})
 * throws an honest error in that case. Key present → funds move; key absent →
 * honest throw surfaces in the UI. ZERO new client config, and the server admin
 * key stays the only configured-state authority (correct security model).
 *
 * Privacy architecture (batch-first, PLAN.md §2):
 *  - `seed = keccak(batchSecret)` derives the SENDER's Unlink account (index 0).
 *  - `seed = keccak(claimSecret)` derives the CLAIM's Unlink account (index 0).
 *    DIFFERENT SEEDS, both at accountIndex 0 — not different indices on one seed.
 *  - Send = shield Σ once into the sender's Unlink balance (a WALLET-FUNDED
 *    `depositWithApproval` of the bridged USDC, signed by the connected wallet
 *    on Arc) → private `transfer` to each claim's unlink1 address (the leg where
 *    amount + the sender↔recipient edge vanish).
 *  - Claim = re-derive the claim account from its secret → `withdraw` to the
 *    recipient's public EOA (relayer-submitted, recipient pays no gas).
 *
 * The real path throws an HONEST error when the server admin key is absent (the
 * auth routes 501 → `ensureRegistered()` throws), when no Arc wallet is
 * connected, or when the wallet rejects / underfunds the deposit. It NEVER
 * simulates a money movement.
 *
 * Unlink API notes (verified against the INSTALLED package @0.3.0-canary.598 —
 * see docs/research/unlink.md "Correction" + the browser/admin `.d.ts`):
 *  - Import `account` + `createUnlinkClient` from `/browser` (non-custodial).
 *  - `account.fromSeed({ seed: Uint8Array, accountIndex? })` is SYNC and returns
 *    an `UnlinkLocalAccount`; `getAddress()` on it is ASYNC → bech32 `unlink1…`.
 *  - Browser client wires `registerUrl` (string) + `authorizationToken: { url }`
 *    to the two server routes; `ensureRegistered()` POSTs the registration.
 *  - `depositWithApproval({ token, amount, evm })` does a REAL on-chain ERC-20
 *    approve + deposit (wallet-funded; `evm = evm.fromViem({ walletClient })`).
 *    It returns a `TransactionHandle`; `.wait()` yields a `TransactionResult`
 *    with a real `txHash` — surfaced on the public shield edge.
 *  - `transfer` / `withdraw` return a `TransactionHandle`; `.wait()` yields a
 *    `TransactionResult { txId, status, txHash? }`. Terminal SUCCESS is
 *    `status === "processed"` — assert it (NOT `!== "failed"`).
 *  - A private transfer leaves NO public tx hash; we surface `result.txId` as an
 *    opaque `proofRef` (NOT an explorer link) for the "no readable middle" story.
 */

import { account, createUnlinkClient, evm } from "@unlink-xyz/sdk/browser";
import { createPublicClient, http, keccak256, type Hex, type WalletClient } from "viem";
import { UNLINK_APP_ID, isRealPayoutSafe } from "../config";
import { UNLINK_ARC_ENVIRONMENT, USDC_ADDRESS, arcTestnet, txUrl } from "./arc";
import type { PrivacyLeg } from "../engine/types";

/**
 * The privacy interface the engine programs against, backed ONLY by the real
 * `@unlink-xyz/sdk/browser` client. Amounts flow as human `amountUsdc` strings;
 * the adapter converts to wei internally. Accounts derive deterministically from
 * a secret so derivations are reproducible across the send and claim sides.
 */
export interface ShieldOps {
  /** Always `true` — there is only the real SDK path. Kept for the engine. */
  readonly real: boolean;

  /**
   * Resolve the SENDER's own shielded (unlink1…) address — where shielded USDC
   * lands. Seed = keccak(batchSecret), accountIndex 0.
   */
  senderAddress(batchSecret: Hex): Promise<string>;

  /**
   * Resolve a CLAIM's shielded (unlink1…) address — the private-transfer
   * target, re-derivable on the claim side. Seed = keccak(claimSecret), index 0.
   */
  claimAddress(claimSecret: Hex): Promise<string>;

  /**
   * Shield Σ (the batch total) once into the SENDER's Unlink balance via a
   * WALLET-FUNDED `depositWithApproval` of the bridged USDC. PUBLIC edge — a
   * real on-chain ERC-20 approve + deposit into the shielded pool, signed by the
   * connected wallet (`walletClient`) on Arc. Returns the shield leg with a real
   * tx hash.
   */
  shieldSender(
    batchSecret: Hex,
    amountUsdc: string,
    walletClient: WalletClient,
  ): Promise<PrivacyLeg>;

  /**
   * Private transfer from the sender's shielded balance to ONE claim's unlink
   * address. THE private middle — no readable amount or parties on-chain.
   * Returns the transfer leg (no tx hash; a proof reference instead).
   */
  privateTransfer(
    batchSecret: Hex,
    claimSecret: Hex,
    amountUsdc: string,
  ): Promise<PrivacyLeg>;

  /**
   * Unshield (withdraw) from the claim's shielded balance to a public EOA.
   * PUBLIC edge — destination + amount visible, source private account is not.
   * Returns the unshield leg.
   */
  unshield(
    claimSecret: Hex,
    recipientEvmAddress: string,
    amountUsdc: string,
  ): Promise<PrivacyLeg>;
}

/** USDC amount (human units) → 6-decimal wei string for Unlink. */
export function usdcToWei(amountHuman: string): string {
  // amountHuman like "50.00"; USDC has 6 decimals on Arc.
  const [whole, frac = ""] = amountHuman.split(".");
  const fracPadded = (frac + "000000").slice(0, 6);
  const wei = `${whole}${fracPadded}`.replace(/^0+(?=\d)/, "");
  return wei.length ? wei : "0";
}

/** A token + amount (wei string) for a shielded op (USDC on Arc). */
export interface ShieldToken {
  token: string;
  amount: string;
}

/** Default token bundle: USDC at the given human amount. */
export function usdcToken(amountHuman: string): ShieldToken {
  return { token: USDC_ADDRESS, amount: usdcToWei(amountHuman) };
}

// ---------------------------------------------------------------------------
// REAL implementation — @unlink-xyz/sdk/browser against arc-testnet.
//
// Non-custodial: the account is derived in the BROWSER from a secret and the
// secret never leaves the client. Only the two thin auth routes (register +
// authorization-token) run server-side with the admin key. This is why there is
// NO `typeof window` guard and NO dynamic import indirection — the browser
// client is a normal client-side static import.
// ---------------------------------------------------------------------------

/** secret → 32-byte deterministic seed (keccak) for account derivation. */
function seedFromSecret(secret: Hex): Uint8Array {
  const seedHex = keccak256(secret);
  return Uint8Array.from(
    seedHex.slice(2).match(/.{2}/g)!.map((b) => parseInt(b, 16)),
  );
}

/**
 * Build a non-custodial browser Unlink client whose account is derived from
 * `secret` (seed = keccak(secret), accountIndex 0). The two server routes carry
 * the admin key; the client posts its registration to `registerUrl` and fetches
 * authorization tokens from `authorizationToken.url`. `ensureRegistered()` runs
 * once before any mutating op.
 */
async function buildClient(secret: Hex) {
  const unlinkAccount = account.fromSeed({ seed: seedFromSecret(secret), accountIndex: 0 });
  const client = createUnlinkClient({
    environment: UNLINK_ARC_ENVIRONMENT,
    account: unlinkAccount,
    registerUrl: "/api/unlink/register",
    authorizationToken: { url: "/api/unlink/authorization-token" },
  });
  await client.ensureRegistered();
  const unlinkAddress = await unlinkAccount.getAddress();
  return { client, unlinkAddress };
}

const realShieldOps: ShieldOps = {
  real: true,

  async senderAddress(batchSecret) {
    const acct = account.fromSeed({ seed: seedFromSecret(batchSecret), accountIndex: 0 });
    return acct.getAddress();
  },

  async claimAddress(claimSecret) {
    const acct = account.fromSeed({ seed: seedFromSecret(claimSecret), accountIndex: 0 });
    return acct.getAddress();
  },

  async shieldSender(batchSecret, amountUsdc, walletClient) {
    const { client } = await buildClient(batchSecret);
    // SHIELD Σ once via a WALLET-FUNDED deposit of the bridged USDC. The
    // connected wallet (`walletClient`, on Arc 5042002) signs the ERC-20
    // approve + the deposit; Unlink's `depositWithApproval` chains them and
    // returns a TransactionHandle. This is a REAL on-chain edge, so we get a
    // real tx hash to surface on the public shield edge. The Unlink account
    // itself is still derived from `batchSecret` (buildClient) — only the
    // deposit FUNDING comes from the wallet.
    if (!walletClient) {
      throw new Error(
        "[slip] No Arc wallet client for the Unlink deposit — connect a wallet before sending.",
      );
    }
    // Pass an Arc publicClient alongside the walletClient so the deposit's
    // ERC-20 allowance read (and any eth_call / getCode) goes over a dedicated
    // Arc RPC transport rather than depending on the injected wallet's transport
    // — de-risks the approve+deposit on wallets with a flaky/absent read path.
    const publicClient = createPublicClient({
      chain: arcTestnet,
      transport: http(),
    });
    const handle = await client.depositWithApproval({
      token: USDC_ADDRESS,
      amount: usdcToWei(amountUsdc),
      evm: evm.fromViem({ walletClient, publicClient }),
    });
    const result = await handle.wait();
    if (result.status !== "processed") {
      throw new Error(`Unlink deposit not processed: ${result.status}`);
    }
    const hash = (result.txHash ?? undefined) as Hex | undefined;
    return {
      kind: "shield",
      label: "Shield batch total into private pool",
      public: true,
      // depositWithApproval is a real on-chain tx — surface its hash + explorer
      // link as the public shield edge (the one readable "in" of the bounty).
      txHash: hash,
      explorerUrl: hash ? txUrl(hash) : undefined,
      simulated: false,
    };
  },

  async privateTransfer(batchSecret, claimSecret, amountUsdc) {
    const { client } = await buildClient(batchSecret);
    const recipientAddress = await this.claimAddress(claimSecret);
    const handle = await client.transfer({
      recipientAddress,
      token: USDC_ADDRESS,
      amount: usdcToWei(amountUsdc),
    });
    const result = await handle.wait();
    if (result.status !== "processed") {
      throw new Error(`Unlink private transfer not processed: ${result.status}`);
    }
    // No public tx hash for a private transfer — the relayer submits a ZK proof.
    // We surface the txId as the opaque proof reference (NOT an explorer link).
    return {
      kind: "transfer",
      label: "Private transfer (shielded)",
      public: false,
      proofRef: result.txId,
      simulated: false,
    };
  },

  async unshield(claimSecret, recipientEvmAddress, amountUsdc) {
    // ───────────────────────────────────────────────────────────────────────
    // CRITICAL SAFETY GUARD. This is the moment REAL shielded USDC leaves the
    // private pool to a PUBLIC address. If the recipient address is not a
    // verified-real, OTP-claimable Dynamic pregen wallet, it is the
    // deterministic `demoAddressFor(identifier)` — a KEYLESS address nobody
    // controls — and the funds would be LOST FOREVER. Refuse outright by
    // THROWING an honest error; the caller surfaces it (no silent simulation).
    // NEVER weaken this to "best effort": a missing Dynamic pregen config means
    // we CANNOT prove the recipient owns the address, so we must NOT send real
    // funds there.
    if (!isRealPayoutSafe()) {
      throw new Error(
        "[slip] Refusing real Unlink withdraw: recipient payout address is not a " +
          "verified-real Dynamic pregen wallet (DYNAMIC_API_TOKEN absent → keyless " +
          "demo address). Real funds must never go to a keyless address.",
      );
    }
    const { client, unlinkAddress } = await buildClient(claimSecret);
    console.log(
      `[slip] unshield: shielded ${unlinkAddress} → ${recipientEvmAddress} (${amountUsdc} USDC)`,
    );
    const handle = await client.withdraw({
      recipientEvmAddress,
      token: USDC_ADDRESS,
      amount: usdcToWei(amountUsdc),
    });
    const result = await handle.wait();
    if (result.status !== "processed") {
      throw new Error(`Unlink withdraw not processed: ${result.status}`);
    }
    const hash = (result.txHash ?? undefined) as Hex | undefined;
    return {
      kind: "unshield",
      label: "Withdraw from shielded balance",
      public: true,
      txHash: hash,
      explorerUrl: hash ? txUrl(hash) : undefined,
      simulated: false,
    };
  },
};

/**
 * The active ShieldOps — REAL-ONLY, ALWAYS. There is no simulated fallback and
 * no client-side config gate (AGENTS.md: "Real adapters are the only path").
 *
 * Configured-state is owned ENTIRELY by the two server auth routes: when
 * `UNLINK_API_KEY` is absent server-side they return an honest 501, so the very
 * first mutating op (`ensureRegistered()` in {@link buildClient}) throws an
 * honest error. We deliberately do NOT pre-check any browser env var — the
 * server-only admin key would read as `undefined` in the client bundle, which is
 * exactly the bug this replaced (see the file header).
 */
export function getShieldOps(): ShieldOps {
  return realShieldOps;
}

/** Exposed for tests / the proof view header. */
export const UNLINK_APP = UNLINK_APP_ID;
