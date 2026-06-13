/** Human-facing metadata for the seven engine steps (used by progress UI + architecture). */

import { ClaimStep, EngineStep } from "./types";

export interface StepMeta {
  step: EngineStep;
  /** Short title shown in the progress list. */
  title: string;
  /** One-line description for the architecture reveal. */
  blurb: string;
}

/** Human-facing metadata for the claim-side pipeline (recipient progress UI). */
export interface ClaimStepMeta {
  step: ClaimStep;
  title: string;
  blurb: string;
}

export const STEP_META: Record<EngineStep, StepMeta> = {
  [EngineStep.Resolve]: {
    step: EngineStep.Resolve,
    title: "Resolve recipient",
    blurb: "Turn a name into an identity. No wallet address to copy.",
  },
  [EngineStep.Aggregate]: {
    step: EngineStep.Aggregate,
    title: "Aggregate to USDC",
    blurb: "Consolidate the sender's holdings into spendable USDC.",
  },
  [EngineStep.Counterfactual]: {
    step: EngineStep.Counterfactual,
    title: "Derive claim account",
    blurb: "A per-slip secret derives the recipient's account — before it exists on-chain.",
  },
  [EngineStep.Shield]: {
    step: EngineStep.Shield,
    title: "Shield the transfer",
    blurb: "Route through a private balance so amount and graph stay invisible.",
  },
  [EngineStep.Settle]: {
    step: EngineStep.Settle,
    title: "Settle USDC",
    blurb: "Move USDC to the claim account. The account isn't deployed yet.",
  },
  [EngineStep.SponsorGas]: {
    step: EngineStep.SponsorGas,
    title: "Sponsor gas",
    blurb: "A paymaster covers fees. Neither party ever touches a gas token.",
  },
  [EngineStep.Claim]: {
    step: EngineStep.Claim,
    title: "Claim & convert",
    blurb: "Tapping the link deploys, withdraws, and FX's into local money — in one go.",
  },
};

export const CLAIM_STEP_META: Record<ClaimStep, ClaimStepMeta> = {
  [ClaimStep.Validate]: {
    step: ClaimStep.Validate,
    title: "Open the slip",
    blurb: "Read the secret from the link. Nothing was ever sent to a server.",
  },
  [ClaimStep.Reconstruct]: {
    step: ClaimStep.Reconstruct,
    title: "Set up your account",
    blurb: "An account is created for you from the link — no wallet, no seed phrase.",
  },
  [ClaimStep.SponsorGas]: {
    step: ClaimStep.SponsorGas,
    title: "Cover the fees",
    blurb: "Gas is sponsored. You never touch a gas token or see a prompt.",
  },
  [ClaimStep.Withdraw]: {
    step: ClaimStep.Withdraw,
    title: "Release the money",
    blurb: "Deploy and withdraw in one batched transaction.",
  },
  [ClaimStep.Convert]: {
    step: ClaimStep.Convert,
    title: "Into your money",
    blurb: "Convert to your local stablecoin at claim time.",
  },
  [ClaimStep.Done]: {
    step: ClaimStep.Done,
    title: "Done",
    blurb: "The money is yours.",
  },
};
