/**
 * The BRIDGE leg of the engine — CCTP aggregation, ONCE, independently retriable.
 *
 * Extracted from the old monolithic `runBatchSend` (the Aggregate step) so the
 * UI can run bridge and distribute as separate, retriable steps. This leg:
 *   1. validates the wallet's connected ORIGIN chain is a CCTP burn source,
 *   2. verifies the sender holds enough USDC there ({@link aggregate}),
 *   3. burns Σ on the origin chain + mints it on Arc ({@link bridgeToArc}).
 *
 * It emits the same {@link EngineStep.Aggregate} states the old pipeline did, so
 * existing progress UIs still read. On any failure it throws honestly (no silent
 * simulation) — the bridge can be retried on its own.
 */

import { formatUsd } from "../format";
import { cctpSourceByChainId } from "../adapters/cctp-chains";
import { aggregate, bridgeToArc } from "./aggregate";
import {
  EngineStep,
  type BridgeRequest,
  type BridgeResult,
  type StepListener,
  type StepState,
} from "./types";

/**
 * Run the bridge (CCTP aggregation) leg — burn Σ on the connected origin chain,
 * mint it onto Arc, ONCE. Independently retriable; carries no recipient concern.
 *
 * @param req     amount + sender + origin-chain + wallet-client accessor
 * @param onStep  optional listener fired as the Aggregate step transitions
 */
export async function runBridge(
  req: BridgeRequest,
  onStep?: StepListener,
): Promise<BridgeResult> {
  const emit = (state: StepState) => onStep?.(state);

  const total = req.amountUsd;
  const totalUsdc = total.toFixed(2);

  // Aggregate. (a) verify the sender holds enough USDC for Σ, then (b) the REAL
  // aggregation — a Circle CCTP bridge of Σ ONCE (burn on the origin chain, mint
  // on Arc, forwarder mode). PLAN §4: CCTP genuinely IS "aggregation" here.
  emit({ step: EngineStep.Aggregate, status: "running" });

  // The wallet's connected ORIGIN chain is the CCTP burn source. It must be a
  // chain CCTP can burn from; the UI gates on this too, but validate here as
  // defence in depth.
  const originSource = cctpSourceByChainId(req.originChainId);
  if (!originSource) {
    emit({
      step: EngineStep.Aggregate,
      status: "failed",
      detail: "Switch your wallet to a supported network to send",
    });
    throw new Error(
      `Wallet is on an unsupported network (chain ${req.originChainId ?? "unknown"}). ` +
        "Switch to a CCTP-supported chain (e.g. Base Sepolia) before sending.",
    );
  }

  // Sufficiency check reads the connected wallet's USDC on that origin chain.
  const agg = await aggregate(total, req.senderAddress, originSource.chainId);
  if (!agg.sufficient) {
    emit({
      step: EngineStep.Aggregate,
      status: "failed",
      detail: `Insufficient USDC (have ${formatUsd(agg.availableUsdc)})`,
    });
    throw new Error(
      `Insufficient USDC balance: have ${formatUsd(agg.availableUsdc)}, need ${formatUsd(total)}.`,
    );
  }

  // Bridge Σ onto Arc ONCE (mint to the connected sender's Arc address, where
  // the funds land before the shield). A live CCTP burn+mint; on failure it
  // throws honestly (no silent fallback) and the bridge aborts at this step.
  if (!req.senderAddress) {
    emit({
      step: EngineStep.Aggregate,
      status: "failed",
      detail: "Connect a wallet to receive the aggregated USDC on Arc",
    });
    throw new Error("No sender wallet connected — connect a wallet before sending.");
  }

  // Resolve the origin-chain wallet client HERE — the engine owns the wallet
  // seam; bridgeToArc receives a ready WalletClient (frozen contract:
  // `bridgeToArc(params, walletClient)`). Throw an honest "connect a wallet"
  // error if it's missing rather than silently routing to a server bridge.
  if (!req.getWalletClient) {
    emit({
      step: EngineStep.Aggregate,
      status: "failed",
      detail: "Connect a wallet to sign the CCTP burn on the origin chain",
    });
    throw new Error("No wallet connected — connect a wallet before sending.");
  }
  const originWalletClient = await req.getWalletClient(
    String(originSource.chainId),
  );
  if (!originWalletClient) {
    emit({
      step: EngineStep.Aggregate,
      status: "failed",
      detail: `Could not get a ${originSource.name} wallet client — allow the network`,
    });
    throw new Error(
      `Could not obtain a ${originSource.name} wallet client — connect a wallet and allow the ${originSource.name} network.`,
    );
  }

  const bridge = await bridgeToArc(
    {
      amountUsdc: totalUsdc,
      recipientAddress: req.senderAddress,
      // Burn from the wallet's connected origin chain (dynamic CCTP source).
      sourceChain: originSource.bridgeKitChain,
    },
    // Frozen seam: the engine passes the resolved ORIGIN WalletClient that signs
    // the wallet-funded CCTP burn (real mode).
    originWalletClient,
  );

  emit({
    step: EngineStep.Aggregate,
    status: "done",
    detail: bridge.simulated
      ? `Bridged ${formatUsd(total)} onto Arc via CCTP (simulated)`
      : `Bridged ${formatUsd(total)} onto Arc via CCTP`,
    // The mint on Arc is the readable artifact of the aggregation step.
    explorerUrl: bridge.mintTx.explorerUrl,
  });

  return {
    burnTx: bridge.burnTx,
    mintTx: bridge.mintTx,
    amountUsdc: totalUsdc,
    arcAddress: req.senderAddress,
  };
}
