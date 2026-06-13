"use client";

import { useRef, useSyncExternalStore } from "react";

const noopSubscribe = () => () => {};

/**
 * Read a browser-only value safely across SSR + hydration without a
 * setState-in-effect. Returns `server` during SSR/first paint, then the result
 * of `read()` on the client. Used for window.location bits (origin, hash).
 *
 * The client snapshot is computed ONCE and cached — useSyncExternalStore
 * requires getSnapshot to return a stable value between subscribe events
 * (a fresh object every call trips React's infinite-loop guard). These are
 * load-time reads (origin, hash, localStorage), so once is correct.
 */
export function useClientValue<T>(read: () => T, server: T): T {
  const cache = useRef<{ value: T } | null>(null);
  return useSyncExternalStore(
    noopSubscribe,
    () => {
      if (cache.current === null) cache.current = { value: read() };
      return cache.current.value;
    },
    () => server,
  );
}

/** The current window origin, or "" on the server. */
export function useOrigin(): string {
  return useClientValue(() => window.location.origin, "");
}

/**
 * The current window hash (including leading '#'). Returns `server` on the
 * server / first paint — pass a sentinel to distinguish SSR from an empty hash.
 */
export function useHash(server = ""): string {
  return useClientValue(() => window.location.hash, server);
}
