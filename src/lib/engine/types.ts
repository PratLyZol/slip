/**
 * Shared engine types — ONE engine, two surfaces (single send + batch).
 *
 * The engine is the seven-step send pipeline (PRD §2). Every step is a typed
 * module under src/lib/engine/. Adapters (real SDK wiring) and demo
 * implementations both conform to the interfaces implied here.
 */

import type { Address, Hex, WalletClient } from "viem";

/** Recipient destination currency region. EU → EURC, otherwise → USDC. */
export type Region = "US" | "EU";

/** Current claim-payload schema version. Bump if the shape changes. */
export const CLAIM_PAYLOAD_VERSION = 2 as const;

/**
 * Everything the recipient needs to claim, encoded into the URL fragment.
 *
 * CRITICAL (AGENTS.md): the `secret` lives in the `/claim#...` fragment ONLY —
 * never a query string, never a server log. The fragment never leaves the
 * browser. The secret deterministically derives the claim account, so whoever
 * holds the link can claim (hackathon-grade design decision, PRD §3).
 */
export interface ClaimPayload {
  /** Schema version (currently 2). */
  v: number;
  /** 32-byte claim secret, hex (0x-prefixed). Re-derives the Unlink claim account. */
  secret: Hex;
  /** Amount of USDC settled, human units as a string (e.g. "50.00"). */
  amountUsdc: string;
  /** The recipient's Dynamic pregen EVM payout address (where the claim lands). */
  recipientAddress: Address;
  /** Optional sender display label ("Sent by alice"). */
  senderLabel?: string;
  /** Optional recipient region; drives FX at claim time. */
  region?: Region;
  /** ISO timestamp the slip was created. */
  createdAt: string;
}

/**
 * A single recipient line of a send. `identifier` is whatever the sender typed:
 * email / phone / name / .eth. A single send is just `recipients.length === 1`.
 */
export interface Recipient {
  /** Raw recipient handle (email / phone / name / .eth). */
  identifier: string;
  /** Amount in USD (== USDC), human units. */
  amountUsd: number;
  /** Optional recipient region (defaults applied downstream). */
  region?: Region;
}

/** A send request entering the engine — one or many recipients. */
export interface SendRequest {
  /** Recipients to pay; single-send = exactly one. */
  recipients: Recipient[];
  /** Optional sender display label embedded in each claim link. */
  senderName?: string;
  /** Connected sender wallet address — the Arc address aggregated funds mint to. */
  senderAddress?: Address;
  /**
   * The wallet's connected ORIGIN chain id — the chain the CCTP burn is signed
   * on and the wallet's USDC is read from. Must be a CCTP-supported source (see
   * adapters/cctp-chains); SendScreen gates on this and the engine validates it.
   */
  originChainId?: number;
  /**
   * Obtain a viem WalletClient for the given chainId (decimal string) from the
   * connected Dynamic wallet. Injected by SendScreen from `wallet.getWalletClient`.
   * Required for the real CCTP bridge path — the burn is signed by the connected
   * wallet on its origin chain, not a server-held private key. Absent when no
   * wallet is connected.
   */
  getWalletClient?: (chainId: string) => Promise<WalletClient | undefined>;
}

/** The seven steps of a send (PRD §2). Ordered. */
export enum EngineStep {
  Resolve = "resolve",
  Aggregate = "aggregate",
  Counterfactual = "counterfactual",
  Shield = "shield",
  Settle = "settle",
  SponsorGas = "sponsorGas",
  Claim = "claim",
}

/** Ordered list of all steps, for rendering progress UI. */
export const ENGINE_STEPS: readonly EngineStep[] = [
  EngineStep.Resolve,
  EngineStep.Aggregate,
  EngineStep.Counterfactual,
  EngineStep.Shield,
  EngineStep.Settle,
  EngineStep.SponsorGas,
  EngineStep.Claim,
] as const;

/** Lifecycle status of an individual step. */
export type StepStatus =
  | "pending" // not started
  | "queued" // will run in a later phase (e.g. shield/FX wired by a later agent)
  | "running" // in flight
  | "done" // completed successfully
  | "failed"; // errored

/** Per-step state surfaced to the progress UI. */
export interface StepState {
  step: EngineStep;
  status: StepStatus;
  /** Short human label, e.g. "Resolved alice → 0x12…ab". */
  detail?: string;
  /** Optional explorer URL for a tx produced by this step. */
  explorerUrl?: string;
}

/** A chain transaction reference produced by a step (real or simulated). */
export interface TxRef {
  hash: Hex;
  explorerUrl: string;
  /** True when the hash is a deterministic demo simulation, not a real tx. */
  simulated: boolean;
}

