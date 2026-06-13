/**
 * Recipient region detection — runs in the CLAIMANT's browser at claim time.
 *
 * The sender no longer picks a currency on the home screen; the recipient's
 * local currency is determined when THEY open the claim link, from their own
 * device locale/timezone. EU/eurozone → EURC, everywhere else → USDC.
 *
 * Timezone is the primary signal (Europe/* is a strong eurozone proxy and isn't
 * affected by browser UI language); the locale country code is a fallback.
 */

import type { Region } from "./engine/types";

/** Country codes (ISO-3166-1 alpha-2, lowercase) that use the euro. */
const EUROZONE = new Set([
  "at", "be", "hr", "cy", "ee", "fi", "fr", "de", "gr", "ie", "it", "lv",
  "lt", "lu", "mt", "nl", "pt", "sk", "si", "es",
]);

/** Detect the claimant's region from their device. Defaults to US/USDC. */
export function detectRegion(): Region {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
    if (tz.startsWith("Europe/")) return "EU";

    // Fallback: locale country code (e.g. "fr-FR" → "fr").
    const locales: readonly string[] =
      (typeof navigator !== "undefined" &&
        (navigator.languages?.length
          ? navigator.languages
          : navigator.language
            ? [navigator.language]
            : [])) || [];
    for (const loc of locales) {
      const country = loc.split("-")[1]?.toLowerCase();
      if (country && EUROZONE.has(country)) return "EU";
    }
  } catch {
    // Intl / navigator unavailable — fall through to the default.
  }
  return "US";
}

/** Human label for a detected region (for transparent UI copy). */
export function regionLabel(region: Region): string {
  return region === "EU" ? "Europe" : "United States";
}
