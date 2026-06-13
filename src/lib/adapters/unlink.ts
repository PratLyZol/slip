/**
 * Unlink adapter — the privacy seam (PRD Phase 3, the bounty).
 *
 * Wraps `@unlink-xyz/sdk` behind a small {@link ShieldOps} interface so the rest
 * of the engine never imports the SDK directly (AGENTS.md: "SDK wiring lives
 * ONLY in adapters"). Two implementations conform to it:
 *
 *  - DEMO ({@link demoShieldOps}): deterministic simulation. Deposit + withdraw
 *    produce visible Arc-style tx hashes (the PUBLIC edges); the private
 *    transfer produces NO public artifact — only an opaque proof reference,
 *    modelling exactly what an explorer would show for an Unlink op (a ZK proof
 *    submission with no readable amount or parties).
 *  - REAL ({@link realShieldOps}): the custodial `@unlink-xyz/sdk/client`
 *    against `arc-testnet`. Deterministically derives an Unlink account from the
 *    claim secret (secret → keccak seed → `account.fromSeed`), so the SAME
 *    shielded note is reachable on the claim side from the same secret.
 *
 * Privacy architecture (decided): the claim secret derives the claim's Unlink
 * account. Send = shield USDC into the SENDER's Unlink balance → private
 * `transfer` to the CLAIM's unlink address (the leg where amount + the
 * sender↔recipient edge vanish). Claim = re-derive the claim account from the
 * secret → `withdraw` to the recipient's public EOA → then FX.
 *
 * The real path may fail without funded testnet USDC / an admin key. Callers
 * (shield.ts / claim.ts) catch and degrade per PRD §8 — the privacy leg behind
 * a flag must NEVER block the end-to-end send.
 *
 * Unlink API notes (verified against the INSTALLED package, not just research —
 * see docs/research/unlink.md "Correction" section):
 *  - There is NO bare `@unlink-xyz/sdk` entry; import from `/client` (custodial).
 *  - `account.fromSeed({ seed: Uint8Array, accountIndex? })` — used for the
 *    deterministic derivation (research only named fromMnemonic).
 *  - `getAddress()` is ASYNC and returns a bech32 `unlink1…` string.
 *  - A `TransactionHandle` carries a NULL `txHash`; the real hash arrives on the
 *    `TransactionResult` returned by `.wait()` — read `result.txHash` there.
 *  - The custodial client needs `register` + `authorizationToken` providers,
 *    which require a backend admin key (`createUnlinkAdmin`).
 */

import { keccak256, type Hex } from "viem";
import {
  UNLINK_APP_ID,
  UNLINK_API_KEY,
  isDemoMode,
  isUnlinkConfigured,
} from "../config";
import { simLatency, simTx, sleep, fakeTxHash } from "../demo/sim";
import { UNLINK_ARC_ENVIRONMENT, USDC_ADDRESS, txUrl } from "./arc";
import type { PrivacyLeg } from "../engine/types";

/** A token + amount (wei string) for a shielded op. */
export interface ShieldToken {
  /** ERC-20 token address (USDC on Arc). */
  token: string;
  /** Amount in wei (6-decimal USDC) as a decimal string. */
  amount: string;
}

/**
 * The privacy interface the engine programs against. Both the real Unlink SDK
 * and the demo simulation implement it. Every op is keyed by the claim
 * `secret` so derivations are deterministic and reproducible.
 */
export interface ShieldOps {
  /** True when this is the real SDK path (vs. the demo simulation). */
  readonly real: boolean;

  /**
   * Resolve the SENDER's own shielded (unlink1…) address — where deposited USDC
   * lands. In demo this is a deterministic pseudo-address; in real mode it is
   * the sender account's `getAddress()`.
   */
  senderUnlinkAddress(secret: Hex): Promise<string>;

  /**
   * Resolve the CLAIM's shielded (unlink1…) address — the private-transfer
   * target, re-derivable on the claim side from the same secret.
   */
  claimUnlinkAddress(secret: Hex): Promise<string>;

  /**
   * Shield (deposit) USDC into the sender's Unlink balance. PUBLIC edge — the
   * funding source + amount are visible on-chain. Returns the deposit leg.
   */
  shield(secret: Hex, t: ShieldToken): Promise<PrivacyLeg>;

  /**
   * Private transfer from the sender's shielded balance to the claim's unlink
   * address. THE private middle — no readable amount or parties on-chain.
   * Returns the transfer leg (no tx hash; a proof reference instead).
   */
  privateTransfer(secret: Hex, t: ShieldToken): Promise<PrivacyLeg>;