/**
 * One leg of the privacy (Unlink) path, captured for the Phase 7 "/private"
 * proof view. The three legs differ in what an on-chain observer can read:
 *
 *  - `shield`   (deposit):  PUBLIC edge — funding source + amount are visible.
 *  - `transfer` (unlink→unlink): the PRIVATE middle — a ZK proof submission with
 *                NO readable amount, sender, recipient, or token. There is no
 *                ordinary tx hash to link; `txHash`/`explorerUrl` are absent and
 *                `public` is false. A `proofRef` / `nullifier` stands in.
 *  - `unshield` (withdraw): PUBLIC edge — destination EOA + amount are visible.
 *
 * The whole point of the bounty: deposit in + withdraw out are readable, the
 * middle is not. {@link PrivacyArtifacts} bundles the three so the proof view
 * can render "here's what's on-chain: in, out, NO readable middle".
 */
export interface PrivacyLeg {
  /** Which leg this is. */
  kind: "shield" | "transfer" | "unshield";
  /** Human label, e.g. "Deposit into shielded balance". */
  label: string;
  /** True when this leg leaves a PUBLIC, readable on-chain artifact (edges). */
  public: boolean;
  /** On-chain tx hash, ONLY for the public edges (shield/unshield). */
  txHash?: Hex;
  /** Explorer URL for `txHash`, when present. */
  explorerUrl?: string;
  /**
   * For the private transfer leg: an opaque proof / nullifier reference that
   * models what the explorer would show (a proof submission), with no readable
   * amount or parties. Never present for the public edges.
   */
  proofRef?: string;
  /** True when the underlying op was a deterministic demo simulation. */
  simulated: boolean;
}

/**
 * The privacy story for one send, captured at settle time for the proof view.
 * `enabled` is false when the privacy path was skipped (flag off / real path
 * degraded per PRD §8) — in that case the engine fell back to direct settle and
 * `legs` is empty but `skippedReason` explains why.
 */
export interface PrivacyArtifacts {
  /** True when settlement actually routed through the Unlink shielded balance. */
  enabled: boolean;
  /** Why the privacy path was skipped, when `enabled` is false. */
  skippedReason?: string;
  /** The sender's own shielded (unlink1…) address the funds were deposited to. */
  senderUnlinkAddress?: string;
  /** The claim's shielded (unlink1…) address the private transfer targeted. */
  claimUnlinkAddress?: string;
  /** Ordered legs: shield → transfer → (unshield happens at claim). */
  legs: PrivacyLeg[];
}

/** Result of step 1 — resolve. */
export interface ResolveResult {
  /** The address the recipient handle maps to (display only at this stage). */
  address: Address;
  /** How it was resolved: a real ENS public-resolver read, or the demo mapping. */
  via: "demo" | "ens";
  /** Optional human note, e.g. why an ENS read fell back to a demo address. */
  note?: string;
}

/** Result of step 2 — aggregate (honest pass-through; verifies USDC balance). */
export interface AggregateResult {
  /** USDC available to spend, human units. */
  availableUsdc: number;
  /** Whether the balance covers the requested amount. */
  sufficient: boolean;
}

/** Result of step 3 — counterfactual account derivation. */
export interface CounterfactualResult {
  /** The deterministic recipient account address derived from the claim secret. */
  address: Address;
  /** Whether the account is deployed on-chain yet (false until claim). */
  deployed: boolean;
}

/** Result of step 5 — settle USDC to the counterfactual address. */
export interface SettleResult {
  tx: TxRef;
}

/**
 * The claim-side pipeline (PRD §2 step 7, exploded into visible sub-steps).
 *
 * The send pipeline ends with a funded-but-undeployed counterfactual account.
 * The claim pipeline picks it up: reconstruct the account from the secret,
 * sponsor gas, deploy + withdraw in one batched UserOp, FX into local money.
 * Kept as its own enum so the claim progress UI can render independently of the
 * seven send steps.
 */
export enum ClaimStep {
  /** Validate the decoded claim payload (amount, secret, version). */
  Validate = "validate",
  /** Reconstruct the counterfactual account from the secret. */
  Reconstruct = "reconstruct",
  /** Paymaster sponsors gas — recipient never holds a gas token. */
  SponsorGas = "sponsorGas",
  /** Deploy the account + withdraw the USDC in one batched UserOp. */
  Withdraw = "withdraw",
  /** FX the USDC into the recipient's local stablecoin (Phase 4 hook). */
  Convert = "convert",
  /** Done — money has landed in the recipient's walletless account. */
  Done = "done",
}

