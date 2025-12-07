import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HZK Staking Dashboard",
  description: "Built for devnet. Test with Phantom on devnet.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        {children}
      </body>
    </html>
  );
}
