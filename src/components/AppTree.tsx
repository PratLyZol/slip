"use client";

/**
 * The interactive provider tree. Imports the Dynamic SDK (Providers /
 * WalletProvider), which is NOT SSR-safe, so this whole tree is loaded
 * client-only via ClientRoot (next/dynamic ssr:false). Pages depend on the
 * wallet context, so the boundary has to wrap everything below the layout.
 */

import Providers from "./Providers";
import WalletProvider from "./WalletProvider";
import AppShell from "./AppShell";

export default function AppTree({ children }: { children: React.ReactNode }) {
  return (
    <Providers>
      <WalletProvider>
        <AppShell>{children}</AppShell>
      </WalletProvider>
    </Providers>
  );
}
