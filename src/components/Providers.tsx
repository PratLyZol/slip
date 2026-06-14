"use client";

/**
 * App providers. The Dynamic provider is REAL and mounted whenever
 * NEXT_PUBLIC_DYNAMIC_ENV_ID is present, so the header's wallet-connect works.
 * With no env id we render children directly so the app still boots without
 * Dynamic credentials (the wallet-connect control falls back to disabled).
 *
 * Dynamic config per docs/research/dynamic.md §1–2: client component,
 * environmentId + EthereumWalletConnectors, Arc testnet via overrides.evmNetworks.
 */

import {
  DynamicContextProvider,
  mergeNetworks,
} from "@dynamic-labs/sdk-react-core";
import { EthereumWalletConnectors } from "@dynamic-labs/ethereum";
import { arcDynamicNetwork, baseSepoliaDynamicNetwork } from "@/lib/adapters/arc";
import { DYNAMIC_ENV_ID } from "@/lib/config";

export default function Providers({ children }: { children: React.ReactNode }) {
  // No env id: no real wallet backend to talk to — skip the provider entirely.
  if (!DYNAMIC_ENV_ID) {
    return <>{children}</>;
  }

  return (
    <DynamicContextProvider
      settings={{
        environmentId: DYNAMIC_ENV_ID,
        walletConnectors: [EthereumWalletConnectors],
        overrides: {
          // Merge Arc testnet + Base Sepolia with any dashboard-configured networks
          // (first arg wins). Base Sepolia is needed so the embedded wallet can
          // sign the CCTP burn transaction on the source chain.
          evmNetworks: (networks) =>
            mergeNetworks([arcDynamicNetwork, baseSepoliaDynamicNetwork], networks),
        },
      }}
    >
      {children}
    </DynamicContextProvider>
  );
}
