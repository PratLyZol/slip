import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Spline_Sans_Mono } from "next/font/google";
import "./globals.css";
import Providers from "@/components/Providers";
import WalletProvider from "@/components/WalletProvider";
import AppShell from "@/components/AppShell";

const display = Bricolage_Grotesque({
  variable: "--font-display",
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
  themeColor: "#07080a",
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
      className={`${display.variable} ${figures.variable} h-full antialiased`}
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
