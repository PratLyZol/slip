/** Human-facing metadata for the seven engine steps (used by progress UI + architecture). */

import { EngineStep } from "./types";

export interface StepMeta {
  step: EngineStep;
  /** Short title shown in the progress list. */
  title: string;
  /** One-line description for the architecture reveal. */
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
