import type { NextConfig } from "next";
import path from "node:path";

/**
 * Next.js 16 builds with Turbopack by default (`next build`). The CCTP bridge
 * (@circle-fin/bridge-kit + @circle-fin/adapter-viem-v2) now runs in the BROWSER
 * client bundle because the burn is signed by the connected wallet client-side.
 *
 * Those packages and their transitive deps all ship browser-safe builds:
 *   - pino@10 exposes a `browser` field (→ browser.js, no Node built-ins)
 *   - @solana/web3.js and @ethersproject/* are browser-compatible
 *   - zod / abitype / bs58 are pure JS
 * so Turbopack resolves them for the client without Node-built-in shims. This is
 * verified by `npm run build` (the client compile succeeds). We transpile the
 * Circle packages explicitly so their published ESM/CJS is processed through the
 * app's pipeline rather than treated as opaque externals.
 */
const nextConfig: NextConfig = {
  transpilePackages: [
    "@circle-fin/bridge-kit",
    "@circle-fin/adapter-viem-v2",
    "@circle-fin/provider-cctp-v2",
  ],
  turbopack: {
    // The repo sits under a parent dir that also has a lockfile; pin the root to
    // this project so Turbopack resolves modules from here (silences the
    // multi-lockfile workspace-root warning and avoids mis-rooted resolution).
    root: path.join(__dirname),
  },
};

export default nextConfig;
