"use client";

/**
 * Mobile-first app shell: a centered device-width column with a top bar
 * (brand + wallet pill) and a bottom tab nav. On larger screens it floats as a
 * phone-sized canvas so the consumer-fintech feel reads on desktop too.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import WalletPill from "./WalletPill";

const NAV = [
  { href: "/", label: "Send", icon: SendIcon },
  { href: "/batch", label: "Batch", icon: BatchIcon },
  { href: "/private", label: "Private", icon: ShieldIcon },
  { href: "/architecture", label: "How", icon: LayersIcon },
] as const;

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[440px] flex-col">
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-[var(--hair)] bg-[var(--ink-950)]/80 px-5 py-3.5 backdrop-blur-xl">
        <Link href="/" className="flex items-center gap-2">
          <Wordmark />
        </Link>
        <WalletPill />
      </header>

      <main className="flex flex-1 flex-col px-5 pb-28 pt-4">{children}</main>

      <nav className="fixed inset-x-0 bottom-0 z-20 mx-auto w-full max-w-[440px] border-t border-[var(--hair)] bg-[var(--ink-900)]/90 px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur-xl">
        <ul className="flex items-stretch justify-between">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active =
              href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <li key={href} className="flex-1">
                <Link
                  href={href}
                  className={`relative flex flex-col items-center gap-1 rounded-xl py-2 text-[11px] font-semibold transition-colors ${
                    active
                      ? "text-volt"
                      : "text-text-faint hover:text-text-dim"
                  }`}
                >
                  {active && (
                    <span
                      aria-hidden
                      className="absolute -top-2 h-0.5 w-7 rounded-full bg-volt shadow-[0_0_8px_var(--volt)]"
                    />
                  )}
                  <Icon active={active} />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}

function Wordmark() {
  return (
    <span className="flex items-center gap-2">
      <span className="grid h-7 w-7 place-items-center rounded-lg bg-volt text-ink-950 shadow-[0_0_20px_-4px_var(--volt)]">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
          <path
            d="M5 14.5 11 6l2 6 6-2-8 8.5L9 12z"
            fill="currentColor"
          />
        </svg>
      </span>
      <span className="display text-[18px] font-bold">Slip</span>
    </span>
  );
}

type IconProps = { active?: boolean };
const stroke = (active?: boolean) => (active ? "var(--volt)" : "currentColor");

function SendIcon({ active }: IconProps) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path
        d="M3.5 12 20 4l-4.5 16-4-6.5L3.5 12Z"
        stroke={stroke(active)}
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function BatchIcon({ active }: IconProps) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path
        d="M4 6h16M4 12h16M4 18h10"
        stroke={stroke(active)}
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}
function ShieldIcon({ active }: IconProps) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path
        d="M12 3 5 6v5c0 4 3 6.5 7 8 4-1.5 7-4 7-8V6l-7-3Z"
        stroke={stroke(active)}
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function LayersIcon({ active }: IconProps) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path
        d="m12 3 9 5-9 5-9-5 9-5Z"
        stroke={stroke(active)}
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path
        d="m3 12 9 5 9-5"
        stroke={stroke(active)}
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}
