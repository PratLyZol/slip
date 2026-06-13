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
import { addressFromSecret } from "../src/lib/engine/counterfactual.ts";
import {
  parseBatchInput,
  validRows,
  runBatch,
  batchToCsv,
} from "../src/lib/engine/batch.ts";
import { resolve, isEnsName } from "../src/lib/engine/resolve.ts";
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
    {
      recipients: [{ identifier: "alice", amountUsd: 50, region: "EU" }],
      senderName: "Demo Sender",
    },
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

  // --- Phase 3 (privacy) assertions: the bounty. ---
  const shieldStep = seen.find((s) => s.step === "shield" && s.status === "done");
  assert(shieldStep !== undefined, "shield step did not complete on send");
  assert(result.privacy.enabled === true, "privacy path should be enabled in demo");
  assert(
    result.privacy.senderUnlinkAddress?.startsWith("unlink1") === true,
    "sender unlink address should be a bech32 unlink1 address",
  );
  assert(
    result.privacy.claimUnlinkAddress?.startsWith("unlink1") === true,
    "claim unlink address should be a bech32 unlink1 address",
  );

  const depositLeg = result.privacy.legs.find((l) => l.kind === "shield");
  const transferLeg = result.privacy.legs.find((l) => l.kind === "transfer");
  assert(depositLeg !== undefined, "no shield (deposit) leg captured");
  assert(transferLeg !== undefined, "no private transfer leg captured");

  // The PUBLIC edge: deposit has a readable tx hash + explorer URL.
  assert(depositLeg!.public === true, "deposit leg should be a public edge");
  assert(
    typeof depositLeg!.txHash === "string" && depositLeg!.txHash.startsWith("0x"),
    "deposit leg must have a public tx hash",
  );

  // THE PRIVATE MIDDLE: the private transfer must leave NO public artifact —
  // no tx hash, no explorer URL — only an opaque proof reference.
  assert(transferLeg!.public === false, "private transfer must NOT be public");
  assert(
    transferLeg!.txHash === undefined,
    "private transfer must NOT expose a tx hash (no readable middle)",
  );
  assert(
    transferLeg!.explorerUrl === undefined,
    "private transfer must NOT expose an explorer URL (no readable middle)",
  );
  assert(
    typeof transferLeg!.proofRef === "string" && transferLeg!.proofRef.length > 0,
    "private transfer should carry an opaque proof reference",
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
  // v2 contract: the payout address rides in the claim PAYLOAD (the recipient's
  // Dynamic pregen address, resolved at send time) — it is NO LONGER derived
  // from the secret. The claim withdraws to exactly that payload address.
  assert(claim.recipientAddress?.startsWith("0x"), "no recipient address");
  assert(
    claim.recipientAddress === decoded.payload.recipientAddress,
    "claim payout address must equal the payload's recipientAddress",
  );
  assert(
    claim.recipientAddress !== result.counterfactualAddress,
    "recipient address must differ from the counterfactual address",
  );
  assert(claim.withdrawTx?.hash?.startsWith("0x"), "no withdraw tx hash");
  assert(claim.withdrawTx.simulated === true, "demo withdraw should be simulated");

  // --- Phase 3: the claim-side unshield is the PUBLIC "out" edge. ---
  assert(claim.unshield !== undefined, "no unshield (withdraw) leg captured");
  assert(claim.unshield!.kind === "unshield", "unshield leg has wrong kind");
  assert(claim.unshield!.public === true, "unshield should be a public edge");
  assert(
    typeof claim.unshield!.txHash === "string" &&
      claim.unshield!.txHash.startsWith("0x"),
    "unshield leg must have a public tx hash",
  );

  // --- Phase 4: EU recipient gets EURC at a realistic rate ≠ 1. ---
  assert(claim.fx.token === "EURC", "EU recipient should receive EURC");
  assert(claim.fx.rateUsed !== undefined, "EURC claim should carry an FX rate");
  assert(claim.fx.rateUsed !== 1, "EURC FX rate must differ from 1");
  assert(
    claim.fx.rateUsed! >= 0.9 && claim.fx.rateUsed! <= 0.94,
    `EURC rate ${claim.fx.rateUsed} should be a realistic EUR/USD figure`,
  );
  const expectedEurc = (50 * claim.fx.rateUsed!).toFixed(2);
  assert(
    claim.fx.amount === expectedEurc,
    `recipient EURC amount ${claim.fx.amount} should equal 50 × rate (${expectedEurc})`,
  );
  assert(
    typeof claim.fx.txHash === "string" && claim.fx.txHash!.startsWith("0x"),
    "EURC conversion should have a StableFX settlement tx hash",
  );
  assert(
    claimSeen[claimSeen.length - 1].step === "done",
    "claim should finish on the done step",
  );

  // Re-derivation determinism: the same secret must reproduce the same FX rate.
  const { fxAtClaim } = await import("../src/lib/engine/fx.ts");
  const reFx = await fxAtClaim("50.00", "EU", result.secret);
  assert(
    reFx.rateUsed === claim.fx.rateUsed,
    "FX rate must be deterministic from the secret across re-renders",
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

  // -----------------------------------------------------------------------
  // PHASE 5 — Batch: parse a 6-row list, run the engine over all rows, assert
  // N INDEPENDENT links whose payloads decode to EXACTLY their own row (no
  // cross-leakage). Print the CSV.
  // -----------------------------------------------------------------------
  console.log("→ Batch: parsing a 6-row sample and paying everyone\n");

  const SAMPLE = [
    "name, amount, region", // header (must be detected + skipped)
    "alice.eth, 250, US",
    "Mateo Rossi, 180.50, EU",
    "priya, 320, US",
    "Sofia Müller, 210, EU",
    "jordan, 95, US",
    "Luca Bianchi, 140.75, EU",
    "broken-row, notanumber, US", // invalid — must be filtered out
  ].join("\n");

  const parsed = parseBatchInput(SAMPLE);
  const valid = validRows(parsed);
  assert(parsed.length === 7, `expected 7 data rows, got ${parsed.length}`);
  assert(valid.length === 6, `expected 6 valid rows, got ${valid.length}`);
  assert(
    parsed[0].name === "alice.eth" && parsed[0].region === "US",
    "header row should have been skipped (first data row is alice.eth)",
  );
  const invalid = parsed.find((r) => r.errors.length > 0);
  assert(invalid?.name === "broken-row", "the invalid row should be 'broken-row'");

  const batchOrigin = "https://slip.cash";
  const batchResults = await runBatch(
    valid,
    batchOrigin,
    "Demo Sender",
    () => {},
    3,
  );

  assert(
    batchResults.length === 6,
    `batch should produce 6 results, got ${batchResults.length}`,
  );
  assert(
    batchResults.every((r) => r.status === "ready"),
    "every batch row should settle to 'ready'",
  );

  // INDEPENDENCE: each link is distinct AND decodes to exactly its own row.
  const seenSecrets = new Set<string>();
  for (const r of batchResults) {
    assert(r.claimUrl !== undefined, `row ${r.row.name} has no claim URL`);
    assert(r.result !== undefined, `row ${r.row.name} has no engine result`);

    const frag = r.claimUrl!.split("#")[1];
    assert(frag !== undefined, `row ${r.row.name} claim URL has no fragment`);
    const decoded = decodeClaimFragment(frag);
    assert(decoded.ok, `row ${r.row.name} claim link failed to decode`);

    // No cross-leakage: this link's payload matches THIS row only.
    assert(
      decoded.payload.amountUsdc === r.row.amount.toFixed(2),
      `row ${r.row.name}: link amount ${decoded.payload.amountUsdc} ≠ row amount ${r.row.amount.toFixed(2)}`,
    );
    assert(
      decoded.payload.region === r.row.region,
      `row ${r.row.name}: link region ${decoded.payload.region} ≠ row region ${r.row.region}`,
    );
    assert(
      decoded.payload.secret === r.result!.secret,
      `row ${r.row.name}: link secret does not match its engine result`,
    );

    // Each secret unique → genuinely independent claims.
    assert(
      !seenSecrets.has(decoded.payload.secret),
      `duplicate secret across rows — links are NOT independent (${r.row.name})`,
    );
    seenSecrets.add(decoded.payload.secret);
  }
  assert(seenSecrets.size === 6, "expected 6 unique secrets across the batch");

  const csv = batchToCsv(batchResults);
  const csvLines = csv.split("\n");
  assert(
    csvLines[0] === "name,amount,region,claimUrl",
    "CSV header mismatch",
  );
  assert(csvLines.length === 7, `CSV should have header + 6 rows, got ${csvLines.length}`);

  console.log("✓ 6 independent claim links, no cross-leakage. Payout CSV:\n");
  console.log(csv);
  console.log("");

  // -----------------------------------------------------------------------
  // PHASE 6 — ENS: attempt a real resolution of vitalik.eth with a short
  // timeout. On network failure, assert the graceful demo fallback instead
  // (don't let CI-less network flakiness fail the build).
  // -----------------------------------------------------------------------
  console.log("→ ENS: resolving vitalik.eth (real read, graceful fallback)\n");

  assert(isEnsName("vitalik.eth"), "vitalik.eth should be detected as an ENS name");
  assert(!isEnsName("alice"), "a bare name should NOT be an ENS name");

  const ens = await resolve("vitalik.eth");
  assert(ens.address.startsWith("0x"), "ENS resolve should return an address");
  if (ens.via === "ens") {
    console.log("✓ Real ENS read succeeded: vitalik.eth → " + ens.address);
  } else {
    // Network unavailable / no record → graceful fallback path.
    assert(
      ens.via === "demo" && typeof ens.note === "string",
      "ENS network failure must degrade to a demo address WITH a note",
    );
    console.log(
      "✓ ENS read unavailable — graceful fallback to demo address: " +
        ens.address +
        " (" +
        ens.note +
        ")",
    );
  }
  console.log("");

  console.log("SMOKE PASS ✅");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
