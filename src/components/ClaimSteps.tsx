"use client";

/**
 * Claim-side progress UI. The recipient mirror of <EngineSteps>: a vertical
 * step rail showing the claim pipeline (open → set up account → cover fees →
 * release → convert → done). Reads claim-step states streamed from runClaim.
 */

import {
  CLAIM_STEPS,
  ClaimStep,
  type ClaimStepState,
  type StepStatus,
} from "@/lib/engine/types";
import { CLAIM_STEP_META } from "@/lib/engine/stepMeta";

interface Props {
  /** Live per-step states keyed by claim step. Missing → "pending". */
  states?: Partial<Record<ClaimStep, ClaimStepState>>;
}

export default function ClaimSteps({ states }: Props) {
  return (
    <ol className="relative flex flex-col gap-1">
      {CLAIM_STEPS.map((step, i) => {
        const state = states?.[step];
        const status: StepStatus = state?.status ?? "pending";
        const meta = CLAIM_STEP_META[step];
        const isLast = i === CLAIM_STEPS.length - 1;
        return (
          <li key={step} className="relative flex gap-3.5">
            {!isLast && (
              <span
                aria-hidden
                className="absolute left-[15px] top-8 bottom-0 w-px bg-[var(--hair)]"
              />
            )}
            <StepDot index={i + 1} status={status} />
            <div className="flex-1 pb-4">
              <div className="flex items-center justify-between gap-2">
                <span
                  className={`text-[14px] font-medium ${
                    status === "pending" ? "text-text-faint" : "text-text"
                  }`}
                >
                  {meta.title}
                </span>
                <StatusTag status={status} />
              </div>
              {state?.detail && (
                <p className="mt-0.5 text-[12px] leading-snug text-text-dim">
                  {state.detail}
                  {state.explorerUrl && (
                    <>
                      {" · "}
                      <a
                        href={state.explorerUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-cool underline-offset-2 hover:underline"
                      >
                        explorer
                      </a>
                    </>
                  )}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function StepDot({ index, status }: { index: number; status: StepStatus }) {
  const base =
    "relative z-10 grid h-8 w-8 shrink-0 place-items-center rounded-full border text-[12px] font-semibold";
  if (status === "done") {
    return (
      <span className={`${base} border-volt bg-volt text-ink-950`}>
        <CheckIcon />
      </span>
    );
  }
  if (status === "running") {
    return (
      <span
        className={`${base} animate-slip-pulse border-volt text-volt`}
        style={{ background: "color-mix(in oklab, var(--volt) 12%, transparent)" }}
      >
        {index}
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className={`${base} border-danger bg-danger/15 text-danger`}>!</span>
    );
  }
  return (
    <span className={`${base} border-ink-700 text-text-faint`}>{index}</span>
  );
}

function StatusTag({ status }: { status: StepStatus }) {
  const map: Record<StepStatus, { label: string; cls: string } | null> = {
    pending: null,
    queued: null,
    running: { label: "running", cls: "text-volt" },
    done: { label: "done", cls: "text-text-faint" },
    failed: { label: "failed", cls: "text-danger" },
  };
  const tag = map[status];
  if (!tag) return null;
  return (
    <span className={`text-[10px] uppercase tracking-wide ${tag.cls}`}>
      {tag.label}
    </span>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <path
        d="m5 12.5 4.5 4.5L19 7"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