  /**
   * Unshield (withdraw) from the claim's shielded balance to a public EOA.
   * PUBLIC edge — destination + amount visible, source private account is not.
   * Returns the unshield leg.
   */
  unshield(
    secret: Hex,
    recipientEvmAddress: string,
    t: ShieldToken,
  ): Promise<PrivacyLeg>;

  /** Shielded balance for the claim account, human-units string (best effort). */
  shieldedBalance(secret: Hex): Promise<string>;
}

/** USDC amount (human units) → 6-decimal wei string for Unlink. */
export function usdcToWei(amountHuman: string): string {
  // amountHuman like "50.00"; USDC has 6 decimals on Arc.
  const [whole, frac = ""] = amountHuman.split(".");
  const fracPadded = (frac + "000000").slice(0, 6);
  const wei = `${whole}${fracPadded}`.replace(/^0+(?=\d)/, "");
  return wei.length ? wei : "0";
}

/** Default token bundle: USDC at the given human amount. */
export function usdcToken(amountHuman: string): ShieldToken {
  return { token: USDC_ADDRESS, amount: usdcToWei(amountHuman) };
}

// ---------------------------------------------------------------------------
// DEMO implementation — deterministic, no credentials, no network.
// ---------------------------------------------------------------------------

/**
 * A believable bech32 `unlink1…` address derived from a secret + role salt.
 * Not a real Unlink address — purely for the demo story / proof view.
 */
function demoUnlinkAddress(secret: Hex, role: string): string {
  const h = keccak256(`0x${Buffer.from(`slip:unlink:${role}`).toString("hex")}${secret.slice(2)}` as Hex);
  // bech32m charset (no 1/b/i/o); good enough to read as an unlink1 address.
  const charset = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
  let body = "";
  const bytes = h.slice(2);
  for (let i = 0; i < 38; i++) {
    const nibble = parseInt(bytes[i % bytes.length], 16);
    body += charset[nibble % charset.length];
  }
  return `unlink1${body}`;
}

const demoShieldOps: ShieldOps = {
  real: false,

  async senderUnlinkAddress(secret) {
    return demoUnlinkAddress(secret, "sender");
  },

  async claimUnlinkAddress(secret) {
    return demoUnlinkAddress(secret, "claim");
  },

  async shield(secret, t) {
    // PUBLIC edge: a visible deposit tx into the shielded pool.
    await sleep(simLatency(500, 1200));
    const tx = simTx("unlink-deposit", secret, t.token, t.amount);
    return {
      kind: "shield",
      label: "Deposit into shielded balance",
      public: true,
      txHash: tx.hash,
      explorerUrl: tx.explorerUrl,
      simulated: true,
    };
  },

  async privateTransfer(secret) {
    // THE private middle: a ZK proof submission. NO readable amount/parties and
    // NO ordinary tx hash to link — only an opaque proof/nullifier reference,
    // modelling what an explorer would actually show for an Unlink transfer.
    await sleep(simLatency(700, 1600));
    const proof = fakeTxHash("unlink-transfer-proof", secret);
    return {
      kind: "transfer",
      label: "Private transfer (shielded)",
      public: false,
      proofRef: proof,
      simulated: true,
    };
  },

  async unshield(secret, recipientEvmAddress, t) {
    // PUBLIC edge: a visible withdraw tx to the recipient EOA.
    await sleep(simLatency(500, 1200));
    const tx = simTx("unlink-withdraw", secret, recipientEvmAddress, t.amount);
    return {
      kind: "unshield",
      label: "Withdraw from shielded balance",
      public: true,
      txHash: tx.hash,
      explorerUrl: tx.explorerUrl,
      simulated: true,
    };
  },

  async shieldedBalance(secret) {
    // Deterministic, plausible-looking shielded balance for the demo proof view.
    void secret;
    return "0.00";
  },
};

// ---------------------------------------------------------------------------
// REAL implementation — @unlink-xyz/sdk/client against arc-testnet.
// ---------------------------------------------------------------------------

/**
 * Build a custodial Unlink client whose account is DETERMINISTICALLY derived
 * from the claim secret. Same secret → same shielded note, on both the send and
 * claim sides. Requires an admin key (server-only) to register + authorize.
 *
 * `roleIndex` separates the SENDER account (0) from the CLAIM account (1) via
 * `accountIndex` so the private transfer has a distinct recipient. Both derive
 * from the same 32-byte seed = keccak(secret).
 */
