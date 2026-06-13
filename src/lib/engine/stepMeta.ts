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
    blurb:
      "Deposit USDC into an Unlink shielded balance, then privately transfer it to the claim — the leg where the amount and the sender→recipient edge vanish on-chain.",
  },
  [EngineStep.Settle]: {
    step: EngineStep.Settle,
    title: "Park the money",
    blurb:
      "The value now sits in the claim's shielded balance, waiting. No public USDC transfer to the claim account ever happens.",
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
    blurb:
      "Withdraw out of the shielded balance to your account — the public 'out' edge. The shielded source stays unlinkable.",
  },
  [ClaimStep.Convert]: {
    step: ClaimStep.Convert,
    title: "Into your money",
    blurb: "Convert USDC to your local stablecoin at claim time, at a live FX rate.",
  },
  [ClaimStep.Done]: {
    step: ClaimStep.Done,
    title: "Done",
    blurb: "The money is yours.",
  },
};