/** Ordered claim steps, for rendering claim progress UI. */
export const CLAIM_STEPS: readonly ClaimStep[] = [
  ClaimStep.Validate,
  ClaimStep.Reconstruct,
  ClaimStep.SponsorGas,
  ClaimStep.Withdraw,
  ClaimStep.Convert,
  ClaimStep.Done,
] as const;

/** Per-claim-step state surfaced to the claim progress UI. */
export interface ClaimStepState {
  step: ClaimStep;
  status: StepStatus;
  detail?: string;
  explorerUrl?: string;
}

/** Callback the claim engine invokes as each claim step transitions. */
export type ClaimStepListener = (state: ClaimStepState) => void;

/**
 * Result of the FX-at-claim hook (PRD §2 step 7, §3: "FX at CLAIM time").
 *
 * Phase 4 fills in real Arc StableFX behind {@link fxAtClaim}. The interface is
 * frozen now: given a USDC amount + region, return the token + amount the
 * recipient actually receives, plus optional rate + settlement tx. In Phase 2
 * the hook passes USDC through unchanged (rate 1.0, no tx).
 */
export interface FxResult {
  /** Symbol of the local stablecoin delivered, e.g. "USDC" | "EURC". */
  token: string;
  /** Amount of `token` delivered, human units as a string. */
  amount: string;
  /** FX rate applied (USDC → token). 1 for a pass-through. */
  rateUsed?: number;
  /** StableFX settlement tx, when a real conversion happened. */
  txHash?: Hex;
}

/**
 * Adapter interfaces the engine programs against (one `real` flag + one method
 * each). Real + demo implementations are built in Wave 1 — do NOT implement
 * them here. `FxResult` is defined above; `ShieldOps` lives in adapters/unlink.ts.
 */

/** Pregen payout address for a recipient identifier (Dynamic waas in Wave 1). */
export interface PregenOps {
  /** True when backed by a real Dynamic env; false in demo. */
  real: boolean;
  /** Map an identifier to its (pregen) EVM payout address. */
  pregenAddress(identifier: string): Promise<{ address: Address; existed: boolean }>;
}

/** Cross-chain USDC bridge into Arc (Circle CCTP in Wave 1). */
export interface BridgeOps {
  /** True when backed by a real CCTP route + funded EOA; false in demo. */
  real: boolean;
  /** Bridge `amountUsdc` (human units) onto Arc. */
  bridge(amountUsdc: string): Promise<{ txHash?: Hex; explorerUrl?: string; simulated: boolean }>;
}

/** FX at claim time (Circle StableFX / Swap in Wave 1). */
export interface FxOps {
  /** True when backed by a real StableFX/Swap key; false in demo. */
  real: boolean;
  /** Convert `amountUsdc` into the recipient's local stablecoin for `region`. */
  convert(amountUsdc: string, region: Region | undefined, secret: Hex): Promise<FxResult>;
}

/**
 * Terminal result of a claim. Mirrors {@link EngineResult}'s shape on the
 * recipient side: where the money landed, what it became, and the receipt.
 */
export interface ClaimResult {
  /** The counterfactual account the secret reconstructs. */
  counterfactualAddress: Address;
  /** The walletless embedded account silently created for the recipient. */
  recipientAddress: Address;
  /** The batched deploy-and-withdraw transaction (real or simulated). */
  withdrawTx: TxRef;
  /**
   * The Unlink unshield (withdraw) leg, when the claim pulled funds out of the
   * shielded balance. This is the PUBLIC "out" edge for the proof view. Absent
   * when the privacy path was skipped (direct claim).
   */
  unshield?: PrivacyLeg;
  /** What the recipient received after FX (token + amount). */
  fx: FxResult;
  /** Final per-step states (for the receipt / re-open view). */
  steps: ClaimStepState[];
  /** ISO timestamp the claim completed. */
  claimedAt: string;
}

/** Terminal result of a single send through the engine. */
export interface EngineResult {
  /** The claim secret generated for this send (also inside claimPayload). */
  secret: Hex;
  /** The counterfactual recipient account that now holds (or will hold) the USDC. */
  counterfactualAddress: Address;
  /** Settlement transaction. */
  settleTx: TxRef;
  /**
   * The send-side privacy story (shield + private transfer), captured for the
   * proof view. `enabled` is false when the privacy path was skipped per §8.
   */
  privacy: PrivacyArtifacts;
  /** The payload encoded into the claim link fragment. */
  claimPayload: ClaimPayload;
  /** Final per-step states (for the architecture reveal / receipts). */
  steps: StepState[];
}

/** Callback the engine invokes as each step transitions, for live UI. */
export type StepListener = (state: StepState) => void;
