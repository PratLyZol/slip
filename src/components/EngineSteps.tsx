"use client";

/**
 * The seven-step progress UI. Doubles as the architecture reveal (PRD demo
 * kill-shot), so it's built to read well both while running (live statuses) and
 * statically (showcase mode with blurbs). Shield/SponsorGas/Claim render as
 * "queued" until later agents wire them.
 */

import {
  ENGINE_STEPS,
  EngineStep,
  type StepState,
  type StepStatus,
} from "@/lib/engine/types";
import { STEP_META } from "@/lib/engine/stepMeta";

interface Props {
  /** Live per-step states keyed by step. Missing → "pending". */
  states?: Partial<Record<EngineStep, StepState>>;
  /** Showcase mode: always show blurbs, ignore live status nuance. */
  showcase?: boolean;
}

export default function EngineSteps({ states, showcase = false }: Props) {
  return (
    <ol className="relative flex flex-col gap-1">
      {ENGINE_STEPS.map((step, i) => {
        const state = states?.[step];
        const status: StepStatus = state?.status ?? "pending";
        const meta = STEP_META[step];
        const isLast = i === ENGINE_STEPS.length - 1;
        return (
          <li key={step} className="relative flex gap-3.5">
            {/* connector rail */}
            {!isLast && (
              <span
                aria-hidden
                className="absolute left-[15px] top-8 bottom-0 w-px bg-[var(--hair)]"
              />
            )}
            <StepDot
              index={i + 1}
              status={status}
              cool={step === EngineStep.Shield}
            />
            <div className="flex-1 pb-4">
              <div className="flex items-center justify-between gap-2">
                <span
                  className={`text-[14px] font-medium ${
                    status === "pending"
                      ? "text-text-faint"
                      : status === "queued"
                        ? "text-text-dim"
                        : "text-text"
                  }`}
                >
                  {meta.title}
                </span>
                <StatusTag status={status} />
              </div>
              {showcase ? (
                <>
                  <p className="mt-0.5 text-[12.5px] leading-snug text-text-dim">
                    {meta.blurb}
                  </p>
                  {meta.sponsors && meta.sponsors.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {meta.sponsors.map((s) => (
                        <span
                          key={s}
                          className="rounded-md border border-[var(--hair)] bg-ink-850 px-1.5 py-0.5 text-[10px] font-medium text-text-faint"
                        >
                          {s}
                        </span>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                state?.detail && (
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
                )
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function StepDot({
  index,
  status,
  cool = false,
}: {
  index: number;
  status: StepStatus;
  cool?: boolean;
}) {
  const base =
    "relative z-10 grid h-8 w-8 shrink-0 place-items-center rounded-full border text-[12px] font-semibold amount-figure";
  // The shield step completes in the cool accent — privacy reads differently.
  const accent = cool ? "var(--cool)" : "var(--volt)";
  if (status === "done") {
    return (
      <span
        className={`${base} text-ink-950`}
        style={{
          borderColor: accent,
          background: accent,
          boxShadow: `0 0 16px -4px color-mix(in oklab, ${accent} 60%, transparent)`,
        }}
      >
        <CheckIcon />
      </span>
    );
  }
  if (status === "running") {
    return (
      <span
        className={`${base} animate-slip-pulse`}
        style={{
          borderColor: accent,
          color: accent,
          background: `color-mix(in oklab, ${accent} 12%, transparent)`,
        }}
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
  if (status === "queued") {
    return (
      <span className={`${base} border-dashed border-ink-600 text-text-faint`}>
        {index}
      </span>
    );
  }
  return (
    <span className={`${base} border-ink-700 text-text-faint`}>{index}</span>
  );
}

function StatusTag({ status }: { status: StepStatus }) {
  const map: Record<StepStatus, { label: string; cls: string } | null> = {
    pending: null,
    running: { label: "running", cls: "text-volt" },
    done: { label: "done", cls: "text-text-faint" },
    failed: { label: "failed", cls: "text-danger" },
    queued: { label: "queued", cls: "text-text-faint" },
  };
  const tag = map[status];
  if (!tag) return null;
  return (
    <span
      className={`rounded-full border border-[var(--hair)] bg-ink-850 px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.1em] ${tag.cls}`}
    >
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
