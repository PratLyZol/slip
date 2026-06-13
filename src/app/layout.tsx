import type { Metadata, Viewport } from "next";
import {
  Instrument_Serif,
  Schibsted_Grotesk,
  Spline_Sans_Mono,
} from "next/font/google";
import "./globals.css";
import Providers from "@/components/Providers";
import WalletProvider from "@/components/WalletProvider";
import AppShell from "@/components/AppShell";

const serif = Instrument_Serif({
  variable: "--font-display",
  weight: "400",
  style: ["normal", "italic"],
  subsets: ["latin"],
});

const body = Schibsted_Grotesk({
  variable: "--font-body",
  subsets: ["latin"],
});

const figures = Spline_Sans_Mono({
  variable: "--font-figures",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Slip — pay anyone, in their own money",
  description:
    "Type a name and an amount. They tap a link and have money in their local currency — no wallet, no gas, no chain. Private by default.",
};

export const viewport: Viewport = {
  themeColor: "#0c0b08",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${serif.variable} ${body.variable} ${figures.variable} h-full antialiased`}
    >
      <body className="app-canvas grain min-h-dvh text-text">
        <Providers>
          <WalletProvider>
            <AppShell>{children}</AppShell>
          </WalletProvider>
        </Providers>
      </body>
    </html>
  );
}
