"use client";

/**
 * Client-only boundary for the whole interactive app. The Dynamic SDK touches
 * `window` at module-eval, so it must never be part of the SSR/prerender bundle
 * (it was crashing /_not-found with "window is not defined"). Loading AppTree
 * with ssr:false keeps all Dynamic code on the client. A skeleton renders during
 * the brief client load.
 */

import dynamic from "next/dynamic";

const AppTree = dynamic(() => import("./AppTree"), {
  ssr: false,
  loading: () => (
    <div className="mx-auto flex min-h-dvh w-full max-w-[440px] items-center justify-center">
      <div className="h-9 w-9 animate-slip-pulse rounded-full border-2 border-volt border-t-transparent" />
    </div>
  ),
});

export default function ClientRoot({ children }: { children: React.ReactNode }) {
  return <AppTree>{children}</AppTree>;
}