async function buildRealClient(secret: Hex, roleIndex: 0 | 1) {
  if (!UNLINK_API_KEY) {
    throw new Error("UNLINK_API_KEY missing — cannot build real Unlink client.");
  }
  // The custodial client + admin API are SERVER-ONLY (the admin key never ships
  // to the browser; @unlink-xyz/sdk/admin sets `"browser": null` in its exports
  // for exactly this reason). Guard so a stray client-side call fails loudly
  // rather than bundling server code into the browser.
  if (typeof window !== "undefined") {
    throw new Error(
      "Real Unlink path is server-only (admin key) — not callable in the browser.",
    );
  }
  // Runtime-resolved specifiers keep the bundler from statically pulling the
  // server-only `/admin` subpath into the browser bundle. The path still
  // type-checks and is reachable server-side when UNLINK_API_KEY is present.
  const clientMod = "@unlink-xyz/sdk/client";
  const adminMod = "@unlink-xyz/sdk/admin";
  const { account, createUnlinkClient } = (await import(
    /* webpackIgnore: true */ /* turbopackIgnore: true */ clientMod
  )) as typeof import("@unlink-xyz/sdk/client");
  const { createUnlinkAdmin } = (await import(
    /* webpackIgnore: true */ /* turbopackIgnore: true */ adminMod
  )) as typeof import("@unlink-xyz/sdk/admin");

  // secret → 32-byte deterministic seed for account derivation.
  const seedHex = keccak256(secret);
  const seed = Uint8Array.from(
    seedHex.slice(2).match(/.{2}/g)!.map((b) => parseInt(b, 16)),
  );
  const unlinkAccount = account.fromSeed({ seed, accountIndex: roleIndex });
  const unlinkAddress = await unlinkAccount.getAddress();

  const admin = createUnlinkAdmin({
    environment: UNLINK_ARC_ENVIRONMENT,
    apiKey: UNLINK_API_KEY,
  });

  const client = createUnlinkClient({
    environment: UNLINK_ARC_ENVIRONMENT,
    account: unlinkAccount,
    register: (payload) => admin.users.register(payload),
    authorizationToken: {
      provider: () => admin.authorizationTokens.issue({ unlinkAddress }),
    },
  });

  await client.ensureRegistered();
  return { client, unlinkAddress };
}

const realShieldOps: ShieldOps = {
  real: true,

  async senderUnlinkAddress(secret) {
    const { unlinkAddress } = await buildRealClient(secret, 0);
    return unlinkAddress;
  },

  async claimUnlinkAddress(secret) {
    const { unlinkAddress } = await buildRealClient(secret, 1);
    return unlinkAddress;
  },

  async shield(secret, t) {
    const { client } = await buildRealClient(secret, 0);
    const handle = await client.depositWithApproval({
      token: t.token,
      amount: t.amount,
    });
    const result = await handle.wait();
    if (result.status === "failed") {
      throw new Error("Unlink deposit failed.");
    }
    const hash = (result.txHash ?? undefined) as Hex | undefined;
    return {
      kind: "shield",
      label: "Deposit into shielded balance",
      public: true,
      txHash: hash,
      explorerUrl: hash ? txUrl(hash) : undefined,
      simulated: false,
    };
  },

  async privateTransfer(secret, t) {
    const { client } = await buildRealClient(secret, 0);
    const recipientAddress = await this.claimUnlinkAddress(secret);
    const handle = await client.transfer({
      recipientAddress,
      token: t.token,
      amount: t.amount,
    });
    const result = await handle.wait();
    if (result.status === "failed") {
      throw new Error("Unlink private transfer failed.");
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

  async unshield(secret, recipientEvmAddress, t) {
    const { client } = await buildRealClient(secret, 1);
    const handle = await client.withdraw({
      recipientEvmAddress,
      token: t.token,
      amount: t.amount,
    });
    const result = await handle.wait();
    if (result.status === "failed") {
      throw new Error("Unlink withdraw failed.");
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

  async shieldedBalance(secret) {
    const { client } = await buildRealClient(secret, 1);
    const bal = await client.balanceOf(USDC_ADDRESS);
    return bal ?? "0";
  },
};

/**
 * Select the active ShieldOps. Real path only when NOT in demo mode AND an
 * Unlink admin key is present; otherwise the deterministic demo simulation.
 */
export function getShieldOps(): ShieldOps {
  if (isUnlinkConfigured()) return realShieldOps;
  return demoShieldOps;
}

/** Exposed for tests / the proof view header. */
export const UNLINK_APP = UNLINK_APP_ID;

/** True when the demo simulation is the active privacy path. */
export function shieldIsSimulated(): boolean {
  return isDemoMode() || !UNLINK_API_KEY;
}
