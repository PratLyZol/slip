/**
 * Headless smoke test for the Slip engine (Phase 0 + 1).
 *
 * Run:
 *   npx tsx scripts/smoke.ts
 *   # or: node --experimental-strip-types scripts/smoke.ts
 *
 * Exercises the engine end-to-end in demo mode: resolve → aggregate →
 * counterfactual → settle, then encodes + DECODES the claim link to prove the
 * round-trip. Prints the claim URL. Exits non-zero on any failure.
 */

import { runSend } from "../src/lib/engine/index.ts";
import { runClaim } from "../src/lib/engine/claim.ts";
import {
  buildClaimUrl,
  decodeClaimFragment,
  encodeClaimFragment,
} from "../src/lib/engine/claimLink.ts";
import {
  addressFromSecret,
  recipientAddressFromSecret,
} from "../src/lib/engine/counterfactual.ts";
import type {
  ClaimStepState,
  StepState,
} from "../src/lib/engine/types.ts";

// Force demo mode for the headless run (no Dynamic env id present anyway).
process.env.NEXT_PUBLIC_DEMO_MODE = "true";

const ORIGIN = "https://slip.cash";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`SMOKE FAIL: ${msg}`);
}

async function main() {
  console.log("→ Running send: 'alice' for $50.00 (EU / EURC)\n");

  const seen: StepState[] = [];
  const result = await runSend(
    { recipient: "alice", amountUsd: 50, senderName: "Demo Sender", region: "EU" },
    (s) => {
      seen.push(s);
      if (s.status !== "queued") {
        console.log(`   [${s.status.padEnd(7)}] ${s.step}${s.detail ? " — " + s.detail : ""}`);
      }
    },
  );

  console.log("");

  // --- Assertions ---
  assert(result.counterfactualAddress?.startsWith("0x"), "no counterfactual address");
  assert(result.settleTx?.hash?.startsWith("0x"), "no settle tx hash");
  assert(result.settleTx.simulated === true, "demo settle should be simulated");
  assert(
    result.counterfactualAddress === addressFromSecret(result.secret),
    "counterfactual address is not derivable from the secret",
  );

  // Round-trip the claim link.
  const fragment = encodeClaimFragment(result.claimPayload);
  const decoded = decodeClaimFragment("#" + fragment);
  assert(decoded.ok, "claim fragment failed to decode");
  assert(decoded.payload.secret === result.secret, "decoded secret mismatch");
  assert(decoded.payload.amountUsdc === "50.00", "decoded amount mismatch");
  assert(decoded.payload.region === "EU", "decoded region mismatch");

  const claimUrl = buildClaimUrl(result.claimPayload, ORIGIN);

  console.log("✓ Funded (simulated) counterfactual account:");
  console.log("   " + result.counterfactualAddress);
  console.log("   settle tx: " + result.settleTx.hash + " (simulated)");
  console.log("   explorer:  " + result.settleTx.explorerUrl);
  console.log("");
  console.log("✓ Claim link round-trips cleanly. Claim URL:");
  console.log("   " + claimUrl);
  console.log("");

  // --- Claim flow: take the decoded payload and run the recipient pipeline. ---
  console.log("→ Running claim from the decoded link (walletless + gasless)\n");

  const claimSeen: ClaimStepState[] = [];
  const claim = await runClaim(decoded.payload, (s) => {
    claimSeen.push(s);
    console.log(
      `   [${s.status.padEnd(7)}] ${s.step}${s.detail ? " — " + s.detail : ""}`,
    );
  });

  console.log("");

  // --- Claim assertions ---
  assert(claim.recipientAddress?.startsWith("0x"), "no recipient address");
  assert(
    claim.recipientAddress === recipientAddressFromSecret(result.secret),
    "recipient address is not derivable from the secret",
  );
  assert(
    claim.recipientAddress !== result.counterfactualAddress,
    "recipient address must differ from the counterfactual address",
  );
  assert(claim.withdrawTx?.hash?.startsWith("0x"), "no withdraw tx hash");
  assert(claim.withdrawTx.simulated === true, "demo withdraw should be simulated");
  // EU send → recipient receives EURC; amount passes through 1:1 in Phase 2.
  assert(claim.fx.token === "EURC", "EU recipient should receive EURC");
  assert(claim.fx.amount === "50.00", "recipient should end with the amount");
  assert(
    claimSeen[claimSeen.length - 1].step === "done",
    "claim should finish on the done step",
  );

  console.log("✓ Recipient claimed — receipt:");
  console.log("   recipient account: " + claim.recipientAddress);
  console.log(
    `   received:          ${claim.fx.amount} ${claim.fx.token}` +
      (claim.fx.rateUsed !== undefined ? ` (rate ${claim.fx.rateUsed})` : ""),
  );
  console.log("   withdraw tx:       " + claim.withdrawTx.hash + " (simulated)");
  console.log("   explorer:          " + claim.withdrawTx.explorerUrl);
  console.log("   claimed at:        " + claim.claimedAt);
  console.log("");
  console.log("SMOKE PASS ✅");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
