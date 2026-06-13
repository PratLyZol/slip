"use client";

import { useSyncExternalStore } from "react";

const noopSubscribe = () => () => {};

/**
 * Read a browser-only value safely across SSR + hydration without a
 * setState-in-effect. Returns `server` during SSR/first paint, then the result
 * of `read()` on the client. Used for window.location bits (origin, hash).
 */
export function useClientValue<T>(read: () => T, server: T): T {
  return useSyncExternalStore(noopSubscribe, read, () => server);
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
