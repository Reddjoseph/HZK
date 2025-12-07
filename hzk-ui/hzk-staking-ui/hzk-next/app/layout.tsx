import type { Metadata } from "next";
import "./globals.css";
import WalletProviders from "@/components/WalletProviders";
import BufferPolyfill from "@/components/BufferPolyfill";
import AppToaster from "@/components/Toaster";

export const metadata: Metadata = {
  title: "HZK Staking Dashboard",
  description: "Built for devnet. Test with Phantom on devnet.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <WalletProviders>
          <BufferPolyfill />
          <AppToaster />
          {children}
        </WalletProviders>
      </body>
    </html>
  );
}
