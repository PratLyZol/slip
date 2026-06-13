/**
 * Shared engine types — ONE engine, two surfaces (single send + batch).
 *
 * The engine is the seven-step send pipeline (PRD §2). Every step is a typed
 * module under src/lib/engine/. Adapters (real SDK wiring) and demo
 * implementations both conform to the interfaces implied here.
 */

import type { Address, Hex } from "viem";

/** Recipient destination currency region. EU → EURC, otherwise → USDC. */
export type Region = "US" | "EU";

/** Current claim-payload schema version. Bump if the shape changes. */
export const CLAIM_PAYLOAD_VERSION = 1 as const;

/**
 * Everything the recipient needs to claim, encoded into the URL fragment.
 *
 * CRITICAL (AGENTS.md): the `secret` lives in the `/claim#...` fragment ONLY —
 * never a query string, never a server log. The fragment never leaves the
 * browser. The secret deterministically derives the counterfactual account, so
 * whoever holds the link can claim (hackathon-grade design decision, PRD §3).
 */
export interface ClaimPayload {
  /** Schema version. */
  v: number;
  /** 32-byte claim secret, hex (0x-prefixed). Salt for the counterfactual account. */
  secret: Hex;
  /** Amount of USDC settled, human units as a string (e.g. "50.00"). */
  amountUsdc: string;
  /** Optional sender display name ("Sent by alice"). */
  senderName?: string;
  /** Optional recipient region; drives FX at claim time. */
  region?: Region;
  /** ISO timestamp the slip was created. */
  createdAt: string;
}

/** A single send request entering the engine. */
export interface SendRequest {
  /** Raw recipient handle the sender typed (name / username / .eth). */
  recipient: string;
  /** Amount in USD (== USDC), human units. */
  amountUsd: number;
  /** Optional sender display name to embed in the claim link. */
  senderName?: string;
  /** Optional recipient region (defaults applied downstream). */
  region?: Region;
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

/** Result of step 1 — resolve. */
export interface ResolveResult {
  /** The address the recipient handle maps to (display only at this stage). */
  address: Address;
  /** How it was resolved, e.g. "demo" | "ens". */
  via: "demo" | "ens";
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

/** Terminal result of a single send through the engine. */
export interface EngineResult {
  /** The claim secret generated for this send (also inside claimPayload). */
  secret: Hex;
  /** The counterfactual recipient account that now holds (or will hold) the USDC. */
  counterfactualAddress: Address;
  /** Settlement transaction. */
  settleTx: TxRef;
  /** The payload encoded into the claim link fragment. */
  claimPayload: ClaimPayload;
  /** Final per-step states (for the architecture reveal / receipts). */
  steps: StepState[];
}

/** Callback the engine invokes as each step transitions, for live UI. */
export type StepListener = (state: StepState) => void;
