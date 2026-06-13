"use client";

/**
 * App providers. The Dynamic provider is REAL but conditionally mounted:
 * only when NEXT_PUBLIC_DYNAMIC_ENV_ID is present. With no env id we're in demo
 * mode and render children directly — the provider must never crash the demo.
 *
 * Dynamic config per docs/research/dynamic.md §1–2: client component,
 * environmentId + EthereumWalletConnectors, Arc testnet via overrides.evmNetworks.
 */

import {
  DynamicContextProvider,
  mergeNetworks,
} from "@dynamic-labs/sdk-react-core";
import { EthereumWalletConnectors } from "@dynamic-labs/ethereum";
import { arcDynamicNetwork } from "@/lib/adapters/arc";
import { DYNAMIC_ENV_ID, isDemoMode } from "@/lib/config";

export default function Providers({ children }: { children: React.ReactNode }) {
  // Demo mode (or no env id): skip the real provider entirely.
  if (isDemoMode() || !DYNAMIC_ENV_ID) {
    return <>{children}</>;
  }

  return (
    <DynamicContextProvider
      settings={{
        environmentId: DYNAMIC_ENV_ID,
        walletConnectors: [EthereumWalletConnectors],
        overrides: {
          // Merge Arc testnet with any dashboard-configured networks (first arg wins).
          evmNetworks: (networks) =>
            mergeNetworks([arcDynamicNetwork], networks),
        },
      }}
    >
      {children}
    </DynamicContextProvider>
  );
}
